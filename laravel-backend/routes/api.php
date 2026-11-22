<?php

use App\Services\AdministratorEmailVerification;
use App\Services\DevelopmentRequestTiming;
use App\Services\FirebaseSupabaseClaims;
use App\Services\PosAdministrator;
use App\Services\PosAdministratorRequests;
use App\Services\PosTotpAccess;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Support\Sleep;
use Kreait\Firebase\Contract\Auth;
use Kreait\Firebase\Exception\Auth\FailedToVerifyToken;
use Kreait\Firebase\Exception\Auth\EmailExists;
use Kreait\Firebase\Exception\Database\TransactionFailed;
use Kreait\Firebase\Exception\Database\PreconditionFailed;

Route::get('/health', static fn () => response()->json(['status' => 'ok'])
    ->header('Cache-Control', 'no-store'));

$tokenIsFromFuture = static function (FailedToVerifyToken $error): bool {
    $message = strtolower($error->getMessage());

    return str_contains($message, 'issued in the future')
        || str_contains($message, 'cannot be used yet')
        || str_contains($message, 'must have authenticated in the past');
};

$verifyFirebaseToken = static function (Request $request, Auth $auth, #[\SensitiveParameter] string $token, bool $checkRevocation = false) use ($tokenIsFromFuture) {
    $verify = static fn () => $checkRevocation ? $auth->verifyIdToken($token, true) : $auth->verifyIdToken($token);
    try {
        return $verify();
    } catch (FailedToVerifyToken $error) {
        $localDevelopment = app()->environment('local');
        $localDesktop = (bool) getenv('POS_DESKTOP_TOKEN', true);
        if ((!$localDevelopment && !$localDesktop) || !in_array($request->ip(), ['127.0.0.1', '::1'], true) || !$tokenIsFromFuture($error)) {
            throw $error;
        }

        // Wait for the local clock to reach the token timestamp, then verify without leeway.
        Sleep::for($localDevelopment ? 10 : 3)->seconds();

        return $verify();
    }
};

$firebaseAuthFailure = static function (\Throwable $error) use ($tokenIsFromFuture): array {
    $context = ['exception' => $error::class];
    if ($error instanceof FailedToVerifyToken) {
        $message = strtolower($error->getMessage());
        // SDK exception messages can contain credentials. Log only fixed labels.
        $context['reason'] = match (true) {
            $tokenIsFromFuture($error) => 'token_from_future',
            str_contains($message, 'token is expired') => 'token_expired',
            str_contains($message, 'allowed issuers'), str_contains($message, 'allowed audiences') => 'firebase_project_mismatch',
            str_contains($message, 'curl error 60'), str_contains($message, 'curl error 77') => 'ca_certificate_error',
            str_contains($message, 'connection to'), str_contains($message, 'curl error') => 'firebase_connection_error',
            str_contains($message, 'no public key matching'), str_contains($message, 'no keys are available') => 'signing_key_unavailable',
            str_contains($message, 'signature') => 'signature_invalid',
            str_contains($message, "error while getting the token's user") => 'firebase_user_lookup_failed',
            default => 'token_validation_failed',
        };
    }

    return $context;
};

$ensureFirebaseSupabaseClaim = function (Request $request, string $uid, array $claims) {
    try {
        $updated = app(FirebaseSupabaseClaims::class)->ensureAuthenticatedRole($uid, $claims);
    } catch (\Throwable $e) {
        Log::error('Firebase Supabase custom claim update failed.', [
            'exception' => $e::class,
        ]);

        return response()->json([
            'success' => false,
            'message' => 'Could not update Firebase access claims. Please retry.',
        ], 503);
    }

    $request->attributes->set('firebase_supabase_claims_updated', $updated);

    return null;
};

$verificationRequired = static fn () => response()->json([
    'success' => false,
    'code' => AdministratorEmailVerification::REQUIRED,
    'message' => AdministratorEmailVerification::MESSAGE,
], 403)->header('Cache-Control', 'no-store');

$authorizeAdmin = function (Request $request, bool $checkRevocation = false) use ($ensureFirebaseSupabaseClaim, $verificationRequired, $firebaseAuthFailure, $verifyFirebaseToken) {
    $authorization = $request->header('Authorization');

    if (!$authorization || !str_starts_with($authorization, 'Bearer ')) {
        return response()->json([
            'success' => false,
            'message' => 'Authentication required.',
        ], 401);
    }

    try {
        $auth = app('firebase.auth');
        $bearer = substr($authorization, 7);
        $idToken = explode('~', $bearer, 2)[0];
        $verifiedToken = $verifyFirebaseToken($request, $auth, $idToken, $checkRevocation);
        $claims = $verifiedToken->claims();
        $uid = $claims->get('sub');
        $adminUser = $auth->getUser($uid);
        if ($adminUser->disabled || !app(PosAdministrator::class)->matches($uid, $adminUser->email)) {
            return response()->json([
                'success' => false,
                'message' => 'Administrator access required.',
            ], 403);
        }

        if (!AdministratorEmailVerification::verified($adminUser, $claims)) {
            return $verificationRequired();
        }

        $pilot = app(PosAdministrator::class);
        if ($pilot->requiresTotp($uid)) {
            if (!$pilot->isTotpPilot($uid)
                || !$pilot->hasTotpProof($claims->get('firebase', null))
                || !app(PosTotpAccess::class)->active($bearer, $idToken)) {
                return response()->json(['message' => 'Authenticator sign-in required.'], 403);
            }
            if (!$checkRevocation) {
                $auth->verifyIdToken($idToken, true);
            }
        }

        $claimsError = $ensureFirebaseSupabaseClaim($request, $uid, $adminUser->customClaims);
        if ($claimsError) {
            return $claimsError;
        }

        $request->attributes->set('audit_actor', [
            'uid' => $uid,
            'role' => 'admin',
        ]);

        return null;
    } catch (\Throwable $e) {
        Log::warning('Invalid Firebase Admin authentication.', $firebaseAuthFailure($e));

        return response()->json([
            'success' => false,
            'message' => 'Invalid or expired authentication.',
        ], 401);
    }
};

