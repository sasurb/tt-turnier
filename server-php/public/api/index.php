<?php
declare(strict_types=1);

// Einziger öffentlicher Einstiegspunkt der Schnittstelle: index.php?r=<route>
// Der Programmcode liegt außerhalb des Webroots. Wo genau, steht in server.php
// (beim Deploy erzeugt, z. B. wenn die App in einem Unterordner der Hauptdomain liegt);
// ohne server.php gilt die Standardstruktur <ordner>/public/api → <ordner>/src.
$server = is_file(__DIR__ . '/server.php') ? require __DIR__ . '/server.php' : dirname(__DIR__, 2);
require $server . '/src/bootstrap.php';

\TtTurnier\ausfuehren();
