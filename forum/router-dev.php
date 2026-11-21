<?php // local dev only: php -S localhost:8090 -t public router-dev.php
if (preg_match('#^/assets/#', parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH))) return false;
require __DIR__ . '/public/index.php';