$authorizeUser = function (Request $request, bool $pilotLogin = false) use ($ensureFirebaseSupabaseClaim, $verificationRequired, $firebaseAuthFailure, $verifyFirebaseToken) {
    $authorization = $request->header('Authorization');

    if (!$authorization || !str_starts_with($authorization, 'Bearer ')) {
        return response()->json([
            'success' => false,
            'message' => 'Authentication required.',
        ], 401);
    }

    try {
        $auth = app('firebase.auth');
        $bearer = substr($authorization, 7);
        $idToken = explode('~', $bearer, 2)[0];
        $verifiedToken = $verifyFirebaseToken($request, $auth, $idToken);
        $claims = $verifiedToken->claims();
        $uid = $claims->get('sub');
        $user = $auth->getUser($uid);
        $email = strtolower($user->email ?? '');
        if (app(PosAdministrator::class)->matches($uid, $user->email)) {
            if ($user->disabled) {
                return response()->json(['message' => 'Administrator access required.'], 403);
            }
            if (!AdministratorEmailVerification::verified($user, $claims)) {
                return $verificationRequired();
            }
            $pilot = app(PosAdministrator::class);
            if ($pilot->requiresTotp($uid)) {
                if (!$pilot->isTotpPilot($uid)
                    || !$pilot->hasTotpProof($claims->get('firebase', null))
                    || (!$pilotLogin && !app(PosTotpAccess::class)->active($bearer, $idToken))) {
                    return response()->json(['message' => 'Authenticator sign-in required.'], 403);
                }
                $auth->verifyIdToken($idToken, true);
            }
            $claimsError = $ensureFirebaseSupabaseClaim($request, $uid, $user->customClaims);
            if ($claimsError) {
                return $claimsError;
            }

            $request->attributes->set('audit_actor', [
                'uid' => $uid,
                'role' => 'admin',
            ]);

            return null;
        }

        $isCashier = str_ends_with($email, '@cashier.atecles-pos.com')
            || str_ends_with($email, '@atecles-pos.local');

        if (!$isCashier) {
            if ($request->attributes->get('pos_login') && !$user->disabled && PosAdministrator::isApplicantEmail($user->email)) {
                $verified = AdministratorEmailVerification::verified($user, $claims);
                $application = app(PosAdministratorRequests::class)->status($user, $verified);
                if ($application !== null) {
                    if ($application['status'] === 'rejected') {
                        return response()->json(['code' => 'admin_request_rejected', 'message' => 'Your administrator request was rejected.'], 403);
                    }
                    if (!$verified) {
                        return response()->json([
                            'code' => AdministratorEmailVerification::REQUIRED,
                            'application_status' => 'pending',
                            'message' => 'Open the verification link in your email, then check your status.',
                        ], 403);
                    }

                    return response()->json(['code' => 'admin_request_pending', 'message' => 'An existing administrator needs to approve your account before you can use the POS.'], 403);
                }
            }
            return response()->json([
                'success' => false,
                'message' => 'Authorized POS account required.',
            ], 403);
        }

        $database = app('firebase.database');
        $cashier = $database->getReference("cashiers/{$uid}")->getValue();

        if (!is_array($cashier)) {
            $suffix = str_ends_with($email, '@cashier.atecles-pos.com')
                ? '@cashier.atecles-pos.com'
                : '@atecles-pos.local';
            $legacyId = strtoupper(substr($email, 0, -strlen($suffix)));
            $cashier = $database->getReference("cashiers/{$legacyId}")->getValue();
        }

        if (!is_array($cashier) || (isset($cashier['uid']) && (string) $cashier['uid'] !== (string) $uid)) {
            return response()->json([
                'success' => false,
                'message' => 'Cashier account required.',
            ], 403);
        }

        $claimsError = $ensureFirebaseSupabaseClaim($request, $uid, $user->customClaims);
        if ($claimsError) {
            return $claimsError;
        }

        $request->attributes->set('audit_actor', [
            'uid' => $uid,
            'role' => 'cashier',
            'cashierUsername' => $cashier['cashierUsername'] ?? '',
            'shift' => $cashier['shift'] ?? null,
        ]);

        return null;
    } catch (\Throwable $e) {
        Log::warning('Firebase POS authentication failed.', $firebaseAuthFailure($e));

        return response()->json([
            'success' => false,
            'message' => 'Invalid or expired authentication.',
        ], 401);
    }
};

$recordAudit = function (
    string $event,
    array $actor = [],
    ?string $targetType = null,
    ?string $targetId = null,
    array $metadata = [],
): bool {
    try {
        $id = app(\App\Services\AuditLogService::class)->record(
            $event,
            $actor,
            $targetType,
            $targetId,
            $metadata,
        );
        return $id !== null;
    } catch (\Throwable $e) {
        Log::critical('Audit event could not be persisted.', [
            'event' => $event,
            'exception' => $e::class,
            'reason' => strlen(trim((string) config('services.audit.hmac_key'))) < 32
                ? 'Audit signing key is missing or too short.'
                : 'Audit storage or serialization failed.',
            'origin' => basename($e->getFile()) . ':' . $e->getLine(),
        ]);
        return false;
    }
};


/*
|--------------------------------------------------------------------------
| MENU API
|--------------------------------------------------------------------------
*/


// =====================================================
// GET ALL MENU ITEMS
// =====================================================

Route::get('/menu', function (Request $request) use ($authorizeUser) {
    if ($error = $authorizeUser($request)) {
        return $error;
    }

    $menu = DevelopmentRequestTiming::read('firebase_menu_read', static fn () => app('firebase.database')
        ->getReference('menu')
        ->getValue());

    return response()->json([
        'success' => true,
        'data' => $menu ?? [],
    ]);
});


// =====================================================
// ADD MENU ITEM
// =====================================================

Route::post('/menu', function (Request $request) use ($authorizeAdmin, $recordAudit) {
    $authorizationError = $authorizeAdmin($request);

    if ($authorizationError) {
        return $authorizationError;
    }

    $data = $request->validate([
        'clientMenuId' => 'nullable|uuid',
        'name' => 'required|string',
        'category' => 'required|string',
        'price' => 'required|numeric',
    ]);

    $database = app('firebase.database');
    $clientMenuId = $data['clientMenuId'] ?? null;
    unset($data['clientMenuId']);
    $created = true;
    if ($clientMenuId === null) {
        $reference = $database->getReference('menu')->push($data);
    } else {
        $reference = $database->getReference("menu/{$clientMenuId}");
        try {
            $created = $database->runTransaction(static function ($transaction) use ($reference, $data): bool {
                if ($transaction->snapshot($reference)->getValue() !== null) {
                    return false;
                }
                $transaction->set($reference, $data);

                return true;
            });
        } catch (TransactionFailed $error) {
            if (!$error->getPrevious() instanceof PreconditionFailed) {
                throw $error;
            }
            $created = false;
        }
        if (!$created) {
            $data = $reference->getValue();
            abort_unless(is_array($data), 409, 'The menu item changed. Refresh the menu.');
        }
    }

    if ($created) {
        $recordAudit(
            'menu_item_created',
            $request->attributes->get('audit_actor', []),
            'menu_item',
            $reference->getKey(),
            ['item_name' => $data['name']],
        );
    }

    return response()->json([
        'success' => true,
        'data' => [
            'id' => $reference->getKey(),
            ...$data,
        ],
    ]);
});


// =====================================================
// EDIT MENU ITEM
// =====================================================

$expectedMenuRules = [
    'expected' => 'sometimes|array:name,category,price',
    'expected.name' => 'required_with:expected|string',
    'expected.category' => 'required_with:expected|string',
    'expected.price' => 'required_with:expected|numeric',
];

$mutateMenuItem = static function (string $id, ?array $expected, ?array $changes): bool {
    $database = app('firebase.database');
    $reference = $database->getReference("menu/{$id}");
    try {
        return $database->runTransaction(static function ($transaction) use ($reference, $expected, $changes): bool {
            $current = $transaction->snapshot($reference)->getValue();
            if ($current === null && $changes === null) {
                return false;
            }
            abort_unless(is_array($current), 409, 'The menu item was deleted. Refresh the menu.');
            $matches = static fn (array $item): bool => ($current['name'] ?? null) === $item['name']
                && ($current['category'] ?? null) === $item['category']
                && (float) ($current['price'] ?? 0) === (float) $item['price'];
            if ($changes !== null && $matches($changes)) {
                return false;
            }
            abort_if($expected !== null && !$matches($expected), 409, 'The menu item changed on another terminal. Refresh the menu.');
            if ($changes === null) {
                $transaction->remove($reference);
            } else {
                $transaction->set($reference, [...$current, ...$changes]);
            }

            return true;
        });
    } catch (TransactionFailed $error) {
        if ($error->getPrevious() instanceof PreconditionFailed) {
            abort(409, 'The menu item changed on another terminal. Refresh the menu.');
        }
        throw $error;
    }
};

