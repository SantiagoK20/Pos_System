<?php

namespace Tests\Feature;

use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Psr7\Uri;
use Illuminate\Cache\RateLimiter;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Kreait\Firebase\Auth\UserRecord;
use Kreait\Firebase\Contract\Auth;
use Kreait\Firebase\Database;
use Kreait\Firebase\Database\ApiClient;
use Kreait\Firebase\Database\UrlBuilder;
use Kreait\Firebase\Exception\DatabaseApiExceptionConverter;
use Kreait\Firebase\Http\ErrorResponseParser;
use Lcobucci\JWT\Token\DataSet;
use Lcobucci\JWT\UnencryptedToken;
use Mockery;
use Tests\TestCase;

class AuditLogsTest extends TestCase
{
    private array $requests = [];
    private ?string $pilotEnrollmentLabel = null;

    public function test_administrator_login_and_logout_are_saved_and_listed(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $firebase = $this->firebase(
            new Response(200, [], '{"name":"log-1"}'),
            new Response(200, [], '{"name":"log-2"}'),
        );

        $this->firebasePasswords('success');
        $this->login((string) env('ADMIN_EMAIL'))->assertOk()->assertJsonPath('data.role', 'admin');
        $this->withToken('test-token')->postJson('/api/audit-events', ['event' => 'logout'])->assertOk();

        $records = [];
        foreach ($this->requests as $index => $exchange) {
            $request = $exchange['request'];
            $this->assertSame('/audit_logs', $request->getUri()->getPath());
            $entry = json_decode((string) $request->getBody(), true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame('admin', $entry['actor_role']);
            foreach (['test-password', 'test-token', 'test-refresh-token', 'test-custom-token'] as $credential) {
                $this->assertStringNotContainsString($credential, (string) $request->getBody());
            }
            $records['log-' . ($index + 1)] = array_filter($entry, static fn ($value) => $value !== null && $value !== []);
        }

        $firebase->append(new Response(200, [], json_encode($records, JSON_THROW_ON_ERROR)));
        $this->withToken('test-token')->getJson('/api/audit-logs')
            ->assertOk()
            ->assertJsonPath('integrity_verified', true)
            ->assertJsonPath('data.0.event', 'logout')
            ->assertJsonPath('data.1.event', 'login_succeeded')
            ->assertJsonMissingPath('data.0.integrity_hash');
    }

    public function test_cashier_login_is_saved_and_history_is_forbidden(): void
    {
        config(['pos.admin_uids' => 'pilot-uid', 'pos.admin_mfa_uid' => 'pilot-uid']);
        $this->authenticate('test@cashier.atecles-pos.com');
        $this->firebase(
            new Response(200, [], '{"uid":"test-uid"}'),
            new Response(200, [], '{"name":"log-1"}'),
            new Response(200, [], '{"uid":"test-uid"}'),
            new Response(200, [], '{"item-1":{"name":"Test menu item"}}'),
        );

        $this->firebasePasswords('invalid', 'success');
        $this->login('  TEST  ')->assertOk()->assertJsonPath('data.role', 'cashier');
        Http::assertSent(fn ($request) => $request['email'] === 'cashier-' . substr(hash('sha256', 'test'), 0, 56) . '@cashier.atecles-pos.com');
        Http::assertSent(fn ($request) => $request['email'] === 'test@atecles-pos.local');
        $entry = json_decode((string) $this->requests[1]['request']->getBody(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame('cashier', $entry['actor_role']);
        $this->assertSame('test-uid', $entry['actor_uid']);
        $this->withToken('test-token')->getJson('/api/audit-logs')->assertForbidden();
        $this->getJson('/api/cashiers')->assertForbidden();
        $this->getJson('/api/menu')->assertOk()->assertJsonPath('data.item-1.name', 'Test menu item');
        $this->assertCount(4, $this->requests);
    }

    public function test_uid_allowlist_authorizes_legacy_and_additional_administrators(): void
    {
        config([
            'pos.admin_uids' => ' another-admin, test-uid, test-uid, malformed uid, ',
            'pos.legacy_admin_email' => ' Legacy.Admin@example.test ',
        ]);
        $this->firebase(
            new Response(200, [], '{"name":"log-1"}'),
            new Response(200, [], 'null'),
            new Response(200, [], '{"name":"log-2"}'),
            new Response(200, [], 'null'),
            new Response(200, [], 'null'),
        );
        $this->firebasePasswords('success', 'success');

        $this->authenticate('legacy.admin@example.test', uid: 'legacy-uid');
        $this->login('legacy.admin@example.test')->assertOk()->assertJsonPath('data.role', 'admin');
        $this->withToken('test-token')->getJson('/api/cashiers')->assertOk();

        $this->authenticate('second.admin@example.test');
        $this->login('second.admin@example.test')->assertOk()
            ->assertJsonPath('data.role', 'admin')
            ->assertJsonPath('data.uid', 'test-uid')
            ->assertDontSee('another-admin');
        $this->getJson('/api/cashiers')->assertOk();
        $this->postJson('/api/kitchen/sync-pending')
            ->assertOk()->assertJsonPath('data.pending', 0);
        $entry = json_decode((string) $this->requests[2]['request']->getBody(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame('admin', $entry['actor_role']);
        $this->assertSame('test-uid', $entry['actor_uid']);
        $this->artisan('kitchen:grant-viewer', ['uid' => 'test-uid'])
            ->expectsOutput('Select an enabled, dedicated Firebase account outside the POS roles.')
            ->assertFailed();
    }

    public function test_unlisted_firebase_user_cannot_claim_an_admin_uid_or_role(): void
    {
        $this->fakeNoAdministratorRequests();
        config(['pos.admin_uids' => 'TEST-UID', 'pos.legacy_admin_email' => 'legacy@example.test']);
        $this->authenticate('unlisted@example.test');
        $this->firebasePasswords('success');

        $this->getJson('/api/cashiers')->assertUnauthorized();
        app('firebase.auth')->shouldReceive('verifyIdToken')->once()->with('invalid-token')
            ->andThrow(new \RuntimeException('Invalid Firebase token.'));
        $this->withToken('invalid-token')->getJson('/api/cashiers')->assertUnauthorized();
        $this->withToken('test-token')->getJson('/api/cashiers?uid=TEST-UID&role=admin')->assertForbidden();
        $this->postJson('/api/pos/login', [
            'identifier' => 'unlisted@example.test',
            'password' => 'test-password',
            'uid' => 'TEST-UID',
            'role' => 'admin',
        ])->assertForbidden();
    }

    public function test_pilot_totp_is_verified_before_login_and_kitchen_access(): void
    {
        $this->authenticateTotpPilot();
        $this->firebase(new Response(200, [], '{"name":"log-1"}'), new Response(200, [], 'null'));
        config(['services.supabase.url' => 'https://test-kitchen.example.test', 'services.supabase.service_role_key' => 'fixture-key']);
        Http::fake([
            'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword*' => Http::response($this->totpChallenge()),
            'https://identitytoolkit.googleapis.com/v2/accounts.mfaSignIn:finalize*' => Http::response(['idToken' => 'totp-token']),
            'https://test-kitchen.example.test/rest/v1/kitchen_orders*' => Http::response([]),
        ]);

        $this->login('pilot@example.test')->assertOk()->assertExactJson(['step' => 'totp_required']);
        $login = $this->postJson('/api/pos/login', [
            'identifier' => 'pilot@example.test', 'password' => 'test-password', 'code' => '012345',
        ])->assertOk()->assertJsonPath('data.totp', true);
        $credential = $login->json('data.token');
        $this->assertStringStartsWith('totp-token~', $credential);
        Http::assertSent(fn ($request) => str_contains($request->url(), 'mfaSignIn:finalize') &&
            $request['totpVerificationInfo']['verificationCode'] === '012345');

        $this->withToken('password-token')->getJson('/api/kitchen/pilot-orders')->assertForbidden();
        $this->withToken('custom-token')->getJson('/api/kitchen/config')->assertForbidden();
        $this->getJson('/api/cashiers')->assertForbidden();
        $this->postJson('/api/kitchen/sync-pending')->assertForbidden();
        $this->withToken('totp-token')->getJson('/api/kitchen/pilot-orders')->assertForbidden();
        $this->withToken($credential.'invalid')->getJson('/api/kitchen/pilot-orders')->assertForbidden();
        $this->withToken($credential)->postJson('/api/kitchen/session')->assertForbidden();
        $this->getJson('/api/kitchen/pilot-orders')->assertOk()->assertExactJson(['data' => []]);
        $this->patchJson('/api/kitchen/pilot-orders/6d8cb8aa-7e50-4a16-8e10-98bc04727118')->assertNoContent();
        $this->postJson('/api/kitchen/sync-pending')->assertOk()->assertJsonPath('data.pending', 0);

        $audit = json_decode((string) $this->requests[0]['request']->getBody(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame('login_succeeded', $audit['event']);
        foreach (['totp-token', 'fixture-pending', '012345', 'test-password'] as $sensitive) {
            $this->assertStringNotContainsString($sensitive, json_encode($audit, JSON_THROW_ON_ERROR));
        }
    }

    public function test_invalid_pilot_codes_share_the_password_rate_limit_and_audit(): void
    {
        $this->authenticateTotpPilot();
        $this->firebase(...array_fill(0, 6, new Response(200, [], '{"name":"log"}')));
        Http::fake([
            'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword*' => fn ($request) =>
                $request['password'] === 'wrong'
                    ? Http::response(['error' => ['message' => 'INVALID_LOGIN_CREDENTIALS']], 400)
                    : Http::response($this->totpChallenge()),
            'https://identitytoolkit.googleapis.com/v2/accounts.mfaSignIn:finalize*' =>
                Http::response(['error' => ['message' => 'INVALID_CODE']], 400),
        ]);

        $this->postJson('/api/pos/login', ['identifier' => 'pilot@example.test', 'password' => 'wrong'])->assertUnauthorized();
        $input = ['identifier' => 'pilot@example.test', 'password' => 'test-password', 'code' => '012345'];
        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/pos/login', $input)->assertUnauthorized()->assertJsonPath('auditRecorded', true);
        }
        $this->postJson('/api/pos/login', $input)->assertTooManyRequests()->assertHeader('Retry-After');
        $this->postJson('/api/pos/login', $input)->assertTooManyRequests();
        Http::assertSentCount(9);
        $this->assertCount(6, $this->requests);
        $this->assertSame('login_source_rate_limited', $this->lastAuditWrite()['event']);
        foreach ($this->requests as $exchange) {
            $body = (string) $exchange['request']->getBody();
            $this->assertStringNotContainsString('012345', $body);
            $this->assertStringNotContainsString('fixture-pending', $body);
        }
    }

    public function test_pilot_enrollment_never_grants_a_pos_session(): void
    {
        $this->authenticateTotpPilot(false);
        $this->firebase(...array_fill(0, 3, new Response(200, [], '{"name":"log"}')));
        Http::fake([
            'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword*' => Http::response(['idToken' => 'password-token']),
            'https://identitytoolkit.googleapis.com/v2/accounts.mfaEnrollment:start*' => Http::response(['totpSessionInfo' => [
                'sharedSecretKey' => 'FIXTURESECRET', 'sessionInfo' => 'fixture-session', 'periodSec' => 30,
            ]]),
            'https://identitytoolkit.googleapis.com/v2/accounts.mfaEnrollment:finalize*' => function ($request, $options) {
                $this->assertSame(4, $options['timeout']);
                $this->assertSame(2, $options['connect_timeout']);
                $this->pilotEnrollmentLabel = $request['displayName'];

                return Http::response(['idToken' => 'enrollment-token', 'refreshToken' => 'fixture-refresh']);
            },
            'https://identitytoolkit.googleapis.com/v1/accounts:lookup*' => function ($request, $options) {
                $this->assertSame(4, $options['timeout']);
                $this->assertSame(2, $options['connect_timeout']);
                $this->assertSame('enrollment-token', $request['idToken']);
                $this->travel(25)->seconds();
                try {
                    $this->assertFalse(Cache::store('database')->lock('pos-totp:lock:'.hash('sha256', 'pilot-uid'), 60)->get());
                } finally {
                    $this->travelBack();
                }

                return Http::response(['users' => [['localId' => 'pilot-uid', 'mfaInfo' => [[
                    'displayName' => $this->pilotEnrollmentLabel,
                    'totpInfo' => (object) [],
                    'mfaEnrollmentId' => 'fixture-factor',
                ]]]]]);
            },
        ]);

        $this->login('pilot@example.test')->assertOk()->assertExactJson(['step' => 'totp_enrollment_required']);
        $input = ['identifier' => 'pilot@example.test', 'password' => 'test-password'];
        $approval = str_repeat('a', 64);
        $start = $input + ['enroll' => 'start', 'approval' => $approval];
        $finish = $input + ['enroll' => 'finish', 'session' => 'fixture-session', 'code' => '012345'];
        $this->postJson('/api/pos/login', $input + ['enroll' => 'start'])->assertUnprocessable();
        $this->postJson('/api/pos/login', $start)->assertUnauthorized();
        $this->artisan('pos:approve-totp-enrollment')
            ->expectsQuestion('Enter a freshly generated 64-character lowercase hexadecimal approval', $approval)
            ->assertSuccessful();
        $this->postJson('/api/pos/login', $start)
            ->assertOk()->assertHeaderContains('Cache-Control', 'no-store')
            ->assertExactJson(['step' => 'totp_enrolling', 'secret' => 'FIXTURESECRET', 'session' => 'fixture-session', 'period' => 30]);
        $this->postJson('/api/pos/login', $start)->assertUnauthorized();
        $this->postJson('/api/pos/login', $finish)
            ->assertOk()->assertExactJson(['step' => 'totp_enrolled']);
        $this->postJson('/api/pos/login', $finish)->assertUnauthorized();
        $this->assertTrue(app(\App\Services\PosTotpAccess::class)->approvedFactor('pilot-uid', 'fixture-factor'));
        Http::assertSentCount(9);
        $this->withToken('password-token')->getJson('/api/sales')->assertForbidden();
    }

    public function test_pilot_logout_revokes_only_its_own_session(): void
    {
        $this->authenticateTotpPilot();
        $this->firebase(...array_fill(0, 3, new Response(200, [], '{"name":"log"}')));
        Http::fake([
            'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword*' => Http::response($this->totpChallenge()),
            'https://identitytoolkit.googleapis.com/v2/accounts.mfaSignIn:finalize*' => Http::response(['idToken' => 'totp-token']),
        ]);
        $login = ['identifier' => 'pilot@example.test', 'password' => 'test-password', 'code' => '012345'];
        $first = $this->postJson('/api/pos/login', $login)->assertOk()->json('data.token');
        $second = $this->postJson('/api/pos/login', $login)->assertOk()->json('data.token');
        $this->assertNotSame($first, $second);
        $this->withToken($first)->postJson('/api/audit-events', ['event' => 'logout'])
            ->assertOk()->assertJsonPath('revoked', true)->assertJsonPath('auditRecorded', true);
        $this->getJson('/api/pos/email-verification')->assertForbidden();
        $this->postJson('/api/audit-events', ['event' => 'logout'])
            ->assertOk()->assertJsonPath('revoked', true)->assertJsonPath('auditRecorded', false);
        $this->withToken($second)->getJson('/api/pos/email-verification')->assertNoContent();
        config(['services.pos_login.cache_store' => 'missing-store']);
        $this->postJson('/api/audit-events', ['event' => 'logout'])->assertStatus(503)->assertJsonMissingPath('revoked');
        $this->getJson('/api/pos/email-verification')->assertUnauthorized();
        config(['services.pos_login.cache_store' => 'database']);
        $this->travel(5)->minutes();
        $this->getJson('/api/pos/email-verification')->assertForbidden();
        $this->travelBack();
    }

    public function test_pilot_cannot_sign_in_with_a_factor_enrolled_outside_the_pos(): void
    {
        $this->authenticateTotpPilot(false);
        Http::fake([
            'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword*' => Http::response($this->totpChallenge()),
        ]);

        $this->postJson('/api/pos/login', [
            'identifier' => 'pilot@example.test', 'password' => 'test-password', 'code' => '012345',
        ])->assertUnauthorized();
        Http::assertSentCount(1);
    }

    private function authenticateTotpPilot(bool $approvedFactor = true): void
    {
        config([
            'pos.admin_uids' => 'pilot-uid', 'pos.admin_mfa_uid' => 'pilot-uid',
            'services.pos_login.firebase_web_api_key' => 'test-web-api-key',
            'services.pos_login.cache_store' => 'database',
        ]);
        Cache::extend('database', fn () => Cache::store('array'));
        Cache::store('array')->flush();
        if ($approvedFactor) {
            Cache::store('array')->forever('pos-totp:factor:'.hash('sha256', 'pilot-uid'), hash('sha256', 'fixture-factor'));
        }
        Http::preventStrayRequests();
        $auth = Mockery::mock(Auth::class);
        $user = fn () => UserRecord::fromResponseData([
            'localId' => 'pilot-uid', 'email' => 'pilot@example.test', 'emailVerified' => true,
            'createdAt' => '1700000000000', 'customAttributes' => '{"role":"authenticated","kitchen_viewer":true}',
        ]);
        $auth->shouldReceive('getUser')->with('pilot-uid')->andReturnUsing($user);
        $auth->shouldReceive('getUserByEmail')->with('pilot@example.test')->andReturnUsing($user);
        foreach ([
            'totp-token' => ['sign_in_provider' => 'password', 'sign_in_second_factor' => 'totp'],
            'password-token' => ['sign_in_provider' => 'password'],
            'custom-token' => ['sign_in_provider' => 'custom', 'sign_in_second_factor' => 'totp'],
        ] as $bearer => $firebase) {
            $token = Mockery::mock(UnencryptedToken::class);
            $token->shouldReceive('claims')->andReturn(new DataSet([
                'sub' => 'pilot-uid', 'email_verified' => true, 'firebase' => $firebase, 'exp' => now()->addMinutes(5)->toDateTimeImmutable(),
            ], ''));
            $auth->shouldReceive('verifyIdToken')->with($bearer)->andReturn($token);
            $auth->shouldReceive('verifyIdToken')->with($bearer, true)->andReturn($token);
        }
        $auth->shouldNotReceive('createCustomToken');
        $this->app->instance('firebase.auth', $auth);
    }

    private function totpChallenge(): array
    {
        return ['mfaPendingCredential' => 'fixture-pending', 'mfaInfo' => [['mfaEnrollmentId' => 'fixture-factor', 'totpInfo' => (object) []]]];
    }

    public function test_failed_credentials_are_audited_once_and_limited_by_source_and_identifier(): void
    {
        $this->firebase(...array_fill(0, 8, new Response(200, [], '{"name":"log"}')));
        $this->firebasePasswords(...array_fill(0, 8, 'invalid'));
        for ($i = 0; $i < 4; $i++) {
            $this->login('admin@example.test')->assertUnauthorized();
        }
        $this->login('ADMIN@example.test')->assertTooManyRequests()->assertHeader('Retry-After');
        $this->withHeaders(['X-Forwarded-For' => '203.0.113.42'])
            ->login('admin@example.test')->assertTooManyRequests();
        Http::assertSentCount(5);

        $this->login('another@example.test')->assertUnauthorized();
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.20'])->login('admin@example.test')->assertUnauthorized();
        $events = [];
        foreach ($this->requests as $exchange) {
            $entry = json_decode((string) $exchange['request']->getBody(), true, flags: JSON_THROW_ON_ERROR);
            $events[] = $entry['event'];
            $this->assertStringNotContainsString('test-password', json_encode($entry, JSON_THROW_ON_ERROR));
            $this->assertArrayHasKey('source_hash', $entry['metadata']);
        }
        $this->assertSame(1, count(array_filter($events, fn ($event) => $event === 'login_source_rate_limited')));
        $this->assertSame(7, count(array_filter($events, fn ($event) => $event === 'administrator_login_failed')));
    }

    public function test_cashier_credential_rejections_count_once_per_submission(): void
    {
        $this->firebase(new Response(200, [], '{"name":"log"}'));
        $this->firebasePasswords('invalid', 'invalid');
        $this->login('clerk')->assertUnauthorized()->assertJsonPath('auditRecorded', true);
        Http::assertSentCount(2);
        $this->assertCount(1, $this->requests);
        $entry = json_decode((string) $this->requests[0]['request']->getBody(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame('cashier_login_failed', $entry['event']);
    }

    public function test_success_resets_the_source_identifier_limit(): void
    {
        $adminEmail = (string) env('ADMIN_EMAIL');
        $this->authenticate($adminEmail);
        $this->firebase(...array_fill(0, 11, new Response(200, [], '{"name":"log"}')));
        $this->firebasePasswords('invalid', 'invalid', 'invalid', 'invalid', 'success', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid');
        for ($i = 0; $i < 4; $i++) {
            $this->login($adminEmail)->assertUnauthorized();
        }
        $this->login($adminEmail)->assertOk();
        for ($i = 0; $i < 4; $i++) {
            $this->login($adminEmail)->assertUnauthorized();
        }
        $this->login($adminEmail)->assertTooManyRequests()->assertJsonPath('auditRecorded', true);
    }

    public function test_busy_source_cannot_start_another_firebase_verification(): void
    {
        $this->firebasePasswords('invalid');
        $ipHash = hash_hmac('sha256', 'source:' . inet_pton('127.0.0.1'), (string) config('app.key'));
        $lock = Cache::store('array')->lock("pos-login:ip:{$ipHash}:lock", 20);
        $this->assertTrue($lock->get());

        try {
            $this->login('admin@example.test')->assertTooManyRequests()->assertHeader('Retry-After', '2');
            Http::assertNothingSent();
        } finally {
            $lock->release();
        }
    }

    public function test_source_limit_expires_without_an_account_change(): void
    {
        $this->firebase(...array_fill(0, 7, new Response(200, [], '{"name":"log"}')));
        $this->firebasePasswords(...array_fill(0, 6, 'invalid'));
        for ($i = 0; $i < 4; $i++) {
            $this->login('admin@example.test')->assertUnauthorized();
        }
        $this->login('admin@example.test')->assertTooManyRequests();
        $this->travel(301)->seconds();
        try {
            $this->login('admin@example.test')->assertUnauthorized();
            Http::assertSentCount(6);
        } finally {
            $this->travelBack();
        }
    }

    public function test_administrator_removes_only_the_selected_restriction_and_audits_it(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $firebase = $this->firebase(...array_fill(0, 18, new Response(200, [], '{"name":"log"}')));
        $this->firebasePasswords(...array_fill(0, 16, 'invalid'));
        $selected = $this->restrict('one@example.test');
        $otherIdentifier = $this->restrict('two@example.test');
        $otherSource = $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.20'])->restrict('one@example.test');
        $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1']);

        $firebase->append($this->storedAuditResponse(['selected' => $selected]));
        $this->withToken('test-token')->getJson('/api/audit-logs')
            ->assertOk()
            ->assertJsonPath('data.0.can_remove_login_restriction', true)
            ->assertJsonMissingPath('data.0.metadata');

        $firebase->append($this->storedAuditResponse($selected), new Response(200, [], '{"name":"removed"}'));
        $this->removeRestriction()->assertOk()->assertJsonPath('status', 'removed')->assertJsonPath('auditRecorded', true);
        $removed = $this->lastAuditWrite();
        $this->assertSame('admin_login_restriction_removed', $removed['event']);
        $this->assertSame('test-uid', $removed['actor_uid']);
        $this->assertSame($selected['target_id'], $removed['target_id']);
        $this->assertSame([], $removed['metadata']);

        $firebase->append($this->storedAuditResponse([
            'selected' => $selected, 'removed' => $removed, 'other' => $otherIdentifier, 'remote' => $otherSource,
        ]));
        $this->getJson('/api/audit-logs')->assertOk()
            ->assertJsonPath('data.0.id', 'selected')
            ->assertJsonMissingPath('data.0.can_remove_login_restriction')
            ->assertJsonPath('data.1.event', 'admin_login_restriction_removed')
            ->assertJsonPath('data.1.integrity_valid', true);

        $firebase->append($this->storedAuditResponse($selected), new Response(200, [], '{"name":"log"}'));
        $this->removeRestriction()->assertStatus(410)->assertJsonPath('status', 'inactive');
        $this->login('two@example.test')->assertTooManyRequests();
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.20'])->login('one@example.test')->assertTooManyRequests();
        $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1'])->login('one@example.test')->assertUnauthorized();
    }

    public function test_cashier_and_signed_out_requests_cannot_remove_restrictions(): void
    {
        $this->authenticate('test@cashier.atecles-pos.com');
        $this->firebase();
        $this->postJson('/api/audit-logs/selected/remove-login-restriction')->assertUnauthorized();
        $this->withToken('test-token')->removeRestriction()->assertForbidden();
        $this->assertSame([], $this->requests);
    }

    public function test_expired_entry_cannot_clear_a_new_restriction_for_the_same_pair(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $firebase = $this->firebase(...array_fill(0, 6, new Response(200, [], '{"name":"log"}')));
        $this->firebasePasswords(...array_fill(0, 10, 'invalid'));
        $old = $this->restrict('one@example.test');
        $this->withToken('test-token')->travel(301)->seconds();

        try {
            $firebase->append($this->storedAuditResponse($old));
            $this->removeRestriction()->assertStatus(410);
            $firebase->append(...array_fill(0, 6, new Response(200, [], '{"name":"log"}')));
            $new = $this->restrict('one@example.test');
            $this->assertNotSame($old['target_id'], $new['target_id']);

            $firebase->append($this->storedAuditResponse($old));
            $this->removeRestriction()->assertStatus(410);
            $this->login('one@example.test')->assertTooManyRequests();
            Http::assertSentCount(10);
        } finally {
            $this->travelBack();
        }
    }

    public function test_removal_waits_on_the_same_source_lock_as_password_verification(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $firebase = $this->firebase(...array_fill(0, 6, new Response(200, [], '{"name":"log"}')));
        $this->firebasePasswords(...array_fill(0, 5, 'invalid'));
        $entry = $this->restrict('one@example.test');
        $sourceHash = $entry['metadata']['source_hash'];
        $lock = Cache::store('array')->lock("pos-login:ip:{$sourceHash}:lock", 20);
        $this->assertTrue($lock->get());

        try {
            $firebase->append($this->storedAuditResponse($entry));
            $this->withToken('test-token')->removeRestriction()->assertConflict();
            $this->login('one@example.test')->assertTooManyRequests()->assertHeader('Retry-After', '2');
            Http::assertSentCount(5);
        } finally {
            $lock->release();
        }
        $this->login('one@example.test')->assertTooManyRequests();
    }

    public function test_removing_a_pair_restriction_preserves_the_ip_wide_limit(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $firebase = $this->firebase(...array_fill(0, 6, new Response(200, [], '{"name":"log"}')));
        $this->firebasePasswords(...array_fill(0, 5, 'invalid'));
        $sourceHash = hash_hmac('sha256', 'source:' . inet_pton('127.0.0.1'), (string) config('app.key'));
        $limiter = new RateLimiter(Cache::store('array'));
        $limiter->increment("pos-login:ip:{$sourceHash}", 300, 55);

        $entry = $this->restrict('one@example.test');
        $firebase->append($this->storedAuditResponse($entry), new Response(200, [], '{"name":"removed"}'));
        $this->withToken('test-token')->removeRestriction()->assertOk();

        $this->login('one@example.test')->assertTooManyRequests();
        $this->login('another@example.test')->assertTooManyRequests();
        Http::assertSentCount(5);
    }

    public function test_legacy_client_cannot_report_a_verified_login_event(): void
    {
        $this->postJson('/api/audit-events', ['event' => 'login_failed'])->assertUnprocessable();
        $this->postJson('/api/audit-events', ['event' => 'login_succeeded'])->assertUnprocessable();
    }

    public function test_missing_signing_key_returns_failure_without_writing(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $this->firebase();
        config(['services.audit.hmac_key' => '']);

        $this->withToken('test-token')->postJson('/api/audit-events', ['event' => 'logout'])
            ->assertServiceUnavailable()
            ->assertJsonPath('success', false);
        $this->assertSame([], $this->requests);
    }

    public function test_firebase_write_failure_is_reported_to_the_client(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $this->firebase(new Response(503, [], '{"error":"Unavailable"}'));

        $this->withToken('test-token')->postJson('/api/audit-events', ['event' => 'logout'])
            ->assertServiceUnavailable()
            ->assertJsonPath('success', false);
        $this->assertCount(1, $this->requests);
    }

    public function test_cashier_login_returns_only_the_verified_profile_fields(): void
    {
        $this->authenticate('test@cashier.atecles-pos.com', 'test-auth-account-hash');
        $this->firebasePasswords('success');
        $this->firebase($this->storedAuditResponse([
            'uid' => 'test-uid',
            'cashierUsername' => 'Clerk',
            'shift' => 'AM',
            'passwordHash' => 'test-profile-hash',
        ]), new Response(200, [], '{"name":"log-1"}'));

        $this->login('clerk')->assertOk()->assertExactJson([
            'success' => true,
            'auditRecorded' => true,
            'data' => [
                'token' => 'test-custom-token',
                'uid' => 'test-uid',
                'role' => 'cashier',
                'cashierProfile' => [
                    'cashierId' => 'test-uid',
                    'cashierUsername' => 'Clerk',
                    'shift' => 'AM',
                ],
            ],
        ]);
        $this->assertSame(['GET', 'POST'], array_map(
            static fn (array $entry): string => $entry['request']->getMethod(),
            $this->requests,
        ));
    }

    public function test_cashier_profile_does_not_expose_firebase_auth_account_data(): void
    {
        $this->authenticate('test@cashier.atecles-pos.com', 'test-auth-account-hash');
        $this->firebase($this->storedAuditResponse([
            'uid' => 'test-uid',
            'cashierUsername' => 'Clerk',
            'shift' => 'AM',
        ]));

        $response = $this->withToken('test-token')->getJson('/api/cashier-profile')
            ->assertOk()
            ->assertExactJson([
                'success' => true,
                'data' => [
                    'cashierId' => 'test-uid',
                    'cashierUsername' => 'Clerk',
                    'shift' => 'AM',
                    'claimsUpdated' => false,
                ],
            ]);
        $this->assertStringNotContainsString('test-auth-account-hash', $response->getContent());
    }

    public function test_cashier_responses_mask_only_password_hashes(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $record = [
            'uid' => 'cashier-1',
            'cashierId' => 'cashier-1',
            'cashierUsername' => 'Clerk',
            'shift' => 'AM',
            'passwordHash' => 'test-hash-value',
            'extra' => ['passwordHash' => 'nested-test-hash', 'label' => 'unchanged'],
        ];
        $this->firebase(
            $this->storedAuditResponse(['cashier-1' => $record]),
            $this->storedAuditResponse($record),
            $this->storedAuditResponse(['shift' => 'PM']),
            new Response(200, [], '{"name":"audit-entry"}'),
        );
        $masked = $record;
        $masked['passwordHash'] = '********';
        $masked['extra']['passwordHash'] = '********';

        $this->withToken('test-token')->getJson('/api/cashiers')
            ->assertOk()
            ->assertExactJson(['success' => true, 'data' => [$masked + ['databaseKey' => 'cashier-1']]]);
        $masked['shift'] = 'PM';
        $this->putJson('/api/cashiers/cashier-1/shift', ['shift' => 'PM'])
            ->assertOk()
            ->assertExactJson(['success' => true, 'data' => $masked]);
        $this->assertSame(['shift' => 'PM'], json_decode((string) $this->requests[2]['request']->getBody(), true));
        $this->assertStringNotContainsString('test-hash', (string) $this->requests[3]['request']->getBody());
    }

    public function test_menu_creation_records_one_administrator_event(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $this->firebase(
            new Response(200, [], '{"name":"menu-1"}'),
            new Response(200, [], '{"name":"log-1"}'),
        );

        $this->withToken('test-token')->postJson('/api/menu', [
            'name' => 'Test dish', 'category' => 'Test', 'price' => 100,
        ])->assertOk();

        $this->assertCount(2, $this->requests);
        $entry = json_decode((string) $this->requests[1]['request']->getBody(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame('menu_item_created', $entry['event']);
        $this->assertSame('menu-1', $entry['target_id']);
        $this->assertSame('admin', $entry['actor_role']);
    }

    public function test_a_sale_and_its_replay_produce_only_one_audit_entry(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $saleId = '6d8cb8aa-7e50-4a16-8e10-98bc04727118';
        $stored = '{"orderType":"dine-in","items":[{"name":"Test dish"}],"kitchenSyncStatus":"synced"}';
        $this->firebase(
            new Response(200, [], 'null'),
            new Response(200, ['ETag' => '"empty"'], 'null'),
            new Response(200, [], $stored),
            new Response(200, [], $stored),
            new Response(200, [], '{"name":"log-1"}'),
            new Response(200, [], $stored),
        );

        $sale = [
            'clientSaleId' => $saleId,
            'items' => [['name' => 'Test dish', 'qty' => 1]],
            'subtotal' => 100,
            'total' => 100,
            'paymentMethod' => 'cash',
            'orderType' => 'dine-in',
        ];

        $this->withToken('test-token')->postJson('/api/sales', $sale)->assertOk();
        $this->withToken('test-token')->postJson('/api/sales', $sale)->assertOk();

        $auditWrites = array_values(array_filter(
            $this->requests,
            static fn (array $exchange) => $exchange['request']->getUri()->getPath() === '/audit_logs',
        ));
        $this->assertCount(1, $auditWrites);
        $entry = json_decode((string) $auditWrites[0]['request']->getBody(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame('sale_recorded', $entry['event']);
        $this->assertSame($saleId, $entry['target_id']);
    }

    public function test_concurrent_sale_replay_acknowledges_the_winning_write(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $saleId = '6d8cb8aa-7e50-4a16-8e10-98bc04727118';
        $this->firebase(
            new Response(200, [], 'null'),
            new Response(200, ['ETag' => '"empty"'], 'null'),
            new Response(412, [], '{"error":"ETag mismatch"}'),
            new Response(200, [], '{"total":100,"kitchenSyncStatus":"synced"}'),
        );

        $this->withToken('test-token')->postJson('/api/sales', [
            'clientSaleId' => $saleId,
            'items' => [['name' => 'Test dish', 'qty' => 1]],
            'subtotal' => 100, 'total' => 100, 'paymentMethod' => 'cash', 'orderType' => 'dine-in',
        ])->assertOk()->assertJsonPath('data.id', $saleId);
        $this->assertSame(['GET', 'GET', 'PUT', 'GET'], array_map(
            static fn (array $exchange) => $exchange['request']->getMethod(), $this->requests,
        ));
    }

    public function test_stale_menu_edit_cannot_overwrite_another_terminal_change(): void
    {
        $this->authenticate((string) env('ADMIN_EMAIL'));
        $this->firebase(new Response(200, ['ETag' => '"updated"'], '{"name":"Dish","category":"Test","price":200}'));

        $this->withToken('test-token')->putJson('/api/menu', [
            'id' => 'menu-1',
            'name' => 'Dish', 'category' => 'Test', 'price' => 120,
            'expected' => ['name' => 'Dish', 'category' => 'Test', 'price' => 100],
        ])->assertConflict();
        $this->assertCount(1, $this->requests);
    }

    public function test_kitchen_sync_omits_legacy_notes_from_the_supabase_payload(): void
    {
        config([
            'services.supabase.url' => 'https://example.supabase.co',
            'services.supabase.service_role_key' => 'test-service-key',
        ]);
        $this->firebase(new Response(200, [], '{}'));
        Http::preventStrayRequests();
        Http::fake(['https://example.supabase.co/rest/v1/kitchen_orders*' => Http::response(null, 201)]);

        $synced = app(\App\Services\KitchenOrderSyncService::class)->syncSale('sale-1', [
            'orderNumber' => 'A-123',
            'date' => '2026-11-18T10:00:00Z',
            'notes' => 'Legacy order note',
            'items' => [
                ['name' => 'Pork Sisig', 'qty' => 2, 'notes' => 'Legacy item note'],
                ['name' => 'Chicken Adobo', 'quantity' => 1, 'specialInstructions' => 'Legacy item instructions'],
            ],
        ]);

        $this->assertTrue($synced);
        Http::assertSentCount(1);
        $request = Http::recorded()->first()[0];
        $payload = $request->data();
        $this->assertNotEmpty($payload['updated_at']);
        unset($payload['updated_at']);
        $this->assertSame([
            'firebase_sale_id' => 'sale-1',
            'order_number' => 'A-123',
            'items' => [
                ['name' => 'Pork Sisig', 'quantity' => 2],
                ['name' => 'Chicken Adobo', 'quantity' => 1],
            ],
            'status' => 'new',
            'created_at' => '2026-11-18T10:00:00Z',
        ], $payload);
        $this->assertSame(['kitchenSyncStatus', 'kitchenSyncedAt', 'kitchenSyncLastError'], array_keys(
            json_decode((string) $this->requests[0]['request']->getBody(), true, flags: JSON_THROW_ON_ERROR),
        ));
    }

    private function authenticate(string $email, ?string $passwordHash = null, string $uid = 'test-uid'): void
    {
        $emailVerified = !str_ends_with($email, '@cashier.atecles-pos.com') && !str_ends_with($email, '@atecles-pos.local');
        $token = Mockery::mock(UnencryptedToken::class);
        $token->shouldReceive('claims')->andReturn(new DataSet(['sub' => $uid, 'email_verified' => $emailVerified], ''));
        $auth = Mockery::mock(Auth::class);
        $auth->shouldReceive('verifyIdToken')->with('test-token')->andReturn($token);
        $auth->shouldReceive('verifyIdToken')->with('test-token', true)->andReturn($token);
        $auth->shouldReceive('getUser')->with($uid)->andReturn(UserRecord::fromResponseData([
            'localId' => $uid,
            'createdAt' => '1700000000000',
            'email' => $email,
            'emailVerified' => $emailVerified,
            'passwordHash' => $passwordHash,
            'customAttributes' => '{"role":"authenticated"}',
        ]));
        $customToken = Mockery::mock(UnencryptedToken::class);
        $customToken->shouldReceive('toString')->andReturn('test-custom-token');
        $auth->shouldReceive('createCustomToken')->with($uid, [], 60)->andReturn($customToken);
        $this->app->instance('firebase.auth', $auth);
        $this->app->instance(Auth::class, $auth);
    }

    private function firebasePasswords(string ...$results): void
    {
        config([
            'services.pos_login.firebase_web_api_key' => 'test-web-api-key',
            'services.pos_login.cache_store' => 'array',
        ]);
        Cache::store('array')->flush();
        Http::preventStrayRequests();
        $sequence = Http::fakeSequence('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword*');
        foreach ($results as $result) {
            $result === 'success'
                ? $sequence->push(['idToken' => 'test-token', 'refreshToken' => 'test-refresh-token'])
                : $sequence->push(['error' => ['message' => 'INVALID_LOGIN_CREDENTIALS']], 400);
        }
    }

    private function login(string $identifier)
    {
        return $this->postJson('/api/pos/login', ['identifier' => $identifier, 'password' => 'test-password']);
    }

    private function restrict(string $identifier): array
    {
        for ($i = 0; $i < 4; $i++) {
            $this->login($identifier)->assertUnauthorized();
        }
        $this->login($identifier)->assertTooManyRequests();

        return $this->lastAuditWrite();
    }

    private function lastAuditWrite(): array
    {
        return json_decode((string) $this->requests[array_key_last($this->requests)]['request']->getBody(), true, flags: JSON_THROW_ON_ERROR);
    }

    private function removeRestriction()
    {
        return $this->postJson('/api/audit-logs/selected/remove-login-restriction');
    }

    private function storedAuditResponse(array $data): Response
    {
        return new Response(200, [], json_encode($data, JSON_THROW_ON_ERROR));
    }

    private function firebase(Response ...$responses): MockHandler
    {
        config(['services.audit.hmac_key' => str_repeat('test', 12)]);
        $handler = new MockHandler($responses);
        $stack = HandlerStack::create($handler);
        $stack->push(Middleware::history($this->requests));
        $url = 'https://test.firebaseio.com';
        $client = new ApiClient(new Client(['handler' => $stack]), UrlBuilder::create($url), new DatabaseApiExceptionConverter(new ErrorResponseParser()));
        $this->app->instance('firebase.database', new Database(new Uri($url), $client));

        return $handler;
    }
}
