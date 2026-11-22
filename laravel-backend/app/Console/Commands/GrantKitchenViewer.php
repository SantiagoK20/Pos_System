<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\PosAdministrator;
use Illuminate\Console\Command;
use Throwable;

final class GrantKitchenViewer extends Command
{
    protected $signature = 'kitchen:grant-viewer {uid : UID of an existing dedicated Firebase account}';

    protected $description = 'Grant read-only Kitchen Live View access to an existing Firebase account';

    public function handle(PosAdministrator $administrators): int
    {
        try {
            if (!$administrators->isConfigured()) {
                $this->error('Administrator configuration is required to validate the viewer account.');

                return self::FAILURE;
            }

            $auth = app('firebase.auth');
            $user = $auth->getUser((string) $this->argument('uid'));
            $email = strtolower($user->email ?? '');

            if (
                $user->disabled ||
                $email === '' ||
                $administrators->matches($user->uid, $user->email) ||
                str_ends_with($email, '@cashier.atecles-pos.com') ||
                str_ends_with($email, '@atecles-pos.local') ||
                app('firebase.database')->getReference("cashiers/{$user->uid}")->getValue() !== null
            ) {
                $this->error('Select an enabled, dedicated Firebase account outside the POS roles.');

                return self::FAILURE;
            }

            $claims = $user->customClaims;
            if (($claims['kitchen_viewer'] ?? null) !== true || ($claims['role'] ?? null) !== 'authenticated') {
                $claims['kitchen_viewer'] = true;
                $claims['role'] = 'authenticated';
                $auth->setCustomUserClaims($user->uid, $claims);
            }
        } catch (Throwable $exception) {
            $this->error('Viewer access could not be provisioned (' . $exception::class . ').');

            return self::FAILURE;
        }

        $this->info('Read-only kitchen access is configured. Sign in again to obtain a fresh token.');

        return self::SUCCESS;
    }
}
