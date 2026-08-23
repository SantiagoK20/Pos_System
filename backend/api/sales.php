<?php

header('Content-Type: application/json');

// Allow React/Vite frontend to communicate with PHP
header('Access-Control-Allow-Origin: http://localhost:5173');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle browser preflight request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/../config/firebase.php';

try {

    $method = $_SERVER['REQUEST_METHOD'];

    // =========================
    // GET - LOAD ALL SALES
    // =========================
    if ($method === 'GET') {

        $sales = $database
            ->getReference('sales')
            ->getValue();

        if ($sales === null) {
            $sales = [];
        }

        echo json_encode([
            'success' => true,
            'data' => $sales
        ]);

        exit;
    }


    // =========================
    // POST - SAVE SALE
    // =========================
    if ($method === 'POST') {

        $input = json_decode(
            file_get_contents('php://input'),
            true
        );

        if (!$input) {

            http_response_code(400);

            echo json_encode([
                'success' => false,
                'message' => 'Invalid JSON data.'
            ]);

            exit;
        }

        // Required sale information
        if (
            !isset($input['items']) ||
            !isset($input['subtotal']) ||
            !isset($input['total']) ||
            !isset($input['paymentMethod'])
        ) {

            http_response_code(400);

            echo json_encode([
                'success' => false,
                'message' => 'Sale data is incomplete.'
            ]);

            exit;
        }

        // Create the sale object
        $sale = [
            'date' => $input['date'] ?? date('c'),

            'items' => $input['items'],

            'subtotal' => (float) $input['subtotal'],

            'discount' => $input['discount'] ?? null,

            'discountValue' => isset($input['discountValue'])
                ? (float) $input['discountValue']
                : 0,

            'vat' => isset($input['vat'])
                ? (float) $input['vat']
                : 0,

            'total' => (float) $input['total'],

            'paymentMethod' => $input['paymentMethod'],

            'tendered' => isset($input['tendered'])
                ? (float) $input['tendered']
                : 0,

            'change' => isset($input['change'])
                ? (float) $input['change']
                : 0
        ];

        // Save to Firebase
        $reference = $database
            ->getReference('sales')
            ->push($sale);

        $saleId = $reference->getKey();

        echo json_encode([
            'success' => true,
            'message' => 'Sale saved successfully.',
            'data' => [
                'id' => $saleId,
                ...$sale
            ]
        ]);

        exit;
    }


    // =========================
    // INVALID METHOD
    // =========================

    http_response_code(405);

    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed.'
    ]);

} catch (Exception $e) {

    http_response_code(500);

    echo json_encode([
        'success' => false,
        'message' => $e->getMessage()
    ]);
}