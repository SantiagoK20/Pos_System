<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\KitchenOrderSyncService;
use Illuminate\Console\Command;

final class SyncPendingKitchenOrders extends Command
{
    protected $signature = 'kitchen:sync-pending {--limit=100}';

    protected $description = 'Retry Firebase sales that have not synchronized to the kitchen display';

    public function handle(KitchenOrderSyncService $syncService): int
    {
        $pendingSales = $syncService->pendingSales((int) $this->option('limit'));
        $synced = 0;

        foreach ($pendingSales as $saleId => $sale) {
            if (is_array($sale) && $syncService->syncSale((string) $saleId, $sale)) {
                $synced++;
            }
        }

        $this->info(sprintf('Synchronized %d of %d pending kitchen orders.', $synced, count($pendingSales)));

        return self::SUCCESS;
    }
}