Route::put('/menu', function (Request $request) use ($authorizeAdmin, $recordAudit, $mutateMenuItem, $expectedMenuRules) {
    $authorizationError = $authorizeAdmin($request);

    if ($authorizationError) {
        return $authorizationError;
    }


    $data = $request->validate([
        'id' => 'required|string|regex:/^[A-Za-z0-9_-]{1,128}$/',
        'name' => 'required|string',
        'category' => 'required|string',
        'price' => 'required|numeric',
        ...$expectedMenuRules,
    ]);

    $id = $data['id'];

    $expected = $data['expected'] ?? null;
    unset($data['id'], $data['expected']);

    if ($mutateMenuItem($id, $expected, $data)) {
        $recordAudit(
            'menu_item_updated',
            $request->attributes->get('audit_actor', []),
            'menu_item',
            $id,
            ['item_name' => $data['name']],
        );
    }

    return response()->json([
        'success' => true,
        'data' => [
            'id' => $id,
            ...$data,
        ],
    ]);
});


// =====================================================
// DELETE MENU ITEM
// =====================================================

Route::delete('/menu', function (Request $request) use ($authorizeAdmin, $recordAudit, $mutateMenuItem, $expectedMenuRules) {
    $authorizationError = $authorizeAdmin($request);

    if ($authorizationError) {
        return $authorizationError;
    }


    $data = $request->validate([
        'id' => 'required|string|regex:/^[A-Za-z0-9_-]{1,128}$/',
        ...$expectedMenuRules,
    ]);

    if ($mutateMenuItem($data['id'], $data['expected'] ?? null, null)) {
        $recordAudit(
            'menu_item_deleted',
            $request->attributes->get('audit_actor', []),
            'menu_item',
            $data['id'],
        );
    }

    return response()->json([
        'success' => true,
        'data' => [
            'id' => $data['id'],
        ],
    ]);
});



/*
|--------------------------------------------------------------------------
| SALES API
|--------------------------------------------------------------------------
*/


// =====================================================
// GET ALL SALES
// =====================================================

Route::get('/sales', function (Request $request) use ($authorizeAdmin) {
    $authorizationError = $authorizeAdmin($request);

    if ($authorizationError) {
        return $authorizationError;
    }

    $sales = app('firebase.database')
        ->getReference('sales')
        ->getValue();

    return response()->json([
        'success' => true,
        'data' => $sales ?? [],
    ]);
});


// =====================================================
// SAVE SALE
// =====================================================

Route::post('/sales', function (Request $request) use ($authorizeUser, $recordAudit) {
    $authorizationError = $authorizeUser($request);

    if ($authorizationError) {
        return $authorizationError;
    }

    $data = $request->validate([
        'clientSaleId' => 'nullable|uuid',
        'id' => 'nullable|integer|min:0',
        'orderNumber' => 'nullable|string|max:32',
        'items' => 'required|array|min:1',
        'items.*.id' => 'nullable|string|max:128',
        'items.*.name' => 'required|string|max:160',
        'items.*.category' => 'nullable|string|max:80',
        'items.*.qty' => 'nullable|integer|min:1|max:999',
        'items.*.quantity' => 'nullable|integer|min:1|max:999',
        'items.*.notes' => 'nullable|string|max:500',
        'items.*.specialInstructions' => 'nullable|string|max:500',
        'subtotal' => 'required|numeric',
        'total' => 'required|numeric',
        'paymentMethod' => 'required|string',
        'orderType' => 'required|string',

        'date' => 'nullable|date',
        'cashierUsername' => 'nullable|string|max:50',
        'cashierId' => 'nullable|string|max:128',
        'shift' => 'nullable|in:AM,PM',
        'discount' => 'nullable',
        'discountValue' => 'nullable|numeric',
        'vat' => 'nullable|numeric',
        'tendered' => 'nullable|numeric',
        'change' => 'nullable|numeric',
    ]);

    $actor = $request->attributes->get('audit_actor', []);
    $cashierId = $data['cashierId'] ?? null;

    if (($actor['role'] ?? null) === 'cashier' && $cashierId !== $actor['uid']) {
        return response()->json([
            'success' => false,
            'message' => 'The sale cashier does not match the authenticated account.',
        ], 403);
    }

    $clientSaleId = (string) ($data['clientSaleId'] ?? $data['id'] ?? Str::uuid());

    if (!preg_match('/^[A-Za-z0-9_-]{1,128}$/', $clientSaleId)) {
        return response()->json([
            'success' => false,
            'message' => 'The sale id is invalid.',
        ], 422);
    }

    $database = app('firebase.database');
    $saleReference = $database->getReference("sales/{$clientSaleId}");
    $sale = $saleReference->getValue();
    $isNewSale = !is_array($sale);

    if ($isNewSale) {
        $items = array_map(static function (array $item): array {
            if (!isset($item['qty']) && isset($item['quantity'])) {
                $item['qty'] = $item['quantity'];
            }

            unset($item['quantity'], $item['specialInstructions']);

            return $item;
        }, $data['items']);

        $orderNumber = trim((string) ($data['orderNumber'] ?? ''));
        if ($orderNumber === '') {
            $orderNumber = 'A-' . strtoupper(substr(hash('sha256', $clientSaleId), 0, 8));
        }

        $sale = [
            'date' => $data['date'] ?? now()->toISOString(),
            'cashierUsername' => ($actor['role'] ?? null) === 'cashier'
                ? ($actor['cashierUsername'] ?? '')
                : ($data['cashierUsername'] ?? null),
            'cashierId' => ($actor['role'] ?? null) === 'cashier'
                ? $actor['uid']
                : ($data['cashierId'] ?? null),
            'shift' => ($actor['role'] ?? null) === 'cashier'
                ? ($actor['shift'] ?? null)
                : ($data['shift'] ?? null),
            'items' => $items,
            'subtotal' => (float) $data['subtotal'],
            'discount' => $data['discount'] ?? null,
            'discountValue' => isset($data['discountValue']) ? (float) $data['discountValue'] : 0,
            'vat' => isset($data['vat']) ? (float) $data['vat'] : 0,
            'total' => (float) $data['total'],
            'paymentMethod' => $data['paymentMethod'],
            'orderType' => $data['orderType'],
            'tendered' => isset($data['tendered']) ? (float) $data['tendered'] : 0,
            'change' => isset($data['change']) ? (float) $data['change'] : 0,
            'orderNumber' => $orderNumber,
            'kitchenSyncStatus' => 'pending',
            'kitchenSyncAttempts' => 0,
        ];

        try {
            $isNewSale = $database->runTransaction(function (\Kreait\Firebase\Database\Transaction $transaction) use (
                $saleReference,
                $sale,
            ): bool {
                if ($transaction->snapshot($saleReference)->getValue() === null) {
                    $transaction->set($saleReference, $sale);
                    return true;
                }

                return false;
            });
            $sale = $saleReference->getValue();
        } catch (TransactionFailed $error) {
            $isNewSale = false;
            if (!is_array($sale = $saleReference->getValue())) {
                throw $error;
            }
        }

    }

    if (!is_array($sale)) {
        throw new \RuntimeException('Firebase did not return the saved sale.');
    }

    if (($actor['role'] ?? null) === 'cashier' && ($sale['cashierId'] ?? null) !== $actor['uid']) {
        return response()->json(['success' => false, 'message' => 'This sale belongs to another account.'], 409);
    }

    app(\App\Services\KitchenOrderSyncService::class)->syncSale($clientSaleId, $sale);

    if ($isNewSale) {
        $recordAudit(
            'sale_recorded',
            $actor,
            'sale',
            $clientSaleId,
            [
                'order_type' => $sale['orderType'] ?? '',
                'item_count' => count($sale['items'] ?? []),
            ],
        );
    }

    $responseSale = $sale;
    unset($responseSale['kitchenSyncStatus'], $responseSale['kitchenSyncAttempts'], $responseSale['kitchenSyncLastError'], $responseSale['kitchenSyncedAt']);

    return response()->json([
        'success' => true,
        'message' => 'Sale saved successfully.',
        'data' => [
            'id' => $clientSaleId,
            ...$responseSale,
        ],
    ]);

});


