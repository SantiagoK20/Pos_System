<?php

declare(strict_types=1);

namespace App\Services;

use Kreait\Firebase\Contract\Auth;

final class FirebaseSupabaseClaims
{
    public function __construct(private Auth $auth) {}

    /**
     * Add Supabase's expected role while retaining the user's other custom claims.
     */
    public function ensureAuthenticatedRole(string $uid, array $existingClaims): bool
    {
        if (($existingClaims['role'] ?? null) === 'authenticated') {
            return false;
        }

        $existingClaims['role'] = 'authenticated';
        $this->auth->setCustomUserClaims($uid, $existingClaims);

        return true;
    }
}
