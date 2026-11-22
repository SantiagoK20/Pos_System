<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\PosAdministrator;
use App\Services\PosTotpAccess;
use Illuminate\Console\Command;
use Throwable;

final class ApproveTotpEnrollment extends Command
{
    protected $signature = 'pos:approve-totp-enrollment';
    protected $description = 'Authorize one TOTP enrollment for the configured pilot administrator';

    public function handle(PosAdministrator $administrators, PosTotpAccess $access): int
    {
        $uid = trim((string) config('pos.admin_mfa_uid'));
        if (!$administrators->isTotpPilot($uid)) {
            $this->error('No eligible TOTP pilot is configured.');

            return self::FAILURE;
        }

        try {
            $approval = $this->secret('Enter a freshly generated 64-character lowercase hexadecimal approval', false);
            if (!is_string($approval) || preg_match('/\A[0-9a-f]{64}\z/', $approval) !== 1 || !$access->approve($uid, $approval)) {
                $this->error('Enrollment approval could not be issued.');

                return self::FAILURE;
            }
        } catch (Throwable) {
            $this->error('Enrollment approval could not be issued.');

            return self::FAILURE;
        }

        $this->info('Approval expires in five minutes. Deliver it privately after independently verifying the pilot administrator.');

        return self::SUCCESS;
    }
}
