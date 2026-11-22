<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;
use SensitiveParameter;

final class PosTotp
{
    public function __construct(private PosTotpAccess $access) {}

    public function challenge(string $identifier, #[SensitiveParameter] string $pending, array $enrollments, #[SensitiveParameter] ?string $code): array
    {
        $auth = app('firebase.auth');
        $user = $auth->getUserByEmail($identifier);
        if ($user->disabled || !app(PosAdministrator::class)->isTotpPilot($user->uid)) {
            return ['status' => 'denied'];
        }
        if (!$user->emailVerified) {
            return ['status' => AdministratorEmailVerification::REQUIRED];
        }

        foreach ($enrollments as $enrollment) {
            $factor = $enrollment['mfaEnrollmentId'] ?? null;
            if (!isset($enrollment['totpInfo']) || !is_string($factor) || !$this->access->approvedFactor($user->uid, $factor)) {
                continue;
            }
            if ($code === null) {
                return ['status' => 'totp_required'];
            }
            $result = $this->request('mfaSignIn:finalize', [
                'mfaPendingCredential' => $pending,
                'mfaEnrollmentId' => $factor,
                'totpVerificationInfo' => ['verificationCode' => $code],
            ]);
            if ($result['status'] !== 'ok') {
                return $result;
            }

            $token = $auth->verifyIdToken($this->field($result['data'], 'idToken'), true);
            $claims = $token->claims();
            if ($claims->get('sub', null) !== $user->uid || !app(PosAdministrator::class)->hasTotpProof($claims->get('firebase', null))) {
                return ['status' => 'denied'];
            }

            return ['status' => 'totp_verified', 'id_token' => $result['data']['idToken'], 'expires_at' => $claims->get('exp', null)];
        }

        return ['status' => 'denied'];
    }

    public function enrollment(#[SensitiveParameter] string $token, #[SensitiveParameter] array $input): ?array
    {
        $auth = app('firebase.auth');
        $claims = $auth->verifyIdToken($token, true)->claims();
        $uid = $claims->get('sub');
        if (!app(PosAdministrator::class)->requiresTotp($uid)) {
            return isset($input['enroll']) || isset($input['code']) ? ['status' => 'denied'] : null;
        }

        $user = $auth->getUser($uid);
        $firebase = $claims->get('firebase', null);
        if (!app(PosAdministrator::class)->isTotpPilot($uid) || $user->disabled
            || !is_array($firebase) || ($firebase['sign_in_provider'] ?? null) !== 'password') {
            return ['status' => 'denied'];
        }
        if (!AdministratorEmailVerification::verified($user, $claims)) {
            return ['status' => AdministratorEmailVerification::REQUIRED];
        }
        $this->access->assertAvailable();

        if (($input['enroll'] ?? null) === 'start') {
            return $this->access->startEnrollment($uid, $input['approval'], function () use ($token): array {
                $result = $this->request('mfaEnrollment:start', ['idToken' => $token, 'totpEnrollmentInfo' => (object) []]);
                if ($result['status'] !== 'ok') {
                    return $result;
                }
                $session = $result['data']['totpSessionInfo'] ?? [];

                return [
                    'status' => 'totp_enrolling',
                    'secret' => $this->field($session, 'sharedSecretKey'),
                    'session' => $this->field($session, 'sessionInfo'),
                    'period' => (int) ($session['periodSec'] ?? 30),
                ];
            });
        }

        if (($input['enroll'] ?? null) === 'finish') {
            return $this->access->finishEnrollment($uid, $input['session'], function (\Closure $consume) use ($token, $input, $uid): array {
                // Bind the approved factor to this particular Firebase enrollment.
                $label = 'Atecles POS '.bin2hex(random_bytes(16));
                $result = $this->request('mfaEnrollment:finalize', [
                    'idToken' => $token,
                    'displayName' => $label,
                    'totpVerificationInfo' => ['sessionInfo' => $input['session'], 'verificationCode' => $input['code']],
                ]);
                if ($result['status'] !== 'ok') {
                    return $result;
                }
                if (!$consume()) {
                    throw new RuntimeException('The enrollment authorization could not be consumed.');
                }
                // Keep the factor lookup inside the lock on the same bounded HTTP path.
                $lookup = $this->request('lookup', ['idToken' => $this->field($result['data'], 'idToken')], version: 'v1');
                $user = $lookup['data']['users'][0] ?? [];
                if (($user['localId'] ?? null) === $uid) {
                    foreach ($user['mfaInfo'] ?? [] as $factor) {
                        if (($factor['displayName'] ?? null) === $label && isset($factor['totpInfo'])) {
                            return ['status' => 'totp_enrolled', 'factor' => $this->field($factor, 'mfaEnrollmentId')];
                        }
                    }
                }

                throw new RuntimeException('The approved Firebase enrollment could not be identified.');
            });
        }

        return ['status' => 'totp_enrollment_required'];
    }

    private function request(string $operation, #[SensitiveParameter] array $payload, string $version = 'v2'): array
    {
        $apiKey = (string) config('services.pos_login.firebase_web_api_key');
        $resource = $version === 'v1' ? 'accounts:' : 'accounts.';
        $response = Http::asJson()->withoutRedirecting()->connectTimeout(2)->timeout(4)
            ->post('https://identitytoolkit.googleapis.com/'.$version.'/'.$resource.$operation.'?key='.rawurlencode($apiKey), $payload);

        if ($response->successful()) {
            return ['status' => 'ok', 'data' => $response->json()];
        }
        $error = $response->json('error.message');
        if ($response->status() === 429 || $error === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
            return ['status' => 'provider_limited', 'retry_after' => 300];
        }
        if (in_array($error, ['INVALID_CODE', 'INVALID_VERIFICATION_CODE', 'INVALID_MFA_PENDING_CREDENTIAL', 'SESSION_EXPIRED', 'INVALID_SESSION_INFO'], true)) {
            return ['status' => 'invalid'];
        }

        throw new RuntimeException('Firebase TOTP operation is unavailable.');
    }

    private function field(#[SensitiveParameter] array $data, string $key): string
    {
        if (!is_string($data[$key] ?? null) || $data[$key] === '') {
            throw new RuntimeException('Firebase TOTP response was incomplete.');
        }

        return $data[$key];
    }
}
