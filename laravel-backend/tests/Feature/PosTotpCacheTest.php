<?php

namespace Tests\Feature;

use App\Services\PosTotpAccess;
use Illuminate\Cache\ArrayStore;
use Illuminate\Cache\FileStore;
use Illuminate\Cache\Repository;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\Cache;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class PosTotpCacheTest extends TestCase
{
    private const BEARER = 'fixture-token~'.'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    public static function invalidStores(): array
    {
        return [[null], [''], ['array'], ['failover'], ['file'], ['undefined']];
    }

    #[DataProvider('invalidStores')]
    public function test_pilot_rejects_implicit_or_unsupported_stores(?string $name): void
    {
        config(['services.pos_login.cache_store' => $name, 'pos.file_cache_single_host' => false]);

        $this->expectException(RuntimeException::class);
        app(PosTotpAccess::class)->assertAvailable();
    }

    public function test_explicit_database_store_can_issue_a_session(): void
    {
        config(['services.pos_login.cache_store' => 'database']);
        Cache::extend('database', fn () => new Repository(new ArrayStore()));
        $access = app(PosTotpAccess::class);
        $access->assertAvailable();

        $bearer = $access->issue('fixture-token', now()->addMinute());
        $this->assertTrue($access->active($bearer, 'fixture-token'));
    }

    public function test_cache_read_failure_cannot_confirm_revocation(): void
    {
        $repository = $this->mockDatabaseStore();
        $repository->shouldReceive('get')->once()->andThrow(new RuntimeException('Fixture cache outage.'));
        $repository->shouldNotReceive('forget');

        $this->expectException(RuntimeException::class);
        app(PosTotpAccess::class)->revoke(self::BEARER, 'fixture-token');
    }

    public function test_unavailable_file_store_rejects_access_even_with_single_host_opt_in(): void
    {
        config([
            'services.pos_login.cache_store' => 'file',
            'pos.file_cache_single_host' => true,
            'cache.stores.file.path' => sys_get_temp_dir().'/pos-test-'.bin2hex(random_bytes(8)),
        ]);

        $this->expectException(RuntimeException::class);
        app(PosTotpAccess::class)->assertAvailable();
    }

    public function test_file_store_miss_cannot_confirm_revocation_when_record_exists(): void
    {
        $directory = sys_get_temp_dir().'/pos-test-'.bin2hex(random_bytes(8));
        mkdir($directory);
        try {
            $store = Mockery::mock(FileStore::class, [new Filesystem(), $directory])->makePartial();
            $store->shouldReceive('path')->andReturn($directory.'/record');
            $store->shouldReceive('get')->andReturn(null);
            $store->shouldNotReceive('forget');
            Cache::extend('file', fn () => new Repository($store));
            config(['services.pos_login.cache_store' => 'file', 'pos.file_cache_single_host' => true]);

            $access = app(PosTotpAccess::class);
            $access->revoke(self::BEARER, 'fixture-token'); // Genuine absence.
            file_put_contents($directory.'/record', 'fixture');
            $this->expectException(RuntimeException::class);
            $access->revoke(self::BEARER, 'fixture-token');
        } finally {
            if (is_file($directory.'/record')) {
                unlink($directory.'/record');
            }
            rmdir($directory);
        }
    }

    public function test_delete_failure_leaves_the_credential_denied(): void
    {
        $repository = $this->mockDatabaseStore();
        $active = ['digest' => hash('sha256', 'fixture-token'), 'expires' => now()->addMinute()->timestamp, 'revoked' => false];
        $revoked = array_replace($active, ['revoked' => true]);
        $repository->shouldReceive('get')->times(3)->andReturn($active, $revoked, $revoked);
        $repository->shouldReceive('put')->once()->withArgs(fn ($key, $record) => $record === $revoked)->andReturn(true);
        $repository->shouldReceive('forget')->once()->andReturn(false);
        $access = app(PosTotpAccess::class);

        try {
            $access->revoke(self::BEARER, 'fixture-token');
            $this->fail('Unconfirmed deletion should not report success.');
        } catch (RuntimeException) {
            $this->assertFalse($access->active(self::BEARER, 'fixture-token'));
        }
    }

    public function test_write_failure_attempts_deletion_but_does_not_confirm_logout(): void
    {
        $repository = $this->mockDatabaseStore();
        $repository->shouldReceive('get')->once()->andReturn([
            'digest' => hash('sha256', 'fixture-token'), 'expires' => now()->addMinute()->timestamp, 'revoked' => false,
        ]);
        $repository->shouldReceive('put')->once()->andReturn(false);
        $repository->shouldReceive('forget')->once()->andReturn(true);

        $this->expectException(RuntimeException::class);
        app(PosTotpAccess::class)->revoke(self::BEARER, 'fixture-token');
    }

    private function mockDatabaseStore(): Repository
    {
        $repository = Mockery::mock(Repository::class);
        $repository->shouldReceive('getStore')->andReturn(new ArrayStore());
        Cache::extend('database', fn () => $repository);
        config(['services.pos_login.cache_store' => 'database']);

        return $repository;
    }
}
