<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Kreait\Firebase\Auth\UserRecord;
use Lcobucci\JWT\Token\DataSet;

final class AdministratorEmailVerification
{
    public const REQUIRED = 'email_verification_required';
    public const MESSAGE = 'Verify your administrator email using the Firebase link, then sign in again.';
    public const RESEND_SECONDS = 60;

    public static function verified(UserRecord $user, DataSet $claims): bool
    {
        return $user->emailVerified
            && $claims->get('email_verified', false) === true;
    }

    public function send(UserRecord $user): bool
    {
        // Share the cooldown across sign-in sources and administrator provisioning.
        $cache = Cache::store(config('services.pos_login.cache_store'));
        if (!$cache->add('pos-verification:'.hash('sha256', $user->uid), true, self::RESEND_SECONDS)) {
            return false;
        }

        app('firebase.auth')->sendEmailVerificationLink($user->email);

        return true;
    }
}
