<?php
declare(strict_types=1);

/**
 * Server-Tests ohne Zusatzpakete. Aufruf: php server-php/tests/ApiTest.php
 * Läuft gegen SQLite im Arbeitsspeicher; optional gegen MySQL mit
 * TT_TEST_DSN, TT_TEST_USER, TT_TEST_PASS (z. B. in GitHub Actions).
 */

require __DIR__ . '/../src/bootstrap.php';

use TtTurnier\{Anfrage, Api, Datenbank, TestMailer};

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

function neueApi(?TestMailer $mailer = null): Api
{
    global $zeit;
    $dsn = getenv('TT_TEST_DSN') ?: 'sqlite::memory:';
    $pdo = new PDO($dsn, getenv('TT_TEST_USER') ?: null, getenv('TT_TEST_PASS') ?: null);
    if (str_starts_with($dsn, 'mysql:')) {
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
        foreach (['meta', 'konten', 'turniere', 'sitzungen', 'ereignisse', 'versuche', 'rueckstellungen', 'codes', 'pool'] as $t) {
            $pdo->exec("DROP TABLE IF EXISTS $t");
        }
    }
    $config = [
        'setup_code' => 'einrichtung-123456',
        'ohne_warten' => true,
        'app_url' => 'https://example.org/tt',
        'mail' => ['absender' => 'tt@example.org', 'admin' => 'betreiber@example.org'],
    ];
    return new Api(new Datenbank($pdo), $config, function () use (&$zeit) {
        global $zeit;
        return $zeit;
    }, $mailer ?? new TestMailer());
}

/** Letzte Mail an eine Adresse */
function mailAn(TestMailer $m, string $an): ?\TtTurnier\Mail
{
    foreach (array_reverse($m->mails) as $x) {
        if ($x->an === $an) {
            return $x;
        }
    }
    return null;
}

/** @return array{0:int,1:array<string,mixed>} */
function rufe(Api $api, string $methode, string $route, ?array $rumpf = null, ?string $token = null, array $query = [], string $ip = '10.0.0.1'): array
{
    // Rumpf wie über HTTP: JSON hin und zurück, oberste Ebene als Array
    if ($rumpf !== null) {
        $rumpf = get_object_vars(json_decode(json_encode((object)$rumpf), false));
    }
    $a = $api->bearbeiten(new Anfrage($methode, $route, $query, $rumpf, $token, Anfrage::ipNormalisieren($ip)));
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
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Vereinsmeisterschaft', 'datum' => '2026-12-05'], $vTok);
pruefe($s === 200 && preg_match('/^[0-9]{8}$/', $d['turnier']['id']) === 1 && $d['turnier']['veranstalter'] === 'TTC Muster', 'Turnier angelegt, Kennung 8 Ziffern');
pruefe(preg_match('/^[0-9]{8}$/', $d['leitung']['code'] ?? '') === 1 && $d['leitung']['rolle'] === 'leitung' && $d['leitung']['name'] === 'TTC Muster', 'Leitungskennung für das Konto angelegt');
$tid = $d['turnier']['id'];
$vLeitung = $d['token'];
$kontoKennung = $d['leitung']['code'];
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'X', 'datum' => null]);
pruefe($s === 401, 'Turnier anlegen ohne Anmeldung abgewiesen');
[$s, $d] = rufe($api, 'GET', 'turnier', null, null, ['id' => $tid]);
pruefe($s === 200 && $d['turnier']['name'] === 'Vereinsmeisterschaft' && !array_key_exists('rechte', $d['turnier']), 'Turnier öffentlich abrufbar, ohne Rechte-Angabe');
[$s, $d] = rufe($api, 'GET', 'turnier', null, $vTok, ['id' => $tid]);
pruefe($s === 200 && $d['turnier']['rechte'] === 'leitung', 'Eigentümer-Konto: Rechte = leitung');
[$s, $d] = rufe($api, 'GET', 'turnier', null, $admin, ['id' => $tid]);
pruefe($s === 200 && $d['turnier']['rechte'] === 'leitung', 'Administrator: Rechte = leitung');
[$s, $d] = rufe($api, 'GET', 'turnier', null, null, ['id' => 'gibtsnicht']);
pruefe($s === 404, 'unbekanntes Turnier: 404');
[$s, $d] = rufe($api, 'GET', 'turniere', null, $vTok);
pruefe(count($d['turniere']) === 1, 'Konto sieht eigenes Turnier');
[$s, $d] = rufe($api, 'GET', 'turniere', null, $admin, ['alle' => '1']);
pruefe(count($d['turniere']) === 1, 'Admin sieht alle Turniere');
// Weitere Leitungskennung mit Namen
[$s, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'leitung', 'bezug' => 'l-max', 'name' => 'Max']]], $vLeitung);
$maxKennung = '';
foreach ($d['codes'] ?? [] as $c) {
    if ($c['bezug'] === 'l-max') {
        $maxKennung = $c['code'];
    }
}
pruefe($s === 200 && preg_match('/^[0-9]{8}$/', $maxKennung) === 1 && $d['codes'][0]['rolle'] === 'leitung', 'zweite Leitungskennung angelegt');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => '00000000']);
pruefe($s === 401, 'falsche Kennung');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => substr($maxKennung, 0, 4) . ' ' . substr($maxKennung, 4)]);
pruefe($s === 200 && $d['rolle'] === 'leitung' && $d['name'] === 'Max', 'Leitungszugang mit Kennung (Leerzeichen erlaubt), Name von der Kennung');
$leitung = $d['token'];
[$s, $d] = rufe($api, 'GET', 'turnier', null, $leitung, ['id' => $tid]);
pruefe($d['turnier']['rechte'] === 'leitung', 'Leitungskennung: Rechte = leitung');
[$s, $d] = rufe($api, 'POST', 'code.entfernen', ['turnier' => $tid, 'rolle' => 'leitung', 'bezug' => 'l-max'], $leitung);
pruefe($s === 200, 'Leitungskennung entfernt');
[$s, $d] = rufe($api, 'GET', 'turnier', null, $leitung, ['id' => $tid]);
pruefe($d['turnier']['rechte'] === null, 'Anmeldung mit entfernter Kennung hat keine Rechte mehr');
[$s, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'leitung', 'bezug' => 'l-max', 'name' => 'Max']]], $vLeitung);
foreach ($d['codes'] as $c) {
    if ($c['bezug'] === 'l-max') {
        $maxKennung = $c['code'];
    }
}
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $maxKennung]);
$leitung = $d['token'];
[$s, $d] = rufe($api, 'POST', 'code.sperren', ['turnier' => $tid, 'rolle' => 'leitung', 'bezug' => 'l-max', 'gesperrt' => true], $leitung);
pruefe($s === 200 && $d['code']['gesperrt'] === true, 'Leitungskennung gesperrt');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $maxKennung]);
pruefe($s === 401, 'gesperrte Leitungskennung gilt nicht');
rufe($api, 'POST', 'code.sperren', ['turnier' => $tid, 'rolle' => 'leitung', 'bezug' => 'l-max', 'gesperrt' => false], $vLeitung);
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $maxKennung]);
$leitung = $d['token'];
pruefe($s === 200, 'entsperrt: Zugang wieder möglich');

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
pruefe($s === 200 && count($d['ereignisse']) === 3 && $d['mehr'] === false && $d['sicht'] === 'zuschauer', 'Abholen öffentlich, 3 Ereignisse');
pruefe($d['ereignisse'][0]['autor'] === ['rolle' => 'leitung', 'name' => ''], 'Zuschauer sehen keine Namen der Eintragenden');
[$s, $d] = rufe($api, 'GET', 'events', null, $leitung, ['turnier' => $tid, 'ab' => '0']);
pruefe($d['sicht'] === 'voll' && $d['ereignisse'][0]['autor'] === ['rolle' => 'leitung', 'name' => 'Max'], 'Autor vom Server gesetzt');
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
for ($i = 0; $i < 30; $i++) {
    rufe($api, 'GET', 'turnier', null, null, ['id' => sprintf('%08d', 20000000 + $i)], '10.8.8.8');
}
[$s, $d] = rufe($api, 'GET', 'turnier', null, null, ['id' => '20000099'], '10.8.8.8');
pruefe($s === 429, 'Durchprobieren von Turnierkennungen wird gebremst');
[$s, $d] = rufe($api, 'GET', 'turnier', null, null, ['id' => $tid], '10.8.8.8');
pruefe($s === 200, 'bekannte Turniere bleiben trotz Bremse erreichbar (Hallen-WLAN)');
[$s, $d] = rufe($api, 'GET', 'turnier', null, null, ['id' => '20000098'], '10.8.8.9');
pruefe($s === 404, 'andere Anschlüsse sind nicht betroffen');
// IPv6: alle Adressen eines /64 zählen zusammen
for ($i = 0; $i < 30; $i++) {
    rufe($api, 'GET', 'turnier', null, null, ['id' => sprintf('%08d', 21000000 + $i)], '2001:db8:1:2::' . dechex($i + 1));
}
[$s] = rufe($api, 'GET', 'turnier', null, null, ['id' => '21000099'], '2001:db8:1:2:ffff::1');
pruefe($s === 429, 'IPv6-Adressen desselben /64 zählen zusammen');
[$s] = rufe($api, 'GET', 'turnier', null, null, ['id' => '21000099'], '2001:db8:1:3::1');
pruefe($s === 404, 'anderes /64 ist nicht betroffen');
// Kennungen durchprobieren: falsche werden ab 30 je Anschluss abgewiesen, richtige kommen immer durch
for ($i = 0; $i < 30; $i++) {
    rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => sprintf('%08d', 30000000 + $i)], null, [], '10.8.8.7');
}
[$s] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => '30000099'], null, [], '10.8.8.7');
pruefe($s === 429, 'falsche Kennungen nach 30 Fehlversuchen je Anschluss gebremst');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $maxKennung], null, [], '10.8.8.7');
pruefe($s === 200, 'richtige Kennung trotz Bremse angenommen (kein Aussperren der Halle)');
for ($i = 0; $i < 201; $i++) {
    rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => sprintf('%08d', 31000000 + $i)], null, [], '10.8.' . ($i % 20) . '.' . intdiv($i, 20));
}
[$s] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => '31999999'], null, [], '10.8.100.100');
pruefe($s === 429, 'nach 200 Fehlversuchen je Turnier sind nur noch richtige Kennungen möglich');
[$s] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $maxKennung], null, [], '10.8.100.100');
pruefe($s === 200, 'richtige Kennung auch dann noch');
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


