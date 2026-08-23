<?php

require_once __DIR__ . '/../vendor/autoload.php';

use Kreait\Firebase\Factory;

$serviceAccount = __DIR__ . '/atecles-grill-pos-firebase-adminsdk-fbsvc-f1e3f85eb6.json';

$factory = (new Factory)
    ->withServiceAccount($serviceAccount)
    ->withDatabaseUri('https://atecles-grill-pos-default-rtdb.asia-southeast1.firebasedatabase.app/');

$database = $factory->createDatabase();