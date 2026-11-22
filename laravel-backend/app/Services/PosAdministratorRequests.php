<?php

declare(strict_types=1);

namespace App\Services;

use Kreait\Firebase\Auth\UserRecord;
use Kreait\Firebase\Database\Transaction;
use Kreait\Firebase\Exception\Auth\UserNotFound;
use Kreait\Firebase\Exception\Database\PreconditionFailed;
use Kreait\Firebase\Exception\Database\TransactionFailed;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

final class PosAdministratorRequests
{
    private const PATH = 'administrator_requests';

    public function __construct(private AuditLogService $audit) {}

    public function eligible(UserRecord $user): bool
    {
        return !$user->disabled
            && ($user->customClaims['kitchen_viewer'] ?? null) !== true
            && filter_var($user->email, FILTER_VALIDATE_EMAIL) !== false
            && PosAdministrator::isApplicantEmail($user->email)
            && !app(PosAdministrator::class)->matchesConfigured($user->uid, $user->email);
    }

    public function approved(string $uid, string $email): bool
    {
        $account = $this->database()->getReference($this->administratorPath($uid))->getValue();
        if ($account !== null) {
            return ($account['uid'] ?? null) === $uid
                && ($account['email'] ?? null) === strtolower($email)
                && $this->validApproval($this->approvalEntry($account), $uid);
        }

        // Backfill approvals made before administrator accounts had their own collection.
        $record = $this->find($uid);
        if (($record['status'] ?? null) !== 'approved'
            || ($record['uid'] ?? null) !== $uid
            || ($record['email'] ?? null) !== strtolower($email)
            || ($record['audit_complete'] ?? false) === true
            || isset($record['account_separated'])
            || ($record['published']['admin_approved'] ?? false) !== true
            || !$this->validApproval($record['events']['admin_approved']['entry'] ?? null, $uid)) {
            return false;
        }

        $this->publish($record);

        return true;
    }

    private function validApproval(?array $approval, string $uid): bool
    {
        return ($approval['event'] ?? null) === 'admin_approved'
            && ($approval['target_type'] ?? null) === 'administrator'
            && ($approval['target_id'] ?? null) === $uid
            && ($approval['actor_role'] ?? null) === 'admin'
            && is_string($approval['actor_uid'] ?? null)
            && $approval['actor_uid'] !== $uid
            && $this->audit->verify([$approval]);
    }

    private function approvalEntry(array $account): ?array
    {
        if (!isset($account['approval_hash'])) {
            return $account['approval'] ?? null;
        }

        return [
            'event' => 'admin_approved',
            'actor_uid' => $account['approved_by'] ?? null,
            'actor_role' => 'admin',
            'target_type' => 'administrator',
            'target_id' => $account['uid'] ?? null,
            'created_at' => $account['approved_at'] ?? null,
            'integrity_hash' => $account['approval_hash'],
        ];
    }

    public function status(UserRecord $user, bool $verified, bool $register = false): ?array
    {
        $record = $this->find($user->uid);
        if (!$register && ($record === null || $record['email'] !== strtolower($user->email))) {
            return null;
        }
        if ($record === null || ($verified && !$this->hasEvent($record, 'admin_email_verified'))) {
            $record = $this->change($user->uid, function (?array $current) use ($user, $verified): array {
                $current ??= [
                    'uid' => $user->uid,
                    'email' => strtolower($user->email),
                    'status' => 'pending',
                    'requested_at' => now()->toISOString(),
                ];
                $this->requireSameEmail($current, $user);
                $this->stage($current, 'admin_registration_requested', ['role' => 'applicant', 'uid' => $user->uid]);
                if ($verified) {
                    $this->stage($current, 'admin_email_verified', ['role' => 'applicant', 'uid' => $user->uid]);
                }

                return $current;
            });
        }
        $this->requireSameEmail($record, $user);
        $this->publish($record);

        return $this->summary($record, $verified);
    }