echo "Etappe 2b: Registrierung\n";
$mailer = new TestMailer();
$api = neueApi($mailer);
rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Sascha', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
[$s, $d] = rufe($api, 'GET', 'info');
pruefe($d['registrierung'] === true && $d['mail'] === true && $d['version'] === '0.9.0' && $d['codes'] === true && $d['kennungen'] === true, 'info: Registrierung, Mail, Codes und Kennungen bereit');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'TSV Nord', 'email' => 'Nord@Example.org', 'passwort' => 'nordpass1'], null, [], '10.1.0.1');
pruefe($s === 200 && strlen($d['token']) === 64 && $d['konto']['rolle'] === 'veranstalter' && $d['konto']['email'] === 'nord@example.org', 'Registrierung legt Veranstalter an und meldet an');
$nordTok = $d['token'];
$w = mailAn($mailer, 'nord@example.org');
pruefe($w !== null && str_contains($w->text, 'https://example.org/tt/') && $w->antwortAn === 'betreiber@example.org', 'Willkommensmail mit Link, Antwort an Betreiber');
$i = mailAn($mailer, 'betreiber@example.org');
pruefe($i !== null && str_contains($i->betreff, 'TSV Nord') && str_contains($i->text, 'nord@example.org'), 'Info-Mail an den Administrator');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Doppelt', 'email' => 'nord@example.org', 'passwort' => 'nordpass1'], null, [], '10.1.0.2');
pruefe($s === 409, 'doppelte E-Mail bei Registrierung abgewiesen');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Bot', 'email' => 'bot@example.org', 'passwort' => 'botpass12', 'website' => 'http://spam'], null, [], '10.1.0.3');
pruefe($s === 400, 'Fangfeld ausgefüllt: abgewiesen');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Kurz', 'email' => 'kurz@example.org', 'passwort' => 'kurz'], null, [], '10.1.0.4');
pruefe($s === 400, 'zu kurzes Passwort bei Registrierung');
for ($n = 1; $n <= 5; $n++) {
    [$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => "Massen {$n}", 'email' => "m{$n}@example.org", 'passwort' => 'massen123'], null, [], '10.1.9.9');
}
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Massen 6', 'email' => 'm6@example.org', 'passwort' => 'massen123'], null, [], '10.1.9.9');
pruefe($s === 429, 'höchstens 5 neue Konten je Stunde und Anschluss');
$zeit += 3601;
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Massen 6', 'email' => 'm6@example.org', 'passwort' => 'massen123'], null, [], '10.1.9.9');
pruefe($s === 200, 'nach einer Stunde wieder möglich');

echo "Etappe 2b: Passwort vergessen\n";
$vorher = count($mailer->mails);
[$s, $d] = rufe($api, 'POST', 'passwort.vergessen', ['email' => 'niemand@example.org'], null, [], '10.2.0.1');
pruefe($s === 200 && count($mailer->mails) === $vorher, 'unbekannte Adresse: gleiche Antwort, keine Mail');
[$s, $d] = rufe($api, 'POST', 'passwort.vergessen', ['email' => 'NORD@example.org'], null, [], '10.2.0.1');
$r = mailAn($mailer, 'nord@example.org');
preg_match('~#/zuruecksetzen/([a-f0-9]{64})~', $r->text, $treffer);
pruefe($s === 200 && isset($treffer[1]), 'Mail mit Link zum Zurücksetzen');
$schl = $treffer[1] ?? '';
[$s, $d] = rufe($api, 'POST', 'passwort.zuruecksetzen', ['schluessel' => str_repeat('a', 64), 'neu' => 'neuNord123'], null, [], '10.2.0.1');
pruefe($s === 401, 'falscher Schlüssel abgewiesen');
[$s, $d] = rufe($api, 'POST', 'passwort.zuruecksetzen', ['schluessel' => $schl, 'neu' => 'neuNord123'], null, [], '10.2.0.1');
pruefe($s === 200 && strlen($d['token']) === 64, 'Passwort zurückgesetzt, neu angemeldet');
$nordTok2 = $d['token'];
[$s, $d] = rufe($api, 'GET', 'ich', null, $nordTok);
pruefe($s === 401, 'alte Sitzungen nach dem Zurücksetzen beendet');
[$s, $d] = rufe($api, 'POST', 'passwort.zuruecksetzen', ['schluessel' => $schl, 'neu' => 'nochmal123'], null, [], '10.2.0.1');
pruefe($s === 401, 'Link nur einmal nutzbar');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'nord@example.org', 'passwort' => 'neuNord123']);
pruefe($s === 200, 'Anmeldung mit neuem Passwort');
rufe($api, 'POST', 'passwort.vergessen', ['email' => 'nord@example.org'], null, [], '10.2.0.2');
preg_match('~#/zuruecksetzen/([a-f0-9]{64})~', mailAn($mailer, 'nord@example.org')->text, $treffer);
$zeit += 3601;
[$s, $d] = rufe($api, 'POST', 'passwort.zuruecksetzen', ['schluessel' => $treffer[1], 'neu' => 'spaeter123'], null, [], '10.2.0.2');
pruefe($s === 401, 'Link nach einer Stunde abgelaufen');

