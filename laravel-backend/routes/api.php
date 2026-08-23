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