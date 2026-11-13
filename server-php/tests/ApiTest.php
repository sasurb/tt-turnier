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
        foreach (['meta', 'konten', 'turniere', 'sitzungen', 'ereignisse', 'versuche', 'rueckstellungen'] as $t) {
            $pdo->exec("DROP TABLE IF EXISTS $t");
        }
    }
    $config = [
        'setup_code' => 'einrichtung-123456',
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


echo "Etappe 2b: Registrierung\n";
$mailer = new TestMailer();
$api = neueApi($mailer);
rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Sascha', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
[$s, $d] = rufe($api, 'GET', 'info');
pruefe($d['registrierung'] === true && $d['mail'] === true && $d['version'] === '0.3.0', 'info: Registrierung und Mail bereit');
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

echo "Etappe 2b: Leitungscode\n";
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Herbstturnier', 'datum' => '2026-11-20', 'leitungsCode' => '123456'], $nordTok2);
pruefe($s === 400, 'zu einfacher Code (123456) abgewiesen');
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Herbstturnier', 'datum' => '2026-11-20', 'leitungsCode' => '4839'], $nordTok2);
pruefe($s === 400, 'Code mit 4 Ziffern abgewiesen');
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Herbstturnier', 'datum' => '2026-11-20', 'leitungsCode' => '483920'], $nordTok2);
pruefe($s === 200, 'Turnier mit Leitungscode angelegt');
$hid = $d['turnier']['id'];
$hLeitung = $d['token'];
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $hid, 'code' => '483920', 'name' => 'Jana']);
pruefe($s === 200 && $d['rolle'] === 'leitung', 'Zugang mit Leitungscode');
$jana = $d['token'];
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, $jana, ['id' => $hid]);
pruefe($s === 200 && $d['leitungsCode'] === '483920' && $d['sicherungAn'] === ['nord@example.org'] && $d['sicherungTakt'] === 30, 'Leitung sieht Code, Empfänger = Konto-Mail, Takt 30');
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, null, ['id' => $hid]);
pruefe($s === 401, 'Zuschauer sieht den Code nicht');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'm1@example.org', 'passwort' => 'massen123']);
$fremd = $d['token'];
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, $fremd, ['id' => $hid]);
pruefe($s === 403, 'fremdes Konto sieht den Code nicht');
[$s, $d] = rufe($api, 'POST', 'login', ['email' => 'admin@example.org', 'passwort' => 'geheim123']);
$admin2 = $d['token'];
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, $admin2, ['id' => $hid]);
pruefe($s === 200 && $d['leitungsCode'] === '483920', 'Administrator sieht den Code');
[$s, $d] = rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $hid, 'leitungsCode' => '907315'], $jana);
pruefe($s === 200 && $d['leitungsCode'] === '907315', 'Leitung ändert den Code');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $hid, 'code' => '483920', 'name' => 'Alt']);
pruefe($s === 401, 'alter Code gilt nicht mehr');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $hid, 'code' => '907315', 'name' => 'Neu']);
pruefe($s === 200, 'neuer Code gilt');
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, $jana, ['id' => $hid]);
pruefe($s === 200, 'bestehende Leitungs-Anmeldung bleibt nach Codewechsel gültig');
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
rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Altes Turnier', 'datum' => null, 'leitungsCode' => '583920'], $d['token']);
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
pruefe($s === 200 && $pdo->query("SELECT wert FROM meta WHERE schluessel = 'schema'")->fetchColumn() === '2', 'Schema 1 → 2 angehoben, Anmeldung geht');
[$s, $d] = rufe($apiAlt, 'POST', 'turnier.zugang', ['turnier' => 'altturnier', 'passwort' => 'altesPasswort', 'name' => 'X']);
pruefe($s === 200, 'alte Turniere: Zugang mit bisherigem Passwort');
[$s, $d] = rufe($apiAlt, 'GET', 'turnier.einstellungen', null, $d['token'], ['id' => 'altturnier']);
pruefe($s === 200 && $d['leitungsCode'] === null && $d['mail'] === false, 'alte Turniere: kein Code bekannt; ohne Mailer kein Versand');

echo "\n$anzahl Prüfungen, $fehler Fehler\n";
exit($fehler === 0 ? 0 : 1);