echo "Etappe 2b/4b: Leitungskennungen und Einstellungen\n";
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Herbstturnier', 'datum' => '2026-11-20'], $nordTok2);
pruefe($s === 200, 'Turnier angelegt');
$hid = $d['turnier']['id'];
$hLeitung = $d['token'];
$hKennung = $d['leitung']['code'];
[$s, $d] = rufe($api, 'GET', 'codes', null, $hLeitung, ['turnier' => $hid]);
pruefe($s === 200 && count($d['codes']) === 1 && $d['codes'][0]['rolle'] === 'leitung' && $d['codes'][0]['name'] === 'TSV Nord', 'Leitungskennung des Kontos in der Liste');
[$s, $d] = rufe($api, 'POST', 'code.entfernen', ['turnier' => $hid, 'rolle' => 'leitung', 'bezug' => $d['codes'][0]['bezug']], $hLeitung);
pruefe($s === 409, 'letzte Leitungskennung lässt sich nicht entfernen');
[$s, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $hid, 'eintraege' => [['rolle' => 'leitung', 'bezug' => 'l-jana', 'name' => 'Jana']]], $hLeitung);
$janaKennung = '';
foreach ($d['codes'] as $c) {
    if ($c['bezug'] === 'l-jana') {
        $janaKennung = $c['code'];
    }
}
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $hid, 'code' => $janaKennung]);
pruefe($s === 200 && $d['rolle'] === 'leitung' && $d['name'] === 'Jana', 'Zugang mit Leitungskennung');
$jana = $d['token'];
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, $jana, ['id' => $hid]);
pruefe($s === 200 && !isset($d['leitungsCode']) && $d['sicherungAn'] === ['nord@example.org'] && $d['sicherungTakt'] === 30, 'Leitung sieht Einstellungen, Empfänger = Konto-Mail, Takt 30');
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, null, ['id' => $hid]);
pruefe($s === 401, 'Zuschauer sieht die Einstellungen nicht');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'm1@example.org', 'passwort' => 'massen123']);
$fremd = $d['token'];
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, $fremd, ['id' => $hid]);
pruefe($s === 403, 'fremdes Konto sieht die Einstellungen nicht');
[$s, $d] = rufe($api, 'GET', 'codes', null, $fremd, ['turnier' => $hid]);
pruefe($s === 403, 'fremdes Konto sieht die Kennungen nicht');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'admin@example.org', 'passwort' => 'geheim123']);
$admin2 = $d['token'];
[$s, $d] = rufe($api, 'GET', 'codes', null, $admin2, ['turnier' => $hid]);
pruefe($s === 200 && count($d['codes']) === 2, 'Administrator sieht die Kennungen');
[$s, $d] = rufe($api, 'POST', 'code.neu', ['turnier' => $hid, 'rolle' => 'leitung', 'bezug' => 'l-jana'], $hLeitung);
pruefe($s === 200 && $d['code']['code'] !== $janaKennung, 'neue Leitungskennung ausgegeben');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $hid, 'code' => $janaKennung]);
pruefe($s === 401, 'alte Kennung gilt nicht mehr');
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, $jana, ['id' => $hid]);
pruefe($s === 401, 'Anmeldung mit der alten Kennung ist beendet');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $hid, 'code' => $hKennung]);
$jana = $d['token'];
pruefe($s === 200, 'Zugang mit der Kennung des Kontos');
[$s, $d] = rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $hid, 'sicherungAn' => ['a@example.org', 'b@example.org', 'c@example.org', 'd@example.org']], $jana);
pruefe($s === 400, 'höchstens 3 Empfänger');
[$s, $d] = rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $hid, 'sicherungTakt' => 20], $jana);
pruefe($s === 400, 'ungültiger Takt abgewiesen');

echo "Etappe 2b: Sicherung per Mail\n";
[$s, $d] = rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $hid, 'sicherungAn' => ['Leitung@Example.org', 'nord@example.org'], 'sicherungTakt' => 15], $jana);
pruefe($s === 200 && $d['sicherungAn'] === ['leitung@example.org', 'nord@example.org'] && $d['sicherungTakt'] === 15, 'Empfänger und Takt gespeichert');
$vorher = count($mailer->mails);
rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('s-0000001')]], $jana, ['turnier' => $hid]);
rufe($api, 'GET', 'events', null, null, ['turnier' => $hid, 'ab' => '0']);
pruefe(count($mailer->mails) === $vorher, 'vor Ablauf des Abstands keine Sicherung');
$zeit += 16 * 60;
rufe($api, 'GET', 'events', null, null, ['turnier' => $hid, 'ab' => '0']);
$sm = mailAn($mailer, 'leitung@example.org');
pruefe(count($mailer->mails) === $vorher + 2 && $sm !== null && $sm->anhangName !== null, 'nach 15 Minuten Sicherung an beide Empfänger, mit Anhang');
$inhalt = json_decode((string)$sm->anhangInhalt, true);
pruefe($inhalt['format'] === 'tt-turnier-sicherung' && count($inhalt['ereignisse']) === 1 && $inhalt['turnier']['id'] === $hid, 'Anhang ist eine gültige Sicherungsdatei');
pruefe(str_contains($sm->text, 'Herbstturnier') && str_contains($sm->text, 'Warum diese Mail'), 'Mailtext mit Übersicht und Erklärung');
$zeit += 16 * 60;
rufe($api, 'GET', 'events', null, null, ['turnier' => $hid, 'ab' => '0']);
pruefe(count($mailer->mails) === $vorher + 2, 'ohne Änderung keine weitere Sicherung');
rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $hid, 'sicherungTakt' => -1], $jana);
rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('s-0000002')]], $jana, ['turnier' => $hid]);
$zeit += 61 * 60;
rufe($api, 'GET', 'events', null, null, ['turnier' => $hid, 'ab' => '0']);
pruefe(count($mailer->mails) === $vorher + 2, 'Takt „nur beim Abschluss“: keine Zwischensicherung');
rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('s-0000003', 'turnier.abgeschlossen', [])]], $jana, ['turnier' => $hid]);
$sm = mailAn($mailer, 'leitung@example.org');
pruefe(count($mailer->mails) === $vorher + 4 && str_contains($sm->text, 'abgeschlossen'), 'Abschluss löst sofort eine Sicherung aus');
rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('s-0000003', 'turnier.abgeschlossen', [])]], $jana, ['turnier' => $hid]);
pruefe(count($mailer->mails) === $vorher + 4, 'erneutes Senden des Abschlusses: keine doppelte Mail');
[$s, $d] = rufe($api, 'POST', 'turnier.sichern', ['turnier' => $hid], $jana);
pruefe($s === 200 && $d['gesendetAn'] === ['leitung@example.org', 'nord@example.org'] && count($mailer->mails) === $vorher + 6, '„Jetzt sichern“ sendet sofort');
[$s, $d] = rufe($api, 'POST', 'turnier.sichern', ['turnier' => $hid], null);
pruefe($s === 401, '„Jetzt sichern“ nur für die Leitung');
rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $hid, 'sicherungTakt' => 0], $jana);
rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('s-0000004')]], $jana, ['turnier' => $hid]);
$zeit += 120 * 60;
rufe($api, 'GET', 'events', null, null, ['turnier' => $hid, 'ab' => '0']);
pruefe(count($mailer->mails) === $vorher + 6, 'Sicherung ausgeschaltet: keine Mail');