// =====================================================
// RESET / DELETE ALL SALES
// =====================================================

Route::delete('/sales', function (Request $request) use ($authorizeAdmin, $recordAudit) {
    $authorizationError = $authorizeAdmin($request);

    if ($authorizationError) {
        return $authorizationError;
    }

    app('firebase.database')
        ->getReference('sales')
        ->remove();

    $recordAudit(
        'sales_reset',
        $request->attributes->get('audit_actor', []),
        'sales',
    );

    return response()->json([
        'success' => true,
        'message' => 'All sales data cleared successfully.',
    ]);
});

Route::post('/kitchen/session', function (Request $request) use ($authorizeAdmin) {
    $authorizationError = $authorizeAdmin($request, true);
    if ($authorizationError) {
        return $authorizationError;
    }

    $actor = $request->attributes->get('audit_actor');
    try {
        if (app(PosAdministrator::class)->requiresTotp($actor['uid'])) {
            return response()->json(['message' => 'Open the kitchen board from the POS.'], 403);
        }
        $token = app('firebase.auth')->createCustomToken($actor['uid'], [], 60);
    } catch (\Throwable $e) {
        Log::warning('Kitchen session token could not be issued.', ['exception' => $e::class]);

        return response()->json(['success' => false, 'message' => 'Could not start the kitchen session.'], 503);
    }

    return response()->json([
        'success' => true,
        'data' => ['token' => $token->toString()],
    ])->header('Cache-Control', 'no-store');
})->middleware('throttle:15,1');

Route::get('/kitchen/config', function (Request $request) use ($authorizeAdmin, $ensureFirebaseSupabaseClaim) {
    $authorizationError = $authorizeAdmin($request);
    $canUpdateStatus = $authorizationError === null;
    if ($canUpdateStatus && app(PosAdministrator::class)->requiresTotp($request->attributes->get('audit_actor')['uid'])) {
        return response()->json(['message' => 'Open the kitchen board from the POS.'], 403);
    }

    if ($canUpdateStatus) {
        return response()->json(['success' => true, 'data' => ['useLaravel' => true]])->header('Cache-Control', 'no-store');
    }

    if ($authorizationError) {
        if ($authorizationError->getStatusCode() !== 403
            || ($authorizationError->getData()->code ?? null) === AdministratorEmailVerification::REQUIRED) {
            return $authorizationError;
        }

        try {
            $auth = app('firebase.auth');
            $token = $auth->verifyIdToken(substr($request->header('Authorization'), 7), true);
            $uid = $token->claims()->get('sub');
            $user = $auth->getUser($uid);
        } catch (\Throwable $e) {
            return response()->json(['success' => false, 'message' => 'Could not verify kitchen access.'], 401);
        }

        $email = strtolower($user->email ?? '');
        if (
            $user->disabled ||
            str_ends_with($email, '@cashier.atecles-pos.com') ||
            str_ends_with($email, '@atecles-pos.local') ||
            ($user->customClaims['kitchen_viewer'] ?? null) !== true ||
            app(PosAdministrator::class)->matches($uid, $user->email)
        ) {
            return response()->json(['success' => false, 'message' => 'Kitchen access required.'], 403);
        }

        $claimsError = $ensureFirebaseSupabaseClaim($request, $uid, $user->customClaims);
        if ($claimsError) {
            return $claimsError;
        }
    }

    $url = trim((string) config('services.supabase.url'));
    $anonKey = trim((string) config('services.supabase.anon_key'));

    if ($url === '' || $anonKey === '') {
        return response()->json([
            'success' => false,
            'message' => 'Kitchen display configuration is incomplete.',
        ], 503);
    }

    return response()->json([
        'success' => true,
        'data' => [
            'url' => $url,
            'anonKey' => $anonKey,
            'canUpdateStatus' => $canUpdateStatus,
        ],
    ]);
});

Route::post('/kitchen/sync-pending', function (
    Request $request,
    \App\Services\KitchenOrderSyncService $syncService
) use ($authorizeUser) {
    $authorizationError = $authorizeUser($request);

    if ($authorizationError) {
        return $authorizationError;
    }

    $pendingSales = $syncService->pendingSales(100);
    $synced = 0;

    foreach ($pendingSales as $saleId => $sale) {
        if (is_array($sale) && $syncService->syncSale((string) $saleId, $sale)) {
            $synced++;
        }
    }

    return response()->json([
        'success' => true,
        'data' => [
            'synced' => $synced,
            'pending' => count($pendingSales) - $synced,
        ],
    ]);
});

Route::match(['get', 'patch'], '/kitchen/pilot-orders/{order?}', function (Request $request, ?string $order = null) use ($authorizeAdmin) {
    if ($error = $authorizeAdmin($request, true)) {
        return $error;
    }
    if ($request->isMethod('PATCH') !== ($order !== null)) {
        abort(404);
    }

    $url = rtrim((string) config('services.supabase.url'), '/');
    $key = (string) config('services.supabase.service_role_key');
    if ($url === '' || $key === '') {
        return response()->json(['message' => 'Kitchen service unavailable.'], 503);
    }

    try {
        $client = \Illuminate\Support\Facades\Http::acceptJson()->withoutRedirecting()
            ->withHeaders(['apikey' => $key])->withToken($key)->connectTimeout(2)->timeout(5);
        $endpoint = $url.'/rest/v1/kitchen_orders';
        $active = 'in.(new,preparing,ready)';
        if ($order !== null) {
            $query = http_build_query(['id' => 'eq.'.$order, 'status' => $active], encoding_type: PHP_QUERY_RFC3986);
            $result = $client->patch($endpoint.'?'.$query, ['status' => 'completed', 'updated_at' => now()->toISOString()]);

            return $result->successful() ? response()->noContent()->header('Cache-Control', 'no-store')
                : response()->json(['message' => 'Could not complete the order.'], 502);
        }
        $result = $client->get($endpoint, [
            'select' => 'id,firebase_sale_id,order_number,items,status,created_at,updated_at',
            'status' => $active,
            'order' => 'created_at.desc,id.desc',
        ]);
        if ($result->successful() && is_array($result->json())) {
            $orders = array_map(static function (array $order): array {
                $saleId = $order['firebase_sale_id'] ?? '';
                unset($order['firebase_sale_id']);
                if (!is_string($saleId) || !preg_match('/^[A-Za-z0-9_-]{1,128}$/', $saleId)) {
                    return $order;
                }

                try {
                    $type = Cache::remember("pos:kitchen-order-type:{$saleId}", 3600, static function () use ($saleId) {
                        $type = app('firebase.database')->getReference("sales/{$saleId}/orderType")->getValue();
                        $type = is_string($type) ? str_replace(['-', ' '], '_', strtolower(trim($type))) : '';

                        return in_array($type, ['dine_in', 'take_out'], true) ? $type : '';
                    });
                    if ($type !== '') {
                        $order['order_type'] = $type;
                    }
                } catch (\Throwable) {
                    // Keep the kitchen board available when the linked sale cannot be read.
                }

                return $order;
            }, $result->json());

            return response()->json(['data' => $orders])->header('Cache-Control', 'no-store');
        }
    } catch (\Throwable) {
        // Avoid recording upstream headers or order details.
    }

    return response()->json(['message' => 'Kitchen service unavailable.'], 502);
})->whereUuid('order')->middleware('throttle:60,1');

