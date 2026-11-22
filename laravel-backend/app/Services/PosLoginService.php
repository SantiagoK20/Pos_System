<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;
use SensitiveParameter;

final class PosLoginService
{
    private const WINDOW_SECONDS = 300;
    private const ACCOUNT_LIMIT = 5;
    private const SOURCE_LIMIT = 60;

    public function attempt(string $source, string $identifier, #[SensitiveParameter] string $password, #[SensitiveParameter] array $totp = [], bool $resendVerification = false): array
    {
        $key = (string) config('app.key');
        $apiKey = (string) config('services.pos_login.firebase_web_api_key');
        if ($key === '' || $apiKey === '') {
            throw new RuntimeException('POS login is not configured.');
        }

        $ip = inet_pton($source);
        $sourceHash = hash_hmac('sha256', "source:" . ($ip === false ? $source : $ip), $key);
        $identifierHash = hash_hmac('sha256', "account:" . $identifier, $key);
        $sourceKey = "pos-login:ip:{$sourceHash}";
        $accountKey = "{$sourceKey}:{$identifierHash}";
        $cache = Cache::store(config('services.pos_login.cache_store'));
        $limiter = new RateLimiter($cache);

        try {
            // Serialize the check, Firebase verification, and counter update per source.
            // Two Firebase requests take at most eight seconds, below the lock lease.
            return $cache->lock("{$sourceKey}:lock", 20)->block(2, function () use (
                $cache, $limiter, $sourceKey, $accountKey, $sourceHash, $identifierHash, $identifier, $password, $apiKey, $totp, $resendVerification,
            ): array {
                $audit = ['source_hash' => $sourceHash, 'attempted_identifier_hash' => $identifierHash];
                $retryAfter = $this->retryAfter($limiter, $sourceKey, $accountKey);
                if ($retryAfter > 0) {
                    return ['status' => 'limited', 'retry_after' => $retryAfter];
                }

                $isAdmin = str_contains($identifier, '@');
                $email = $isAdmin ? $identifier : 'cashier-' . substr(hash('sha256', $identifier), 0, 56) . '@cashier.atecles-pos.com';
                $result = $this->verifyPassword($apiKey, $email, $password);

                if (!$isAdmin && $result['status'] === 'invalid') {
                    $result = $this->verifyPassword($apiKey, $identifier . '@atecles-pos.local', $password);
                }

                if (!$resendVerification && $isAdmin && trim((string) config('pos.admin_mfa_uid')) !== '') {
                    $pilot = app(PosTotp::class);
                    if ($result['status'] === 'firebase_challenge') {
                        $result = $pilot->challenge($identifier, $result['pending'], $result['enrollments'], $totp['code'] ?? null);
                    } elseif ($result['status'] === 'verified') {
                        $result = $pilot->enrollment($result['id_token'], $totp) ?? $result;
                    }
                }

                if (in_array($result['status'], ['verified', 'totp_verified'], true)) {
                    $limiter->clear($accountKey);
                } elseif ($result['status'] === 'invalid') {
                    $limiter->hit($sourceKey, self::WINDOW_SECONDS);
                    $limiter->hit($accountKey, self::WINDOW_SECONDS);
                    if ($limiter->tooManyAttempts($accountKey, self::ACCOUNT_LIMIT)) {
                        $restrictionId = (string) Str::uuid();
                        if ($cache->put("{$accountKey}:restriction", $restrictionId, max(1, $limiter->availableIn($accountKey)))) {
                            $result['restriction_id'] = $restrictionId;
                        }
                    }
                    $result['retry_after'] = $this->retryAfter($limiter, $sourceKey, $accountKey);
                }

                return $result + ['audit' => $audit, 'role' => $isAdmin ? 'admin' : 'cashier'];
            });
        } catch (LockTimeoutException) {
            return ['status' => 'busy', 'retry_after' => 2];
        }
    }

    /** @param array<string, array> $verifiedEntries */
    public function activeRestrictionEntries(array $verifiedEntries): array
    {
        $references = [];
        foreach ($verifiedEntries as $entryId => $entry) {
            $reference = $this->restrictionReference($entry);
            if ($reference !== null) {
                $references[$entryId] = $reference;
            }
        }
        if ($references === []) {
            return [];
        }

        $cache = Cache::store(config('services.pos_login.cache_store'));
        $keys = array_map(static fn (array $reference) => $reference['account_key'] . ':restriction', $references);
        $active = $cache->many(array_values(array_unique($keys)));

        return array_keys(array_filter($references, static fn (array $reference) =>
            ($active[$reference['account_key'] . ':restriction'] ?? null) === $reference['id']
        ));
    }

    /** The caller verifies the audit signature before passing the entry. */
    public function removeRestriction(array $entry): ?string
    {
        $reference = $this->restrictionReference($entry);
        if ($reference === null) {
            return null;
        }

        $cache = Cache::store(config('services.pos_login.cache_store'));
        $limiter = new RateLimiter($cache);
        $accountKey = $reference['account_key'];
        $marker = "{$accountKey}:restriction";

        return $cache->lock($reference['source_key'] . ':lock', 20)->block(2, function () use (
            $cache, $limiter, $reference, $accountKey, $marker,
        ): ?string {
            if ($cache->get($marker) !== $reference['id'] || !$limiter->tooManyAttempts($accountKey, self::ACCOUNT_LIMIT)) {
                return null;
            }

            $limiter->clear($accountKey);
            if ($limiter->tooManyAttempts($accountKey, self::ACCOUNT_LIMIT)) {
                throw new RuntimeException('The POS restriction could not be cleared.');
            }
            $cache->forget($marker);

            return $reference['id'];
        });
    }

    private function restrictionReference(array $entry): ?array
    {
        if (($entry['event'] ?? null) !== 'login_source_rate_limited' || ($entry['target_type'] ?? null) !== 'login_restriction') {
            return null;
        }
        $id = $entry['target_id'] ?? null;
        $source = $entry['metadata']['source_hash'] ?? null;
        $identifier = $entry['metadata']['attempted_identifier_hash'] ?? null;
        if (
            !is_string($id) || !Str::isUuid($id) ||
            !is_string($source) || !preg_match('/\A[0-9a-f]{64}\z/', $source) ||
            !is_string($identifier) || !preg_match('/\A[0-9a-f]{64}\z/', $identifier)
        ) {
            return null;
        }

        $sourceKey = "pos-login:ip:{$source}";

        return ['id' => $id, 'source_key' => $sourceKey, 'account_key' => "{$sourceKey}:{$identifier}"];
    }

    private function retryAfter(RateLimiter $limiter, string $sourceKey, string $accountKey): int
    {
        return max(
            $limiter->tooManyAttempts($sourceKey, self::SOURCE_LIMIT) ? max(1, $limiter->availableIn($sourceKey)) : 0,
            $limiter->tooManyAttempts($accountKey, self::ACCOUNT_LIMIT) ? max(1, $limiter->availableIn($accountKey)) : 0,
        );
    }

    private function verifyPassword(string $apiKey, string $email, #[SensitiveParameter] string $password): array
    {
        $response = Http::asJson()->withoutRedirecting()->connectTimeout(2)->timeout(4)
            ->post('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' . rawurlencode($apiKey), [
                'email' => $email,
                'password' => $password,
                'returnSecureToken' => true,
            ]);

        if ($response->successful() && is_string($response->json('idToken')) && $response->json('idToken') !== '') {
            return ['status' => 'verified', 'id_token' => $response->json('idToken')];
        }
        if ($response->successful() && is_string($response->json('mfaPendingCredential')) && $response->json('mfaPendingCredential') !== '') {
            return [
                'status' => 'firebase_challenge',
                'pending' => $response->json('mfaPendingCredential'),
                'enrollments' => (array) $response->json('mfaInfo', []),
            ];
        }

        $error = $response->json('error.message');
        if ($response->status() === 400 && in_array($error, ['INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_EMAIL'], true)) {
            return ['status' => 'invalid'];
        }
        if ($response->status() === 429 || $error === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
            return ['status' => 'provider_limited', 'retry_after' => self::WINDOW_SECONDS];
        }
        if ($error === 'USER_DISABLED') {
            return ['status' => 'denied'];
        }

        throw new RuntimeException('Firebase password verification is unavailable.');
    }
}