echo "Etappe 2b: Rückmeldung\n";
[$s, $d] = rufe($api, 'POST', 'rueckmeldung', ['art' => 'kontakt', 'text' => 'Hallo, eine Frage zum Turnier.'], null, [], '10.3.0.1');
pruefe($s === 400, 'ohne Anmeldung: Name und E-Mail nötig');
[$s, $d] = rufe($api, 'POST', 'rueckmeldung', ['art' => 'kontakt', 'text' => 'Hallo, eine Frage zum Turnier.', 'name' => 'Gast', 'email' => 'gast@example.org'], null, [], '10.3.0.1');
$rm = mailAn($mailer, 'betreiber@example.org');
pruefe($s === 200 && $rm->antwortAn === 'gast@example.org' && str_contains($rm->betreff, 'Kontakt'), 'Kontaktformular: Mail an Betreiber, Antwort an Absender');
[$s, $d] = rufe($api, 'POST', 'rueckmeldung', ['art' => 'fehler', 'text' => 'Knopf reagiert nicht'], $nordTok2, [], '10.3.0.2');
$rm = mailAn($mailer, 'betreiber@example.org');
pruefe($s === 200 && $rm->antwortAn === 'nord@example.org' && str_contains($rm->text, 'TSV Nord'), 'Fehlermeldung aus dem Konto');
[$s, $d] = rufe($api, 'POST', 'rueckmeldung', ['art' => 'egal', 'text' => 'xxxxxxxx'], $nordTok2, [], '10.3.0.2');
pruefe($s === 400, 'unbekannte Art abgewiesen');

echo "Etappe 2b: Konto löschen\n";
[$s, $d] = rufe($api, 'POST', 'konto.loeschen', ['passwort' => 'geheim123'], $admin2);
pruefe($s === 400, 'Administrator kann sich nicht löschen');
[$s, $d] = rufe($api, 'POST', 'konto.loeschen', ['passwort' => 'falsch'], $nordTok2);
pruefe($s === 401, 'Löschen mit falschem Passwort abgewiesen');
[$s, $d] = rufe($api, 'POST', 'konto.loeschen', ['passwort' => 'neuNord123'], $nordTok2);
pruefe($s === 200, 'eigenes Konto gelöscht');
[$s, $d] = rufe($api, 'GET', 'turnier', null, null, ['id' => $hid]);
pruefe($s === 404, 'Turniere des Kontos mitgelöscht');
[$s, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $hid, 'ab' => '0']);
pruefe($s === 404, 'Ereignisse mitgelöscht');
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, $jana, ['id' => $hid]);
pruefe($s === 404, 'Leitungs-Sitzungen des Turniers ungültig');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'nord@example.org', 'passwort' => 'neuNord123']);
pruefe($s === 401, 'Anmeldung nach Löschung nicht mehr möglich');

echo "Etappe 2b: Löschung inaktiver Konten\n";
[$s, $d] = rufe($api, 'GET', 'konten', null, $admin2);
$vorherKonten = count($d['konten']);
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'm2@example.org', 'passwort' => 'massen123']);
rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Altes Turnier', 'datum' => null], $d['token']);
$vorher = count($mailer->mails);
$zeit += 336 * 86400;
rufe($api, 'GET', 'info');
$e = mailAn($mailer, 'm2@example.org');
pruefe($e !== null && str_contains($e->betreff, 'gelöscht') && count($mailer->mails) > $vorher, 'Erinnerung 30 Tage vor der Löschung');
pruefe(mailAn($mailer, 'admin@example.org') === null, 'Administrator bekommt keine Erinnerung');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'm3@example.org', 'passwort' => 'massen123']);
pruefe($s === 200, 'm3 meldet sich nach der Erinnerung an');
$zeit += 31 * 86400;
rufe($api, 'GET', 'info');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'admin@example.org', 'passwort' => 'geheim123']);
$admin3 = $d['token'];
[$s, $d] = rufe($api, 'GET', 'konten', null, $admin3);
$mails = array_column($d['konten'], 'email');
pruefe(!in_array('m2@example.org', $mails, true) && in_array('m3@example.org', $mails, true) && in_array('admin@example.org', $mails, true), 'inaktive Konten gelöscht, angemeldete und Admin bleiben');
[$s, $d] = rufe($api, 'GET', 'turniere', null, $admin3, ['alle' => '1']);
pruefe(!in_array('Altes Turnier', array_column($d['turniere'], 'name'), true), 'Turniere gelöschter Konten entfernt');


echo "Etappe 3: Spieler- und Helfer-Codes\n";
$mailer = new TestMailer();
$api = neueApi($mailer);
rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Sascha', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'TTC Nord', 'email' => 'nord@example.org', 'passwort' => 'nordnord1']);
$vk = $d['token'];
[, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Pokal', 'datum' => null], $vk);
$tid = $d['turnier']['id'];
$leit = $d['token'];
$leitKennung = $d['leitung']['code'];
[$s, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [
    ['rolle' => 'spieler', 'bezug' => 'sp1', 'name' => 'Anna A'],
    ['rolle' => 'spieler', 'bezug' => 'sp2', 'name' => 'Ben B'],
    ['rolle' => 'helfer', 'bezug' => 'h1', 'name' => 'Hilde'],
]], $leit);
$codes = [];
foreach ($d['codes'] ?? [] as $c) {
    if ($c['rolle'] !== 'leitung') {
        $codes[$c['bezug']] = $c['code'];
    }
}
pruefe($s === 200 && count($d['codes']) === 4 && count($codes) === 3 && count(array_unique($codes)) === 3 && !in_array($leitKennung, $codes, true) && preg_match('/^[0-9]{8}$/', $codes['sp1']) === 1, 'Kennungen angelegt, 8 Ziffern, eindeutig, nicht die Leitungskennung');
[$s, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'spieler', 'bezug' => 'sp1', 'name' => 'Anna Neu']]], $leit);
$sp1 = array_values(array_filter($d['codes'], fn($c) => $c['bezug'] === 'sp1'))[0];
pruefe($sp1['code'] === $codes['sp1'] && $sp1['name'] === 'Anna Neu', 'erneutes Anlegen: Code bleibt, Name aktualisiert');
[$s] = rufe($api, 'GET', 'codes', null, null, ['turnier' => $tid]);
pruefe($s === 401, 'Codes nur für die Leitung');

[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $codes['sp1']]);
pruefe($s === 200 && $d['rolle'] === 'spieler' && $d['spieler'] === 'sp1' && $d['name'] === 'Anna Neu', 'Zugang mit Spieler-Code');
$tokSp = $d['token'];
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $codes['h1']]);
pruefe($s === 200 && $d['rolle'] === 'helfer', 'Zugang mit Helfer-Code');
$tokH = $d['token'];
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $leitKennung]);
pruefe($s === 200 && $d['rolle'] === 'leitung' && $d['name'] === 'TTC Nord', 'Leitungskennung: Name vom Konto');
[$s, $d] = rufe($api, 'GET', 'turnier', null, $tokSp, ['id' => $tid]);
pruefe($d['turnier']['rechte'] === 'spieler', 'Spielerkennung: Rechte = spieler');
[$s, $d] = rufe($api, 'GET', 'ich', null, $tokSp);
pruefe($d['spieler'] === 'sp1', 'ich: Spieler-ID');

