<?php

namespace Tests\Feature;

use Kreait\Firebase\Auth\UserRecord;
use Kreait\Firebase\Contract\Auth;
use Kreait\Firebase\Exception\Auth\RevokedIdToken;
use Lcobucci\JWT\Token\DataSet;
use Lcobucci\JWT\UnencryptedToken;
use Mockery;
use Tests\TestCase;

class KitchenSessionAuthorizationTest extends TestCase
{
    public function test_administrator_can_only_bootstrap_the_verified_uid(): void
    {
        $auth = $this->account((string) env('ADMIN_EMAIL'));
        $customToken = Mockery::mock(UnencryptedToken::class);
        $customToken->shouldReceive('toString')->once()->andReturn('mock-custom-token');
        $auth->shouldReceive('createCustomToken')->once()->with('verified-uid', [], 60)->andReturn($customToken);

        $this->withToken('test-token')->postJson('/api/kitchen/session', ['uid' => 'untrusted-uid'])
            ->assertOk()
            ->assertHeaderContains('Cache-Control', 'no-store')
            ->assertExactJson(['success' => true, 'data' => ['token' => 'mock-custom-token']]);
    }

    public function test_cashier_and_viewer_cannot_bootstrap_an_administrator_session(): void
    {
        $this->fakeNoAdministratorRequests();
        foreach (['cashier@cashier.atecles-pos.com', 'viewer@example.test'] as $email) {
            $this->account($email)->shouldNotReceive('createCustomToken');
            $this->withToken('test-token')->postJson('/api/kitchen/session')->assertForbidden();
        }
    }

    public function test_signed_out_request_cannot_bootstrap_a_session(): void
    {
        $this->postJson('/api/kitchen/session')->assertUnauthorized();
    }

    public function test_revoked_token_cannot_bootstrap_a_session(): void
    {
        $auth = Mockery::mock(Auth::class);
        $auth->shouldReceive('verifyIdToken')->with('test-token', true)->once()
            ->andThrow(new RevokedIdToken(Mockery::mock(UnencryptedToken::class)));
        $auth->shouldNotReceive('createCustomToken');
        $this->app->instance('firebase.auth', $auth);

        $this->withToken('test-token')->postJson('/api/kitchen/session')->assertUnauthorized();
    }

    private function account(string $email): Auth
    {
        $token = Mockery::mock(UnencryptedToken::class);
        $token->shouldReceive('claims')->andReturn(new DataSet(['sub' => 'verified-uid', 'email_verified' => true], ''));
        $auth = Mockery::mock(Auth::class);
        $auth->shouldReceive('verifyIdToken')->with('test-token', true)->once()->andReturn($token);
        $auth->shouldReceive('getUser')->with('verified-uid')->once()->andReturn(UserRecord::fromResponseData([
            'localId' => 'verified-uid',
            'createdAt' => '1700000000000',
            'email' => $email,
            'emailVerified' => true,
            'customAttributes' => '{"role":"authenticated","kitchen_viewer":true}',
        ]));
        $auth->shouldNotReceive('setCustomUserClaims');
        $this->app->instance('firebase.auth', $auth);
        $this->app->instance(Auth::class, $auth);

        return $auth;
    }
}
