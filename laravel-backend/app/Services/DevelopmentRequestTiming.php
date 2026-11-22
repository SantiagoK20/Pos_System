<?php

declare(strict_types=1);

namespace App\Services;

use Closure;
use Throwable;

final class DevelopmentRequestTiming
{
    private static ?string $id = null;
    private static int $startedAt;
    private static string $route;
    private static ?string $active = null;

    public static function start(int $startedAt): void
    {
        self::$startedAt = $startedAt;
        self::$route = match (($_SERVER['REQUEST_METHOD'] ?? '').' '.explode('?', $_SERVER['REQUEST_URI'] ?? '', 2)[0]) {
            'GET /up' => 'health',
            'GET /api/menu' => 'menu',
            'POST /api/kitchen/sync-pending' => 'kitchen_sync',
            'POST /api/pos/login' => 'pos_login',
            default => 'other',
        };
        $id = bin2hex(random_bytes(12));
        register_shutdown_function(static function (): void {
            self::finish('incomplete');
        });
        self::$id = $id;
        self::$active = 'laravel_bootstrap';
        self::write('php_entry', 'started');
    }

    public static function bootstrapComplete(): void
    {
        self::finish('success');
    }

    public static function read(string $operation, Closure $read): mixed
    {
        if (self::$id === null) {
            return $read();
        }

        self::$active = $operation;
        self::write($operation, 'started');

        try {
            $value = $read();
        } catch (Throwable $exception) {
            self::finish('failure');
            throw $exception;
        }

        self::finish('success');

        return $value;
    }

    private static function finish(string $outcome): void
    {
        $operation = self::$active;
        self::$active = null;
        if ($operation !== null) {
            self::write($operation, $outcome);
        }
    }

    private static function write(string $operation, string $outcome): void
    {
        try {
            @error_log('[pos-timing] '.json_encode([
                'id' => self::$id,
                'route' => self::$route,
                'operation' => $operation,
                'elapsed_ms' => round((hrtime(true) - self::$startedAt) / 1_000_000, 3),
                'outcome' => $outcome,
            ], JSON_THROW_ON_ERROR));
        } catch (Throwable) {
            // Timing must never affect the request.
        }
    }
}