$ev = fn(string $id, string $art) => ['id' => $id, 'art' => $art, 'daten' => ['spiel' => 'x'], 'zeit' => '2026-11-14T10:00:00Z', 'geraet' => 'geraet-1'];
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000001', 'spieler.angelegt')]], $tokSp, ['turnier' => $tid]);
pruefe($s === 403, 'Spieler darf keine Spieler anlegen');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000002', 'spiel.ergebnis'), $ev('e3-000003', 'spiel.angefochten')]], $tokSp, ['turnier' => $tid]);
pruefe($s === 200, 'Spieler darf Ergebnisse und Anfechtungen senden');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000004', 'spiel.bestaetigt')]], $tokH, ['turnier' => $tid]);
pruefe($s === 403, 'Helfer darf nur Ergebnisse senden');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000014', 'spiel.aufgerufen'), $ev('e3-000015', 'spiel.aufruf_zurueck')]], $tokH, ['turnier' => $tid]);
pruefe($s === 200, 'Helfer darf Spiele aufrufen');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000016', 'spiel.aufgerufen')]], $tokSp, ['turnier' => $tid]);
pruefe($s === 403, 'Spieler darf keine Spiele aufrufen');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000017', 'tisch.gesperrt')]], $tokH, ['turnier' => $tid]);
pruefe($s === 403, 'Helfer darf keine Tische sperren');
[$s, $d] = rufe($api, 'GET', 'events', null, $tokH, ['turnier' => $tid, 'ab' => '0']);
$autor = $d['ereignisse'][0]['autor'] ?? [];
pruefe($autor === ['rolle' => 'spieler', 'name' => 'Anna Neu', 'spieler' => 'sp1'], 'Autor mit Spieler-ID, gesetzt vom Server');

[$s, $d] = rufe($api, 'POST', 'code.neu', ['turnier' => $tid, 'rolle' => 'spieler', 'bezug' => 'sp1'], $leit);
pruefe($s === 200 && $d['code']['code'] !== $codes['sp1'], 'neuer Code ausgegeben');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000005', 'spiel.ergebnis')]], $tokSp, ['turnier' => $tid]);
pruefe($s === 401, 'alte Anmeldung endet mit neuem Code');
[$s] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $codes['sp1']]);
pruefe($s === 401, 'alter Code gilt nicht mehr');
rufe($api, 'POST', 'code.sperren', ['turnier' => $tid, 'rolle' => 'spieler', 'bezug' => 'sp2', 'gesperrt' => true], $leit);
[$s] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $codes['sp2']]);
pruefe($s === 401, 'gesperrter Code gilt nicht');
rufe($api, 'POST', 'code.entfernen', ['turnier' => $tid, 'rolle' => 'helfer', 'bezug' => 'h1'], $leit);
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000006', 'spiel.ergebnis')]], $tokH, ['turnier' => $tid]);
pruefe($s === 401, 'Helfer entfernt: Anmeldung endet');

echo "Paket 4b: Spieler mit Helfer-Recht, Konto-Einstellungen\n";
[$s, $d] = rufe($api, 'POST', 'code.helfer', ['turnier' => $tid, 'bezug' => 'sp2', 'helfer' => true], $leit);
pruefe($s === 200 && $d['code']['helfer'] === true && $d['code']['rolle'] === 'spieler', 'Spielerkennung bekommt Helfer-Recht');
[$s, $d] = rufe($api, 'POST', 'code.helfer', ['turnier' => $tid, 'bezug' => 'h-gibtsnicht', 'helfer' => true], $leit);
pruefe($s === 404, 'Helfer-Recht nur für vorhandene Spielerkennungen');
rufe($api, 'POST', 'code.sperren', ['turnier' => $tid, 'rolle' => 'spieler', 'bezug' => 'sp2', 'gesperrt' => false], $leit);
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $codes['sp2']]);
pruefe($s === 200 && $d['rolle'] === 'spieler' && $d['helfer'] === true && $d['spieler'] === 'sp2', 'Zugang: Spieler mit Helfer-Recht');
$tokSH = $d['token'];
[$s, $d] = rufe($api, 'GET', 'ich', null, $tokSH);
pruefe($d['helfer'] === true, 'ich: Helfer-Recht');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000007', 'spiel.ergebnis')]], $tokSH, ['turnier' => $tid]);
[, $d] = rufe($api, 'GET', 'events', null, $tokSH, ['turnier' => $tid, 'ab' => '0']);
$letzt = $d['ereignisse'][count($d['ereignisse']) - 1]['autor'];
pruefe($s === 200 && $letzt === ['rolle' => 'spieler', 'name' => 'Ben B', 'spieler' => 'sp2', 'helfer' => true], 'Autor mit Helfer-Recht');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000018', 'spiel.aufgerufen'), $ev('e3-000019', 'spiel.bestaetigt')]], $tokSH, ['turnier' => $tid]);
pruefe($s === 200, 'Spieler mit Helfer-Recht: aufrufen und bestätigen');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000020', 'spieler.angelegt')]], $tokSH, ['turnier' => $tid]);
pruefe($s === 403, 'Spieler mit Helfer-Recht: keine Leitungsarten');
// Sende-Bremse: höchstens 60 Sendungen pro Minute je Kennung
$n429 = 0;
for ($i = 0; $i < 62; $i++) {
    [$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev(sprintf('e9-%06d', $i), 'spiel.aufruf_zurueck')]], $tokSH, ['turnier' => $tid]);
    if ($s === 429) $n429++;
}
pruefe($n429 > 0, 'Sende-Bremse für Helfer und Spieler greift');
$zeit += 61;
[$s, $d] = rufe($api, 'POST', 'code.helfer', ['turnier' => $tid, 'bezug' => 'sp2', 'helfer' => false], $leit);
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000008', 'spiel.ergebnis')]], $tokSH, ['turnier' => $tid]);
pruefe($s === 401, 'Helfer-Recht entzogen: Anmeldung endet');
[$s, $d] = rufe($api, 'GET', 'konto.einstellungen', null, $vk);
pruefe($s === 200 && $d['klassen'] === [], 'Konto-Einstellungen: noch keine Klassen');
[$s, $d] = rufe($api, 'POST', 'konto.einstellungen', ['klassen' => ['Anfänger', ' Fortgeschritten ', 'Anfänger', '', 7]], $vk);
pruefe($s === 200 && $d['klassen'] === ['Anfänger', 'Fortgeschritten'], 'Klassen gespeichert, bereinigt');
[$s, $d] = rufe($api, 'GET', 'konto.einstellungen', null, $vk);
pruefe($d['klassen'] === ['Anfänger', 'Fortgeschritten'], 'Klassen abrufbar');
[$s] = rufe($api, 'GET', 'konto.einstellungen', null, $tokSp);
pruefe($s === 401, 'Konto-Einstellungen nur für Konten');
// Turnier löschen (DSGVO): nur Eigentümer/Admin mit Passwort, alles weg
[, $dl] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Löschtest', 'datum' => null], $vk);
$lid = $dl['turnier']['id'];
[$s] = rufe($api, 'POST', 'turnier.loeschen', ['turnier' => $lid, 'passwort' => 'veranst123'], $tokSp);
pruefe($s === 401, 'Turnier löschen: nicht mit Spielerkennung');
[$sr, $fremd] = rufe($api, 'POST', 'registrieren', ['name' => 'Fremd', 'email' => 'fremd@example.org', 'passwort' => 'fremdfremd1'], null, [], '10.77.0.1');
[$s, $dd] = rufe($api, 'POST', 'turnier.loeschen', ['turnier' => $lid, 'passwort' => 'fremdfremd1'], $fremd['token'] ?? null);
pruefe($s === 403, 'Turnier löschen: nicht mit fremdem Konto');
[$s] = rufe($api, 'POST', 'turnier.loeschen', ['turnier' => $lid, 'passwort' => 'falsch'], $vk);
pruefe($s === 401, 'Turnier löschen: Passwort nötig');
[$s, $dd] = rufe($api, 'POST', 'turnier.loeschen', ['turnier' => $lid, 'passwort' => 'nordnord1'], $vk);
pruefe($s === 200, 'Turnier gelöscht');
[$s] = rufe($api, 'GET', 'turnier', null, null, ['id' => $lid]);
pruefe($s === 404, 'gelöschtes Turnier ist weg');
[$s] = rufe($api, 'GET', 'codes', null, $admin, ['turnier' => $lid]);
pruefe($s === 404, 'Kennungen des gelöschten Turniers sind weg');

