<?php

declare(strict_types=1);

namespace App\Services;

final class PosAdministrator
{
    /** @var list<string> */
    private array $uids;

    private ?string $legacyEmail;

    public function __construct()
    {
        $configuredUids = config('pos.admin_uids');
        $uids = is_string($configuredUids) ? explode(',', $configuredUids) : [];
        $this->uids = array_values(array_unique(array_filter(
            array_map('trim', $uids),
            static fn (string $uid): bool => preg_match('/\A[^\p{C}\s]{1,128}\z/u', $uid) === 1,
        )));

        $configuredEmail = config('pos.legacy_admin_email');
        $email = is_string($configuredEmail) ? strtolower(trim($configuredEmail)) : '';
        $this->legacyEmail = filter_var($email, FILTER_VALIDATE_EMAIL) !== false ? $email : null;
    }

    public function isConfigured(): bool
    {
        return $this->uids !== [] || $this->legacyEmail !== null;
    }

    public function matches(string $uid, ?string $email): bool
    {
        return $this->matchesConfigured($uid, $email)
            || (self::isApplicantEmail($email) && app(PosAdministratorRequests::class)->approved($uid, $email));
    }

    public function matchesConfigured(string $uid, ?string $email): bool
    {
        return $this->isUidListed($uid) || $this->isLegacyEmail($email);
    }

    public function isLegacyEmail(?string $email): bool
    {
        return $this->legacyEmail !== null && strtolower($email ?? '') === $this->legacyEmail;
    }

    public static function isApplicantEmail(?string $email): bool
    {
        if ($email === null || $email === '') {
            return false;
        }
        $email = strtolower($email);

        return !str_ends_with($email, '@cashier.atecles-pos.com')
            && !str_ends_with($email, '@atecles-pos.local');
    }

    public function requiresTotp(string $uid): bool
    {
        $configured = config('pos.admin_mfa_uid');

        return is_string($configured) && trim($configured) !== '' && trim($configured) === $uid;
    }

    public function isUidListed(string $uid): bool
    {
        return in_array($uid, $this->uids, true);
    }

    public function isTotpPilot(string $uid): bool
    {
        return $this->requiresTotp($uid) && $this->isUidListed($uid);
    }

    public function hasTotpProof(mixed $firebase): bool
    {
        return is_array($firebase)
            && ($firebase['sign_in_provider'] ?? null) === 'password'
            && ($firebase['sign_in_second_factor'] ?? null) === 'totp';
    }
}
