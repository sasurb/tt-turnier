<?php
declare(strict_types=1);

/**
 * Server-Tests ohne Zusatzpakete. Aufruf: php server-php/tests/ApiTest.php
 * Läuft gegen SQLite im Arbeitsspeicher; optional gegen MySQL mit
 * TT_TEST_DSN, TT_TEST_USER, TT_TEST_PASS (z. B. in GitHub Actions).
 */

require __DIR__ . '/../src/bootstrap.php';

use TtTurnier\{Anfrage, Api, Datenbank};

$fehler = 0;
$anzahl = 0;
$zeit = 1_800_000_000;

function pruefe(bool $bedingung, string $text): void
{
    global $fehler, $anzahl;
    $anzahl++;
    if ($bedingung) {
        echo "  ok  $text\n";
    } else {
        $fehler++;
        echo "  FEHLER  $text\n";
    }
}

function neueApi(): Api
{
    global $zeit;
    $dsn = getenv('TT_TEST_DSN') ?: 'sqlite::memory:';
    $pdo = new PDO($dsn, getenv('TT_TEST_USER') ?: null, getenv('TT_TEST_PASS') ?: null);
    if (str_starts_with($dsn, 'mysql:')) {
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
        foreach (['meta', 'konten', 'turniere', 'sitzungen', 'ereignisse', 'versuche'] as $t) {
            $pdo->exec("DROP TABLE IF EXISTS $t");
        }
    }
    return new Api(new Datenbank($pdo), ['setup_code' => 'einrichtung-123456'], function () use (&$zeit) {
        global $zeit;
        return $zeit;
    });
}

/** @return array{0:int,1:array<string,mixed>} */
function rufe(Api $api, string $methode, string $route, ?array $rumpf = null, ?string $token = null, array $query = [], string $ip = '10.0.0.1'): array
{
    // Rumpf wie über HTTP: JSON hin und zurück, oberste Ebene als Array
    if ($rumpf !== null) {
        $rumpf = get_object_vars(json_decode(json_encode((object)$rumpf), false));
    }
    $a = $api->bearbeiten(new Anfrage($methode, $route, $query, $rumpf, $token, $ip));
    return [$a->status, json_decode(json_encode($a->daten), true)];
}

function ereignis(string $id, string $art = 'test.notiz', array|object $daten = ['text' => 'Hallo']): array
{
    return ['id' => $id, 'art' => $art, 'daten' => (object)$daten, 'zeit' => '2026-11-13T10:00:00.000Z', 'geraet' => 'geraet-a'];
}

echo "Einrichtung\n";
$api = neueApi();
[$s, $d] = rufe($api, 'GET', 'info');
pruefe($s === 200 && $d['eingerichtet'] === false && $d['protokoll'] === 1, 'info: noch nicht eingerichtet');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'a@b.de', 'passwort' => 'xxxxxxxx']);
pruefe($s === 503, 'login vor Einrichtung abgewiesen');
[$s, $d] = rufe($api, 'POST', 'setup', ['code' => 'falsch', 'name' => 'Sascha', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
pruefe($s === 401, 'setup mit falschem Code abgewiesen');
[$s, $d] = rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Sascha', 'email' => 'Admin@Example.org', 'passwort' => 'geheim123']);
pruefe($s === 200, 'setup legt Administrator an');
[$s, $d] = rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'X', 'email' => 'x@example.org', 'passwort' => 'geheim123']);
pruefe($s === 409, 'zweites setup gesperrt');
[$s, $d] = rufe($api, 'GET', 'info');
pruefe($d['eingerichtet'] === true, 'info: eingerichtet');

