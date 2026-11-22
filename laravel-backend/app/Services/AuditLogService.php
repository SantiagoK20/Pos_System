<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Arr;
use RuntimeException;

final class AuditLogService
{
    private const SAFE_METADATA_KEYS = [
        'role',
        'item_name',
        'cashier_uid',
        'shift',
        'receipt_type',
        'attempted_identifier_hash',
        'source_hash',
        'error_code',
        'order_type',
        'item_count',
    ];

    /**
     * @param array<string, mixed> $actor
     * @param array<string, mixed> $metadata
     */
    public function record(
        string $event,
        array $actor = [],
        ?string $targetType = null,
        ?string $targetId = null,
        array $metadata = [],
    ): ?string {
        return app('firebase.database')
            ->getReference('audit_logs')
            ->push($this->signedEntry($event, $actor, $targetType, $targetId, $metadata))
            ->getKey();
    }

    public function signedEntry(
        string $event,
        array $actor,
        ?string $targetType,
        ?string $targetId,
        array $metadata = [],
    ): array {
        $entry = [
            'event' => $event,
            'actor_uid' => $actor['uid'] ?? null,
            'actor_role' => $actor['role'] ?? 'unauthenticated',
            'target_type' => $targetType,
            'target_id' => $targetId,
            'metadata' => Arr::only($metadata, self::SAFE_METADATA_KEYS),
            'created_at' => now()->toISOString(),
        ];
        $entry['integrity_hash'] = hash_hmac(
            'sha256',
            $this->canonicalJson($entry),
            $this->key(),
        );

        return $entry;
    }

    /**
     * @param array<string, mixed> $entries
     */
    public function verify(array $entries): bool
    {
        foreach ($entries as $entry) {
            if (!is_array($entry) || !is_string($entry['integrity_hash'] ?? null)) {
                return false;
            }

            $signature = $entry['integrity_hash'];
            unset($entry['integrity_hash']);

            // Firebase omits null fields and empty collections when storing JSON.
            $entry += [
                'actor_uid' => null,
                'target_type' => null,
                'target_id' => null,
                'metadata' => [],
            ];

            if (!hash_equals(
                hash_hmac('sha256', $this->canonicalJson($entry), $this->key()),
                $signature,
            )) {
                return false;
            }
        }

        return true;
    }

    private function canonicalJson(array $value): string
    {
        $sort = function (array $items) use (&$sort): array {
            ksort($items);

            foreach ($items as $key => $item) {
                if (is_array($item)) {
                    $items[$key] = $sort($item);
                }
            }

            return $items;
        };

        return json_encode(
            $sort($value),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        );
    }

    private function key(): string
    {
        $key = trim((string) config('services.audit.hmac_key'));

        if (strlen($key) < 32) {
            throw new RuntimeException('AUDIT_LOG_HMAC_KEY must contain at least 32 characters.');
        }

        return $key;
    }
}
