<?php

namespace Tests\Feature;

use App\Services\AuditLogService;
use GuzzleHttp\Client;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Promise\FulfilledPromise;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Psr7\Uri;
use Illuminate\Support\Arr;
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
use Psr\Http\Message\RequestInterface;
use Tests\TestCase;

class AdministratorRequestsTest extends TestCase
{
    private const EMAIL = 'applicant@gmail.com';
    private const PASSWORD = 'example-password';
    private array $store = [];
    private bool $verified = false;
    private bool $claimVerified = false;
    private bool $failAuditPublish = false;
    private bool $conflict = false;
    private Auth $firebase;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'pos.admin_uids' => 'reviewer',
            'pos.legacy_admin_email' => 'legacy@example.test',
            'pos.admin_mfa_uid' => '',
            'services.audit.hmac_key' => str_repeat('fixture', 6),
            'services.pos_login.cache_store' => 'array',
            'services.pos_login.firebase_web_api_key' => 'fixture-api-key',
        ]);
        Http::preventStrayRequests();
        Http::fake(['https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword*' => Http::response(['idToken' => 'applicant-token'])]);

        $this->firebase = Mockery::mock(Auth::class);
        $this->firebase->shouldReceive('getUser')->with('applicant')->andReturnUsing(fn () => $this->applicant());
        $this->firebase->shouldReceive('getUser')->with('reviewer')->andReturn(
            $this->account('reviewer', 'reviewer@example.test', true),
        );
        foreach (['reviewer', 'applicant'] as $uid) {
            $token = Mockery::mock(UnencryptedToken::class);
            $token->shouldReceive('claims')->andReturnUsing(fn () => new DataSet([
                'sub' => $uid,
                'email_verified' => $uid === 'reviewer' || $this->claimVerified,
                'firebase' => ['sign_in_provider' => 'password'],
            ], ''));
            $this->firebase->shouldReceive('verifyIdToken')->with($uid.'-token', true)->andReturn($token);
            $this->firebase->shouldReceive('verifyIdToken')->with($uid.'-token')->andReturn($token);
        }
        $this->app->instance('firebase.auth', $this->firebase);
        $url = 'https://fixture.firebaseio.com';
        $client = new ApiClient(
            new Client(['handler' => HandlerStack::create(fn (RequestInterface $request) => new FulfilledPromise($this->databaseResponse($request)))]),
            UrlBuilder::create($url),
            new DatabaseApiExceptionConverter(new ErrorResponseParser()),
        );
        $this->app->instance('firebase.database', new Database(new Uri($url), $client));
    }

    public function test_registration_verification_and_review_require_distinct_authorization(): void
    {
        $this->register();
        $this->asApplicant()->postJson('/api/pos/administrator-request', ['uid' => 'reviewer'])
            ->assertOk()->assertJsonPath('data.uid', 'applicant')->assertJsonPath('data.status', 'pending');
        $this->login()->assertForbidden()->assertJsonPath('code', 'email_verification_required')
            ->assertJsonPath('application_status', 'pending')->assertJsonMissingPath('data.token');
        $this->asApplicant()->getJson('/api/administrator-requests')->assertForbidden();
        $this->patchJson('/api/administrator-requests/applicant', ['decision' => 'approved', 'role' => 'admin'])->assertForbidden();
        $this->patchJson('/api/administrator-requests/applicant', ['decision' => 'rejected'])->assertForbidden();
        $this->getJson('/api/sales')->assertForbidden();
        $this->getJson('/api/menu')->assertForbidden();
        $this->asReviewer()->getJson('/api/administrator-requests')->assertOk()->assertJsonPath('data.0.email_verified', false);
        $this->patchJson('/api/administrator-requests/applicant', ['decision' => 'approved'])->assertConflict();
        $this->patchJson('/api/administrator-requests/reviewer', ['decision' => 'approved'])->assertForbidden();
        $this->patchJson('/api/administrator-requests/reviewer', ['decision' => 'rejected'])->assertForbidden();

        $this->verified = $this->claimVerified = true;
        $this->login()->assertForbidden()->assertJsonPath('code', 'admin_request_pending')->assertJsonMissingPath('data.token');
        $this->asApplicant()->getJson('/api/sales')->assertForbidden();
        $this->asReviewer()->getJson('/api/administrator-requests')->assertOk()->assertJsonPath('data.0.email_verified', true);
        $this->patchJson('/api/administrator-requests/applicant', ['decision' => 'approved', 'actor_uid' => 'spoofed'])
            ->assertOk()->assertJsonPath('data.status', 'approved');
        $this->patchJson('/api/administrator-requests/applicant', ['decision' => 'approved'])->assertConflict();
        $this->patchJson('/api/administrator-requests/applicant', ['decision' => 'rejected'])->assertConflict();
        $this->assertAudit('admin_registration_requested', 'applicant', 'applicant');
        $this->assertAudit('admin_email_verified', 'applicant', 'applicant');
        $this->assertAudit('admin_approved', 'reviewer', 'admin');

        $this->claimVerified = false;
        $this->asApplicant()->getJson('/api/sales')->assertForbidden();
        $this->claimVerified = true;
        $this->getJson('/api/kitchen/config')->assertOk()->assertJsonPath('data.useLaravel', true);
        $this->getJson('/api/sales')->assertOk();
        $this->getJson('/api/menu')->assertOk();
        $customToken = Mockery::mock(UnencryptedToken::class);
        $customToken->shouldReceive('toString')->once()->andReturn('fixture-custom-token');
        $this->firebase->shouldReceive('createCustomToken')->once()->with('applicant', [], 60)->andReturn($customToken);
        $this->login()->assertOk()->assertJsonPath('data.role', 'admin')->assertJsonPath('data.token', 'fixture-custom-token');

        $accountPath = 'administrators.'.hash('sha256', 'applicant');
        $requestPath = 'administrator_requests.'.hash('sha256', 'applicant');
        $account = Arr::get($this->store, $accountPath);
        $this->assertEmpty(Arr::get($this->store, $requestPath.'.events'));
        $this->assertTrue(Arr::get($this->store, $requestPath.'.audit_complete'));
        $this->assertNull(Arr::get($this->store, $requestPath.'.published'));
        $this->assertNull(Arr::get($this->store, $requestPath.'.account_separated'));
        $this->assertSame(self::EMAIL, $account['email']);
        $this->assertSame('reviewer', $account['approved_by']);
        $this->assertArrayNotHasKey('approval', $account);
        Arr::set($this->store, $accountPath.'.approved_by', 'forged-reviewer');
        $this->asApplicant()->getJson('/api/sales')->assertForbidden();

        Arr::forget($this->store, $accountPath);
        $this->asApplicant()->getJson('/api/sales')->assertForbidden();

        // Simulate an approved request from before the separate collection was added.
        $approvalEntries = array_filter($this->store['audit_logs'], fn ($entry) => $entry['event'] === 'admin_approved');
        $approvalEvent = ['id' => array_key_first($approvalEntries), 'entry' => reset($approvalEntries)];
        Arr::set($this->store, $requestPath.'.events.admin_approved', $approvalEvent);
        Arr::forget($this->store, $requestPath.'.audit_complete');
        Arr::set($this->store, $requestPath.'.published', [
            'admin_registration_requested' => true,
            'admin_email_verified' => true,
            'admin_approved' => true,
        ]);
        $this->asApplicant()->getJson('/api/sales')->assertOk();
        $this->assertSame($account, Arr::get($this->store, $accountPath));
        $this->assertEmpty(Arr::get($this->store, $requestPath.'.events'));

        // A dashboard refresh also cleans up copies already published by earlier versions.
        Arr::forget($this->store, $requestPath.'.audit_complete');
        Arr::set($this->store, $requestPath.'.account_separated', true);
        Arr::set($this->store, $requestPath.'.published', [
            'admin_registration_requested' => true,
            'admin_email_verified' => true,
            'admin_approved' => true,
        ]);
        Arr::set($this->store, $requestPath.'.events.admin_approved', $approvalEvent);
        Arr::set($this->store, $requestPath.'.decided_by', 'reviewer');
        Arr::forget($this->store, $accountPath.'.approval_hash');
        Arr::set($this->store, $accountPath.'.approval', $approvalEvent['entry']);
        $this->asApplicant()->getJson('/api/sales')->assertOk();
        $this->asReviewer()->getJson('/api/administrator-requests')->assertOk();
        $this->assertEmpty(Arr::get($this->store, $requestPath.'.events'));
        $this->assertNull(Arr::get($this->store, $requestPath.'.decided_by'));
        $this->assertTrue(Arr::get($this->store, $requestPath.'.audit_complete'));
        $this->assertNull(Arr::get($this->store, $requestPath.'.published'));
        $this->assertNull(Arr::get($this->store, $requestPath.'.account_separated'));
        $this->assertSame($account, Arr::get($this->store, $accountPath));
        $this->asApplicant()->getJson('/api/sales')->assertOk();
        $this->assertAudit('admin_approved', 'reviewer', 'admin');
    }

    public function test_rejection_is_final_and_an_audit_record_identifies_the_reviewer(): void
    {
        $this->firebase->shouldNotReceive('createCustomToken');
        $this->register();
        $this->asReviewer()->patchJson('/api/administrator-requests/applicant', ['decision' => 'rejected'])
            ->assertOk()->assertJsonPath('data.status', 'rejected');
        $this->assertArrayNotHasKey('administrators', $this->store);
        $this->verified = $this->claimVerified = true;
        $this->asApplicant()->postJson('/api/pos/administrator-request', ['status' => 'approved'])->assertOk()
            ->assertJsonPath('data.status', 'rejected');
        $this->login()->assertForbidden()->assertJsonPath('code', 'admin_request_rejected');
        $this->getJson('/api/sales')->assertForbidden();
        $this->asReviewer()->getJson('/api/administrator-requests')->assertOk()->assertJsonPath('data.0.status', 'rejected');
        $this->patchJson('/api/administrator-requests/applicant', ['decision' => 'approved'])->assertConflict();
        $this->assertAudit('admin_rejected', 'reviewer', 'admin');
        $this->assertAudit('admin_email_verified', 'applicant', 'applicant');
    }

    public function test_conflicts_and_audit_outage_cannot_grant_unaudited_approval(): void
    {
        $this->register();
        $this->verified = $this->claimVerified = true;
        $this->conflict = true;
        $this->asReviewer()->patchJson('/api/administrator-requests/applicant', ['decision' => 'approved'])->assertConflict();
        $this->asApplicant()->getJson('/api/sales')->assertForbidden();

        $this->failAuditPublish = true;
        $this->asReviewer()->patchJson('/api/administrator-requests/applicant', ['decision' => 'approved'])->assertServerError();
        $this->assertArrayNotHasKey('administrators', $this->store);
        $this->asApplicant()->getJson('/api/sales')->assertForbidden();
        $this->asReviewer()->patchJson('/api/administrator-requests/applicant', ['decision' => 'rejected'])->assertConflict();
        $this->assertAudit('admin_approved', 'reviewer', 'admin');
        $this->assertAudit('admin_email_verified', 'applicant', 'applicant');
        $this->asApplicant()->getJson('/api/sales')->assertOk();
    }

    public function test_registration_cannot_create_configured_admins_or_cashier_identities(): void
    {
        $this->firebase->shouldNotReceive('createUser');
        foreach (['legacy@example.test', 'impersonator@atecles-pos.local', 'impersonator@cashier.atecles-pos.com'] as $email) {
            $this->postJson('/api/pos/administrator-registration', ['email' => $email, 'password' => self::PASSWORD])
                ->assertForbidden();
        }
        $this->postJson('/api/pos/administrator-registration', ['email' => 'applicant@example.test', 'password' => self::PASSWORD])
            ->assertUnprocessable();
        $this->postJson('/api/pos/administrator-request', ['uid' => 'reviewer'])->assertUnauthorized();
        $this->assertSame([], $this->store);
    }

    private function register(): void
    {
        $this->firebase->shouldReceive('createUser')->once()->with([
            'email' => self::EMAIL, 'password' => self::PASSWORD, 'emailVerified' => false,
        ])->andReturn($this->applicant());
        $this->firebase->shouldReceive('sendEmailVerificationLink')->once()->with(self::EMAIL);
        $this->postJson('/api/pos/administrator-registration', [
            'email' => self::EMAIL, 'password' => self::PASSWORD, 'uid' => 'reviewer', 'status' => 'approved',
        ])->assertCreated()->assertJsonPath('data.uid', 'applicant')->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.email_verified', false)->assertJsonMissingPath('data.token');
    }

    private function applicant(): UserRecord
    {
        return $this->account('applicant', self::EMAIL, $this->verified);
    }

    private function account(string $uid, string $email, bool $verified): UserRecord
    {
        return UserRecord::fromResponseData([
            'localId' => $uid, 'email' => $email, 'emailVerified' => $verified,
            'createdAt' => '1700000000000', 'customAttributes' => '{"role":"authenticated"}',
        ]);
    }

    private function login()
    {
        return $this->postJson('/api/pos/login', ['identifier' => self::EMAIL, 'password' => self::PASSWORD]);
    }

    private function asApplicant(): self
    {
        return $this->withToken('applicant-token');
    }

    private function asReviewer(): self
    {
        return $this->withToken('reviewer-token');
    }

    private function assertAudit(string $event, string $uid, string $role): void
    {
        $entries = array_values(array_filter($this->store['audit_logs'], static fn ($entry) => $entry['event'] === $event));
        $this->assertCount(1, $entries);
        $this->assertTrue(app(AuditLogService::class)->verify($entries));
        $this->assertSame($uid, $entries[0]['actor_uid']);
        $this->assertSame($role, $entries[0]['actor_role']);
        $this->assertSame('administrator', $entries[0]['target_type']);
        $this->assertSame('applicant', $entries[0]['target_id']);
        $this->assertNotEmpty($entries[0]['created_at']);
        $this->assertStringNotContainsString(self::PASSWORD, json_encode($entries, JSON_THROW_ON_ERROR));
    }

    private function databaseResponse(RequestInterface $request): Response
    {
        $path = str_replace('/', '.', trim($request->getUri()->getPath(), '/'));
        $current = Arr::get($this->store, $path);
        $etag = '"'.hash('sha256', json_encode($current, JSON_THROW_ON_ERROR)).'"';
        $payload = json_decode((string) $request->getBody(), true);
        if ($request->getMethod() === 'PUT') {
            if ($this->conflict || $request->getHeaderLine('if-match') !== $etag) {
                $this->conflict = false;

                return new Response(412, [], '{"error":"precondition failed"}');
            }
            Arr::set($this->store, $path, $payload);
        } elseif ($request->getMethod() === 'PATCH') {
            if ($this->failAuditPublish) {
                $this->failAuditPublish = false;

                return new Response(503, [], '{"error":"unavailable"}');
            }
            $this->assertSame('', $path);
            foreach ($payload as $key => $value) {
                $key = str_replace('/', '.', $key);
                if ($value === null) {
                    Arr::forget($this->store, $key);
                } else {
                    Arr::set($this->store, $key, $value);
                }
            }
        } elseif ($request->getMethod() === 'POST') {
            $this->assertSame('audit_logs', $path);
            Arr::set($this->store, 'audit_logs.login-entry', $payload);

            return new Response(200, [], '{"name":"login-entry"}');
        }

        return new Response(200, ['ETag' => $etag], json_encode($current, JSON_THROW_ON_ERROR));
    }
}