echo "Anmeldung und Konten\n";
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'admin@example.org', 'passwort' => 'falsch']);
pruefe($s === 401 && $d['fehler'] === 'falsche_zugangsdaten', 'falsches Passwort');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'ADMIN@example.org', 'passwort' => 'geheim123']);
pruefe($s === 200 && $d['konto']['rolle'] === 'admin' && strlen($d['token']) === 64, 'Admin-Anmeldung (E-Mail ohne Groß/Klein)');
$admin = $d['token'];
[$s, $d] = rufe($api, 'POST', 'konto.anlegen', ['name' => 'TTC Muster', 'email' => 'v@example.org', 'passwort' => 'kurz'], $admin);
pruefe($s === 400, 'zu kurzes Passwort abgewiesen');
[$s, $d] = rufe($api, 'POST', 'konto.anlegen', ['name' => 'TTC Muster', 'email' => 'v@example.org', 'passwort' => 'veranst123'], $admin);
pruefe($s === 200 && $d['konto']['rolle'] === 'veranstalter', 'Veranstalter angelegt');
$vId = $d['konto']['id'];
[$s, $d] = rufe($api, 'POST', 'konto.anlegen', ['name' => 'Doppelt', 'email' => 'v@example.org', 'passwort' => 'veranst123'], $admin);
pruefe($s === 409, 'doppelte E-Mail abgewiesen');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'v@example.org', 'passwort' => 'veranst123']);
pruefe($s === 200, 'Veranstalter-Anmeldung');
$vTok = $d['token'];
[$s, $d] = rufe($api, 'GET', 'konten', null, $vTok);
pruefe($s === 403, 'Veranstalter darf keine Konten sehen');
[$s, $d] = rufe($api, 'GET', 'konten', null, $admin);
pruefe($s === 200 && count($d['konten']) === 2 && $d['konten'][1]['letzteAnmeldung'] !== null, 'Admin sieht Konten mit letzter Anmeldung');
[$s, $d] = rufe($api, 'GET', 'ich', null, $vTok);
pruefe($s === 200 && $d['rolle'] === 'veranstalter', 'ich: Rolle Veranstalter');

echo "Turnier\n";
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Vereinsmeisterschaft', 'datum' => '2026-12-05', 'leitungsPasswort' => 'leitung1'], $vTok);
pruefe($s === 200 && strlen($d['turnier']['id']) === 10 && $d['turnier']['veranstalter'] === 'TTC Muster', 'Turnier angelegt');
$tid = $d['turnier']['id'];
$vLeitung = $d['token'];
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'X', 'datum' => null, 'leitungsPasswort' => 'leitung1']);
pruefe($s === 401, 'Turnier anlegen ohne Anmeldung abgewiesen');
[$s, $d] = rufe($api, 'GET', 'turnier', null, null, ['id' => $tid]);
pruefe($s === 200 && $d['turnier']['name'] === 'Vereinsmeisterschaft', 'Turnier öffentlich abrufbar');
[$s, $d] = rufe($api, 'GET', 'turnier', null, null, ['id' => 'gibtsnicht']);
pruefe($s === 404, 'unbekanntes Turnier: 404');
[$s, $d] = rufe($api, 'GET', 'turniere', null, $vTok);
pruefe(count($d['turniere']) === 1, 'Veranstalter sieht eigenes Turnier');
[$s, $d] = rufe($api, 'GET', 'turniere', null, $admin, ['alle' => '1']);
pruefe(count($d['turniere']) === 1, 'Admin sieht alle Turniere');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'passwort' => 'falsch', 'name' => 'Max']);
pruefe($s === 401, 'falsches Leitungspasswort');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'passwort' => 'leitung1', 'name' => 'Max']);
pruefe($s === 200 && $d['rolle'] === 'leitung', 'Leitungszugang mit Passwort');
$leitung = $d['token'];

