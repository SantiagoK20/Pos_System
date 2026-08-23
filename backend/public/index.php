<?php

require_once __DIR__ . '/../config/firebase.php';

try {
    $database->getReference('test')->set([
        'message' => 'Firebase connection works!',
        'time' => date('Y-m-d H:i:s')
    ]);

    echo "Firebase connection works!";
} catch (Exception $e) {
    echo "Firebase error: " . $e->getMessage();
}