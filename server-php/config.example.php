<?php
// Vorlage für config.php. Die echte config.php liegt auf dem Server EINE EBENE
// ÜBER dem öffentlichen Ordner (z. B. /tt-turnier/config.php neben /tt-turnier/public)
// und wird beim Deploy aus den GitHub-Secrets erzeugt. Nie ins Repo einchecken.
return [
    'db' => [
        // MySQL auf Strato: Host steht im Strato-Kundenbereich bei der Datenbank
        'dsn' => 'mysql:host=DATENBANK-HOST;dbname=DATENBANK-NAME;charset=utf8mb4',
        'user' => 'BENUTZER',
        'pass' => 'PASSWORT',
        // Lokal zum Ausprobieren ohne MySQL:
        // 'dsn' => 'sqlite:' . __DIR__ . '/daten.sqlite',
    ],
    // Einmaliger Code für die Einrichtungsseite (Administrator anlegen), mind. 12 Zeichen.
    'setup_code' => 'BITTE-AENDERN-mind-12-Zeichen',
];