    public function all(): array
    {
        $records = $this->database()->getReference(self::PATH)->getValue();
        $result = [];
        foreach ($records ?? [] as $record) {
            try {
                $user = app('firebase.auth')->getUser($record['uid']);
            } catch (UserNotFound) {
                $user = null;
            }
            $verified = $user && $this->eligible($user) && $user->emailVerified
                && strtolower($user->email) === $record['email'];
            if ($verified && !$this->hasEvent($record, 'admin_email_verified')) {
                $result[] = $this->status($user, true);
            } else {
                $this->publish($record, compactAccount: true);
                $result[] = $this->summary($record, (bool) $verified);
            }
        }
        usort($result, static fn (array $a, array $b) => strcmp($b['requested_at'], $a['requested_at']));

        return $result;
    }

    public function decide(string $uid, array $actor, string $decision): array
    {
        if ($uid === $actor['uid']) {
            abort(403, 'You cannot decide your own administrator request.');
        }
        $record = $this->find($uid) ?? throw new NotFoundHttpException('Administrator request not found.');
        if ($record['status'] !== 'pending') {
            $this->publish($record);
            throw new ConflictHttpException('This request has already been decided.');
        }

        try {
            $user = app('firebase.auth')->getUser($uid);
        } catch (UserNotFound) {
            $user = null;
        }
        $verified = $user && $this->eligible($user) && $user->emailVerified
            && strtolower($user->email) === $record['email'];
        if ($decision === 'approved' && !$verified) {
            throw new ConflictHttpException('The applicant must verify the email on this request before approval.');
        }

        $updated = $this->change($uid, function (?array $current) use ($record, $uid, $actor, $decision, $verified): array {
            if (($current['status'] ?? null) !== 'pending' || $current['email'] !== $record['email']) {
                throw new ConflictHttpException('This request has already been decided or changed.');
            }
            if ($verified) {
                $this->stage($current, 'admin_email_verified', ['role' => 'applicant', 'uid' => $uid]);
            }
            $current['status'] = $decision;
            $current['decided_at'] = now()->toISOString();
            $this->stage($current, 'admin_'.$decision, $actor);

            return $current;
        });
        $this->publish($updated);

        return $this->summary($updated, $verified);
    }

    private function find(string $uid): ?array
    {
        return $this->database()->getReference($this->path($uid))->getValue();
    }

    private function change(string $uid, callable $mutate): array
    {
        $database = $this->database();
        $reference = $database->getReference($this->path($uid));
        try {
            return $database->runTransaction(static function (Transaction $transaction) use ($reference, $mutate): array {
                $current = $transaction->snapshot($reference)->getValue();
                $updated = $mutate($current);
                if ($updated !== $current) {
                    $transaction->set($reference, $updated);
                }

                return $updated;
            });
        } catch (TransactionFailed $error) {
            if ($error->getPrevious() instanceof PreconditionFailed) {
                throw new ConflictHttpException('The request changed. Refresh and try again.');
            }
            throw $error;
        }
    }

    private function stage(array &$record, string $event, array $actor): void
    {
        if ($this->hasEvent($record, $event)) {
            return;
        }
        $record['events'][$event] = [
            'id' => $this->auditKey(),
            'entry' => $this->audit->signedEntry($event, $actor, 'administrator', $record['uid']),
        ];
    }

    private function hasEvent(array $record, string $event): bool
    {
        return ($record['audit_complete'] ?? false) === true
            || ($record['published'][$event] ?? false) === true
            || isset($record['events'][$event]);
    }