echo "Etappe 3: Spielerpool und Übersicht\n";
[$s, $d] = rufe($api, 'POST', 'pool.speichern', ['spieler' => [
    ['id' => 'p1', 'vorname' => 'Anna', 'nachname' => 'A', 'verein' => 'TTC', 'ttr' => 1500, 'geschlecht' => 'w', 'jahrgang' => 1990, 'klasse' => 'B', 'fremd' => 'x'],
    ['id' => 'p2', 'vorname' => 'Ben', 'nachname' => 'B', 'verein' => 'TSV', 'ttr' => 99999],
]], $vk);
pruefe($s === 200 && count($d['spieler']) === 2 && $d['spieler'][1]['ttr'] === null && !isset($d['spieler'][0]['fremd']), 'Pool speichern, Felder geprüft');
rufe($api, 'POST', 'pool.speichern', ['spieler' => [['id' => 'p1', 'vorname' => 'Anna', 'nachname' => 'A', 'verein' => 'TTC Neu']]], $vk);
[, $d] = rufe($api, 'GET', 'pool', null, $vk);
pruefe(count($d['spieler']) === 2 && $d['spieler'][0]['verein'] === 'TTC Neu', 'Pool ändern');
[, $d2] = rufe($api, 'POST', 'registrieren', ['name' => 'TTC Süd', 'email' => 'sued@example.org', 'passwort' => 'suedsued1']);
[, $d] = rufe($api, 'GET', 'pool', null, $d2['token']);
pruefe($d['spieler'] === [], 'Pool ist je Konto getrennt');
[$s] = rufe($api, 'POST', 'pool.speichern', ['spieler' => [['id' => 'p3', 'vorname' => '', 'nachname' => '', 'verein' => '']]], $vk);
pruefe($s === 400, 'Pool: Name ist Pflicht');
rufe($api, 'POST', 'pool.loeschen', ['ids' => ['p2']], $vk);
[, $d] = rufe($api, 'GET', 'pool', null, $vk);
pruefe(count($d['spieler']) === 1, 'Pool löschen');
[$s] = rufe($api, 'POST', 'turnier.uebersicht', ['turnier' => $tid, 'text' => "Gruppe A\n 1 Anna"], $leit);
pruefe($s === 200, 'Übersicht hochladen');
[$s] = rufe($api, 'POST', 'turnier.uebersicht', ['turnier' => $tid, 'text' => 'x'], $tokSp);
pruefe($s === 401 || $s === 403, 'Übersicht nur von der Leitung');
rufe($api, 'POST', 'turnier.sichern', ['turnier' => $tid], $leit);
$m = mailAn($mailer, 'nord@example.org');
pruefe($m !== null && str_contains($m->text, 'Aktueller Stand') && str_contains($m->text, '1 Anna'), 'Sicherungsmail enthält die Übersicht');
rufe($api, 'POST', 'konto.loeschen', ['passwort' => 'nordnord1'], $vk);
[, $d] = rufe($api, 'POST', 'login', ['email' => 'nord@example.org', 'passwort' => 'nordnord1']);
pruefe(!isset($d['token']), 'Konto mit Pool und Codes gelöscht');

echo "Etappe 4: Android-Zentrale (Übernahme, Rückgabe, Sicherung)\n";
$mailer4 = new TestMailer();
$api = neueApi($mailer4);
rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Admin', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'TTC Zentral', 'email' => 'z@example.org', 'passwort' => 'zentral12']);
$zk = $d['token'];
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Fremd', 'email' => 'f@example.org', 'passwort' => 'fremd1234']);
$fk = $d['token'];
[, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Hallenturnier', 'datum' => '2026-12-12'], $zk);
$tid = $d['turnier']['id'];
$zl = $d['token'];
$zKennung = $d['leitung']['code'];
rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('z4-000001'), ereignis('z4-000002')]], $zl, ['turnier' => $tid]);
rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'spieler', 'bezug' => 'sp1', 'name' => 'Anna'], ['rolle' => 'spieler', 'bezug' => 'sp2', 'name' => 'Ben']]], $zl);
[, $d] = rufe($api, 'GET', 'codes', null, $zl, ['turnier' => $tid]);
$c4 = [];
foreach ($d['codes'] as $c) {
    $c4[$c['bezug']] = $c['code'];
}
$zug = ['turnier' => $tid, 'zentrale' => 'Zentrale TTC (z-abc)', 'zentraleId' => 'z-abcdefghij'];
[$s] = rufe($api, 'POST', 'zentrale.uebernehmen', $zug, $fk);
pruefe($s === 403, 'Übernahme nur durch das Eigentümer-Konto');
[, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $zKennung]);
[$s] = rufe($api, 'POST', 'zentrale.uebernehmen', $zug, $d['token']);
pruefe($s === 401, 'Übernahme braucht Konto-Anmeldung (Leitungskennung reicht nicht)');
[$s, $d] = rufe($api, 'POST', 'zentrale.uebernehmen', $zug, $zk);
$rollen4 = array_map(fn($c) => $c['rolle'], $d['codes']);
pruefe($s === 200 && count($d['codes']) === 3 && $rollen4[0] === 'leitung' && $d['turnier']['zentrale'] === 'Zentrale TTC (z-abc)', 'Übernahme liefert Kennungen (inkl. Leitung) und Einstellungen');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('z4-000003')]], $zl, ['turnier' => $tid]);
pruefe($s === 409 && str_contains($d['meldung'], 'Zentrale'), 'gesperrt: online keine neuen Einträge');
[$s] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'helfer', 'bezug' => 'h1', 'name' => 'Hilde']]], $zl);
pruefe($s === 409, 'gesperrt: keine Code-Änderungen');
[$s, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => '0']);
pruefe($s === 200 && count($d['ereignisse']) === 2, 'gesperrt: Lesen geht weiter');
[$s] = rufe($api, 'POST', 'zentrale.uebernehmen', ['turnier' => $tid, 'zentrale' => 'Andere', 'zentraleId' => 'z-andere123'], $zk);
pruefe($s === 409, 'zweite Zentrale: Konflikt');
[$s] = rufe($api, 'POST', 'zentrale.rueckgabe', ['turnier' => $tid, 'zentraleId' => 'z-andere123', 'ereignisse' => []], $zk);
pruefe($s === 409, 'Rückgabe nur von der übernehmenden Zentrale');
$ru = ['turnier' => $tid, 'zentraleId' => 'z-abcdefghij', 'ereignisse' => [
    ereignis('z4-000002') + ['autor' => ['rolle' => 'leitung', 'name' => 'Max']],
    ereignis('z4-000010', 'spiel.ergebnis') + ['autor' => ['rolle' => 'spieler', 'name' => 'Anna', 'spieler' => 'sp1']],
    ereignis('z4-000011') + ['autor' => ['rolle' => 'admin', 'name' => '']],
]];
[$s, $d] = rufe($api, 'POST', 'zentrale.rueckgabe', $ru, $zk);
pruefe($s === 200 && count($d['angenommen']) === 3, 'Rückgabe: Ereignisse angenommen (bekannte doppelt harmlos)');
[, $d] = rufe($api, 'GET', 'events', null, $zk, ['turnier' => $tid, 'ab' => '0']);
$autoren = array_map(fn($e) => $e['autor']['rolle'] . ':' . $e['autor']['name'] . ':' . ($e['autor']['spieler'] ?? ''), $d['ereignisse']);
pruefe(count($d['ereignisse']) === 4 && $autoren[2] === 'spieler:Anna:sp1' && $autoren[3] === 'leitung:Zentrale:', 'Rückgabe: Autoren wie auf der Zentrale');
[$s, $d] = rufe($api, 'POST', 'zentrale.freigeben', ['turnier' => $tid, 'zentraleId' => 'z-abcdefghij',
    'codes' => [['rolle' => 'spieler', 'bezug' => 'sp1', 'name' => 'Anna', 'code' => $c4['sp1'], 'gesperrt' => false, 'helfer' => true],
                ['rolle' => 'helfer', 'bezug' => 'h9', 'name' => 'Hanna', 'code' => '73910482', 'gesperrt' => false],
                ['rolle' => 'leitung', 'bezug' => 'l-z', 'name' => 'Leiter Z', 'code' => '58392174', 'gesperrt' => false]],
    'einstellungen' => ['sicherungAn' => ['z@example.org'], 'sicherungTakt' => 60],
    'uebersicht' => ['text' => 'Stand von der Zentrale']], $zk);