Route::get('/audit-logs', function (Request $request) use ($authorizeAdmin) {
    $authorizationError = $authorizeAdmin($request);

    if ($authorizationError) {
        return $authorizationError;
    }

    try {
        $stored = app('firebase.database')
            ->getReference('audit_logs')
            ->orderByKey()
            ->limitToLast(300)
            ->getValue();
        $entries = is_array($stored) ? $stored : [];
        krsort($entries, SORT_STRING);
        $auditLogService = app(\App\Services\AuditLogService::class);
        $records = [];
        $restrictionEntries = [];
        foreach ($entries as $id => $entry) {
            $valid = $auditLogService->verify([$entry]);
            $record = ['id' => (string) $id, 'integrity_valid' => $valid];
            if ($valid) {
                foreach (['event', 'actor_uid', 'actor_role', 'target_type', 'target_id', 'created_at'] as $field) {
                    $record[$field] = is_string($entry[$field] ?? null) ? $entry[$field] : null;
                }
                if ($record['target_type'] === 'account_identifier') {
                    $record['target_id'] = null;
                }
                if ($record['event'] === 'login_source_rate_limited' && $record['target_type'] === 'login_restriction') {
                    $restrictionEntries[$id] = $entry;
                }
            }
            $records[] = $record;
        }
    } catch (\Throwable $e) {
        Log::error('Audit history could not be loaded.', ['exception' => $e::class]);
        return response()->json(['success' => false, 'message' => 'Audit history is temporarily unavailable.'], 503);
    }

    try {
        $active = array_fill_keys(app(\App\Services\PosLoginService::class)->activeRestrictionEntries($restrictionEntries), true);
        foreach ($records as &$record) {
            if (isset($active[$record['id']])) {
                $record['can_remove_login_restriction'] = true;
            }
        }
        unset($record);
    } catch (\Throwable $e) {
        Log::warning('Could not check active login restrictions.', ['exception' => $e::class]);
    }

    return response()->json([
        'success' => true,
        'data' => $records,
        'integrity_verified' => $records !== [] && !in_array(false, array_column($records, 'integrity_valid'), true),
    ])->header('Cache-Control', 'no-store');
});

Route::post('/audit-logs/{entryId}/remove-login-restriction', function (Request $request, string $entryId) use ($authorizeAdmin, $recordAudit) {
    if ($error = $authorizeAdmin($request, true)) {
        return $error;
    }

    try {
        $entry = app('firebase.database')->getReference("audit_logs/{$entryId}")->getValue();
        if (!is_array($entry) || !app(\App\Services\AuditLogService::class)->verify([$entry])) {
            return response()->json(['message' => 'A verified audit entry was not found.'], 404);
        }

        $restrictionId = app(\App\Services\PosLoginService::class)->removeRestriction($entry);
    } catch (\Illuminate\Contracts\Cache\LockTimeoutException) {
        return response()->json(['message' => 'A sign-in is in progress for this source. Please try again.'], 409);
    } catch (\Throwable $e) {
        Log::warning('Login restriction could not be removed.', ['exception' => $e::class]);
        return response()->json(['message' => 'Could not remove the login restriction. Please try again.'], 503);
    }

    if ($restrictionId === null) {
        return response()->json([
            'status' => 'inactive',
            'message' => 'This restriction has expired, was already removed, or cannot be removed from this entry.',
        ], 410);
    }

    $saved = $recordAudit(
        'admin_login_restriction_removed',
        $request->attributes->get('audit_actor', []),
        'login_restriction',
        $restrictionId,
    );

    return response()->json([
        'status' => 'removed',
        'message' => $saved
            ? 'Login restriction removed.'
            : 'Login restriction removed, but the audit entry could not be saved.',
        'auditRecorded' => $saved,
    ])->header('Cache-Control', 'no-store');
})->where('entryId', '[A-Za-z0-9_-]{1,128}');

Route::get('/pos/email-verification', function (Request $request) use ($authorizeAdmin) {
    $authorizationError = $authorizeAdmin($request, true);

    return ($authorizationError ?? response()->noContent())->header('Cache-Control', 'no-store');
});

$submitAdministratorRequest = static function (PosAdministratorRequests $requests, \Kreait\Firebase\Auth\UserRecord $user, bool $verified) {
    $application = $requests->status($user, $verified, register: true);
    $message = 'Your administrator request is awaiting approval.';
    if ($application['status'] === 'rejected') {
        $message = 'Your administrator request was rejected.';
    } elseif ($application['status'] === 'approved') {
        $message = 'Your administrator request has been approved. Return to Sign In.';
    } elseif (!$verified) {
        try {
            $message = app(AdministratorEmailVerification::class)->send($user)
                ? 'Request submitted. Check your inbox or spam folder for the Firebase verification link.'
                : 'Request submitted. Wait a minute before requesting another verification email.';
        } catch (\Throwable $error) {
            Log::warning('Administrator request verification email could not be sent.', ['exception' => $error::class]);
            $message = 'Request submitted. Email delivery failed. Use Resend verification email to try again.';
        }
    }

    return response()->json(['data' => $application, 'message' => $message])->header('Cache-Control', 'no-store');
};

Route::post('/pos/administrator-registration', function (Request $request, PosAdministratorRequests $requests) use ($submitAdministratorRequest) {
    $data = $request->validate(['email' => 'required|email|max:160', 'password' => 'required|string|min:8|max:4096']);
    $email = strtolower($data['email']);
    if (!PosAdministrator::isApplicantEmail($email) || app(PosAdministrator::class)->isLegacyEmail($email)) {
        return response()->json(['message' => 'This email cannot request administrator access.'], 403);
    }
    if (!str_ends_with($email, '@gmail.com')) {
        return response()->json(['message' => 'Enter a Gmail address to create an administrator account.'], 422);
    }

    try {
        $user = app('firebase.auth')->createUser([
            'email' => $email,
            'password' => $data['password'],
            'emailVerified' => false,
        ]);
    } catch (EmailExists) {
        return response()->json(['code' => 'firebase_account_exists'], 409);
    } catch (\Throwable $error) {
        Log::warning('Firebase applicant creation failed.', ['exception' => $error::class]);

        return response()->json(['message' => 'Firebase could not create the account. Check your details and try again.'], 503);
    }
    abort_unless($requests->eligible($user), 403, 'This Firebase account cannot request administrator access.');

    return $submitAdministratorRequest($requests, $user, false)->setStatusCode(201);
})->middleware('throttle:5,1,administrator-registration:');