    private function publish(array $record, bool $compactAccount = false): void
    {
        $updates = [];
        $requestPath = $this->path($record['uid']);
        $accountPath = $this->administratorPath($record['uid']);
        $auditComplete = ($record['audit_complete'] ?? false) === true;
        $accountSeparated = $auditComplete || isset($record['account_separated']);
        $published = $record['published'] ?? [];
        if (isset($record['decided_by'])) {
            $updates[$requestPath.'/decided_by'] = null;
        }
        foreach ($record['events'] ?? [] as $event => $audit) {
            if (!$auditComplete && !isset($published[$event])) {
                $updates['audit_logs/'.$audit['id']] = $audit['entry'];
                $updates[$requestPath.'/published/'.$event] = true;
                $published[$event] = true;
            }
        }
        $approval = $record['events']['admin_approved']['entry'] ?? null;
        if (($record['status'] ?? null) === 'approved'
            && !$accountSeparated
            && $this->validApproval($approval, $record['uid'])) {
            $updates[$accountPath] = [
                'uid' => $record['uid'],
                'email' => $record['email'],
                'approved_at' => $approval['created_at'],
                'approved_by' => $approval['actor_uid'],
                'approval_hash' => $approval['integrity_hash'],
            ];
            $updates[$requestPath.'/account_separated'] = true;
        } elseif ($compactAccount && $accountSeparated) {
            $account = $this->database()->getReference($accountPath)->getValue();
            $legacyApproval = $account['approval'] ?? null;
            if ($legacyApproval !== null
                && !isset($account['approval_hash'])
                && $this->validApproval($legacyApproval, $record['uid'])
                && ($account['uid'] ?? null) === $record['uid']
                && ($account['approved_by'] ?? null) === $legacyApproval['actor_uid']
                && ($account['approved_at'] ?? null) === $legacyApproval['created_at']) {
                $updates[$accountPath.'/approval_hash'] = $legacyApproval['integrity_hash'];
                $updates[$accountPath.'/approval'] = null;
            }
        }
        if (($record['status'] ?? null) === 'approved'
            && ($accountSeparated || isset($updates[$accountPath]))
            && ($published['admin_registration_requested'] ?? false) === true
            && ($published['admin_email_verified'] ?? false) === true
            && ($published['admin_approved'] ?? false) === true) {
            foreach (array_keys($published) as $event) {
                unset($updates[$requestPath.'/published/'.$event]);
            }
            $updates[$requestPath.'/audit_complete'] = true;
            $updates[$requestPath.'/published'] = null;
            $updates[$requestPath.'/account_separated'] = null;
        }
        foreach (array_keys($record['events'] ?? []) as $event) {
            if ($event === 'admin_approved' && !$accountSeparated && !isset($updates[$accountPath])) {
                continue;
            }
            $updates[$requestPath.'/events/'.$event] = null;
        }
        // The audit, markers, and staging cleanup commit together.
        if ($updates !== []) {
            $this->database()->getReference()->update($updates);
        }
    }

    private function auditKey(): string
    {
        // Match Firebase push ID ordering used by the audit history query.
        $alphabet = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
        $timestamp = (int) floor(microtime(true) * 1000);
        $prefix = '';
        for ($index = 0; $index < 8; $index++) {
            $prefix = $alphabet[$timestamp % 64].$prefix;
            $timestamp = intdiv($timestamp, 64);
        }
        $suffix = '';
        foreach (str_split(random_bytes(12)) as $byte) {
            $suffix .= $alphabet[ord($byte) & 63];
        }

        return $prefix.$suffix;
    }

    private function requireSameEmail(array $record, UserRecord $user): void
    {
        if ($record['email'] !== strtolower($user->email)) {
            throw new ConflictHttpException('The email on this request no longer matches the Firebase account.');
        }
    }

    private function summary(array $record, bool $verified): array
    {
        return [
            'uid' => $record['uid'],
            'email' => $record['email'],
            'status' => $record['status'],
            'email_verified' => $verified,
            'requested_at' => $record['requested_at'],
            'decided_at' => $record['decided_at'] ?? null,
        ];
    }

    private function path(string $uid): string
    {
        return self::PATH.'/'.hash('sha256', $uid);
    }

    private function administratorPath(string $uid): string
    {
        return 'administrators/'.hash('sha256', $uid);
    }

    private function database(): \Kreait\Firebase\Contract\Database
    {
        return app('firebase.database');
    }
}
