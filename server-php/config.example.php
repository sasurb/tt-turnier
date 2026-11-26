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
    // Registrierung: Zahl der führenden SHA-256-Nullbits (12 bis 20).
    'registrieraufgabe_bits' => 17,

    // Adresse der App – für Links in Mails (Willkommen, Passwort zurücksetzen, Sicherung).
    'app_url' => 'https://example.org/tt-turnier/',
    'mail' => [
        // Absender: eine Adresse der eigenen Domain (Postfach beim Webspace-Anbieter)
        'absender' => 'tt-turnier@example.org',
        // Empfänger der Info-Mails (neue Konten, Rückmeldungen); Antworten auf System-Mails gehen hierhin
        'admin' => 'betreiber@example.org',
        // Entwicklung: Mails als Dateien in diesen Ordner schreiben statt versenden
        // 'datei' => __DIR__ . '/mails',
    ],
];