Route::post('/pos/administrator-request', function (Request $request, PosAdministratorRequests $requests) use ($firebaseAuthFailure, $submitAdministratorRequest, $verifyFirebaseToken) {
    $token = $request->bearerToken();
    if (!$token) {
        return response()->json(['message' => 'Firebase sign-in required.'], 401);
    }
    try {
        $auth = app('firebase.auth');
        $claims = $verifyFirebaseToken($request, $auth, $token, true)->claims();
        $user = $auth->getUser($claims->get('sub'));
    } catch (\Throwable $error) {
        Log::warning('Invalid Firebase applicant authentication.', $firebaseAuthFailure($error));

        return response()->json(['message' => 'Invalid or expired Firebase authentication.'], 401);
    }
    if (!$requests->eligible($user) || ($claims->get('firebase', [])['sign_in_provider'] ?? null) !== 'password') {
        return response()->json(['message' => 'This Firebase account cannot request administrator access.'], 403);
    }

    return $submitAdministratorRequest($requests, $user, AdministratorEmailVerification::verified($user, $claims));
})->middleware('throttle:10,1,administrator-request:');

Route::get('/administrator-requests', function (Request $request, PosAdministratorRequests $requests) use ($authorizeAdmin) {
    if ($error = $authorizeAdmin($request, true)) {
        return $error;
    }

    return response()->json(['data' => $requests->all()])->header('Cache-Control', 'no-store');
})->middleware('throttle:30,1,administrator-review-list:');

Route::patch('/administrator-requests/{uid}', function (Request $request, string $uid, PosAdministratorRequests $requests) use ($authorizeAdmin) {
    if ($error = $authorizeAdmin($request, true)) {
        return $error;
    }
    $data = $request->validate(['decision' => 'required|in:approved,rejected']);
    $application = $requests->decide($uid, $request->attributes->get('audit_actor'), $data['decision']);

    return response()->json(['data' => $application])->header('Cache-Control', 'no-store');
})->middleware('throttle:30,1,administrator-review-write:');

Route::post('/pos/login', function (Request $request) use ($authorizeUser, $recordAudit, $verificationRequired, $firebaseAuthFailure, $verifyFirebaseToken) {
    $response = static fn (array $data, int $status = 200) => response()->json($data, $status)
        ->header('Cache-Control', 'no-store');

    $validator = Validator::make($request->only(['identifier', 'password', 'code', 'enroll', 'session', 'approval', 'resendVerification']), [
        'identifier' => 'required|string|max:160',
        'password' => 'required|string|max:4096',
        'code' => 'required_if:enroll,finish|string|regex:/\A[0-9]{6}\z/',
        'enroll' => 'sometimes|string|in:start,finish',
        'session' => 'required_if:enroll,finish|string|max:8192',
        'approval' => 'required_if:enroll,start|string|regex:/\A[0-9a-f]{64}\z/',
        'resendVerification' => 'sometimes|boolean',
    ]);
    if ($validator->fails()) {
        return $response(['message' => 'Enter your email or cashier username and password.'], 422);
    }

    try {
        $input = $validator->validated();
        $identifier = mb_strtolower(trim($input['identifier']), 'UTF-8');
        $resendVerification = (bool) ($input['resendVerification'] ?? false) && str_contains($identifier, '@');
        $attempt = app(\App\Services\PosLoginService::class)->attempt(
            (string) $request->ip(), $identifier, $input['password'], array_intersect_key($input, array_flip(['code', 'enroll', 'session', 'approval'])),
            $resendVerification,
        );

        $auditSaved = null;
        if ($attempt['status'] === 'invalid') {
            $audit = $attempt['audit'] + ['role' => $attempt['role']];
            $actor = ['role' => 'unauthenticated'];
            $event = $attempt['role'] === 'admin' ? 'administrator_login_failed' : 'cashier_login_failed';
            $auditSaved = $recordAudit($event, $actor, 'account_identifier', $audit['attempted_identifier_hash'], $audit);
            if ($attempt['retry_after'] > 0) {
                $restrictionId = $attempt['restriction_id'] ?? null;
                $limitedSaved = $recordAudit(
                    'login_source_rate_limited',
                    $actor,
                    $restrictionId === null ? 'account_identifier' : 'login_restriction',
                    $restrictionId ?? $audit['attempted_identifier_hash'],
                    $audit,
                );
                $auditSaved = $auditSaved && $limitedSaved;
            }
        }

        if (($attempt['retry_after'] ?? 0) > 0) {
            $seconds = $attempt['retry_after'];
            $minutes = (int) ceil($seconds / 60);
            $message = $attempt['status'] === 'busy'
                ? 'Another sign-in request is in progress. Please try again in a few seconds.'
                : "Too many login attempts. Please try again in {$minutes} " . ($minutes === 1 ? 'minute.' : 'minutes.');
            return $response(['message' => $message, 'auditRecorded' => $auditSaved], 429)
                ->header('Retry-After', (string) $seconds);
        }

        if ($resendVerification && in_array($attempt['status'], ['verified', 'firebase_challenge'], true)) {
            $auth = app('firebase.auth');
            // Both results confirm the password. Any Firebase tokens stay on the server.
            $user = $attempt['status'] === 'verified'
                ? $auth->getUser($verifyFirebaseToken($request, $auth, $attempt['id_token'], true)->claims()->get('sub'))
                : $auth->getUserByEmail($identifier);
            $requests = app(PosAdministratorRequests::class);
            $applicant = $requests->eligible($user) ? $requests->status($user, false) : null;
            if ($user->disabled || !$user->email || (!app(PosAdministrator::class)->matchesConfigured($user->uid, $user->email)
                && !in_array($applicant['status'] ?? null, ['pending', 'approved'], true))) {
                return $response(['message' => 'Administrator access required.'], 403);
            }
            if ($user->emailVerified) {
                return $response(['code' => 'email_already_verified', 'message' => 'Your email is already verified. Continue to sign in.'], 409);
            }
            if (!app(AdministratorEmailVerification::class)->send($user)) {
                return $response(['message' => 'Wait a minute before requesting another verification email.'], 429)
                    ->header('Retry-After', (string) AdministratorEmailVerification::RESEND_SECONDS);
            }

            return $response(['message' => 'Verification email sent. Check your inbox or spam folder.']);
        }

        if ($attempt['status'] === AdministratorEmailVerification::REQUIRED) {
            return $verificationRequired();
        }
        if (in_array($attempt['status'], ['totp_required', 'totp_enrollment_required', 'totp_enrolled'], true)) {
            return $response(['step' => $attempt['status']]);
        }
        if ($attempt['status'] === 'totp_enrolling') {
            return $response(['step' => $attempt['status'], 'secret' => $attempt['secret'], 'session' => $attempt['session'], 'period' => $attempt['period']]);
        }
        if (!in_array($attempt['status'], ['verified', 'totp_verified'], true)) {
            $message = isset($input['enroll']) ? 'Enrollment could not be verified. Check your approval or authenticator code.'
                : (isset($input['code']) ? 'Sign-in could not be verified. Check your password and authenticator code.' : 'Invalid email or cashier username or password.');
            return $response(['message' => $message, 'auditRecorded' => $auditSaved], 401);
        }

        // Use the same POS identity checks as authenticated routes before issuing a session.
        $pilot = $attempt['status'] === 'totp_verified';
        $verifiedRequest = $request->duplicate();
        $verifiedRequest->attributes->set('pos_login', true);
        $verifiedRequest->headers->set('Authorization', 'Bearer ' . $attempt['id_token']);
        if ($error = $authorizeUser($verifiedRequest, $pilot)) {
            return $error->header('Cache-Control', 'no-store');
        }
        $actor = $verifiedRequest->attributes->get('audit_actor');
        if ($actor['role'] !== $attempt['role']) {
            return $response(['message' => 'Authorized POS account required.'], 403);
        }
        $token = $pilot
            ? app(PosTotpAccess::class)->issue($attempt['id_token'], $attempt['expires_at'])
            : app('firebase.auth')->createCustomToken($actor['uid'], [], 60)->toString();
        $auditSaved = $recordAudit('login_succeeded', $actor, 'session', null, $attempt['audit']);

        $data = ['token' => $token, 'uid' => $actor['uid'], 'role' => $actor['role']];
        if ($pilot) {
            $data['totp'] = true;
        }
        if ($actor['role'] === 'cashier') {
            $data['cashierProfile'] = [
                'cashierId' => $actor['uid'],
                'cashierUsername' => $actor['cashierUsername'],
                'shift' => $actor['shift'],
            ];
        }

        return $response([
            'success' => true,
            'auditRecorded' => $auditSaved,
            'data' => $data,
        ]);
    } catch (\Throwable $e) {
        Log::warning('POS login unavailable.', $firebaseAuthFailure($e));
        return $response(['message' => 'Sign-in is temporarily unavailable. Please try again.'], 503);
    }
});

