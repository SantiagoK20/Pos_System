<?php

use App\Http\Middleware\HandleInertiaRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Request;

$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        if (getenv('POS_DESKTOP_TOKEN', true)) {
            $middleware->append(\App\Http\Middleware\VerifyDesktopInstance::class);
        }
        $middleware->web(append: [
            HandleInertiaRequests::class,
            AddLinkHeadersForPreloadedAssets::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();

$storagePath = getenv('LARAVEL_STORAGE_PATH', true);
if ($storagePath !== false && $storagePath !== '') {
    $app->useStoragePath($storagePath);
    if (preg_match('/^[A-Za-z]:/', $storagePath, $drive)) {
        $app->addAbsoluteCachePathPrefix($drive[0]);
    }
}

$environmentPath = getenv('POS_ENV_PATH', true);
if ($environmentPath !== false && $environmentPath !== '') {
    $app->useEnvironmentPath($environmentPath);
}

return $app;