echo "Ereignisse\n";
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('e-0000001')]], null, ['turnier' => $tid]);
pruefe($s === 401, 'Senden ohne Anmeldung abgewiesen');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('e-0000001')]], $admin, ['turnier' => $tid]);
pruefe($s === 403, 'Admin ohne Turnierzugang darf nicht schreiben');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('e-0000001'), ereignis('e-0000002', 'test.notiz', ['leer' => new stdClass(), 'liste' => []])]], $leitung, ['turnier' => $tid]);
pruefe($s === 200 && count($d['angenommen']) === 2 && $d['angenommen'][1]['seq'] > $d['angenommen'][0]['seq'], 'zwei Ereignisse angenommen, Laufnummer steigt');
$seq1 = $d['angenommen'][0]['seq'];
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('e-0000001'), ereignis('e-0000003')]], $vLeitung, ['turnier' => $tid]);
pruefe($s === 200 && $d['angenommen'][0]['seq'] === $seq1, 'erneutes Senden: gleiche Laufnummer (keine Doppelung)');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [['id' => 'kurz', 'art' => 'x', 'daten' => [], 'zeit' => 'nie', 'geraet' => 'g']]], $leitung, ['turnier' => $tid]);
pruefe($s === 400, 'ungültiges Ereignis abgewiesen');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('e-0000009', 'test.notiz', ['text' => str_repeat('x', 20000)])]], $leitung, ['turnier' => $tid]);
pruefe($s === 400, 'zu großes Ereignis abgewiesen');
[$s, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => '0']);
pruefe($s === 200 && count($d['ereignisse']) === 3 && $d['mehr'] === false, 'Abholen öffentlich, 3 Ereignisse');
pruefe($d['ereignisse'][0]['autor'] === ['rolle' => 'leitung', 'name' => 'Max'], 'Autor vom Server gesetzt');
pruefe($d['ereignisse'][2]['autor']['name'] === 'TTC Muster', 'Veranstalter schreibt als Leitung mit eigenem Namen');
$roh = json_encode($api->bearbeiten(new Anfrage('GET', 'events', ['turnier' => $tid, 'ab' => '0']))->daten);
pruefe(str_contains($roh, '"leer":{}') && str_contains($roh, '"liste":[]'), 'leere Objekte und Listen bleiben erhalten');
[$s, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => (string)$seq1]);
pruefe(count($d['ereignisse']) === 2, 'Abholen ab Laufnummer');

$viele = [];
for ($i = 0; $i < 200; $i++) {
    $viele[] = ereignis(sprintf('m-%08d', $i));
}
rufe($api, 'POST', 'events', ['ereignisse' => $viele], $leitung, ['turnier' => $tid]);
[$s, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => '0']);
pruefe(count($d['ereignisse']) === 200 && $d['mehr'] === true, 'Abholen begrenzt auf 200, „mehr“ gesetzt');
$viele[] = ereignis('m-zuviel01');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => $viele], $leitung, ['turnier' => $tid]);
pruefe($s === 400, 'mehr als 200 Ereignisse je Aufruf abgewiesen');

echo "Sicherheit\n";
for ($i = 0; $i < 10; $i++) {
    rufe($api, 'POST', 'login', ['email' => 'v@example.org', 'passwort' => 'falsch'], null, [], '10.9.9.9');
}
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'v@example.org', 'passwort' => 'veranst123'], null, [], '10.9.9.9');
pruefe($s === 429, 'nach 10 Fehlversuchen gebremst');
$zeit += 16 * 60;
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'v@example.org', 'passwort' => 'veranst123'], null, [], '10.9.9.9');
pruefe($s === 200, 'nach 15 Minuten wieder möglich');
[$s, $d] = rufe($api, 'POST', 'konto.sperren', ['id' => $vId, 'gesperrt' => true], $admin);
pruefe($s === 200 && $d['konto']['gesperrt'] === true, 'Veranstalter gesperrt');
[$s, $d] = rufe($api, 'GET', 'turniere', null, $vTok);
pruefe($s === 401 || $s === 403, 'gesperrtes Konto: Sitzung ungültig');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'v@example.org', 'passwort' => 'veranst123']);
pruefe($s === 403 && $d['fehler'] === 'gesperrt', 'gesperrtes Konto kann sich nicht anmelden');
[$s, $d] = rufe($api, 'POST', 'konto.sperren', ['id' => $vId, 'gesperrt' => false], $admin);
pruefe($s === 200, 'Sperre aufgehoben');
[$s, $d] = rufe($api, 'POST', 'passwort.aendern', ['alt' => 'geheim123', 'neu' => 'neuesPasswort1'], $admin);
pruefe($s === 200, 'Passwort geändert');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'admin@example.org', 'passwort' => 'neuesPasswort1']);
pruefe($s === 200, 'Anmeldung mit neuem Passwort');
$zeit += 31 * 24 * 3600;
[$s, $d] = rufe($api, 'GET', 'ich', null, $leitung);
pruefe($s === 401, 'Sitzung läuft nach 30 Tagen ab');
[$s, $d] = rufe($api, 'GET', 'unbekannt');
pruefe($s === 404, 'unbekannte Route: 404');
$a = $api->bearbeiten(new Anfrage('POST', 'login', [], ['__ungueltig' => true]));
pruefe($a->status === 400, 'kaputtes JSON: 400');

echo "\n$anzahl Prüfungen, $fehler Fehler\n";
exit($fehler === 0 ? 0 : 1);
