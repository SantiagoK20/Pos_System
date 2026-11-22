<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyDesktopInstance
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = getenv('POS_DESKTOP_TOKEN', true);
        if ($request->isMethod('OPTIONS')) {
            return $next($request);
        }

        if (!$request->is('api/*') || $request->getHost() !== '127.0.0.1' ||
            $request->server('REMOTE_ADDR') !== '127.0.0.1' ||
            !$token || !hash_equals($token, (string) $request->header('X-POS-Instance'))) {
            return response()->json(['message' => 'Use the Atecles Grill POS desktop app.'], 403);
        }

        $response = $next($request);
        if ($request->is('api/health')) {
            $response->headers->set('X-POS-Ready', $token);
        }

        return $response;
    }
}
