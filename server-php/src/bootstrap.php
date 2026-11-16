<?php
declare(strict_types=1);

namespace TtTurnier;

require_once __DIR__ . '/Http.php';
require_once __DIR__ . '/Datenbank.php';
require_once __DIR__ . '/Mailer.php';
require_once __DIR__ . '/Api.php';
require_once __DIR__ . '/Anmeldung.php';

/**
 * Lädt die Konfiguration. Reihenfolge:
 *  1. Umgebungsvariable TT_CONFIG (Pfad), für Tests und Entwicklung
 *  2. config.php eine Ebene über dem öffentlichen Ordner (außerhalb des Webroots)
 *
 * @return array{db:array{dsn:string,user?:string,pass?:string},setup_code?:string,app_url?:string,mail?:array{absender?:string,admin?:string,datei?:string}}
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

/** Mailversand laut config.php: Dateiablage (Entwicklung), PHP-mail() (Webspace) oder keiner. */
function mailer(array $cfg): Mailer
{
    $m = $cfg['mail'] ?? [];
    if (!empty($m['datei'])) {
        return new DateiMailer((string)$m['datei'], (string)($m['absender'] ?? 'test@example.org'));
    }
    if (!empty($m['absender'])) {
        return new PhpMailer((string)$m['absender']);
    }
    return new KeinMailer();
}

function ausfuehren(): void
{
    try {
        $cfg = konfiguration();
        $api = new Api(Datenbank::verbinden($cfg['db']), $cfg, null, mailer($cfg));
        $antwort = $api->bearbeiten(Anfrage::ausGlobals());
    } catch (ApiFehler $f) {
        $antwort = new Antwort($f->status(), ['fehler' => $f->code_, 'meldung' => $f->getMessage()]);
    } catch (\Throwable $t) {
        error_log('tt-turnier: ' . $t);
        $antwort = new Antwort(500, ['fehler' => 'serverfehler', 'meldung' => 'Keine Verbindung zur Datenbank.']);
    }
    $antwort->senden();
}
