<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

$authorizeAdmin = function (Request $request) {
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
        $adminUser = $auth->getUser($uid);
        $adminEmail = strtolower($adminUser->email ?? '');
        $allowedAdminEmail = strtolower(env('ADMIN_EMAIL', ''));

        if (!$allowedAdminEmail || $adminEmail !== $allowedAdminEmail) {
            return response()->json([
                'success' => false,
                'message' => 'Administrator access required.',
            ], 403);
        }

        return null;
    } catch (\Throwable $e) {
        \Log::warning('Invalid Firebase Admin authentication.', [
            'error' => $e->getMessage(),
        ]);

        return response()->json([
            'success' => false,
            'message' => 'Invalid or expired authentication.',
        ], 401);
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

Route::get('/menu', function () {

    $menu = app('firebase.database')
        ->getReference('menu')
        ->getValue();

    return response()->json([
        'success' => true,
        'data' => $menu ?? [],
    ]);
});


// =====================================================
// ADD MENU ITEM
// =====================================================

Route::post('/menu', function (Request $request) {

    $data = $request->validate([
        'name' => 'required|string',
        'category' => 'required|string',
        'price' => 'required|numeric',
    ]);

    $reference = app('firebase.database')
        ->getReference('menu')
        ->push($data);

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

Route::put('/menu', function (Request $request) {

    $data = $request->validate([
        'id' => 'required|string',
        'name' => 'required|string',
        'category' => 'required|string',
        'price' => 'required|numeric',
    ]);

    $id = $data['id'];

    unset($data['id']);

    app('firebase.database')
        ->getReference("menu/{$id}")
        ->update($data);

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

Route::delete('/menu', function (Request $request) {

    $data = $request->validate([
        'id' => 'required|string',
    ]);

    app('firebase.database')
        ->getReference("menu/{$data['id']}")
        ->remove();

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

Route::get('/sales', function () {

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

Route::post('/sales', function (Request $request) {

    $data = $request->validate([
        'items' => 'required|array',
        'subtotal' => 'required|numeric',
        'total' => 'required|numeric',
        'paymentMethod' => 'required|string',
        'orderType' => 'required|string',

        'date' => 'nullable|string',
        'cashierUsername' => 'nullable|string|max:50',
        'cashierId' => 'nullable|string|max:50',
        'shift' => 'nullable|in:AM,PM',
        'discount' => 'nullable',
        'discountValue' => 'nullable|numeric',
        'vat' => 'nullable|numeric',
        'tendered' => 'nullable|numeric',
        'change' => 'nullable|numeric',
    ]);


    $sale = [
        'date' => $data['date'] ?? now()->toISOString(),
        'cashierUsername' => isset($data['cashierUsername'])
            ? trim($data['cashierUsername'])
            : (isset($data['cashierId']) ? trim($data['cashierId']) : null),
        'shift' => $data['shift'] ?? null,

        'items' => $data['items'],

        'subtotal' => (float) $data['subtotal'],

        'discount' => $data['discount'] ?? null,

        'discountValue' => isset($data['discountValue'])
            ? (float) $data['discountValue']
            : 0,

        'vat' => isset($data['vat'])
            ? (float) $data['vat']
            : 0,

        'total' => (float) $data['total'],

        'paymentMethod' => $data['paymentMethod'],
        'orderType' => $data['orderType'],

        'tendered' => isset($data['tendered'])
            ? (float) $data['tendered']
            : 0,

        'change' => isset($data['change'])
            ? (float) $data['change']
            : 0,
    ];


    // Save to Firebase

    $reference = app('firebase.database')
        ->getReference('sales')
        ->push($sale);


    $saleId = $reference->getKey();


    return response()->json([
        'success' => true,
        'message' => 'Sale saved successfully.',
        'data' => [
            'id' => $saleId,
            ...$sale,
        ],
    ]);
});


// =====================================================
// RESET / DELETE ALL SALES
// =====================================================

Route::delete('/sales', function () {

    app('firebase.database')
        ->getReference('sales')
        ->remove();

    return response()->json([
        'success' => true,
        'message' => 'All sales data cleared successfully.',
    ]);
});

// =====================================================
// CREATE CASHIER ACCOUNT - ADMIN ONLY
// =====================================================

Route::get('/cashiers', function (Request $request) use ($authorizeAdmin) {
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
            ($cashier['cashierId'] ?? null) !== $cashier['cashierUsername'] ||
            array_key_exists('cashierName', $cashier) ||
            array_key_exists('role', $cashier) ||
            ($cashier['uid'] ?? null) !== (string) $databaseKey
        ) {
            $cashierReference
                ->getChild((string) $databaseKey)
                ->update([
                    'cashierUsername' => $cashier['cashierUsername'],
                    'cashierId' => $cashier['cashierUsername'],
                    'cashierName' => null,
                    'role' => null,
                    'uid' => (string) $databaseKey,
                ]);
        }

        unset($cashier['cashierName'], $cashier['role']);
        $cashier['cashierId'] = $cashier['cashierUsername'];
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
        'data' => $cashiers,
    ]);
});

Route::put('/cashiers/{cashierKey}/shift', function (
    Request $request,
    string $cashierKey
) use ($authorizeAdmin) {
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

    return response()->json([
        'success' => true,
        'data' => [
            ...$cashier,
            'shift' => $data['shift'],
        ],
    ]);
});

Route::put('/cashiers/{cashierKey}/password', function (
    Request $request,
    string $cashierKey
) use ($authorizeAdmin) {
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

        return response()->json([
            'success' => true,
            'message' => 'Cashier password updated successfully.',
        ]);
    } catch (\Throwable $e) {
        \Log::error('Cashier password update failed.', [
            'cashierUid' => $cashierKey,
            'error' => $e->getMessage(),
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
) use ($authorizeAdmin) {
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

Route::get('/cashier-profile', function (Request $request) {
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

        return response()->json([
            'success' => true,
            'data' => [
                'cashierUsername' => $cashier['cashierUsername']
                        ?? '',
                'shift' => $cashier['shift'] ?? null,
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

Route::post('/cashiers', function (Request $request) use ($authorizeAdmin) {
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
                'cashierId' => $cashierUsername,
                'uid' => $user->uid,
                'shift' => $data['shift'],
            ]);


        // -------------------------------------------------
        // Return success
        // -------------------------------------------------

        return response()->json([
            'success' => true,

            'message' =>
                'Cashier account created successfully.',

            'data' => [
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