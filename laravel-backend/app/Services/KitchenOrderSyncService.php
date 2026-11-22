<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

final class KitchenOrderSyncService
{
    public function syncSale(string $saleId, array $sale): bool
    {
        if (($sale['kitchenSyncStatus'] ?? null) === 'synced') {
            return true;
        }

        $url = rtrim((string) config('services.supabase.url'), '/');
        $serviceRoleKey = (string) config('services.supabase.service_role_key');

        if ($url === '' || $serviceRoleKey === '') {
            $this->recordFailure($saleId, 'Supabase is not configured.');

            return false;
        }

        $items = array_values(array_filter(array_map(
            static function ($item): ?array {
                if (!is_array($item) || trim((string) ($item['name'] ?? '')) === '') {
                    return null;
                }

                return [
                    'name' => trim((string) $item['name']),
                    'quantity' => max(1, (int) ($item['qty'] ?? $item['quantity'] ?? 1)),
                ];
            },
            is_array($sale['items'] ?? null) ? $sale['items'] : [],
        )));

        $orderNumber = trim((string) ($sale['orderNumber'] ?? $sale['order_number'] ?? ''));
        if ($orderNumber === '') {
            $orderNumber = 'A-' . strtoupper(substr(hash('sha256', $saleId), 0, 8));
        }

        $createdAt = $sale['date'] ?? now()->toISOString();
        $payload = [
            'firebase_sale_id' => $saleId,
            'order_number' => $orderNumber,
            'items' => $items,
            'status' => 'new',
            'created_at' => $createdAt,
            'updated_at' => now()->toISOString(),
        ];

        try {
            $response = Http::acceptJson()
                ->withHeaders([
                    'apikey' => $serviceRoleKey,
                    'Prefer' => 'resolution=ignore-duplicates,return=minimal',
                ])
                ->withToken($serviceRoleKey)
                ->timeout(5)
                ->retry([200, 500], throw: false)
                ->post($url . '/rest/v1/kitchen_orders?on_conflict=firebase_sale_id', $payload);

            if (!$response->successful()) {
                $this->recordFailure($saleId, 'Supabase returned HTTP ' . $response->status() . '.');

                return false;
            }

            app('firebase.database')
                ->getReference("sales/{$saleId}")
                ->update([
                    'kitchenSyncStatus' => 'synced',
                    'kitchenSyncedAt' => now()->toISOString(),
                    'kitchenSyncLastError' => null,
                ]);

            return true;
        } catch (Throwable $exception) {
            $message = $exception instanceof ConnectionException
                ? 'Supabase connection failed.'
                : 'Kitchen synchronization failed.';

            $this->recordFailure($saleId, $message);

            return false;
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function pendingSales(int $limit = 100): array
    {
        $sales = DevelopmentRequestTiming::read('firebase_pending_sales_read', static fn () => app('firebase.database')
            ->getReference('sales')
            ->orderByChild('kitchenSyncStatus')
            ->equalTo('pending')
            ->limitToFirst(max(1, min($limit, 500)))
            ->getValue());

        return is_array($sales) ? $sales : [];
    }

    private function recordFailure(string $saleId, string $message): void
    {
        try {
            $reference = app('firebase.database')->getReference("sales/{$saleId}");
            $sale = $reference->getValue();
            $attempts = is_array($sale) ? (int) ($sale['kitchenSyncAttempts'] ?? 0) : 0;

            $reference->update([
                'kitchenSyncStatus' => 'pending',
                'kitchenSyncAttempts' => $attempts + 1,
                'kitchenSyncLastError' => $message,
            ]);
        } catch (Throwable $exception) {
            Log::error('Could not update the kitchen sync outbox state.', [
                'firebase_sale_id' => $saleId,
                'exception' => $exception::class,
            ]);
        }

        Log::warning('Kitchen order synchronization will be retried.', [
            'firebase_sale_id' => $saleId,
            'reason' => $message,
        ]);
    }
}