Route::post('/audit-events', function (Request $request) use ($authorizeUser, $recordAudit) {
    $data = $request->validate([
        'event' => 'required|in:logout,receipt_printed',
        'targetId' => 'nullable|string|max:128|regex:/^[A-Za-z0-9_-]+$/',
        'receiptType' => 'nullable|in:sale,kitchen,dessert,cashier_shift',
    ]);

    $authorizationError = $authorizeUser($request);

    $event = $data['event'];
    $actor = $request->attributes->get('audit_actor', []);
    $authorization = (string) $request->header('Authorization');
    $pilotLogout = $event === 'logout' && str_starts_with($authorization, 'Bearer ') && str_contains($authorization, '~')
        && ($authorizationError || app(PosAdministrator::class)->isTotpPilot($actor['uid'] ?? ''));
    if ($pilotLogout) {
        try {
            $bearer = substr($authorization, 7);
            app(PosTotpAccess::class)->revoke($bearer, explode('~', $bearer, 2)[0]);
        } catch (\Throwable) {
            return response()->json(['message' => 'POS session revocation could not be confirmed.'], 503);
        }
        if ($authorizationError) {
            return response()->json(['success' => true, 'revoked' => true, 'auditRecorded' => false]);
        }
    }
    if ($authorizationError) {
        return $authorizationError;
    }
    $metadata = isset($data['receiptType'])
        ? ['receipt_type' => $data['receiptType']]
        : [];

    $saved = $recordAudit(
        $event,
        $actor,
        $data['event'] === 'receipt_printed' ? 'receipt' : 'session',
        $event === 'receipt_printed' ? ($data['targetId'] ?? null) : null,
        $metadata,
    );

    if ($pilotLogout) {
        return response()->json(['success' => true, 'revoked' => true, 'auditRecorded' => $saved]);
    }

    return $saved
        ? response()->json(['success' => true])
        : response()->json(['success' => false, 'message' => 'Activity could not be recorded.'], 503);
});

// =====================================================
// CREATE CASHIER ACCOUNT - ADMIN ONLY
// =====================================================

$maskFirebasePasswordHash = static function (array $data) use (&$maskFirebasePasswordHash): array {
    foreach ($data as $key => $value) {
        if ($key === 'passwordHash') {
            $data[$key] = '********';
        } elseif (is_array($value)) {
            $data[$key] = $maskFirebasePasswordHash($value);
        }
    }

    return $data;
};

Route::get('/cashiers', function (Request $request) use ($authorizeAdmin, $maskFirebasePasswordHash) {
    $authorizationError = $authorizeAdmin($request);

    if ($authorizationError) {
        return $authorizationError;
    }

    $cashierReference = app('firebase.database')->getReference('cashiers');
    $cashiers = $cashierReference->getValue() ?? [];
    foreach ($cashiers as $databaseKey => &$cashier) {
        if (!is_array($cashier)) {
            continue;
        }

        $cashier['cashierUsername'] = $cashier['cashierUsername']
            ?? $cashier['cashierName']
            ?? $cashier['cashierId']
            ?? '';

        if (
            !isset($cashier['cashierUsername']) ||
            ($cashier['cashierId'] ?? null) !== (string) $databaseKey ||
            array_key_exists('cashierName', $cashier) ||
            array_key_exists('role', $cashier) ||
            ($cashier['uid'] ?? null) !== (string) $databaseKey
        ) {
            $cashierReference
                ->getChild((string) $databaseKey)
                ->update([
                    'cashierUsername' => $cashier['cashierUsername'],
                    'cashierId' => (string) $databaseKey,
                    'cashierName' => null,
                    'role' => null,
                    'uid' => (string) $databaseKey,
                ]);
        }

        unset($cashier['cashierName'], $cashier['role']);
        $cashier['cashierId'] = (string) $databaseKey;
        $cashier['uid'] = (string) $databaseKey;
        $cashier['databaseKey'] = (string) $databaseKey;
    }
    unset($cashier);

    $cashiers = array_values(array_filter(
        $cashiers,
        fn ($cashier) => is_array($cashier)
    ));

    usort($cashiers, fn ($a, $b) => strcmp(
        $a['cashierUsername'] ?? '',
        $b['cashierUsername'] ?? ''
    ));

    return response()->json([
        'success' => true,
        'data' => $maskFirebasePasswordHash($cashiers),
    ]);
});

Route::put('/cashiers/{cashierKey}/shift', function (
    Request $request,
    string $cashierKey
) use ($authorizeAdmin, $recordAudit, $maskFirebasePasswordHash) {
    $authorizationError = $authorizeAdmin($request);

    if ($authorizationError) {
        return $authorizationError;
    }

    $data = $request->validate([
        'shift' => 'required|in:AM,PM',
    ]);

    $reference = app('firebase.database')
        ->getReference("cashiers/{$cashierKey}");
    $cashier = $reference->getValue();

    if (!$cashier) {
        return response()->json([
            'success' => false,
            'message' => 'Cashier account not found.',
        ], 404);
    }

    $reference->update([
        'shift' => $data['shift'],
    ]);

    $recordAudit(
        'cashier_shift_updated',
        $request->attributes->get('audit_actor', []),
        'cashier',
        $cashierKey,
        ['shift' => $data['shift']],
    );

    return response()->json([
        'success' => true,
        'data' => $maskFirebasePasswordHash([
            ...$cashier,
            'shift' => $data['shift'],
        ]),
    ]);
});

Route::put('/cashiers/{cashierKey}/password', function (
    Request $request,
    string $cashierKey
) use ($authorizeAdmin, $recordAudit) {
    $authorizationError = $authorizeAdmin($request);

    if ($authorizationError) {
        return $authorizationError;
    }

    $data = $request->validate([
        'password' => 'required|string|min:6',
    ]);

    $cashier = app('firebase.database')
        ->getReference("cashiers/{$cashierKey}")
        ->getValue();

    if (!$cashier || ($cashier['uid'] ?? null) !== $cashierKey) {
        return response()->json([
            'success' => false,
            'message' => 'Cashier account not found.',
        ], 404);
    }

    try {
        app('firebase.auth')->changeUserPassword($cashierKey, $data['password']);

        $recordAudit(
            'cashier_password_changed',
            $request->attributes->get('audit_actor', []),
            'cashier',
            $cashierKey,
        );

        return response()->json([
            'success' => true,
            'message' => 'Cashier password updated successfully.',
        ]);
    } catch (\Throwable $e) {
        \Log::error('Cashier password update failed.', [
            'cashierUid' => $cashierKey,
            'exception' => $e::class,
        ]);

        return response()->json([
            'success' => false,
            'message' => 'Could not update the cashier password.',
        ], 500);
    }
});

