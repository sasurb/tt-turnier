<?php
declare(strict_types=1);

namespace TtTurnier;

require_once __DIR__ . '/Http.php';
require_once __DIR__ . '/Datenbank.php';
require_once __DIR__ . '/Api.php';

/**
 * Lädt die Konfiguration. Reihenfolge:
 *  1. Umgebungsvariable TT_CONFIG (Pfad), für Tests und Entwicklung
 *  2. config.php eine Ebene über dem öffentlichen Ordner (außerhalb des Webroots)
 *
 * @return array{db:array{dsn:string,user?:string,pass?:string},setup_code?:string}
 */
function konfiguration(): array
{
    $pfad = getenv('TT_CONFIG') ?: dirname(__DIR__) . '/config.php';
    if (!is_file($pfad)) {
        throw new ApiFehler('nicht_eingerichtet', 'config.php fehlt auf dem Server. Siehe docs/strato-einrichtung.md.');
    }
    $cfg = require $pfad;
    if (!is_array($cfg) || !isset($cfg['db']['dsn'])) {
        throw new ApiFehler('nicht_eingerichtet', 'config.php ist unvollständig.');
    }
    return $cfg;
}

function ausfuehren(): void
{
    try {
        $cfg = konfiguration();
        $api = new Api(Datenbank::verbinden($cfg['db']), $cfg);
        $antwort = $api->bearbeiten(Anfrage::ausGlobals());
    } catch (ApiFehler $f) {
        $antwort = new Antwort($f->status(), ['fehler' => $f->code_, 'meldung' => $f->getMessage()]);
    } catch (\Throwable $t) {
        error_log('tt-turnier: ' . $t);
        $antwort = new Antwort(500, ['fehler' => 'serverfehler', 'meldung' => 'Keine Verbindung zur Datenbank.']);
    }
    $antwort->senden();
}