pruefe($s === 200 && $d['turnier']['zentrale'] === null, 'Freigeben hebt die Sperre auf');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('z4-000003')]], $zl, ['turnier' => $tid]);
pruefe($s === 200, 'nach der Rückgabe: online wieder beschreibbar');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => '73910482']);
pruefe($s === 200 && $d['rolle'] === 'helfer' && $d['name'] === 'Hanna', 'Kennungen von der Zentrale gelten online');
[$s] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $c4['sp2']]);
pruefe($s === 401, 'auf der Zentrale entfernte Kennung gilt nicht mehr');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $c4['sp1']]);
pruefe($s === 200 && $d['helfer'] === true, 'Helfer-Recht von der Zentrale übernommen');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => '58392174']);
pruefe($s === 200 && $d['rolle'] === 'leitung' && $d['name'] === 'Leiter Z', 'Leitungskennung von der Zentrale übernommen');
// Auf der Zentrale angelegtes Turnier hochladen
$neuId = '47381920';
[$s] = rufe($api, 'POST', 'zentrale.rueckgabe', ['turnier' => $neuId, 'zentraleId' => 'z-abcdefghij', 'ereignisse' => []], $zk);
pruefe($s === 404, 'unbekanntes Turnier ohne Angaben: nicht gefunden');
[$s, $d] = rufe($api, 'POST', 'zentrale.rueckgabe', ['turnier' => $neuId, 'zentraleId' => 'z-abcdefghij', 'zentrale' => 'Zentrale TTC',
    'neu' => ['name' => 'Offline-Turnier', 'datum' => '2026-12-13'],
    'ereignisse' => [ereignis('z4-000100', 'turnier.angelegt', ['name' => 'Offline-Turnier']) + ['autor' => ['rolle' => 'leitung', 'name' => 'TTC Zentral']]]], $zk);
pruefe($s === 200 && $d['hoechsteSeq'] > 0, 'Turnier von der Zentrale online angelegt');
rufe($api, 'POST', 'zentrale.freigeben', ['turnier' => $neuId, 'zentraleId' => 'z-abcdefghij'], $zk);
[, $d] = rufe($api, 'GET', 'turniere', null, $zk);
pruefe(count(array_filter($d['turniere'], fn($t) => $t['id'] === $neuId && $t['zentrale'] === null)) === 1, 'neues Turnier gehört dem Konto, nicht gesperrt');
[$s] = rufe($api, 'POST', 'zentrale.rueckgabe', ['turnier' => $neuId, 'zentraleId' => 'z-abcdefghij', 'ereignisse' => []], $fk);
pruefe($s === 403 || $s === 409, 'fremdes Konto kann nicht zurückgeben');
// Sicherung über den Online-Server
$sich = ['format' => 'tt-turnier-sicherung', 'version' => 1, 'erstellt' => '2026-12-12T10:00:00Z',
    'turnier' => ['id' => '47381920', 'name' => 'Offline-Turnier', 'datum' => null, 'modus' => 'online'],
    'ereignisse' => [ereignis('z4-000200', 'turnier.abgeschlossen', [])]];
[$s, $d] = rufe($api, 'POST', 'sicherung.senden', ['turnier' => ['id' => '47381920', 'name' => 'Offline-Turnier', 'datum' => '2026-12-13'],
    'empfaenger' => ['sicherung@example.org'], 'anlass' => 'Turnier abgeschlossen (Zentrale)',
    'uebersicht' => ['text' => "Sieger: Anna", 'zeit' => '2026-12-12T10:00:00Z'], 'sicherung' => $sich], $zk);
$m = mailAn($mailer4, 'sicherung@example.org');
pruefe($s === 200 && $m !== null && str_contains($m->text, 'Sieger: Anna') && str_contains($m->text, 'abgeschlossen') && str_contains($m->text, 'Zentrale')
    && $m->anhangName !== null && str_contains((string)$m->anhangInhalt, 'z4-000200'), 'Sicherungsmail von der Zentrale mit Anhang');
[$s] = rufe($api, 'POST', 'sicherung.senden', ['turnier' => ['id' => 'x'], 'empfaenger' => ['a@example.org'], 'sicherung' => $sich], $zk);
pruefe($s === 400, 'Sicherung von der Zentrale: Angaben werden geprüft');
[$s] = rufe($api, 'POST', 'sicherung.senden', ['turnier' => ['id' => '47381920', 'name' => 'X'], 'empfaenger' => ['a@example.org'], 'sicherung' => $sich], null);
pruefe($s === 401, 'Sicherung von der Zentrale nur mit Konto');