Route::delete('/cashiers/{cashierKey}', function (
    Request $request,
    string $cashierKey
) use ($authorizeAdmin, $recordAudit) {
    $authorizationError = $authorizeAdmin($request);

    if ($authorizationError) {
        return $authorizationError;
    }

    $reference = app('firebase.database')
        ->getReference("cashiers/{$cashierKey}");
    $cashier = $reference->getValue();

    if (!$cashier || ($cashier['uid'] ?? null) !== $cashierKey) {
        return response()->json([
            'success' => false,
            'message' => 'Cashier account not found.',
        ], 404);
    }

    try {
        $reference->remove();

        try {
            app('firebase.auth')->deleteUser($cashierKey);
        } catch (\Throwable $e) {
            $reference->set($cashier);
            throw $e;
        }

        $recordAudit(
            'cashier_deleted',
            $request->attributes->get('audit_actor', []),
            'cashier',
            $cashierKey,
        );

        return response()->json([
            'success' => true,
            'message' => 'Cashier account deleted successfully.',
        ]);
    } catch (\Throwable $e) {
        \Log::error('Cashier account deletion failed.', [
            'cashierUid' => $cashierKey,
            'error' => $e->getMessage(),
        ]);

        return response()->json([
            'success' => false,
            'message' => 'Could not delete the cashier account. Please try again.',
        ], 500);
    }
});

Route::get('/cashier-profile', function (Request $request) use ($ensureFirebaseSupabaseClaim) {
    $authorization = $request->header('Authorization');

    if (!$authorization || !str_starts_with($authorization, 'Bearer ')) {
        return response()->json([
            'success' => false,
            'message' => 'Authentication required.',
        ], 401);
    }

    try {
        $auth = app('firebase.auth');
        $verifiedToken = $auth->verifyIdToken(substr($authorization, 7));
        $uid = $verifiedToken->claims()->get('sub');
        $user = $auth->getUser($uid);
        $email = strtolower($user->email ?? '');
        if (app(PosAdministrator::class)->matches($uid, $user->email)) {
            return response()->json(['message' => 'Cashier account required.'], 403);
        }
        $emailSuffixes = [
            '@cashier.atecles-pos.com',
            '@atecles-pos.local',
        ];
        $emailSuffix = null;
        foreach ($emailSuffixes as $suffix) {
            if (str_ends_with($email, $suffix)) {
                $emailSuffix = $suffix;
                break;
            }
        }

        if ($emailSuffix === null) {
            return response()->json([
                'success' => false,
                'message' => 'Cashier account required.',
            ], 403);
        }

        $database = app('firebase.database');
        $cashier = $database
            ->getReference("cashiers/{$uid}")
            ->getValue();

        if (!$cashier) {
            $cashierId = strtoupper(substr($email, 0, -strlen($emailSuffix)));
            $cashier = $database
                ->getReference("cashiers/{$cashierId}")
                ->getValue();
        }

        if (
            !$cashier ||
            (isset($cashier['uid']) && $cashier['uid'] !== $uid)
        ) {
            return response()->json([
                'success' => false,
                'message' => 'Cashier profile not found.',
            ], 404);
        }

        $claimsError = $ensureFirebaseSupabaseClaim($request, $uid, $user->customClaims);
        if ($claimsError) {
            return $claimsError;
        }

        return response()->json([
            'success' => true,
            'data' => [
                'cashierId' => $uid,
                'cashierUsername' => $cashier['cashierUsername']
                        ?? '',
                'shift' => $cashier['shift'] ?? null,
                'claimsUpdated' => (bool) $request->attributes->get('firebase_supabase_claims_updated'),
            ],
        ]);
    } catch (\Throwable $e) {
        \Log::warning('Cashier profile lookup failed.', [
            'error' => $e->getMessage(),
        ]);

        return response()->json([
            'success' => false,
            'message' => 'Could not load cashier profile.',
        ], 401);
    }
});

Route::post('/cashiers', function (Request $request) use ($authorizeAdmin, $recordAudit) {
    $authorizationError = $authorizeAdmin($request);

    if ($authorizationError) {
        return $authorizationError;
    }


    // -------------------------------------------------
    // Validate cashier information
    // -------------------------------------------------

    $data = $request->validate([
        'cashierUsername' =>
            'required|string|min:1|max:50',

        'password' =>
            'required|string|min:6',

        'shift' =>
            'required|in:AM,PM',
    ]);


    $cashierUsername = trim($data['cashierUsername']);
    if ($cashierUsername === '') {
        return response()->json([
            'success' => false,
            'message' => 'Please enter a cashier username.',
        ], 422);
    }

    $password =
        $data['password'];


    // -------------------------------------------------
    // Hash the username for Firebase's required email-based authentication.
    // -------------------------------------------------

    $normalizedUsername = mb_strtolower($cashierUsername, 'UTF-8');
    $email = 'cashier-' . substr(hash('sha256', $normalizedUsername), 0, 56) . '@cashier.atecles-pos.com';


    // -------------------------------------------------
    // Create Firebase Authentication account
    // -------------------------------------------------

    try {

        $auth = app('firebase.auth');
        $database = app('firebase.database');
        $existingCashiers = $database
            ->getReference('cashiers')
            ->getValue() ?? [];

        foreach ($existingCashiers as $existingCashier) {
            if (!is_array($existingCashier)) {
                continue;
            }

            $existingName = $existingCashier['cashierUsername'] ?? '';
            if (mb_strtolower(trim($existingName), 'UTF-8') === $normalizedUsername) {
                return response()->json([
                    'success' => false,
                    'message' => 'This cashier username already exists.',
                ], 409);
            }
        }

        // Check whether this internal account already exists.

        try {

            $auth->getUserByEmail($email);

            return response()->json([
                'success' => false,
                'message' =>
                    'This cashier username already exists.',
            ], 409);

        } catch (
            \Kreait\Firebase\Exception\Auth\UserNotFound $e
        ) {

            // User doesn't exist.
            // Continue creating the account.

        }


        // -------------------------------------------------
        // Create Firebase user
        // -------------------------------------------------

        $user = $auth->createUser([
            'email' => $email,
            'password' => $password,
            'displayName' => $cashierUsername,
        ]);


        // -------------------------------------------------
        // Save cashier information in Firebase Database
        // -------------------------------------------------

        $database
            ->getReference(
                "cashiers/{$user->uid}"
            )
            ->set([
                'cashierUsername' => $cashierUsername,
                'cashierId' => $user->uid,
                'uid' => $user->uid,
                'shift' => $data['shift'],
            ]);

        $recordAudit(
            'cashier_created',
            $request->attributes->get('audit_actor', []),
            'cashier',
            $user->uid,
            ['cashier_uid' => $user->uid],
        );


        // -------------------------------------------------
        // Return success
        // -------------------------------------------------

        return response()->json([
            'success' => true,

            'message' =>
                'Cashier account created successfully.',

            'data' => [
                'cashierId' => $user->uid,
                'cashierUsername' => $cashierUsername,
                'shift' => $data['shift'],
            ],
        ]);

    } catch (\Throwable $e) {

        \Log::error(
            'Cashier account creation failed.',
            [
                'error' => $e->getMessage(),
            ]
        );

        return response()->json([
            'success' => false,
            'message' =>
                'Could not create the cashier account. Please try again or contact your administrator.',
        ], 500);
    }
});
