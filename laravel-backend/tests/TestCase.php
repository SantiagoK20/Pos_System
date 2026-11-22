<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected function fakeNoAdministratorRequests(): void
    {
        $client = new \GuzzleHttp\Client(['handler' => static fn () => new \GuzzleHttp\Promise\FulfilledPromise(
            new \GuzzleHttp\Psr7\Response(200, [], 'null'),
        )]);
        $url = 'https://test.firebaseio.com';
        $api = new \Kreait\Firebase\Database\ApiClient(
            $client,
            \Kreait\Firebase\Database\UrlBuilder::create($url),
            new \Kreait\Firebase\Exception\DatabaseApiExceptionConverter(new \Kreait\Firebase\Http\ErrorResponseParser()),
        );
        $database = \Mockery::mock(\Kreait\Firebase\Contract\Database::class);
        $database->shouldReceive('getReference')
            ->with(\Mockery::pattern('/^(administrator_requests|administrators)\/[0-9a-f]{64}$/'))
            ->andReturnUsing(fn ($path) => new \Kreait\Firebase\Database\Reference(new \GuzzleHttp\Psr7\Uri($url.'/'.$path), $api));
        $this->app->instance('firebase.database', $database);
    }
}
