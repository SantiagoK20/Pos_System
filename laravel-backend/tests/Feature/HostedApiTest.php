<?php

namespace Tests\Feature;

use Tests\TestCase;

class HostedApiTest extends TestCase
{
    public function test_desktop_can_check_health_and_send_bearer_headers(): void
    {
        config(['cors.allowed_origins' => ['null']]);

        $this->getJson('/api/health', ['Origin' => 'null'])
            ->assertOk()
            ->assertHeader('Access-Control-Allow-Origin', 'null')
            ->assertExactJson(['status' => 'ok']);

        $this->call('OPTIONS', '/api/sales', server: [
            'HTTP_ORIGIN' => 'null',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
            'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization,content-type',
        ])->assertNoContent()
            ->assertHeader('Access-Control-Allow-Origin', 'null')
            ->assertHeaderContains('Access-Control-Allow-Headers', 'authorization')
            ->assertHeaderMissing('Access-Control-Allow-Credentials');

        $this->getJson('/api/health', ['Origin' => 'https://unlisted.invalid'])
            ->assertOk()
            ->assertHeader('Access-Control-Allow-Origin', 'null');

        $this->getJson('/api/audit-logs', ['Origin' => 'null'])->assertUnauthorized();
    }
}
