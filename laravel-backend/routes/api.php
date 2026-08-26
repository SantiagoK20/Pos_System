<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;


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

        'date' => 'nullable|string',
        'discount' => 'nullable',
        'discountValue' => 'nullable|numeric',
        'vat' => 'nullable|numeric',
        'tendered' => 'nullable|numeric',
        'change' => 'nullable|numeric',
    ]);


    $sale = [
        'date' => $data['date'] ?? now()->toISOString(),

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

Route::post('/cashiers', function (Request $request) {

    // -------------------------------------------------
    // Get Firebase ID token
    // -------------------------------------------------

    $authorization = $request->header('Authorization');

    if (
        !$authorization ||
        !str_starts_with($authorization, 'Bearer ')
    ) {
        return response()->json([
            'success' => false,
            'message' => 'Authentication required.',
        ], 401);
    }

    $idToken = substr($authorization, 7);


    // -------------------------------------------------
    // Verify Admin Firebase account
    // -------------------------------------------------

    try {

        $auth = app('firebase.auth');

        $verifiedToken =
            $auth->verifyIdToken($idToken);

        $uid =
            $verifiedToken->claims()->get('sub');

        $adminUser =
            $auth->getUser($uid);

        $adminEmail =
            strtolower($adminUser->email ?? '');

        $allowedAdminEmail =
            strtolower(env('ADMIN_EMAIL', ''));

        // Make sure the logged-in user
        // is your designated Admin.

        if (
            !$allowedAdminEmail ||
            $adminEmail !== $allowedAdminEmail
        ) {
            return response()->json([
                'success' => false,
                'message' =>
                    'Administrator access required.',
            ], 403);
        }

    } catch (\Throwable $e) {

        \Log::warning(
            'Invalid Firebase Admin authentication.',
            [
                'error' => $e->getMessage(),
            ]
        );

        return response()->json([
            'success' => false,
            'message' =>
                'Invalid or expired authentication.',
        ], 401);
    }


    // -------------------------------------------------
    // Validate cashier information
    // -------------------------------------------------

    $data = $request->validate([
        'cashierId' =>
            'required|string|min:1|max:50',

        'password' =>
            'required|string|min:6',
    ]);


    $cashierId =
        strtoupper(trim($data['cashierId']));

    $password =
        $data['password'];


    // -------------------------------------------------
    // Create internal Firebase email
    // -------------------------------------------------

    // The cashier will only use the Cashier ID.
    //
    // Example:
    //
    // C001
    // ↓
    // c001@atecles-pos.local

    $email =
        strtolower($cashierId) .
        '@atecles-pos.local';


    // -------------------------------------------------
    // Create Firebase Authentication account
    // -------------------------------------------------

    try {

        $auth = app('firebase.auth');


        // Check whether the Cashier ID already exists.

        try {

            $auth->getUserByEmail($email);

            return response()->json([
                'success' => false,
                'message' =>
                    'This Cashier ID already exists.',
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
        ]);


        // -------------------------------------------------
        // Save cashier information in Firebase Database
        // -------------------------------------------------

        app('firebase.database')
            ->getReference(
                "cashiers/{$cashierId}"
            )
            ->set([
                'cashierId' => $cashierId,
                'uid' => $user->uid,
                'role' => 'cashier',
            ]);


        // -------------------------------------------------
        // Return success
        // -------------------------------------------------

        return response()->json([
            'success' => true,

            'message' =>
                'Cashier account created successfully.',

            'data' => [
                'cashierId' => $cashierId,
                'uid' => $user->uid,
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
                'Failed to create cashier account.',
        ], 500);
    }
});