echo "Etappe 7: Datenschutz beim Abholen (Zuschauer)\n";
$api = neueApi(new TestMailer());
rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Sascha', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'TTC Süd', 'email' => 'sued@example.org', 'passwort' => 'suedsued1']);
$vk = $d['token'];
[, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Jugend', 'datum' => null], $vk);
$tid = $d['turnier']['id'];
$leit = $d['token'];
[, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'spieler', 'bezug' => 'sp1', 'name' => 'Lea Löwe']]], $leit);
$codeLea = array_values(array_filter($d['codes'], fn($c) => $c['bezug'] === 'sp1'))[0]['code'];
[, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $codeLea]);
$tokLea = $d['token'];
rufe($api, 'POST', 'events', ['ereignisse' => [
    ereignis('d7-000001', 'spieler.angelegt', ['id' => 'sp1', 'vorname' => 'Lea', 'nachname' => 'Löwe', 'verein' => 'TSV', 'ttr' => 1200, 'jahrgang' => 2012, 'geschlecht' => 'w', 'pool' => 'p-123']),
    ereignis('d7-000002', 'spiel.aufgerufen', ['konkurrenz' => 'k1', 'spiel' => 'g0-a-b', 'tisch' => 2, 'schiri' => ['name' => 'Opa Paul']]),
    ereignis('d7-000003', 'spiel.aufgerufen', ['konkurrenz' => 'k1', 'spiel' => 'g0-a-c', 'tisch' => 3, 'schiri' => ['name' => 'Lea Löwe', 'spieler' => 'sp1']]),
]], $leit, ['turnier' => $tid]);
[, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => '0']);
$sp = $d['ereignisse'][0]['daten'];
pruefe($d['sicht'] === 'zuschauer' && $sp['nachname'] === 'Löwe' && $sp['ttr'] === 1200 && $sp['verein'] === 'TSV', 'Zuschauer: Name, Verein und TTR bleiben');
pruefe(!isset($sp['jahrgang']) && !isset($sp['geschlecht']) && !isset($sp['pool']), 'Zuschauer: kein Jahrgang, kein Geschlecht, kein Pool-Bezug');
pruefe(!isset($d['ereignisse'][1]['daten']['schiri']) && $d['ereignisse'][1]['daten']['tisch'] === 2, 'Zuschauer: frei eingetippter Schiedsrichter fehlt, Aufruf bleibt');
pruefe($d['ereignisse'][2]['daten']['schiri'] === ['spieler' => 'sp1'], 'Zuschauer: Schiedsrichter nur als Spieler-Bezug');
pruefe(array_unique(array_map(fn($e) => $e['autor']['name'], $d['ereignisse'])) === [''], 'Zuschauer: keine Namen der Eintragenden');
[, $d] = rufe($api, 'GET', 'events', null, $tokLea, ['turnier' => $tid, 'ab' => '0']);
pruefe($d['sicht'] === 'spieler' && !isset($d['ereignisse'][0]['daten']['jahrgang']) && !isset($d['ereignisse'][0]['daten']['geschlecht']) && $d['ereignisse'][1]['daten']['schiri']['name'] === 'Opa Paul' && $d['ereignisse'][0]['autor']['name'] === 'TTC Süd', 'Spielerkennung: Namen und Schiedsrichter, aber kein Jahrgang/Geschlecht');
[, $d] = rufe($api, 'GET', 'events', null, $leit, ['turnier' => $tid, 'ab' => '0']);
pruefe($d['sicht'] === 'voll' && $d['ereignisse'][0]['daten']['jahrgang'] === 2012 && $d['ereignisse'][0]['daten']['pool'] === 'p-123', 'Leitung: alles sichtbar');
[, $d] = rufe($api, 'GET', 'events', null, str_repeat('ab', 32), ['turnier' => $tid, 'ab' => '0']);
pruefe($d['sicht'] === 'zuschauer' && !isset($d['ereignisse'][0]['daten']['jahrgang']), 'ungültiges Token: wie Zuschauer');
// Kurzform: nur die Leitung kann sie einschalten
rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('d7-000004', 'spiel.ergebnis', ['namen' => 'kurz'])]], $tokLea, ['turnier' => $tid]);
[, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => '0']);
pruefe($d['sicht'] === 'zuschauer', 'Kurzform nicht über fremde Ereignisarten');
rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('d7-000005', 'turnier.daten', ['namen' => 'kurz'])]], $leit, ['turnier' => $tid]);
[, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => '0']);
pruefe($d['sicht'] === 'kurz' && $d['ereignisse'][0]['daten']['nachname'] === 'L.' && $d['ereignisse'][0]['daten']['vorname'] === 'Lea', 'Kurzform: „Lea L.“ für Zuschauer');
[, $d] = rufe($api, 'GET', 'events', null, $leit, ['turnier' => $tid, 'ab' => '0']);
pruefe($d['sicht'] === 'voll' && $d['ereignisse'][0]['daten']['nachname'] === 'Löwe', 'Kurzform: Leitung sieht den vollen Namen');
rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('d7-000006', 'turnier.daten', ['ort' => 'Halle']), ereignis('d7-000007', 'turnier.daten', ['namen' => 'voll'])]], $leit, ['turnier' => $tid]);
[, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => '0']);
pruefe($d['sicht'] === 'zuschauer' && $d['ereignisse'][0]['daten']['nachname'] === 'Löwe', 'Kurzform zurückgenommen: wieder voller Name');
pruefe(Api::kurzname(' élise ') === 'É.' && Api::kurzname('') === '', 'Kurzform mit Umlauten und leerem Namen');

echo "Migration von Version 1\n";
$pdo = new PDO('sqlite::memory:');
$alt = new Datenbank($pdo);
$pdo->exec("CREATE TABLE meta (schluessel VARCHAR(64) NOT NULL PRIMARY KEY, wert VARCHAR(255) NOT NULL)");
$m = new ReflectionMethod(Datenbank::class, 'schemaV1');
foreach (array_slice($m->invoke($alt), 1) as $sql) {
    $pdo->exec($sql);
}
$pdo->exec("INSERT INTO meta VALUES ('schema', '1')");
$pdo->exec("INSERT INTO konten (name, email, passwort_hash, rolle, gesperrt, angelegt, letzte_anmeldung) VALUES ('Alt', 'alt@example.org', '" . password_hash('altpass12', PASSWORD_DEFAULT) . "', 'admin', 0, 1000, 2000)");
$pdo->exec("INSERT INTO turniere (id, konto_id, name, datum, leitung_hash, angelegt) VALUES ('altturnier', 1, 'Alt', NULL, '" . password_hash('altesPasswort', PASSWORD_DEFAULT) . "', 1000)");
$apiAlt = new Api($alt, ['setup_code' => 'einrichtung-123456']);
[$s, $d] = rufe($apiAlt, 'POST', 'login', ['email' => 'alt@example.org', 'passwort' => 'altpass12']);
pruefe($s === 200 && $pdo->query("SELECT wert FROM meta WHERE schluessel = 'schema'")->fetchColumn() === '6', 'Schema 1 → 6 angehoben, Anmeldung geht');
$altTok = $d['token'];
[$s, $d] = rufe($apiAlt, 'GET', 'turnier', null, $altTok, ['id' => 'altturnier']);
pruefe($s === 200 && $d['turnier']['rechte'] === 'leitung', 'alte Turnierkennung (10 Zeichen) bleibt erreichbar');
[$s, $d] = rufe($apiAlt, 'POST', 'turnier.zugang', ['turnier' => 'altturnier', 'passwort' => 'altesPasswort', 'name' => 'X']);
pruefe($s === 401, 'altes Leitungspasswort gilt nicht mehr (Kennungen neu ausgeben)');
[$s, $d] = rufe($apiAlt, 'GET', 'turnier.einstellungen', null, $altTok, ['id' => 'altturnier']);
pruefe($s === 200 && !isset($d['leitungsCode']) && $d['mail'] === false, 'alte Turniere: Einstellungen über das Konto; ohne Mailer kein Versand');

echo "\n$anzahl Prüfungen, $fehler Fehler\n";
exit($fehler === 0 ? 0 : 1);
