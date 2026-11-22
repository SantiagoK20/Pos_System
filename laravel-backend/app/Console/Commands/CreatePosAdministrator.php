<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\AdministratorEmailVerification;
use App\Services\PosAdministrator;
use Illuminate\Console\Command;
use Throwable;

final class CreatePosAdministrator extends Command
{
    protected $signature = 'pos:create-administrator {email} {uid : Firebase UID to use for the new account}';

    protected $description = 'Create an authorized POS administrator and send a Firebase verification email';

    public function handle(PosAdministrator $administrators, AdministratorEmailVerification $verification): int
    {
        $email = strtolower(trim((string) $this->argument('email')));
        $uid = (string) $this->argument('uid');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)
            || !preg_match('/\A[^\p{C}\s]{1,128}\z/u', $uid)
            || str_ends_with($email, '@cashier.atecles-pos.com')
            || str_ends_with($email, '@atecles-pos.local')
            || !$administrators->matchesConfigured($uid, $email)) {
            $this->error('Use an administrator UID or email authorized in the POS configuration.');

            return self::FAILURE;
        }

        $password = $this->secret('New administrator password');
        if (!is_string($password) || strlen($password) < 8 || $this->secret('Confirm password') !== $password) {
            $this->error('Enter matching passwords with at least eight characters.');

            return self::FAILURE;
        }

        try {
            $user = app('firebase.auth')->createUser([
                'uid' => $uid,
                'email' => $email,
                'password' => $password,
                'emailVerified' => false,
            ]);
        } catch (Throwable $e) {
            $this->error('Firebase could not confirm account creation ('.$e::class.').');

            return self::FAILURE;
        }

        try {
            if ($verification->send($user)) {
                $this->info('Administrator created. Firebase verification email requested.');

                return self::SUCCESS;
            }
        } catch (Throwable) {
            // The account already exists. Its owner can retry delivery through sign-in.
        }

        $this->error('Administrator created. To retry email delivery, use Resend verification email on the POS sign-in screen.');

        return self::FAILURE;
    }
}
