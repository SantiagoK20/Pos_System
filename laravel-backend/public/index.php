<?php

use App\Services\DevelopmentRequestTiming;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Bootstrap\BootProviders;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$timingEnabled = PHP_SAPI === 'cli-server'
    && getenv('APP_ENV', true) === 'local'
    && getenv('POS_DEV_TIMING', true) === '1'
    && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);

if ($timingEnabled) {
    try {
        $entryTime = hrtime(true);
        require_once __DIR__.'/../app/Services/DevelopmentRequestTiming.php';
        DevelopmentRequestTiming::start($entryTime);
    } catch (Throwable) {
        $timingEnabled = false;
    }
}

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Bootstrap Laravel and handle the request...
/** @var Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

if ($timingEnabled) {
    try {
        $app->afterBootstrapping(BootProviders::class, static function (): void {
            DevelopmentRequestTiming::bootstrapComplete();
        });
    } catch (Throwable) {
        // The normal bootstrap can continue without the completion checkpoint.
    }
}

$app->handleRequest(Request::capture());
