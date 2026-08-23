<?php

header('Content-Type: application/json');

// Allow React/Vite frontend to communicate with PHP
header('Access-Control-Allow-Origin: http://localhost:5173');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
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
    // GET - LOAD MENU
    // =========================
    if ($method === 'GET') {

        $menu = $database
            ->getReference('menu')
            ->getValue();

        if ($menu === null) {
            $menu = [];
        }

        echo json_encode([
            'success' => true,
            'data' => $menu
        ]);

        exit;
    }


    // =========================
    // POST - ADD MENU ITEM
    // =========================
    if ($method === 'POST') {

        $input = json_decode(
            file_get_contents('php://input'),
            true
        );

        if (
            !isset($input['name']) ||
            !isset($input['price']) ||
            !isset($input['category'])
        ) {

            http_response_code(400);

            echo json_encode([
                'success' => false,
                'message' => 'Name, price, and category are required.'
            ]);

            exit;
        }

        $newItem = [
            'name' => trim($input['name']),
            'price' => (float) $input['price'],
            'category' => $input['category']
        ];

        $reference = $database
            ->getReference('menu')
            ->push($newItem);

        echo json_encode([
            'success' => true,
            'message' => 'Menu item added successfully.',
            'data' => [
                'id' => $reference->getKey(),
                'name' => $newItem['name'],
                'price' => $newItem['price'],
                'category' => $newItem['category']
            ]
        ]);

        exit;
    }


    // =========================
    // PUT - EDIT MENU ITEM
    // =========================
    if ($method === 'PUT') {

        $input = json_decode(
            file_get_contents('php://input'),
            true
        );

        if (
            !isset($input['id']) ||
            !isset($input['name']) ||
            !isset($input['price']) ||
            !isset($input['category'])
        ) {

            http_response_code(400);

            echo json_encode([
                'success' => false,
                'message' => 'ID, name, price, and category are required.'
            ]);

            exit;
        }

        $id = $input['id'];

        $updatedItem = [
            'name' => trim($input['name']),
            'price' => (float) $input['price'],
            'category' => $input['category']
        ];

        $database
            ->getReference("menu/$id")
            ->update($updatedItem);

        echo json_encode([
            'success' => true,
            'message' => 'Menu item updated successfully.',
            'data' => [
                'id' => $id,
                'name' => $updatedItem['name'],
                'price' => $updatedItem['price'],
                'category' => $updatedItem['category']
            ]
        ]);

        exit;
    }


    // =========================
    // DELETE - DELETE MENU ITEM
    // =========================
    if ($method === 'DELETE') {

        $input = json_decode(
            file_get_contents('php://input'),
            true
        );

        if (!isset($input['id'])) {

            http_response_code(400);

            echo json_encode([
                'success' => false,
                'message' => 'Menu item ID is required.'
            ]);

            exit;
        }

        $id = $input['id'];

        $database
            ->getReference("menu/$id")
            ->remove();

        echo json_encode([
            'success' => true,
            'message' => 'Menu item deleted successfully.'
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