<?php

declare(strict_types=1);

namespace App\Services;

use DateTimeInterface;
use Illuminate\Cache\FileStore;
use Illuminate\Cache\Repository;
use Illuminate\Support\Facades\Cache;
use RuntimeException;
use SensitiveParameter;
use Throwable;

final class PosTotpAccess
{
    // Finalize and factor lookup each have a four-second total HTTP timeout.
    private const ENROLLMENT_LEASE_SECONDS = 60;

    public function assertAvailable(): void
    {
        $this->read($this->cache(), 'pos-totp:health');
    }

    public function issue(#[SensitiveParameter] string $token, mixed $expiresAt): string
    {
        if (!$expiresAt instanceof DateTimeInterface || $expiresAt->getTimestamp() <= now()->timestamp) {
            throw new RuntimeException('The Firebase session is expired or incomplete.');
        }

        $nonce = bin2hex(random_bytes(32));
        $record = ['digest' => hash('sha256', $token), 'expires' => $expiresAt->getTimestamp(), 'revoked' => false];
        if (!$this->cache()->add($this->sessionKey($nonce), $record, $expiresAt)) {
            throw new RuntimeException('The POS session could not be created.');
        }

        return $token.'~'.$nonce;
    }

    public function active(#[SensitiveParameter] string $bearer, #[SensitiveParameter] string $token): bool
    {
        $nonce = $this->nonce($bearer);
        $record = $nonce === null ? null : $this->read($this->cache(), $this->sessionKey($nonce));

        return is_array($record) && ($record['revoked'] ?? null) === false
            && ($record['expires'] ?? 0) > now()->timestamp
            && is_string($record['digest'] ?? null) && hash_equals($record['digest'], hash('sha256', $token));
    }

    public function revoke(#[SensitiveParameter] string $bearer, #[SensitiveParameter] string $token): void
    {
        $nonce = $this->nonce($bearer);
        if ($nonce === null) {
            throw new RuntimeException('Invalid POS session format.');
        }
        $cache = $this->cache();
        $key = $this->sessionKey($nonce);
        $record = $this->read($cache, $key);
        if ($record === null) {
            return;
        }
        if (!is_array($record) || !is_int($record['expires'] ?? null)
            || !is_string($record['digest'] ?? null) || !hash_equals($record['digest'], hash('sha256', $token))) {
            throw new RuntimeException('POS session revocation could not be confirmed.');
        }
        if (($record['revoked'] ?? null) === true || $record['expires'] <= now()->timestamp) {
            return;
        }

        // Publish denial before deleting so failed deletion cannot restore access.
        $record['revoked'] = true;
        try {
            if (!$cache->put($key, $record, now()->setTimestamp($record['expires']))
                || $this->read($cache, $key) !== $record) {
                throw new RuntimeException('POS session revocation could not be confirmed.');
            }
        } catch (Throwable) {
            // Try to revoke by deletion even if the denial record could not be confirmed.
            $cache->forget($key);
            throw new RuntimeException('POS session revocation could not be confirmed.');
        }
        if (!$cache->forget($key) || $this->read($cache, $key) !== null) {
            throw new RuntimeException('POS session revocation could not be confirmed.');
        }
    }

    public function approve(string $uid, #[SensitiveParameter] string $approval): bool
    {
        return $this->cache()->lock($this->key($uid, 'lock'), self::ENROLLMENT_LEASE_SECONDS)->block(2, function () use ($uid, $approval): bool {
            if ($this->read($this->cache(), $this->key($uid, 'factor')) !== null
                || $this->read($this->cache(), $this->key($uid, 'enrollment')) !== null) {
                return false;
            }

            return $this->cache()->add($this->key($uid, 'approval'), hash('sha256', $approval), now()->addMinutes(5));
        });
    }

    public function startEnrollment(string $uid, #[SensitiveParameter] string $approval, \Closure $start): array
    {
        return $this->cache()->lock($this->key($uid, 'lock'), self::ENROLLMENT_LEASE_SECONDS)->block(2, function () use ($uid, $approval, $start): array {
            $key = $this->key($uid, 'approval');
            $digest = $this->read($this->cache(), $key);
            if (!is_string($digest) || !hash_equals($digest, hash('sha256', $approval))
                || !$this->cache()->forget($key)) {
                return ['status' => 'invalid'];
            }

            $result = $start();
            if ($result['status'] === 'totp_enrolling'
                && !$this->cache()->put($this->key($uid, 'enrollment'), hash('sha256', $result['session']), now()->addMinutes(5))) {
                throw new RuntimeException('The enrollment session could not be bound.');
            }

            return $result;
        });
    }

    public function finishEnrollment(string $uid, #[SensitiveParameter] string $session, \Closure $finish): array
    {
        return $this->cache()->lock($this->key($uid, 'lock'), self::ENROLLMENT_LEASE_SECONDS)->block(2, function () use ($uid, $session, $finish): array {
            $key = $this->key($uid, 'enrollment');
            $digest = $this->read($this->cache(), $key);
            if (!is_string($digest) || !hash_equals($digest, hash('sha256', $session))) {
                return ['status' => 'invalid'];
            }

            $result = $finish(fn () => $this->cache()->forget($key));
            if ($result['status'] === 'totp_enrolled'
                && !$this->cache()->forever($this->key($uid, 'factor'), hash('sha256', $result['factor']))) {
                throw new RuntimeException('The approved factor could not be recorded.');
            }
            unset($result['factor']);

            return $result;
        });
    }

    public function approvedFactor(string $uid, string $factor): bool
    {
        $digest = $this->read($this->cache(), $this->key($uid, 'factor'));

        return is_string($digest) && hash_equals($digest, hash('sha256', $factor));
    }

    private function nonce(#[SensitiveParameter] string $bearer): ?string
    {
        $nonce = explode('~', $bearer, 2)[1] ?? '';

        return preg_match('/\A[0-9a-f]{64}\z/', $nonce) === 1 ? $nonce : null;
    }

    private function sessionKey(#[SensitiveParameter] string $nonce): string
    {
        return 'pos-totp:session:'.hash('sha256', $nonce);
    }

    private function key(string $uid, string $purpose): string
    {
        return 'pos-totp:'.$purpose.':'.hash('sha256', $uid);
    }

    private function cache(): Repository
    {
        $name = config('services.pos_login.cache_store');
        $driver = is_string($name) && trim($name) !== '' ? config('cache.stores.'.trim($name).'.driver') : null;
        if (!in_array($driver, ['database', 'redis', 'file'], true)
            || ($driver === 'file' && config('pos.file_cache_single_host') !== true)) {
            throw new RuntimeException('The TOTP pilot requires an explicit supported cache store.');
        }
        $cache = Cache::store(trim($name));
        $store = $cache->getStore();
        if ($store instanceof FileStore && (!is_dir($store->getDirectory()) || !is_writable($store->getDirectory()))) {
            throw new RuntimeException('The pilot cache directory is unavailable.');
        }

        return $cache;
    }

    private function read(Repository $cache, string $key): mixed
    {
        $value = $cache->get($key);
        $store = $cache->getStore();
        if ($value !== null || !$store instanceof FileStore) {
            return $value;
        }

        // FileStore can convert file-read errors into misses. Prove absence by
        // listing each directory, starting at the configured cache root.
        $directory = rtrim($store->getDirectory(), '/\\');
        $relative = substr($store->path($key), strlen($directory) + 1);
        foreach (explode('/', str_replace('\\', '/', $relative)) as $part) {
            $entries = @scandir($directory);
            if ($entries === false) {
                throw new RuntimeException('The pilot cache directory could not be read.');
            }
            if (!in_array($part, $entries, true)) {
                return null;
            }
            $directory .= DIRECTORY_SEPARATOR.$part;
        }

        throw new RuntimeException('The pilot cache record could not be read.');
    }
}
