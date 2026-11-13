<?php
declare(strict_types=1);

// Einziger öffentlicher Einstiegspunkt der Schnittstelle: index.php?r=<route>
// Der Programmcode liegt außerhalb des Webroots in ../../src.
require dirname(__DIR__, 2) . '/src/bootstrap.php';

\TtTurnier\ausfuehren();
