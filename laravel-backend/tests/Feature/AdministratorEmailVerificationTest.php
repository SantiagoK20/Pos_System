<?php

namespace Tests\Feature;

use Kreait\Firebase\Auth\UserRecord;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Sleep;
use Kreait\Firebase\Contract\Auth;
use Kreait\Firebase\Exception\Auth\RevokedIdToken;
use Kreait\Firebase\Exception\Auth\FailedToVerifyToken;
use Lcobucci\JWT\Token\DataSet;
use Lcobucci\JWT\UnencryptedToken;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AdministratorEmailVerificationTest extends TestCase
{
    public static function localPosEnvironments(): array
    {
        return ['development' => ['local', true], 'hosted production' => ['production', false]];
    }

    #[DataProvider('localPosEnvironments')]
    public function test_only_development_retries_a_future_token(string $environment, bool $retries): void
    {
        $this->app->detectEnvironment(static fn () => $environment);
        config(['pos.admin_uids' => 'allowed-uid', 'pos.admin_mfa_uid' => '']);
        Sleep::fake();
        try {
            $token = Mockery::mock(UnencryptedToken::class);
            $auth = Mockery::mock(Auth::class);
            $auth->shouldReceive('verifyIdToken')->once()->ordered()->with('future-token', true)
                ->andThrow(new FailedToVerifyToken('The token was issued in the future'));
            if ($retries) {
                $token->shouldReceive('claims')->once()->andReturn(new DataSet([
                    'sub' => 'allowed-uid', 'email_verified' => true,
                ], ''));
                $auth->shouldReceive('verifyIdToken')->once()->ordered()->with('future-token', true)->andReturn($token);
                $auth->shouldReceive('getUser')->once()->with('allowed-uid')->andReturn($this->administrator(true));
            } else {
                $auth->shouldNotReceive('getUser');
            }
            $this->app->instance('firebase.auth', $auth);

            $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1'])->withToken('future-token')
                ->getJson('/api/pos/email-verification')->assertStatus($retries ? 204 : 401);
            Sleep::assertSleptTimes($retries ? 1 : 0);
        } finally {
            Sleep::fake(false);
        }
    }

    public static function accounts(): array
    {
        return [
            'UID administrator' => ['allowed-uid', 'admin@example.test', 204],
            'legacy administrator' => ['legacy-uid', 'legacy@example.test', 204],
            'cashier' => ['cashier-uid', 'cashier@cashier.atecles-pos.com', 403],
            'unlisted account' => ['other-uid', 'other@example.test', 403],
        ];
    }

    #[DataProvider('accounts')]
    public function test_only_verified_administrator_identities_can_use_the_action(string $uid, string $email, int $status): void
    {
        $this->fakeNoAdministratorRequests();
        config(['pos.admin_uids' => 'allowed-uid', 'pos.legacy_admin_email' => 'legacy@example.test']);
        $token = Mockery::mock(UnencryptedToken::class);
        $token->shouldReceive('claims')->once()->andReturn(new DataSet(['sub' => $uid, 'email_verified' => $status === 204], ''));
        $auth = Mockery::mock(Auth::class);
        $auth->shouldReceive('verifyIdToken')->once()->with('test-token', true)->andReturn($token);
        $auth->shouldReceive('getUser')->once()->with($uid)->andReturn(UserRecord::fromResponseData([
            'localId' => $uid,
            'createdAt' => '1700000000000',
            'email' => $email,
            'emailVerified' => $status === 204,
            'customAttributes' => '{"role":"authenticated"}',
        ]));
        $auth->shouldNotReceive('sendEmailVerificationLink');
        $this->app->instance('firebase.auth', $auth);

        $response = $this->withToken('test-token')
            ->getJson('/api/pos/email-verification?email=untrusted@example.test&uid=allowed-uid')
            ->assertStatus($status)
            ->assertHeaderContains('Cache-Control', 'no-store')
            ->assertDontSee($email)
            ->assertDontSee('untrusted@example.test');

        if ($status === 204) {
            $response->assertNoContent();
        }
    }

    public function test_provisioning_creates_an_unverified_account_and_requests_firebase_delivery(): void
    {
        config(['pos.admin_uids' => 'allowed-uid', 'services.pos_login.cache_store' => 'array']);
        $auth = Mockery::mock(Auth::class);
        $auth->shouldReceive('createUser')->once()->with([
            'uid' => 'allowed-uid', 'email' => 'admin@example.test',
            'password' => 'fixture-password', 'emailVerified' => false,
        ])->andReturn($this->administrator(false));
        $auth->shouldReceive('sendEmailVerificationLink')->once()->with('admin@example.test');
        $auth->shouldNotReceive('createCustomToken');
        $this->app->instance('firebase.auth', $auth);
        $this->artisan('pos:create-administrator', ['email' => 'admin@example.test', 'uid' => 'allowed-uid'])
            ->expectsQuestion('New administrator password', 'fixture-password')
            ->expectsQuestion('Confirm password', 'fixture-password')
            ->assertSuccessful();
    }

    public static function unverifiedStates(): array
    {
        return [
            'unverified account' => [false, false],
            'stale token after verification' => [true, false],
            'stale token after verification lost' => [false, true],
            'missing claim' => [true, null],
            'non-boolean claim' => [true, 'true'],
        ];
    }

    #[DataProvider('unverifiedStates')]
    public function test_unverified_administrator_cannot_enter_pos_or_call_protected_routes(bool $recordVerified, mixed $claim): void
    {
        $auth = $this->mockSignIn($recordVerified, $claim);
        $auth->shouldNotReceive('sendEmailVerificationLink');
        $this->postJson('/api/pos/login', $this->credentials())->assertForbidden()
            ->assertJsonPath('code', 'email_verification_required')->assertJsonMissingPath('data.token');

        $this->withToken('test-token');
        $this->getJson('/api/cashiers')->assertForbidden()->assertJsonPath('code', 'email_verification_required');
        $this->postJson('/api/sales')->assertForbidden()->assertJsonPath('code', 'email_verification_required');
        $this->postJson('/api/kitchen/sync-pending')->assertForbidden();
        $this->getJson('/api/kitchen/config')->assertForbidden()->assertJsonPath('code', 'email_verification_required');
        $this->postJson('/api/kitchen/session')->assertForbidden()->assertJsonMissingPath('data.token');
    }

    public function test_resend_uses_the_registered_email_and_cools_down_across_sources(): void
    {
        $auth = $this->mockSignIn(false, false);
        $auth->shouldReceive('sendEmailVerificationLink')->twice()->with('admin@example.test');
        $payload = $this->credentials() + ['resendVerification' => true, 'email' => 'untrusted@example.test'];
        $this->postJson('/api/pos/login', $payload)->assertOk()
            ->assertJsonPath('message', 'Verification email sent. Check your inbox or spam folder.')
            ->assertJsonMissingPath('data.token');
        $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.2'])
            ->postJson('/api/pos/login', $payload)->assertTooManyRequests()->assertHeader('Retry-After', '60');
        $this->travel(61)->seconds();
        $this->postJson('/api/pos/login', $payload)->assertOk()->assertJsonMissingPath('data.token');
    }

    private function mockSignIn(bool $recordVerified, mixed $claim): Auth
    {
        config([
            'pos.admin_uids' => 'allowed-uid',
            'pos.admin_mfa_uid' => '',
            'services.pos_login.firebase_web_api_key' => 'fixture-key',
            'services.pos_login.cache_store' => 'array',
        ]);
        Cache::store('array')->flush();
        Http::preventStrayRequests();
        Http::fake(['https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword*' => Http::response(['idToken' => 'test-token'])]);
        $claims = ['sub' => 'allowed-uid'];
        if ($claim !== null) {
            $claims['email_verified'] = $claim;
        }
        $token = Mockery::mock(UnencryptedToken::class);
        $token->shouldReceive('claims')->andReturn(new DataSet($claims, ''));
        $auth = Mockery::mock(Auth::class);
        $auth->shouldReceive('verifyIdToken')->with('test-token')->andReturn($token);
        $auth->shouldReceive('verifyIdToken')->with('test-token', true)->andReturn($token);
        $auth->shouldReceive('getUser')->with('allowed-uid')->andReturn($this->administrator($recordVerified));
        $auth->shouldNotReceive('createCustomToken', 'setCustomUserClaims');
        $this->app->instance('firebase.auth', $auth);

        return $auth;
    }

    private function administrator(bool $verified): UserRecord
    {
        return UserRecord::fromResponseData([
            'localId' => 'allowed-uid', 'email' => 'admin@example.test', 'emailVerified' => $verified,
            'createdAt' => '1700000000000', 'customAttributes' => '{"role":"authenticated","kitchen_viewer":true}',
        ]);
    }

    private function credentials(): array
    {
        return ['identifier' => 'admin@example.test', 'password' => 'fixture-password'];
    }

    public function test_missing_and_revoked_tokens_are_rejected(): void
    {
        $this->getJson('/api/pos/email-verification')->assertUnauthorized();

        $auth = Mockery::mock(Auth::class);
        $auth->shouldReceive('verifyIdToken')->once()->with('test-token', true)
            ->andThrow(new RevokedIdToken(Mockery::mock(UnencryptedToken::class)));
        $auth->shouldNotReceive('getUser');
        $this->app->instance('firebase.auth', $auth);

        $this->withToken('test-token')->getJson('/api/pos/email-verification')->assertUnauthorized();
    }
}
