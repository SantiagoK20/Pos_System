<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Kreait\Firebase\Auth\UserRecord;
use Kreait\Firebase\Contract\Auth;
use Lcobucci\JWT\Token\DataSet;
use Lcobucci\JWT\UnencryptedToken;
use Mockery;
use Tests\TestCase;

class KitchenConfigAuthorizationTest extends TestCase
{
    public function test_uid_admin_can_read_and_complete_orders_through_laravel(): void
    {
        config([
            'pos.admin_uids' => 'test-uid',
            'pos.admin_mfa_uid' => '',
            'services.supabase.url' => 'https://example.supabase.co',
            'services.supabase.service_role_key' => 'server-key',
        ]);
        $this->expectFirebaseAccount('additional-admin@example.test', ['role' => 'authenticated'], strictCalls: 2);
        $order = ['id' => '6d8cb8aa-7e50-4a16-8e10-98bc04727118', 'status' => 'new'];
        $saleType = Mockery::mock();
        $saleType->shouldReceive('getValue')->withNoArgs()->once()->andReturn('take-out');
        $database = Mockery::mock();
        $database->shouldReceive('getReference')->with('sales/sale-1/orderType')->once()->andReturn($saleType);
        $this->app->instance('firebase.database', $database);
        Http::preventStrayRequests();
        Http::fake([
            'https://example.supabase.co/rest/v1/kitchen_orders*' => fn ($request) =>
                $request->method() === 'GET'
                    ? Http::response([$order + ['firebase_sale_id' => 'sale-1']])
                    : Http::response(null, 204),
        ]);

        $this->withToken('test-token')->getJson('/api/kitchen/config')
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['useLaravel' => true]]);
        $this->getJson('/api/kitchen/pilot-orders')->assertOk()
            ->assertExactJson(['data' => [$order + ['order_type' => 'take_out']]]);
        $this->patchJson('/api/kitchen/pilot-orders/'.$order['id'])->assertNoContent();
        Http::assertSent(fn ($request) => $request->method() === 'PATCH' && $request['status'] === 'completed');
    }

    public function test_kitchen_configuration_rejects_an_unverified_uid_parameter(): void
    {
        $this->getJson('/api/kitchen/config?uid=untrusted-user')
            ->assertUnauthorized()
            ->assertJsonPath('success', false);
    }

    public function test_legacy_administrator_does_not_need_supabase_client_write_access(): void
    {
        config(['pos.admin_uids' => '', 'pos.legacy_admin_email' => 'additional-admin@example.test', 'pos.admin_mfa_uid' => '']);
        $this->expectFirebaseAccount('additional-admin@example.test', ['role' => 'authenticated'], strictCalls: 0);

        $this->withToken('test-token')->getJson('/api/kitchen/config')
            ->assertOk()->assertExactJson(['success' => true, 'data' => ['useLaravel' => true]]);
    }

    public function test_entitled_viewer_receives_read_only_configuration(): void
    {
        $this->fakeNoAdministratorRequests();
        config([
            'services.supabase.url' => 'https://example.supabase.co',
            'services.supabase.anon_key' => 'public-key',
            'services.supabase.service_role_key' => 'server-key',
        ]);
        $this->expectFirebaseAccount('viewer@example.test', [
            'kitchen_viewer' => true,
            'role' => 'authenticated',
        ]);

        $this->withToken('test-token')->getJson('/api/kitchen/config')
            ->assertOk()
            ->assertExactJson([
                'success' => true,
                'data' => [
                    'url' => 'https://example.supabase.co',
                    'anonKey' => 'public-key',
                    'canUpdateStatus' => false,
                ],
            ]);
    }

    public function test_cashier_namespace_cannot_use_viewer_entitlement(): void
    {
        $this->expectFirebaseAccount('cashier@cashier.atecles-pos.com', [
            'kitchen_viewer' => true,
            'role' => 'authenticated',
        ]);

        $this->withToken('test-token')->getJson('/api/kitchen/config')->assertForbidden();
    }

    private function expectFirebaseAccount(string $email, array $claims, int $strictCalls = 1): void
    {
        $token = Mockery::mock(UnencryptedToken::class);
        $emailVerified = $email === 'additional-admin@example.test';
        $token->shouldReceive('claims')->andReturn(new DataSet(['sub' => 'test-uid', 'email_verified' => $emailVerified], ''));
        $auth = Mockery::mock(Auth::class);
        $auth->shouldReceive('verifyIdToken')->with('test-token')->once()->andReturn($token);
        $auth->shouldReceive('verifyIdToken')->with('test-token', true)->times($strictCalls)->andReturn($token);
        $auth->shouldReceive('getUser')->with('test-uid')->times(1 + $strictCalls)->andReturn(UserRecord::fromResponseData([
            'localId' => 'test-uid',
            'createdAt' => '1700000000000',
            'email' => $email,
            'emailVerified' => $emailVerified,
            'customAttributes' => json_encode($claims, JSON_THROW_ON_ERROR),
        ]));
        $auth->shouldNotReceive('setCustomUserClaims');
        $this->app->instance('firebase.auth', $auth);
        $this->app->instance(Auth::class, $auth);
    }
}
