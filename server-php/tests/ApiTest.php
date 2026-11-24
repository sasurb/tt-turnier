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
        foreach (['meta', 'konten', 'turniere', 'sitzungen', 'ereignisse', 'versuche', 'rueckstellungen', 'codes', 'pool', 'anmeldungen', 'vereine', 'sparten', 'mitglieder', 'turnier_zugaenge', 'einladungen', 'ausschuesse', 'ausschuss_mitglieder', 'ausschuss_nachrichten', 'veranstaltungen', 'spieler_pool', 'kennungen_gesperrt', 'sicherung_empfaenger'] as $t) {
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

/** Antwort „angenommen bis auf einzeln abgelehnte“ (ab 0.11): alle gesendeten abgelehnt, keiner angenommen */
function abgelehnt(int $s, ?array $d, string $fehler = 'keine_berechtigung'): bool
{
    return $s === 200 && ($d['angenommen'] ?? null) === [] && count($d['abgelehnt'] ?? []) > 0
        && array_reduce($d['abgelehnt'], fn(bool $ok, array $x): bool => $ok && $x['fehler'] === $fehler, true);
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
pruefe($s === 200 && $d['konto']['bedingungen'] === false && count($d['konto']['sparten']) === 1, 'Veranstalter-Anmeldung (vom Admin angelegt: eigene Sparte, Bedingungen offen)');
$vTok = $d['token'];
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'X', 'datum' => null], $vTok);
pruefe($s === 403 && $d['fehler'] === 'bedingungen', 'ohne Zustimmung zu den Nutzungsbedingungen kein Turnier');
[$s, $d] = rufe($api, 'POST', 'konto.bedingungen', ['zustimmung' => true], $vTok);
pruefe($s === 400, 'Bedingungen: „mindestens 18“ fehlt');
[$s, $d] = rufe($api, 'POST', 'konto.bedingungen', ['zustimmung' => true, 'volljaehrig' => true], $vTok);
pruefe($s === 200 && $d['bedingungen'] === true, 'Bedingungen angenommen');
[$s, $d] = rufe($api, 'GET', 'konten', null, $vTok);
pruefe($s === 403, 'Veranstalter darf keine Konten sehen');
[$s, $d] = rufe($api, 'GET', 'konten', null, $admin);
pruefe($s === 200 && count($d['konten']) === 2 && $d['konten'][1]['letzteAnmeldung'] !== null, 'Admin sieht Konten mit letzter Anmeldung');
[$s, $d] = rufe($api, 'GET', 'ich', null, $vTok);
pruefe($s === 200 && $d['rolle'] === 'veranstalter', 'ich: Rolle Veranstalter');

echo "Turnier\n";
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Vereinsmeisterschaft', 'datum' => '2026-12-05'], $vTok);
pruefe($s === 200 && preg_match('/^[A-HJKMNP-Z2-9]{8}$/', $d['turnier']['id']) === 1 && $d['turnier']['veranstalter'] === 'TTC Muster', 'Turnier angelegt, Kennung 8 Zeichen ohne Verwechsler');
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
pruefe(abgelehnt($s, $d, 'ungueltig'), 'ungültiges Ereignis einzeln abgelehnt');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('e-0000009', 'test.notiz', ['text' => str_repeat('x', 20000)])]], $leitung, ['turnier' => $tid]);
pruefe(abgelehnt($s, $d, 'ungueltig'), 'zu großes Ereignis einzeln abgelehnt');
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
pruefe($d['registrierung'] === true && $d['mail'] === true && $d['version'] === '0.17.0' && $d['sparten'] === true && $d['aufgaben'] === true && $d['anmeldung'] === true && $d['codes'] === true && $d['kennungen'] === true, 'info: Registrierung, Mail, Codes und Kennungen bereit');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'TSV Nord', 'email' => 'Nord@Example.org', 'passwort' => 'nordpass1', 'volljaehrig' => true, 'bedingungen' => true], null, [], '10.1.0.1');
pruefe($s === 200 && strlen($d['token']) === 64 && $d['konto']['rolle'] === 'veranstalter' && $d['konto']['email'] === 'nord@example.org', 'Registrierung legt Veranstalter an und meldet an');
$nordTok = $d['token'];
$w = mailAn($mailer, 'nord@example.org');
pruefe($w !== null && str_contains($w->text, 'https://example.org/tt/') && $w->antwortAn === 'betreiber@example.org', 'Willkommensmail mit Link, Antwort an Betreiber');
$i = mailAn($mailer, 'betreiber@example.org');
pruefe($i !== null && str_contains($i->betreff, 'TSV Nord') && str_contains($i->text, 'nord@example.org'), 'Info-Mail an den Administrator');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Doppelt', 'email' => 'nord@example.org', 'passwort' => 'nordpass1', 'volljaehrig' => true, 'bedingungen' => true], null, [], '10.1.0.2');
pruefe($s === 409, 'doppelte E-Mail bei Registrierung abgewiesen');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Bot', 'email' => 'bot@example.org', 'passwort' => 'botpass12', 'website' => 'http://spam', 'volljaehrig' => true, 'bedingungen' => true], null, [], '10.1.0.3');
pruefe($s === 400, 'Fangfeld ausgefüllt: abgewiesen');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Kurz', 'email' => 'kurz@example.org', 'passwort' => 'kurz', 'volljaehrig' => true, 'bedingungen' => true], null, [], '10.1.0.4');
pruefe($s === 400, 'zu kurzes Passwort bei Registrierung');
for ($n = 1; $n <= 5; $n++) {
    [$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => "Massen {$n}", 'email' => "m{$n}@example.org", 'passwort' => 'massen123', 'volljaehrig' => true, 'bedingungen' => true], null, [], '10.1.9.9');
}
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Massen 6', 'email' => 'm6@example.org', 'passwort' => 'massen123', 'volljaehrig' => true, 'bedingungen' => true], null, [], '10.1.9.9');
pruefe($s === 429, 'höchstens 5 neue Konten je Stunde und Anschluss');
$zeit += 3601;
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Massen 6', 'email' => 'm6@example.org', 'passwort' => 'massen123', 'volljaehrig' => true, 'bedingungen' => true], null, [], '10.1.9.9');
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
pruefe($d['unbestaetigt'] === ['leitung@example.org'], 'Ab 0.17: fremde Adresse wartet auf Bestätigung, Konto-Adresse nicht');
$bm = mailAn($mailer, 'leitung@example.org');
preg_match('~#/sicherung/([A-Z0-9-]+)/([a-f0-9]{64})~', (string)$bm?->text, $treffer);
pruefe(($treffer[1] ?? '') === $hid, 'Bestätigungsmail mit Link an den neuen Empfänger');
[$s, $d] = rufe($api, 'POST', 'sicherung.bestaetigen', ['turnier' => $hid, 'schluessel' => str_repeat('a', 64)]);
pruefe($s === 410, 'falscher Bestätigungslink abgewiesen');
[$s, $d] = rufe($api, 'POST', 'sicherung.bestaetigen', ['turnier' => strtolower($hid), 'schluessel' => $treffer[2] ?? '']);
pruefe($s === 200 && $d['email'] === 'leitung@example.org', 'Empfänger bestätigt (Kennung ohne Groß/klein)');
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, $jana, ['id' => $hid]);
pruefe($d['unbestaetigt'] === [] && $d['loeschenNach'] === 12 && $d['loeschungAm'] !== null, 'nach Bestätigung alle Empfänger aktiv; Löschfrist 12 Monate');
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
pruefe($s === 409 && str_contains($d['meldung'], 'einzige Spartenleitung'), 'einzige Spartenleitung: Löschen nur mit Bestätigung');
[$s, $d] = rufe($api, 'POST', 'konto.loeschen', ['passwort' => 'neuNord123', 'sparteLoeschen' => true], $nordTok2);
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
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'TTC Nord', 'email' => 'nord@example.org', 'passwort' => 'nordnord1', 'volljaehrig' => true, 'bedingungen' => true]);
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
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000001', 'spieler.angelegt')]], $tokSp, ['turnier' => $tid]);
pruefe(abgelehnt($s, $d), 'Spieler darf keine Spieler anlegen');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000002', 'spiel.ergebnis'), $ev('e3-000003', 'spiel.angefochten')]], $tokSp, ['turnier' => $tid]);
pruefe($s === 200, 'Spieler darf Ergebnisse und Anfechtungen senden');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000004', 'spiel.bestaetigt')]], $tokH, ['turnier' => $tid]);
pruefe(abgelehnt($s, $d), 'Helfer darf nur Ergebnisse senden');
[$s] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000014', 'spiel.aufgerufen'), $ev('e3-000015', 'spiel.aufruf_zurueck')]], $tokH, ['turnier' => $tid]);
pruefe($s === 200, 'Helfer darf Spiele aufrufen');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000016', 'spiel.aufgerufen')]], $tokSp, ['turnier' => $tid]);
pruefe(abgelehnt($s, $d), 'Spieler darf keine Spiele aufrufen');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000017', 'tisch.gesperrt')]], $tokH, ['turnier' => $tid]);
pruefe(abgelehnt($s, $d), 'Helfer darf keine Tische sperren');
// Etappe 8: Vorplanen, Auslosung ändern, Rückgängig – nur Leitung
foreach (['spiel.geplant', 'auslosung.geaendert', 'eintrag.zurueckgenommen'] as $i => $art) {
    [$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e8-00000' . $i, $art)]], $tokH, ['turnier' => $tid]);
    pruefe(abgelehnt($s, $d), "Helfer darf kein $art senden");
    [$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e8-00001' . $i, $art)]], $tokSp, ['turnier' => $tid]);
    pruefe(abgelehnt($s, $d), "Spieler darf kein $art senden");
}
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
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev('e3-000020', 'spieler.angelegt')]], $tokSH, ['turnier' => $tid]);
pruefe(abgelehnt($s, $d), 'Spieler mit Helfer-Recht: keine Leitungsarten');
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
[$sr, $fremd] = rufe($api, 'POST', 'registrieren', ['name' => 'Fremd', 'email' => 'fremd@example.org', 'passwort' => 'fremdfremd1', 'volljaehrig' => true, 'bedingungen' => true], null, [], '10.77.0.1');
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
[$s, $d] = rufe($api, 'POST', 'pool.speichern', ['spieler' => [
    ['id' => 'h1', 'vorname' => "Han\nna", 'nachname' => 'H', 'verein' => '', 'ttr' => 1025, 'ttrGeschaetzt' => true, 'appSpiele' => 7, 'wertungTurniere' => ['12345678'], 'lizenz' => 'NU-123'],
    ['id' => 'h2', 'vorname' => 'Hugo', 'nachname' => 'H', 'verein' => '', 'ttrGeschaetzt' => true, 'appSpiele' => -3, 'lizenz' => '<script>'],
]], $vk);
$h = array_column($d['spieler'], null, 'id');
pruefe($s === 200 && $h['h1']['ttrGeschaetzt'] === true && $h['h1']['appSpiele'] === 7 && $h['h1']['lizenz'] === 'NU-123' && $h['h1']['vorname'] === 'Hanna' && !isset($h['h1']['wertungTurniere']),
    'Pool: geschätzter Wert, App-Spiele, Lizenz; Steuerzeichen entfernt; keine Turnierliste je Person');
pruefe(!isset($h['h2']['ttrGeschaetzt']) && !isset($h['h2']['appSpiele']) && !isset($h['h2']['lizenz']), 'Pool: ungültige Zusatzfelder verworfen (geschätzt nur mit Wert)');
[$s] = rufe($api, 'POST', 'pool.speichern', ['spieler' => [['id' => "h3\n", 'vorname' => 'X', 'nachname' => 'Y', 'verein' => '']]], $vk);
pruefe($s === 400, 'Pool-ID mit Zeilenumbruch abgewiesen');
rufe($api, 'POST', 'pool.loeschen', ['ids' => ['h1', 'h2']], $vk);
[, $d2] = rufe($api, 'POST', 'registrieren', ['name' => 'TTC Süd', 'email' => 'sued@example.org', 'passwort' => 'suedsued1', 'volljaehrig' => true, 'bedingungen' => true]);
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
rufe($api, 'POST', 'konto.loeschen', ['passwort' => 'nordnord1', 'sparteLoeschen' => true], $vk);
[, $d] = rufe($api, 'POST', 'login', ['email' => 'nord@example.org', 'passwort' => 'nordnord1']);
pruefe(!isset($d['token']), 'Konto mit Pool und Codes gelöscht');

echo "Etappe 4: Android-Zentrale (Übernahme, Rückgabe, Sicherung)\n";
$mailer4 = new TestMailer();
$api = neueApi($mailer4);
rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Admin', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'TTC Zentral', 'email' => 'z@example.org', 'passwort' => 'zentral12', 'volljaehrig' => true, 'bedingungen' => true]);
$zk = $d['token'];
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Fremd', 'email' => 'f@example.org', 'passwort' => 'fremd1234', 'volljaehrig' => true, 'bedingungen' => true]);
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
// Etappe 10: neue Konten senden Sicherungen nur an die eigene Adresse, bis sie freigegeben sind
[$s, $d] = rufe($api, 'POST', 'sicherung.senden', ['turnier' => ['id' => '47381920', 'name' => 'Offline-Turnier'], 'empfaenger' => ['sicherung@example.org'], 'sicherung' => $sich], $zk);
pruefe($s === 403, 'Neues Konto: Sicherung von der Zentrale nur an die eigene Adresse');
[$s] = rufe($api, 'POST', 'sicherung.senden', ['turnier' => ['id' => '47381920', 'name' => 'Offline-Turnier'], 'empfaenger' => ['z@example.org'], 'sicherung' => $sich], $zk);
pruefe($s === 200 && mailAn($mailer4, 'z@example.org') !== null, 'Neues Konto: an die eigene Adresse geht es');
[, $d] = rufe($api, 'POST', 'login', ['email' => 'admin@example.org', 'passwort' => 'geheim123'], null, [], '10.4.0.9');
$adm4 = $d['token'];
[, $d] = rufe($api, 'GET', 'sparten', null, $adm4);
$zid4 = array_values(array_filter($d['sparten'], fn($k) => $k['verein'] === 'TTC Zentral'))[0]['id'];
rufe($api, 'POST', 'sparte.anmeldung', ['id' => $zid4, 'anmeldung' => 'frei'], $adm4);
// Ab 0.17: fremde Adresse bekommt erst einen Bestätigungslink
[$s, $d] = rufe($api, 'POST', 'sicherung.senden', ['turnier' => ['id' => '47381920', 'name' => 'Offline-Turnier'], 'empfaenger' => ['sicherung@example.org'], 'sicherung' => $sich], $zk);
$bm = mailAn($mailer4, 'sicherung@example.org');
preg_match('~#/sicherung/([A-Z0-9-]+)/([a-f0-9]{64})~', (string)$bm?->text, $bx);
pruefe($s === 200 && $d['gesendetAn'] === [] && ($d['unbestaetigt'] ?? false) === true && $bm !== null && $bm->anhangName === null, 'Zentrale: neuer Empfänger bekommt zuerst nur den Bestätigungslink');
rufe($api, 'POST', 'sicherung.bestaetigen', ['turnier' => $bx[1] ?? '', 'schluessel' => $bx[2] ?? '']);
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
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'TTC Süd', 'email' => 'sued@example.org', 'passwort' => 'suedsued1', 'volljaehrig' => true, 'bedingungen' => true]);
$vk = $d['token'];
[, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Jugend', 'datum' => null], $vk);
$tid = $d['turnier']['id'];
$leit = $d['token'];
[, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'spieler', 'bezug' => 'sp1', 'name' => 'Lea Löwe']]], $leit);
$codeLea = array_values(array_filter($d['codes'], fn($c) => $c['bezug'] === 'sp1'))[0]['code'];
[, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $codeLea]);
$tokLea = $d['token'];
rufe($api, 'POST', 'events', ['ereignisse' => [
    ereignis('d7-000001', 'spieler.angelegt', ['id' => 'sp1', 'vorname' => 'Lea', 'nachname' => 'Löwe', 'verein' => 'TSV', 'ttr' => 1200, 'ttrGeschaetzt' => true, 'jahrgang' => 2012, 'geschlecht' => 'w', 'pool' => 'p-123']),
    ereignis('d7-000002', 'spiel.aufgerufen', ['konkurrenz' => 'k1', 'spiel' => 'g0-a-b', 'tisch' => 2, 'schiri' => ['name' => 'Opa Paul']]),
    ereignis('d7-000003', 'spiel.aufgerufen', ['konkurrenz' => 'k1', 'spiel' => 'g0-a-c', 'tisch' => 3, 'schiri' => ['name' => 'Lea Löwe', 'spieler' => 'sp1']]),
]], $leit, ['turnier' => $tid]);
[, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => '0']);
$sp = $d['ereignisse'][0]['daten'];
pruefe($d['sicht'] === 'zuschauer' && $sp['nachname'] === 'Löwe' && $sp['ttr'] === 1200 && $sp['verein'] === 'TSV', 'Zuschauer: Name, Verein und TTR bleiben');
pruefe(!isset($sp['jahrgang']) && !isset($sp['geschlecht']) && !isset($sp['pool']) && !isset($sp['ttrGeschaetzt']), 'Zuschauer: kein Jahrgang, kein Geschlecht, kein Pool-Bezug, nicht „geschätzt“');
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

echo "Etappe 9: Aufgaben der Helfer, abgelehnte Einträge, Kasse nur in voller Sicht\n";
$zeit = 1_800_000_000; // 15.01.2027
$mailer = new TestMailer();
$api = neueApi($mailer);
rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Admin', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'TTC Süd', 'email' => 'sued@example.org', 'passwort' => 'suedpass1', 'volljaehrig' => true, 'bedingungen' => true], null, [], '10.9.0.1');
$konto = $d['token'];
[, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Frühjahrsturnier', 'datum' => '2027-02-20'], $konto);
$tid = $d['turnier']['id'];
$leit = $d['token'];
[$s, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [
    ['rolle' => 'helfer', 'bezug' => 'h-kasse1', 'name' => 'Kasse Eva', 'aufgaben' => ['kasse']],
    ['rolle' => 'helfer', 'bezug' => 'h-alt1', 'name' => 'Helfer Ali'],
    ['rolle' => 'spieler', 'bezug' => 'sp1', 'name' => 'Sven Spieler'],
]], $leit);
$codes = [];
foreach ($d['codes'] as $c) {
    $codes[$c['bezug']] = $c;
}
pruefe($s === 200 && $codes['h-kasse1']['aufgaben'] === ['kasse'] && $codes['h-alt1']['aufgaben'] === ['ergebnisse', 'aufruf'], 'Helferkennungen mit Aufgaben (Standard: Ergebnisse + Aufruf)');
[$s, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'helfer', 'bezug' => 'h-leer1', 'name' => 'X', 'aufgaben' => ['nix']]]], $leit);
pruefe($s === 400, 'Helferkennung ohne gültige Aufgabe abgewiesen');
[$s, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $codes['h-kasse1']['code']]);
$kasse = $d['token'];
pruefe($s === 200 && $d['rolle'] === 'helfer' && $d['aufgaben'] === ['kasse'], 'Anmeldung als Kasse: Aufgaben in der Antwort');
[, $d] = rufe($api, 'GET', 'turnier', null, $kasse, ['id' => $tid]);
pruefe($d['turnier']['rechte'] === 'helfer' && $d['turnier']['aufgaben'] === ['kasse'], 'GET turnier: Aufgaben der Helferkennung');
[, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $codes['sp1']['code']]);
$spTok = $d['token'];
$ev9 = fn(string $id, string $art, array $daten = ['spiel' => 'x']) => ['id' => $id, 'art' => $art, 'daten' => $daten, 'zeit' => '2027-01-15T10:00:00Z', 'geraet' => 'geraet-k'];
rufe($api, 'POST', 'events', ['ereignisse' => [
    $ev9('k9-000001', 'spieler.angelegt', ['id' => 'sp1', 'vorname' => 'Sven', 'nachname' => 'Spieler', 'verein' => 'TTC']),
    $ev9('k9-000002', 'turnier.daten', ['ort' => 'Halle', 'kasse' => ['aussteller' => 'TTC Süd e. V.', 'iban' => 'DE89370400440532013000']]),
]], $leit, ['turnier' => $tid]);
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [
    $ev9('k9-000003', 'startgeld.gebucht', ['id' => 'b0001', 'spieler' => 'sp1', 'betrag' => 800, 'art' => 'bar']),
    $ev9('k9-000004', 'spiel.ergebnis'),
    $ev9('k9-000005', 'teilnehmer.eingecheckt', ['spieler' => 'sp1', 'da' => true]),
]], $kasse, ['turnier' => $tid]);
pruefe($s === 200 && count($d['angenommen']) === 2 && count($d['abgelehnt'] ?? []) === 1 && $d['abgelehnt'][0]['id'] === 'k9-000004' && $d['abgelehnt'][0]['fehler'] === 'keine_berechtigung',
    'Kasse: Startgeld und Check-in angenommen, Ergebnis einzeln abgelehnt (Rest gilt)');
[$s, $d] = rufe($api, 'POST', 'code.aufgaben', ['turnier' => $tid, 'bezug' => 'h-kasse1', 'aufgaben' => ['kasse', 'oberschiri']], $kasse);
pruefe($s === 403, 'Aufgaben ändern nur die Leitung');
[$s, $d] = rufe($api, 'POST', 'code.aufgaben', ['turnier' => $tid, 'bezug' => 'h-kasse1', 'aufgaben' => ['kasse', 'oberschiri']], $leit);
pruefe($s === 200 && $d['code']['aufgaben'] === ['kasse', 'oberschiri'], 'Leitung gibt der Kasse zusätzlich „Oberschiedsrichter“');
[$s, $d] = rufe($api, 'POST', 'code.aufgaben', ['turnier' => $tid, 'bezug' => 'h-kasse1', 'aufgaben' => []], $leit);
pruefe($s === 400, 'mindestens eine Aufgabe');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev9('k9-000006', 'spiel.entschieden'), $ev9('k9-000007', 'spiel.aufgerufen')]], $kasse, ['turnier' => $tid]);
pruefe($s === 200 && count($d['angenommen']) === 1 && ($d['abgelehnt'][0]['id'] ?? '') === 'k9-000007', 'Änderung gilt sofort ohne neue Anmeldung: entscheiden ja, aufrufen nein');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev9('k9-000008', 'startgeld.gebucht', ['id' => 'b0002', 'spieler' => 'sp1', 'betrag' => 1, 'art' => 'bar'])]], $spTok, ['turnier' => $tid]);
pruefe(abgelehnt($s, $d), 'Spieler darf kein Startgeld buchen');
[, $d] = rufe($api, 'GET', 'events', null, $leit, ['turnier' => $tid, 'ab' => '0']);
$arten = array_column($d['ereignisse'], 'art');
$autorK = null;
foreach ($d['ereignisse'] as $e) {
    if ($e['art'] === 'startgeld.gebucht') {
        $autorK = $e['autor'];
    }
}
pruefe(in_array('startgeld.gebucht', $arten, true) && in_array('teilnehmer.eingecheckt', $arten, true) && $autorK === ['rolle' => 'helfer', 'name' => 'Kasse Eva', 'aufgaben' => ['kasse']],
    'Leitung sieht Kasse und Check-in; Autor mit Aufgaben');
$letzteSeq = $d['hoechsteSeq'];
[, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $codes['h-alt1']['code']]);
$aliTok = $d['token'];
[, $d] = rufe($api, 'GET', 'events', null, $aliTok, ['turnier' => $tid, 'ab' => '0']);
$arten = array_column($d['ereignisse'], 'art');
$daten = array_values(array_filter($d['ereignisse'], fn($e) => $e['art'] === 'turnier.daten'))[0]['daten'] ?? [];
pruefe($d['sicht'] === 'helfer' && !in_array('startgeld.gebucht', $arten, true) && !isset($daten['kasse']) && in_array('spieler.angelegt', $arten, true) && $d['bis'] === $letzteSeq,
    'Helfer ohne Aufgabe „Kasse“: Sicht „helfer“ ohne Zahlungen und Bankverbindung');
foreach ([[null, 'Zuschauer'], [$spTok, 'Spieler']] as [$tok, $wer]) {
    [, $d] = rufe($api, 'GET', 'events', null, $tok, ['turnier' => $tid, 'ab' => '0']);
    $arten = array_column($d['ereignisse'], 'art');
    $daten = null;
    foreach ($d['ereignisse'] as $e) {
        if ($e['art'] === 'turnier.daten') {
            $daten = $e['daten'];
        }
    }
    pruefe(!in_array('startgeld.gebucht', $arten, true) && !in_array('teilnehmer.eingecheckt', $arten, true) && $daten !== null && !isset($daten['kasse']) && $daten['ort'] === 'Halle'
        && $d['bis'] === $letzteSeq, "$wer: ohne Zahlungen, Check-in und Bankverbindung; „bis“ zeigt die zuletzt gelesene Laufnummer");
}
[, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [$ev9('k9-000010', 'teilnehmer.eingecheckt', ['spieler' => 'sp1', 'da' => false]), $ev9('k9-000011', 'teilnehmer.eingecheckt', ['spieler' => 'sp1', 'da' => true])]], $leit, ['turnier' => $tid]);
$bisSoll = $d['hoechsteSeq'];
[, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => (string)$letzteSeq]);
pruefe($d['ereignisse'] === [] && $d['bis'] === $bisSoll && $d['mehr'] === false, 'Nur gefilterte Einträge: leere Liste, aber „bis“ rückt vor');
[$s, $d] = rufe($api, 'POST', 'konto.einstellungen', ['kasse' => ['aussteller' => 'TTC Süd e. V.', 'iban' => 'DE00 1234', 'ust' => 'befreit']], $konto);
pruefe($s === 400, 'Konto-Vorgabe Kasse: falsche IBAN abgewiesen');
[$s, $d] = rufe($api, 'POST', 'konto.einstellungen', ['kasse' => ['aussteller' => 'TTC Süd e. V.', 'iban' => 'de89 3704 0044 0532 0130 00', 'ust' => 'befreit', 'ustSatz' => 7]], $konto);
pruefe($s === 200 && $d['kasse']['iban'] === 'DE89370400440532013000' && $d['kasse']['ust'] === 'befreit' && $d['klassen'] === [], 'Konto-Vorgabe Kasse gespeichert (Klassen bleiben)');

echo "Etappe 9: Online-Anmeldung mit Warteliste\n";
[$s] = rufe($api, 'GET', 'anmeldung', null, null, ['turnier' => $tid]);
pruefe($s === 404, 'ohne Einstellungen keine Anmeldeseite');
$einst = [
    'turnier' => $tid, 'offen' => true, 'schluss' => null, 'hinweis' => 'Bitte pünktlich', 'angaben' => ['ttr'], 'ort' => 'Halle Süd',
    'konkurrenzen' => [['id' => 'herren', 'name' => 'Herren', 'art' => 'einzel', 'max' => 2, 'startgeld' => 800], ['id' => 'doppel', 'name' => 'Doppel', 'art' => 'doppel', 'max' => null, 'startgeld' => null]],
    'bank' => ['empfaenger' => 'TTC Süd e. V.', 'iban' => 'DE89370400440532013000', 'bic' => ''],
];
[$s] = rufe($api, 'POST', 'anmeldung.einstellungen', $einst, $spTok);
pruefe($s === 403, 'Anmeldung einrichten nur Leitung');
[$s] = rufe($api, 'POST', 'anmeldung.einstellungen', ['bank' => ['empfaenger' => 'X', 'iban' => 'DE89370400440532013001']] + $einst, $leit);
pruefe($s === 400, 'falsche IBAN abgewiesen');
[, $d2] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Ohne Datum', 'datum' => null], $konto);
[$s] = rufe($api, 'POST', 'anmeldung.einstellungen', ['turnier' => $d2['turnier']['id']] + $einst, $konto);
pruefe($s === 400, 'Anmeldung öffnen braucht ein Turnierdatum (Löschfrist)');
// Etappe 10: neue Konten bieten die Online-Anmeldung erst nach 7 Tagen an (oder nach Freigabe durch den Admin)
[$s, $d] = rufe($api, 'POST', 'anmeldung.einstellungen', $einst, $leit);
pruefe($s === 403 && str_contains($d['meldung'] ?? '', 'Administrator'), 'Neues Konto: Online-Anmeldung erst nach 7 Tagen');
[, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
pruefe($d['freigabe']['erlaubt'] === false && $d['freigabe']['ab'] === Api::iso($zeit + 7 * 86400), 'Liste der Leitung nennt den Tag der Freigabe');
[, $d] = rufe($api, 'POST', 'login', ['email' => 'admin@example.org', 'passwort' => 'geheim123'], null, [], '10.9.0.9');
$admin9 = $d['token'];
[, $d] = rufe($api, 'GET', 'sparten', null, $admin9);
$sued = array_values(array_filter($d['sparten'], fn($k) => $k['verein'] === 'TTC Süd'))[0];
pruefe($sued['anmeldung'] === 'auto' && $sued['leitung'] === ['TTC Süd'], 'Sparte: Online-Anmeldung automatisch');
[$s] = rufe($api, 'POST', 'sparte.anmeldung', ['id' => $sued['id'], 'anmeldung' => 'frei'], $konto);
pruefe($s === 403, 'Freigabe nur durch den Admin');
[$s, $d] = rufe($api, 'POST', 'sparte.anmeldung', ['id' => $sued['id'], 'anmeldung' => 'frei'], $admin9);
pruefe($s === 200 && $d['sparte']['anmeldung'] === 'frei', 'Admin schaltet die Online-Anmeldung frei');
[$s, $d] = rufe($api, 'POST', 'anmeldung.einstellungen', $einst, $leit);
pruefe($s === 200 && $d['einstellungen']['offen'] === true && $d['einstellungen']['konkurrenzen'][0]['vorab'] === 0, 'Anmeldung geöffnet (Leitung sieht „vorab“)');
[$s, $d] = rufe($api, 'GET', 'anmeldung', null, null, ['turnier' => $tid]);
pruefe($s === 200 && $d['moeglich'] === true && $d['belegung']['herren'] === ['plaetze' => 0, 'warteliste' => 0] && $d['einstellungen']['bank'] === null && !isset($d['anmeldungen']) && !isset($d['einstellungen']['konkurrenzen'][0]['vorab']),
    'Anmeldeseite öffentlich: Belegung ohne Namen, ohne Bankverbindung');
$person = fn(string $vn, string $mail, array $extra = []) => $extra + [
    'turnier' => $tid, 'vorname' => $vn, 'nachname' => 'Muster', 'verein' => 'TV', 'email' => $mail, 'ttr' => 1400,
    'konkurrenzen' => [['id' => 'herren']], 'volljaehrig' => true, 'datenschutz' => true,
];
[$s] = rufe($api, 'POST', 'anmeldung.senden', $person('Ada', 'ada@example.org', ['ttr' => null]), null, [], '10.9.1.1');
pruefe($s === 400, 'Pflichtangabe TTR fehlt');
[$s] = rufe($api, 'POST', 'anmeldung.senden', $person('Ada', 'ada@example.org', ['volljaehrig' => false]), null, [], '10.9.1.1');
pruefe($s === 400, 'Ab 0.17: ohne „mindestens 18“ keine Online-Anmeldung');
[$s] = rufe($api, 'POST', 'anmeldung.senden', $person('Ada', 'ada@example.org', ['konkurrenzen' => [['id' => 'doppel', 'partner' => 'Doris D']]]), null, [], '10.9.1.1');
pruefe($s === 400, 'Doppelpartner ohne E-Mail abgewiesen (bestätigt selbst)');
[$s] = rufe($api, 'POST', 'anmeldung.senden', $person('Ada', 'ada@example.org', ['datenschutz' => false]), null, [], '10.9.1.1');
pruefe($s === 400, 'ohne Datenschutzhinweis abgewiesen');
[$s] = rufe($api, 'POST', 'anmeldung.senden', $person('Bot', 'bot@example.org', ['website' => 'x']), null, [], '10.9.1.1');
pruefe($s === 400, 'Fangfeld');
[$s] = rufe($api, 'POST', 'anmeldung.senden', $person('Ada', 'ada@example.org', ['konkurrenzen' => [['id' => 'gibtsnicht']]]), null, [], '10.9.1.1');
pruefe($s === 400, 'unbekannte Konkurrenz abgewiesen');
$schluessel = function (string $an) use ($mailer, $tid): string {
    $m = mailAn($mailer, $an);
    preg_match('~#/meldung/' . $tid . '/([a-f0-9]{64})~', $m?->text ?? '', $x);
    return $x[1] ?? '';
};
$keys = [];
foreach (['ada', 'ben', 'cem'] as $i => $n) {
    [$s, $d] = rufe($api, 'POST', 'anmeldung.senden', $person(ucfirst($n), "$n@example.org", ['ttrGeschaetzt' => $n === 'ben' ? true : 'ja', 'konkurrenzen' => [['id' => 'herren'], ['id' => 'doppel', 'partner' => 'Doris D', 'partnerEmail' => "doris-$n@example.org"]]]), null, [], '10.9.1.' . ($i + 2));
    $keys[$n] = $schluessel("$n@example.org");
}
pruefe($s === 200 && strlen($keys['ada']) === 64 && str_contains(mailAn($mailer, 'ada@example.org')->betreff, 'Bitte bestätigen'), 'Bestätigungsmail mit Link');
[$s, $d] = rufe($api, 'GET', 'anmeldung', null, null, ['turnier' => $tid]);
pruefe($d['belegung']['herren']['plaetze'] === 0, 'Unbestätigte belegen keinen Platz');
[$s, $d] = rufe($api, 'POST', 'anmeldung.bestaetigen', ['turnier' => $tid, 'schluessel' => $keys['ada']]);
pruefe($s === 200 && $d['konkurrenzen'][0]['status'] === 'platz' && $d['startgeld'] === 800 && $d['zweck'] === 'Startgeld Frühjahrsturnier Ada Muster' && $d['abmeldbar'] === true,
    'Bestätigt: Platz, Startgeld, Verwendungszweck');
pruefe(str_contains(mailAn($mailer, 'ada@example.org')->text, 'Platz sicher') && str_contains(mailAn($mailer, 'ada@example.org')->text, 'DE89 3704'), 'Mail nach Bestätigung mit Stand und Bankverbindung');
$pm = mailAn($mailer, 'doris-ada@example.org');
preg_match('~#/partner/' . $tid . '/([a-f0-9]{64})~', (string)$pm?->text, $px);
pruefe($pm !== null && str_contains($pm->text, 'Ada Muster') && isset($px[1]), 'Ab 0.17: Partnerin bekommt nach der Bestätigung eine Mail mit Link');
[$s, $d] = rufe($api, 'POST', 'anmeldung.partner', ['turnier' => $tid, 'schluessel' => $px[1] ?? '']);
pruefe($s === 200 && $d['status'] === 'offen' && $d['von'] === 'Ada Muster' && $d['konkurrenz'] !== '', 'Partner-Link zeigt, was zu bestätigen ist');
[$s] = rufe($api, 'POST', 'anmeldung.partner', ['turnier' => $tid, 'schluessel' => $px[1] ?? '', 'antwort' => 'ja']);
pruefe($s === 400, 'Partner-Bestätigung nur mit „mindestens 18“');
[$s, $d] = rufe($api, 'POST', 'anmeldung.partner', ['turnier' => $tid, 'schluessel' => $px[1] ?? '', 'antwort' => 'ja', 'volljaehrig' => true]);
pruefe($s === 200 && $d['status'] === 'bestaetigt' && str_contains((string)mailAn($mailer, 'ada@example.org')?->betreff, 'bestätigt'), 'Partnerin bestätigt, Meldende bekommt Bescheid');
[$s] = rufe($api, 'POST', 'anmeldung.partner', ['turnier' => $tid, 'schluessel' => str_repeat('b', 64)]);
pruefe($s === 410, 'falscher Partner-Link abgewiesen');
[$s, $d] = rufe($api, 'POST', 'anmeldung.bestaetigen', ['turnier' => $tid, 'schluessel' => $keys['ada']]);
pruefe($s === 200 && $d['konkurrenzen'][0]['status'] === 'platz', 'Link erneut öffnen: nur Stand');
$anzahlMails = count($mailer->mails);
[$s, $d] = rufe($api, 'POST', 'anmeldung.bestaetigen', ['turnier' => $tid, 'schluessel' => $keys['ada']]);
pruefe(count($mailer->mails) === $anzahlMails && $d['bestaetigt'] === true, 'Erneutes Bestätigen: keine zweite Mail');
[$s, $d] = rufe($api, 'POST', 'anmeldung.stand', ['turnier' => $tid, 'schluessel' => $keys['ben']]);
pruefe($s === 200 && $d['bestaetigt'] === false && $d['konkurrenzen'][0]['status'] === null, 'Stand ohne Bestätigung (Mail-Scanner bestätigen nichts)');
$erste = mailAn($mailer, 'ben@example.org');
pruefe(str_starts_with($erste->text, "Hallo,\n") && !str_contains($erste->text, 'Ben'), 'Erste Mail ohne frei eingegebenen Namen');
$antwortAn = $erste->antwortAn;
pruefe($antwortAn === 'sued@example.org', 'Antworten auf Anmelde-Mails gehen an die Turnierleitung');
rufe($api, 'POST', 'anmeldung.bestaetigen', ['turnier' => $tid, 'schluessel' => $keys['ben']]);
// Etappe 11: Hinweis-Mail an die Leitung je bestätigter Anmeldung – ohne Namen und Mail-Adressen
$hinweis = mailAn($mailer, 'sued@example.org');
pruefe($hinweis !== null && str_starts_with($hinweis->betreff, 'Neue Anmeldung: Frühjahrsturnier') && str_contains($hinweis->text, 'Bestätigte Anmeldungen insgesamt: 2')
    && !str_contains($hinweis->text, 'Ben') && !str_contains($hinweis->text, 'Muster') && !str_contains($hinweis->text, '@example.org'),
    'Hinweis-Mail an die Leitung ohne Namen');
[, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
$nachName = array_column($d['anmeldungen'], null, 'vorname');
pruefe($nachName['Ben']['ttrGeschaetzt'] === true && $nachName['Ada']['ttrGeschaetzt'] === false, 'Anmeldung: geschätzter Wert (Einstufung) nur bei true übernommen');
pruefe(($d['einstellungen']['hinweisMail'] ?? null) === true, 'Leitung sieht die Einstellung Hinweis-Mail (Standard an)');
[, $d] = rufe($api, 'GET', 'anmeldung', null, null, ['turnier' => $tid]);
pruefe(!array_key_exists('hinweisMail', $d['einstellungen']), 'Einstellung Hinweis-Mail nicht öffentlich');
[$s] = rufe($api, 'POST', 'anmeldung.einstellungen', ['hinweisMail' => false] + $einst, $leit);
pruefe($s === 200, 'Hinweis-Mail abgeschaltet');
[, $d] = rufe($api, 'POST', 'anmeldung.einstellungen', $einst, $leit);
pruefe(($d['einstellungen']['hinweisMail'] ?? null) === false, 'Ohne Feld (ältere App) bleibt die Hinweis-Mail aus');
$vorher = count(array_filter($mailer->mails, fn($m) => $m->an === 'sued@example.org'));
[$s, $d] = rufe($api, 'POST', 'anmeldung.bestaetigen', ['turnier' => $tid, 'schluessel' => $keys['cem']]);
pruefe(count(array_filter($mailer->mails, fn($m) => $m->an === 'sued@example.org')) === $vorher, 'Abgeschaltet: keine Hinweis-Mail');
pruefe($s === 200 && $d['konkurrenzen'][0]['status'] === 'warteliste' && $d['konkurrenzen'][0]['position'] === 1 && $d['konkurrenzen'][1]['status'] === 'platz' && $d['startgeld'] === 0,
    'Herren voll: Warteliste Platz 1; Doppel unbegrenzt');
[$s, $d] = rufe($api, 'GET', 'anmeldungen', null, null, ['turnier' => $tid]);
pruefe($s === 401, 'Liste der Anmeldungen nicht öffentlich');
[$s, $d] = rufe($api, 'GET', 'anmeldungen', null, $kasse, ['turnier' => $tid]);
pruefe($s === 403, 'Liste der Anmeldungen nicht für Helfer');
[$s, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
$liste = [];
foreach ($d['anmeldungen'] as $x) {
    $liste[$x['vorname']] = $x;
}
pruefe($s === 200 && count($d['anmeldungen']) === 3 && !isset($liste['Cem']['minderjaehrig']) && $liste['Cem']['email'] === 'cem@example.org' && $liste['Cem']['konkurrenzen'][1]['partner'] === 'Doris D'
    && $liste['Ada']['konkurrenzen'][1]['partnerStatus'] === 'bestaetigt' && $liste['Cem']['konkurrenzen'][1]['partnerStatus'] === 'offen'
    && !str_contains((string)json_encode($d), 'doris-')
    && preg_match('/^[a-z0-9]{10}$/', $liste['Ada']['id']) === 1, 'Leitung sieht alle Angaben (mit E-Mail, Partnerwunsch)');
[$s, $d] = rufe($api, 'POST', 'anmeldung.abmelden', ['turnier' => $tid, 'schluessel' => $keys['ada'], 'konkurrenz' => 'herren']);
pruefe($s === 200 && $d['konkurrenzen'][0]['status'] === 'abgemeldet', 'Abmelden per Link');
$cem = mailAn($mailer, 'cem@example.org');
pruefe(str_contains($cem->betreff, 'Nachgerückt') && str_contains($cem->text, 'Platz sicher'), 'Warteliste rückt nach (Mail)');
[, $d] = rufe($api, 'GET', 'anmeldung', null, null, ['turnier' => $tid]);
pruefe($d['belegung']['herren'] === ['plaetze' => 2, 'warteliste' => 0], 'Belegung nach dem Nachrücken');
[$s, $d] = rufe($api, 'POST', 'anmeldung.aendern', ['turnier' => $tid, 'id' => $liste['Ben']['id'], 'konkurrenz' => 'herren', 'status' => 'abgemeldet'], $leit);
pruefe($s === 200 && str_contains(mailAn($mailer, 'ben@example.org')->text, 'gestrichen'), 'Leitung streicht eine Meldung (Mail an die Person)');
// Doppelte Anmeldung: kein zweiter Eintrag, Mail mit Link
[$s, $d] = rufe($api, 'POST', 'anmeldung.senden', $person('Ada', 'ada@example.org'), null, [], '10.9.1.9');
[, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
pruefe($s === 200 && count($d['anmeldungen']) === 3 && str_contains(mailAn($mailer, 'ada@example.org')->text, 'schon eine Anmeldung'), 'Gleiche Person nochmals: keine Doppelung, Mail mit Link');
$keys['ada'] = $schluessel('ada@example.org');
[$s, $d] = rufe($api, 'POST', 'anmeldung.bestaetigen', ['turnier' => $tid, 'schluessel' => $keys['ada']]);
pruefe($s === 200 && $d['vorname'] === 'Ada', 'neuer Link gilt');
// Bestätigung nach 24 Stunden abgelaufen
rufe($api, 'POST', 'anmeldung.senden', $person('Dora', 'dora@example.org'), null, [], '10.9.1.10');
$k = $schluessel('dora@example.org');
$zeit += 86400 + 60;
[$s] = rufe($api, 'POST', 'anmeldung.bestaetigen', ['turnier' => $tid, 'schluessel' => $k]);
pruefe($s === 410 || $s === 401, 'Bestätigungslink nach 24 Stunden abgelaufen (und Anmeldung gelöscht)');
[$s, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
pruefe(count($d['anmeldungen']) === 3, 'abgelaufene unbestätigte Anmeldung gelöscht');
// Falsche Schlüssel: gebremst
$n = 0;
for ($i = 0; $i < 12; $i++) {
    [$s] = rufe($api, 'POST', 'anmeldung.bestaetigen', ['turnier' => $tid, 'schluessel' => str_repeat('a', 64)], null, [], '10.9.2.1');
    $n += $s === 429 ? 1 : 0;
}
pruefe($n >= 2, 'Durchprobieren von Links gebremst (429)');
[$s] = rufe($api, 'POST', 'anmeldung.uebernommen', ['turnier' => $tid, 'ids' => [$liste['Cem']['id']]], $leit);
[, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
$cemNeu = array_values(array_filter($d['anmeldungen'], fn($x) => $x['vorname'] === 'Cem'))[0];
pruefe($s === 200 && $cemNeu['spieler'] === $cemNeu['id'], 'Übernahme ins Turnier vermerkt');
// Meldeschluss
[$s] = rufe($api, 'POST', 'anmeldung.einstellungen', ['schluss' => '2027-01-10T00:00:00Z'] + $einst, $leit);
[$s, $d] = rufe($api, 'GET', 'anmeldung', null, null, ['turnier' => $tid]);
[$s2] = rufe($api, 'POST', 'anmeldung.senden', $person('Emil', 'emil@example.org'), null, [], '10.9.1.11');
pruefe($d['moeglich'] === false && $s2 === 410, 'nach Meldeschluss keine neuen Anmeldungen');
// Angaben, die die Leitung nicht verlangt, werden verworfen (Datensparsamkeit, ab 0.15)
rufe($api, 'POST', 'anmeldung.einstellungen', $einst, $leit);
[$s] = rufe($api, 'POST', 'anmeldung.senden', $person('Nina', 'nina@example.org', ['jahrgang' => 1990, 'klasse' => 'B', 'geschlecht' => 'w']), null, [], '10.9.1.13');
[, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
$nina = array_values(array_filter($d['anmeldungen'], fn($x) => $x['vorname'] === 'Nina'))[0] ?? null;
pruefe($s === 200 && $nina !== null && $nina['jahrgang'] === null && $nina['klasse'] === null && $nina['geschlecht'] === null && $nina['ttr'] === 1400, 'Anmeldung: nicht verlangte Angaben verworfen');
rufe($api, 'POST', 'anmeldung.einstellungen', ['angaben' => ['ttr', 'jahrgang']] + $einst, $leit);
// Zeilenumbrüche im Namen werden entfernt; Jahrgang unter 18 verlangt das Einverständnis
[$s] = rufe($api, 'POST', 'anmeldung.senden', $person("Eve\n\nIhr Konto ist gesperrt: https://x", 'eve@example.org', ['jahrgang' => (int)gmdate('Y', $zeit) - 12]), null, [], '10.9.1.12');
pruefe($s === 400, 'Jahrgang unter 18 ohne Einverständnis abgewiesen');
rufe($api, 'POST', 'anmeldung.einstellungen', $einst, $leit);
[$s] = rufe($api, 'POST', 'anmeldung.senden', $person("Eve\n\nIhr Konto ist gesperrt: https://x", 'eve@example.org'), null, [], '10.9.1.12');
[, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
$eve = array_values(array_filter($d['anmeldungen'], fn($x) => str_starts_with($x['vorname'], 'Eve')))[0] ?? null;
pruefe($s === 200 && $eve !== null && !str_contains($eve['vorname'], "\n") && !str_contains(mailAn($mailer, 'eve@example.org')->text, 'gesperrt'), 'Steuerzeichen entfernt, kein Fremdtext in der Mail');
// Je Adresse 5 Mails pro Stunde; danach immer dieselbe Antwort ohne Mail (keine Auskunft, wer angemeldet ist)
$vorher = count($mailer->mails);
$stati = [];
for ($i = 0; $i < 7; $i++) {
    [$st] = rufe($api, 'POST', 'anmeldung.senden', $person('Fremd' . $i, 'opfer@example.org'), null, [], '10.9.4.' . $i);
    $stati[] = $st;
}
pruefe(array_unique($stati) === [200] && count($mailer->mails) - $vorher === 5, 'Je Adresse höchstens 5 Mails, Antwort immer 200');
// Abmelden ohne Änderung: keine weitere Mail
$vorher = count($mailer->mails);
rufe($api, 'POST', 'anmeldung.abmelden', ['turnier' => $tid, 'schluessel' => $keys['ada'], 'konkurrenz' => 'gibtsnicht']);
rufe($api, 'POST', 'anmeldung.abmelden', ['turnier' => $tid, 'schluessel' => $keys['ada'], 'konkurrenz' => 'gibtsnicht']);
pruefe(count($mailer->mails) === $vorher, 'Abmelden ohne Änderung schickt keine Mail');
// Datum bleibt gesetzt, solange es Anmeldungen gibt
[$s] = rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $tid, 'datum' => null], $leit);
pruefe($s === 409, 'Datum lässt sich nicht entfernen, solange es Anmeldungen gibt');
// Bankverbindung über eine Leitungskennung geändert → Mail an das Konto
[, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'leitung', 'bezug' => 'l-zweit', 'name' => 'Zweitleitung']]], $leit);
$zweit = array_values(array_filter($d['codes'], fn($c) => $c['bezug'] === 'l-zweit'))[0]['code'];
[, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $zweit]);
$zweitTok = $d['token'];
rufe($api, 'POST', 'anmeldung.einstellungen', ['bank' => ['empfaenger' => 'Fremd', 'iban' => 'GB82WEST12345698765432', 'bic' => '']] + $einst, $zweitTok);
pruefe(str_contains(mailAn($mailer, 'sued@example.org')?->text ?? '', 'GB82 WEST'), 'IBAN-Änderung in der Anmeldung: Mail an das Konto');
rufe($api, 'POST', 'events', ['ereignisse' => [$ev9('k9-000020', 'turnier.daten', ['kasse' => ['aussteller' => 'X', 'iban' => 'DE89370400440532013000']])]], $zweitTok, ['turnier' => $tid]);
pruefe(str_contains(mailAn($mailer, 'sued@example.org')?->text ?? '', 'DE89 3704') && str_contains(mailAn($mailer, 'sued@example.org')->text, 'Zweitleitung'), 'IBAN-Änderung in der Kasse: Mail an das Konto');
// Löschfrist: 30 Tage nach dem Turniertag
$zeit = (int)strtotime('2027-03-22T12:00:00Z');
rufe($api, 'GET', 'info');
[, $d] = rufe($api, 'POST', 'login', ['email' => 'sued@example.org', 'passwort' => 'suedpass1'], null, [], '10.9.3.1');
$leit = $d['token'];
[, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
pruefe(count($d['anmeldungen']) === 3, 'vor Ablauf der Frist noch vorhanden');
$zeit = (int)strtotime('2027-03-23T12:00:00Z');
rufe($api, 'GET', 'info');
[, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
pruefe($d['anmeldungen'] === [], '30 Tage nach dem Turniertag gelöscht');
// Ersatzfrist: Turnier weit in der Zukunft – nach 180 Tagen trotzdem gelöscht
rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $tid, 'datum' => '2030-01-01'], $leit);
rufe($api, 'POST', 'anmeldung.einstellungen', ['schluss' => null] + $einst, $leit);
rufe($api, 'POST', 'anmeldung.senden', $person('Fritz', 'fritz@example.org'), null, [], '10.9.5.1');
rufe($api, 'POST', 'anmeldung.bestaetigen', ['turnier' => $tid, 'schluessel' => $schluessel('fritz@example.org')]);
$zeit += 179 * 86400;
rufe($api, 'GET', 'info');
[, $d] = rufe($api, 'POST', 'login', ['email' => 'sued@example.org', 'passwort' => 'suedpass1'], null, [], '10.9.3.2');
$leit = $d['token'];
[, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
$n179 = count($d['anmeldungen']);
$zeit += 2 * 86400;
rufe($api, 'GET', 'info');
[, $d] = rufe($api, 'GET', 'anmeldungen', null, $leit, ['turnier' => $tid]);
pruefe($n179 === 1 && $d['anmeldungen'] === [], 'Ersatzfrist: spätestens 180 Tage nach der Anmeldung gelöscht');

echo "Etappe 10: entfernte Spieler, Grenzen, Freigaben\n";
$zeit = 1_800_000_000;
$mailer = new TestMailer();
$api = neueApi($mailer);
rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Admin', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'TTC Nord', 'email' => 'nord@example.org', 'passwort' => 'nordnord1', 'volljaehrig' => true, 'bedingungen' => true], null, [], '10.10.0.1');
$konto = $d['token'];
[, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Herbstturnier', 'datum' => '2027-03-01'], $konto);
$tid = $d['turnier']['id'];
$leit = $d['token'];
$ev10 = fn(string $id, string $art, array $daten) => ['id' => $id, 'art' => $art, 'daten' => $daten, 'zeit' => '2027-01-15T10:00:00Z', 'geraet' => 'geraet-n'];
rufe($api, 'POST', 'events', ['ereignisse' => [
    $ev10('e10-0001', 'spieler.angelegt', ['id' => 'anna', 'vorname' => 'Anna', 'nachname' => 'Arm', 'verein' => 'TTC', 'jahrgang' => 2010, 'lizenz' => 'NU-12345']),
    $ev10('e10-0002', 'spieler.angelegt', ['id' => 'bert', 'vorname' => 'Bert', 'nachname' => 'Bein', 'verein' => 'TTC']),
    $ev10('e10-0003', 'spieler.geaendert', ['id' => 'bert', 'verein' => 'SV Bein']),
    $ev10('e10-0004', 'spieler.angelegt', ['id' => 'cora', 'vorname' => 'Cora', 'nachname' => 'Copf', 'verein' => 'TTC']),
]], $leit, ['turnier' => $tid]);
[, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => '0']);
pruefe(!isset($d['filter']) && !isset($d['ereignisse'][0]['daten']['lizenz']) && !isset($d['ereignisse'][0]['daten']['jahrgang']), 'Ohne entfernte Spieler kein Filter; Lizenz und Jahrgang nicht für Zuschauer');
rufe($api, 'POST', 'events', ['ereignisse' => [
    $ev10('e10-0005', 'spieler.entfernt', ['id' => 'bert']),
    $ev10('e10-0006', 'eintrag.zurueckgenommen', ['ereignisse' => ['e10-0004'], 'zurueck' => true]),
]], $leit, ['turnier' => $tid]);
$namen = function (array $d): array {
    $aus = [];
    foreach ($d['ereignisse'] as $e) {
        if (in_array($e['art'], ['spieler.angelegt', 'spieler.geaendert'], true)) {
            $aus[] = $e['daten']['id'] . ':' . ($e['daten']['vorname'] ?? '') . '/' . ($e['daten']['nachname'] ?? '') . '/' . ($e['daten']['verein'] ?? '');
        }
    }
    return $aus;
};
[, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => '0']);
$f1 = $d['filter'] ?? null;
pruefe($namen($d) === ['anna:Anna/Arm/TTC', 'bert:Entfernt//', 'bert://', 'cora:Entfernt//'] && is_string($f1) && strlen($f1) === 16,
    'Zuschauer: Namen entfernter und zurückgenommener Spieler ersetzt, Filter-Kennung gesetzt');
rufe($api, 'POST', 'events', ['ereignisse' => [$ev10('e10-0050', 'spiel.aufgerufen', ['konkurrenz' => 'k', 'spiel' => 's', 'tisch' => 1, 'schiri' => ['spieler' => 'bert', 'name' => 'Bert Bein']])]], $leit, ['turnier' => $tid]);
[, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'spieler', 'bezug' => 'anna', 'name' => 'Anna Arm']]], $leit);
$ac = array_values(array_filter($d['codes'], fn($c) => $c['bezug'] === 'anna'))[0]['code'];
[, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $ac]);
[, $d] = rufe($api, 'GET', 'events', null, $d['token'], ['turnier' => $tid, 'ab' => '0']);
$auf = array_values(array_filter($d['ereignisse'], fn($e) => $e['art'] === 'spiel.aufgerufen'))[0] ?? null;
pruefe($d['sicht'] === 'spieler' && $auf !== null && $auf['daten']['schiri'] === ['spieler' => 'bert'], 'Spieler-Sicht: Schiedsrichter-Name einer entfernten Person entfernt');
[, $d] = rufe($api, 'GET', 'events', null, $leit, ['turnier' => $tid, 'ab' => '0']);
pruefe(in_array('bert:Bert/Bein/TTC', $namen($d), true) && !isset($d['filter']), 'Leitung sieht alles, ohne Filter');
[, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'helfer', 'bezug' => 'h-auf', 'name' => 'Aufruf Ali', 'aufgaben' => ['aufruf']]]], $leit);
$hc = array_values(array_filter($d['codes'], fn($c) => $c['bezug'] === 'h-auf'))[0]['code'];
[, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $hc]);
[, $d] = rufe($api, 'GET', 'events', null, $d['token'], ['turnier' => $tid, 'ab' => '0']);
pruefe($d['sicht'] === 'helfer' && !isset($d['ereignisse'][0]['daten']['jahrgang']) && !isset($d['ereignisse'][0]['daten']['lizenz']) && $d['ereignisse'][0]['daten']['vorname'] === 'Anna',
    'Helfer ohne Kasse: kein Jahrgang, keine Lizenz (Datensparsamkeit)');
rufe($api, 'POST', 'events', ['ereignisse' => [$ev10('e10-0007', 'eintrag.zurueckgenommen', ['ereignisse' => ['e10-0005'], 'zurueck' => true])]], $leit, ['turnier' => $tid]);
[, $d] = rufe($api, 'GET', 'events', null, null, ['turnier' => $tid, 'ab' => '0']);
pruefe(in_array('bert:Bert/Bein/TTC', $namen($d), true) && ($d['filter'] ?? null) !== $f1 && isset($d['filter']), 'Entfernen rückgängig: Name wieder da, Filter-Kennung ändert sich');
pruefe(Api::entfernteAus([
    ['id' => 'x1', 'art' => 'spieler.angelegt', 'daten' => ['id' => 'p'], 'leitung' => true],
    ['id' => 'x2', 'art' => 'spieler.entfernt', 'daten' => ['id' => 'p'], 'leitung' => false],
    ['id' => 'x3', 'art' => 'eintrag.zurueckgenommen', 'daten' => ['ereignisse' => ['x1']], 'leitung' => false],
]) === [], 'Entfernen/Zurücknehmen zählt nur von der Leitung');
// Turniere anlegen: höchstens 20 am Tag (Admin ausgenommen)
$stati = [];
for ($i = 0; $i < 20; $i++) {
    [$st] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Test ' . $i], $konto);
    $stati[] = $st;
}
pruefe(array_count_values($stati) === [200 => 19, 429 => 1], 'Höchstens 20 neue Turniere je Konto und Tag');
[, $d] = rufe($api, 'POST', 'login', ['email' => 'admin@example.org', 'passwort' => 'geheim123'], null, [], '10.10.0.9');
$admin10 = $d['token'];
[$st] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Admin-Test'], $admin10);
pruefe($st === 200, 'Admin ist von der Tagesgrenze ausgenommen');
// Neue Sicherungsempfänger über eine Leitungskennung → Mail an das Konto
[, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $tid, 'eintraege' => [['rolle' => 'leitung', 'bezug' => 'l-zwei', 'name' => 'Zweite Leitung']]], $leit);
$zw = array_values(array_filter($d['codes'], fn($c) => $c['bezug'] === 'l-zwei'))[0]['code'];
[, $d] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $tid, 'code' => $zw]);
$zwTok = $d['token'];
$vorher = count($mailer->mails);
[$st] = rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $tid, 'sicherungAn' => ['nord@example.org', 'fremd@example.org']], $zwTok);
$m = mailAn($mailer, 'nord@example.org');
pruefe($st === 200 && count($mailer->mails) === $vorher + 2 && str_contains($m->text, 'fremd@example.org') && str_contains($m->text, 'Zweite Leitung')
    && str_contains((string)mailAn($mailer, 'fremd@example.org')?->betreff, 'Bitte bestätigen'), 'Neue Sicherungsempfänger: Mail an das Konto (und Bestätigungslink an die neue Adresse)');
$vorher = count($mailer->mails);
rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $tid, 'sicherungAn' => ['nord@example.org']], $leit);
rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $tid, 'sicherungAn' => ['nord@example.org', 'zweit@example.org']], $leit);
pruefe(count(array_filter(array_slice($mailer->mails, $vorher), fn($m) => $m->an === 'nord@example.org')) === 0, 'Änderung durch das Konto selbst: keine Mail an das Konto');

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
pruefe($s === 200 && $pdo->query("SELECT wert FROM meta WHERE schluessel = 'schema'")->fetchColumn() === '9', 'Schema 1 → 9 angehoben, Anmeldung geht');
$altTok = $d['token'];
[$s, $d] = rufe($apiAlt, 'GET', 'turnier', null, $altTok, ['id' => 'altturnier']);
pruefe($s === 200 && $d['turnier']['rechte'] === 'leitung' && $d['turnier']['id'] === 'ALTTURNIER', 'alte Turnierkennung (10 Zeichen) bleibt erreichbar (ab 0.17 ohne Groß/klein)');
[$s, $d] = rufe($apiAlt, 'POST', 'turnier.zugang', ['turnier' => 'altturnier', 'passwort' => 'altesPasswort', 'name' => 'X']);
pruefe($s === 401, 'altes Leitungspasswort gilt nicht mehr (Kennungen neu ausgeben)');
[$s, $d] = rufe($apiAlt, 'GET', 'turnier.einstellungen', null, $altTok, ['id' => 'altturnier']);
pruefe($s === 200 && !isset($d['leitungsCode']) && $d['mail'] === false, 'alte Turniere: Einstellungen über das Konto; ohne Mailer kein Versand');

echo "Etappe 11: Mannschaften – Aufstellung nur durch die Führung, verdeckt bis beide abgegeben haben\n";
$api = neueApi();
rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Sascha', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
[, $d] = rufe($api, 'POST', 'login', ['email' => 'admin@example.org', 'passwort' => 'geheim123']);
[, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Mannschafts-Cup', 'datum' => '2026-12-05'], $d['token']);
$mtid = $d['turnier']['id'];
$mLeit = $d['token'];
rufe($api, 'POST', 'events', ['ereignisse' => [
    ereignis('m-0000001', 'spieler.angelegt', ['id' => 'a1', 'vorname' => 'A', 'nachname' => 'Eins', 'verein' => '']),
    ereignis('m-0000002', 'spieler.angelegt', ['id' => 'a2', 'vorname' => 'A', 'nachname' => 'Zwei', 'verein' => '']),
    ereignis('m-0000003', 'spieler.angelegt', ['id' => 'b1', 'vorname' => 'B', 'nachname' => 'Eins', 'verein' => '']),
    ereignis('m-0000004', 'mannschaft.gemeldet', ['konkurrenz' => 'm', 'id' => 'm-aaaa', 'name' => 'A', 'spieler' => ['a1', 'a2'], 'fuehrer' => 'a1']),
    ereignis('m-0000005', 'mannschaft.gemeldet', ['konkurrenz' => 'm', 'id' => 'm-bbbb', 'name' => 'B', 'spieler' => ['b1'], 'fuehrer' => 'b1']),
]], $mLeit, ['turnier' => $mtid]);
[, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $mtid, 'eintraege' => [['rolle' => 'spieler', 'bezug' => 'a1', 'name' => 'A1'], ['rolle' => 'spieler', 'bezug' => 'a2', 'name' => 'A2'], ['rolle' => 'spieler', 'bezug' => 'b1', 'name' => 'B1']]], $mLeit);
$mTok = [];
foreach ($d['codes'] as $c) {
    if ($c['rolle'] === 'spieler') {
        [, $z] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $mtid, 'code' => $c['code']], null, [], '10.11.0.' . count($mTok));
        $mTok[$c['bezug']] = $z['token'];
    }
}
$aufst = fn(string $id, string $m, string $g, array $einzel, string $spiel = 'g0-m-aaaa-m-bbbb') => ['ereignisse' => [ereignis($id, 'mannschaft.aufgestellt', ['konkurrenz' => 'm', 'spiel' => $spiel, 'mannschaft' => $m, 'gegner' => $g, 'einzel' => $einzel])]];
$anzahlAuf = fn(array $d) => count(array_filter($d['ereignisse'], fn($e) => $e['art'] === 'mannschaft.aufgestellt'));
[$s, $d] = rufe($api, 'POST', 'events', $aufst('m-0000006', 'm-aaaa', 'm-bbbb', ['a1', 'a2']), $mTok['a2'], ['turnier' => $mtid]);
pruefe($s === 200 && $d['angenommen'] === [] && str_contains($d['abgelehnt'][0]['meldung'] ?? '', 'Mannschaftsführung'), 'Spieler ohne Führung: Aufstellung abgelehnt');
[$s, $d] = rufe($api, 'POST', 'events', $aufst('m-0000007', 'm-aaaa', 'm-bbbb', ['a1'], 'g0-m-cccc-m-bbbb'), $mTok['a1'], ['turnier' => $mtid]);
pruefe($d['angenommen'] === [], 'Gruppenspiel einer fremden Begegnung: abgelehnt');
[$s, $d] = rufe($api, 'POST', 'events', $aufst('m-0000017', 'm-aaaa', 'm-bbbb', ['b1']), $mTok['a1'], ['turnier' => $mtid]);
pruefe($d['angenommen'] === [], 'Fremder Spieler in der Aufstellung: abgelehnt');
[$s, $d] = rufe($api, 'POST', 'events', $aufst('m-0000018', 'm-aaaa', 'm-bbbb', []), $mTok['a1'], ['turnier' => $mtid]);
pruefe($d['angenommen'] === [], 'Leere Aufstellung abgelehnt (kein Aufdecken mit ungültiger Abgabe)');
[$s, $d] = rufe($api, 'POST', 'events', $aufst('m-0000019', 'm-aaaa', 'm-bbbb', ['a1', 'a1']), $mTok['a1'], ['turnier' => $mtid]);
pruefe($d['angenommen'] === [], 'Doppelt besetzte Position abgelehnt');
[$s, $d] = rufe($api, 'POST', 'events', $aufst('m-0000008', 'm-aaaa', 'm-bbbb', ['a1', 'a2']), $mTok['a1'], ['turnier' => $mtid]);
pruefe(count($d['angenommen']) === 1, 'Mannschaftsführung gibt die Aufstellung ab');
[, $gegner] = rufe($api, 'GET', 'events', null, $mTok['b1'], ['turnier' => $mtid, 'ab' => 0]);
[, $selbst] = rufe($api, 'GET', 'events', null, $mTok['a2'], ['turnier' => $mtid, 'ab' => 0]);
[, $zusch] = rufe($api, 'GET', 'events', null, null, ['turnier' => $mtid, 'ab' => 0]);
[, $leit] = rufe($api, 'GET', 'events', null, $mLeit, ['turnier' => $mtid, 'ab' => 0]);
pruefe($anzahlAuf($gegner) === 0 && $anzahlAuf($zusch) === 0 && !isset($zusch['filter']), 'Gegner und Zuschauer sehen die Aufstellung noch nicht (verdeckte ändern die Filter-Kennung nicht)');
pruefe($anzahlAuf($selbst) === 1 && $anzahlAuf($leit) === 1, 'Eigene Mannschaft und Leitung sehen sie');
// Ab 0.16: Kasse-Helfer haben die volle Sicht (Zahlungen), sehen Aufstellungen aber erst nach dem Aufdecken
[, $d] = rufe($api, 'POST', 'codes.anlegen', ['turnier' => $mtid, 'eintraege' => [['rolle' => 'helfer', 'bezug' => 'hk', 'name' => 'Kasse', 'aufgaben' => ['kasse']]]], $mLeit);
$kasseCode = array_values(array_filter($d['codes'], fn($c) => $c['bezug'] === 'hk'))[0]['code'] ?? '';
[, $z] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $mtid, 'code' => $kasseCode], null, [], '10.11.0.8');
$kasseTok = $z['token'] ?? '';
[, $kas] = rufe($api, 'GET', 'events', null, $kasseTok, ['turnier' => $mtid, 'ab' => 0]);
pruefe(($kas['sicht'] ?? '') === 'voll' && $anzahlAuf($kas) === 0 && isset($kas['filter']) && !isset($leit['filter']), 'Kasse-Helfer (volle Sicht) sieht die Aufstellung vor dem Aufdecken nicht; eigene Filter-Kennung, Leitung ohne');
// Eine Aufstellung, die den Gegner nicht nennt (oder einen anderen), deckt nichts auf
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('m-0000020', 'mannschaft.aufgestellt', ['konkurrenz' => 'm', 'spiel' => 'ko-1-0', 'mannschaft' => 'm-bbbb', 'gegner' => 'm-aaaa', 'einzel' => ['b1']])]], $mTok['b1'], ['turnier' => $mtid]);
[, $zusch] = rufe($api, 'GET', 'events', null, null, ['turnier' => $mtid, 'ab' => 0]);
pruefe(count($d['angenommen']) === 1 && $anzahlAuf($zusch) === 0, 'Andere Begegnung: nichts aufgedeckt');
[$s, $d] = rufe($api, 'POST', 'events', $aufst('m-0000009', 'm-bbbb', 'm-aaaa', ['b1']), $mTok['b1'], ['turnier' => $mtid]);
pruefe(count($d['angenommen']) === 1, 'Gegner gibt ab');
[, $gegner] = rufe($api, 'GET', 'events', null, $mTok['b1'], ['turnier' => $mtid, 'ab' => 0]);
[, $zusch] = rufe($api, 'GET', 'events', null, null, ['turnier' => $mtid, 'ab' => 0]);
pruefe($anzahlAuf($gegner) === 3 && $anzahlAuf($zusch) === 2 && isset($zusch['filter']), 'Beide nennen sich gegenseitig: aufgedeckt, Filter-Kennung geändert');
[, $kas] = rufe($api, 'GET', 'events', null, $kasseTok, ['turnier' => $mtid, 'ab' => 0]);
[, $leit] = rufe($api, 'GET', 'events', null, $mLeit, ['turnier' => $mtid, 'ab' => 0]);
pruefe($anzahlAuf($kas) === 2 && isset($kas['filter']) && $anzahlAuf($leit) === 3 && !isset($leit['filter']), 'Kasse-Helfer: nach dem Aufdecken sichtbar (Filter-Kennung), Leitung sieht alles ohne Filter');
for ($i = 0; $i < 4; $i++) {
    rufe($api, 'POST', 'events', $aufst('m-00001' . $i . '0', 'm-bbbb', 'm-aaaa', ['b1']), $mTok['b1'], ['turnier' => $mtid]);
}
[$s, $d] = rufe($api, 'POST', 'events', $aufst('m-0000199', 'm-bbbb', 'm-aaaa', ['b1']), $mTok['b1'], ['turnier' => $mtid]);
pruefe($d['angenommen'] === [] && str_contains($d['abgelehnt'][0]['meldung'] ?? '', 'zu oft'), 'Höchstens 5 Abgaben je Mannschaft und Begegnung');
// Spieler mit Helferrecht aus einer der beiden Mannschaften: nur als Führung (sonst Aufdecken ohne Sperre)
[, $d] = rufe($api, 'POST', 'code.helfer', ['turnier' => $mtid, 'bezug' => 'a2', 'helfer' => true], $mLeit);
[, $z] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $mtid, 'code' => $d['code']['code']], null, [], '10.11.0.9');
$mTok['a2'] = $z['token'];
[$s, $d] = rufe($api, 'POST', 'events', $aufst('m-0000201', 'm-aaaa', 'm-bbbb', ['a1', 'a2'], 'ko-1-0'), $mTok['a2'], ['turnier' => $mtid]);
pruefe($d['angenommen'] === [] && str_contains($d['abgelehnt'][0]['meldung'] ?? '', 'Mannschaftsführung'), 'Spieler mit Helferrecht der eigenen Mannschaft: nur als Führung');
[$s, $d] = rufe($api, 'POST', 'events', $aufst('m-0000202', 'm-bbbb', 'm-aaaa', ['b1'], 'ko-2-0'), $mTok['a2'], ['turnier' => $mtid]);
pruefe($d['angenommen'] === [], 'Spieler mit Helferrecht: keine Aufstellung für den Gegner');
[$s, $d] = rufe($api, 'POST', 'events', $aufst('m-0000203', 'm-aaaa', 'm-bbbb', ['a1'], 'frei-1'), $mTok['a1'], ['turnier' => $mtid]);
pruefe($d['angenommen'] === [], 'Erfundene Spiel-ID abgelehnt');
[$s, $d] = rufe($api, 'POST', 'events', ['ereignisse' => [ereignis('m-0000204', 'mannschaft.aufgestellt', ['konkurrenz' => 'm', 'spiel' => 'ko-3-0', 'mannschaft' => 'm-aaaa', 'gegner' => 'm-bbbb', 'einzel' => ['a1'], 'fuell' => str_repeat('x', 100)])]], $mTok['a1'], ['turnier' => $mtid]);
pruefe($d['angenommen'] === [], 'Unbekannte Felder in der Aufstellung abgelehnt');
pruefe(Api::filterKennung(['aufgedeckt:m|g0' => true]) === substr(hash('sha256', 'aufgedeckt:m|g0'), 0, 16), 'Filter-Kennung wie im Kern der Zentrale');

echo "Paket 0.17: Sparten, Rollen, Einladungen, Ausschüsse\n";
$mailer17 = new TestMailer();
$api = neueApi($mailer17);
$zeit = 1_800_000_000;
rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Admin', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Sara Sparte', 'email' => 'sara@example.org', 'passwort' => 'sarasara1', 'bedingungen' => true], null, [], '10.17.0.1');
pruefe($s === 400 && str_contains($d['meldung'], '18'), 'Registrieren ohne „mindestens 18“ abgewiesen');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Sara Sparte', 'email' => 'sara@example.org', 'passwort' => 'sarasara1', 'volljaehrig' => true], null, [], '10.17.0.1');
pruefe($s === 400 && str_contains($d['meldung'], 'Nutzungsbedingungen'), 'Registrieren ohne Zustimmung abgewiesen');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Sara Sparte', 'email' => 'sara@example.org', 'passwort' => 'sarasara1', 'volljaehrig' => true, 'bedingungen' => true, 'verein' => 'TSV Musterdorf', 'sparte' => 'Tischtennis'], null, [], '10.17.0.1');
pruefe($s === 200 && $d['konto']['sparten'][0]['verein'] === 'TSV Musterdorf' && $d['konto']['sparten'][0]['rolle'] === 'spartenleitung' && $d['konto']['bedingungen'] === true, 'Registrieren legt Verein und Sparte an (Spartenleitung)');
$sara = $d['token'];
$sid = $d['konto']['sparten'][0]['id'];
[$s, $d] = rufe($api, 'GET', 'sparte', null, $sara, ['id' => (string)$sid]);
pruefe($s === 200 && $d['sparte']['avv'] !== null && count($d['mitglieder']) === 1, 'Sparte mit AVV-Zeitpunkt, ein Mitglied');

// Turnierkennungen
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Vereinsmeisterschaft', 'datum' => '2027-03-01', 'kennung' => 'vm 2027'], $sara);
pruefe($s === 200 && $d['turnier']['id'] === 'VM2027', 'Wunschkennung (Leerzeichen raus, Großbuchstaben)');
$vm = $d['turnier']['id'];
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Doppelt', 'datum' => null, 'kennung' => 'VM2027'], $sara);
pruefe($s === 409, 'vergebene Wunschkennung abgewiesen');
foreach (['AB', '-ABCD', 'ABCD-', 'A--B', 'SEHR-LANGE-KENNUNG', 'ÄÖÜ1'] as $falsch) {
    [$s] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'X', 'datum' => null, 'kennung' => $falsch], $sara);
    pruefe($s === 400, "ungültige Wunschkennung „{$falsch}“ abgewiesen");
}
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Kreisrangliste', 'datum' => '2027-02-01', 'loeschenNach' => 24], $sara);
pruefe($s === 200 && preg_match('/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/', $d['turnier']['id']) === 1 && preg_match('/[A-Z]/', $d['turnier']['id']) && preg_match('/[0-9]/', $d['turnier']['id']), 'Zufallskennung: 8 Zeichen ohne Verwechsler, Buchstaben und Ziffern');
$kr = $d['turnier']['id'];
$krLeit = $d['token'];
[$s, $d] = rufe($api, 'GET', 'turnier', null, null, ['id' => strtolower($kr)]);
pruefe($s === 200 && $d['turnier']['id'] === $kr && $d['turnier']['veranstalter'] === 'TSV Musterdorf', 'Kennung ohne Groß/klein; Veranstalter = Verein');
[$s, $d] = rufe($api, 'GET', 'turnier.einstellungen', null, $sara, ['id' => $kr]);
pruefe($d['loeschenNach'] === 24 && str_starts_with((string)$d['loeschungAm'], '2029-02-01'), 'Löschfrist 24 Monate nach dem Turniertag');
[$s] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'X', 'datum' => null, 'loeschenNach' => 6], $sara);
pruefe($s === 400, 'nur 12 oder 24 Monate');

// Turnierleitung per Einladung (ganze Sparte, ohne Recht „anlegen“)
[$s, $d] = rufe($api, 'POST', 'sparte.einladen', ['sparte' => $sid, 'email' => 'Tom@Example.org', 'name' => 'Tom Turnier', 'rolle' => 'turnierleitung'], $sara);
pruefe($s === 200 && str_contains($d['link'], '#/einladung/') && $d['gesendet'] === true && $d['einladung']['email'] === 'tom@example.org', 'Einladung mit Link und Mail');
preg_match('~#/einladung/([a-f0-9]{64})~', $d['link'], $ex);
$tomKey = $ex[1];
pruefe(str_contains((string)mailAn($mailer17, 'tom@example.org')?->text, $tomKey), 'Einladungsmail enthält den Link');
[$s, $d] = rufe($api, 'POST', 'einladung.info', ['schluessel' => $tomKey]);
pruefe($s === 200 && $d['einladung']['verein'] === 'TSV Musterdorf' && $d['einladung']['rolle'] === 'turnierleitung' && $d['einladung']['email'] === 'to…@example.org', 'Einladung lesbar, Adresse gekürzt');
[$s] = rufe($api, 'POST', 'einladung.info', ['schluessel' => str_repeat('c', 64)]);
pruefe($s === 410, 'unbekannte Einladung');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Tom', 'email' => 'anders@example.org', 'passwort' => 'tomtom123', 'volljaehrig' => true, 'bedingungen' => true, 'einladung' => $tomKey], null, [], '10.17.0.2');
pruefe($s === 400, 'Registrieren mit Einladung nur mit der eingeladenen Adresse');
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Tom Turnier', 'email' => 'tom@example.org', 'passwort' => 'tomtom123', 'volljaehrig' => true, 'bedingungen' => true, 'einladung' => $tomKey], null, [], '10.17.0.2');
pruefe($s === 200 && count($d['konto']['sparten']) === 1 && $d['konto']['sparten'][0]['id'] === $sid && $d['konto']['sparten'][0]['rolle'] === 'turnierleitung' && $d['konto']['sparten'][0]['anlegen'] === false, 'Mit Einladung: Konto gehört zur Sparte (Turnierleitung), keine eigene Sparte');
$tom = $d['token'];
$tomId = $d['konto']['id'];
[$s] = rufe($api, 'POST', 'einladung.info', ['schluessel' => $tomKey]);
pruefe($s === 410, 'Einladung nur einmal');
[$s, $d] = rufe($api, 'GET', 'turniere', null, $tom);
pruefe($s === 200 && $d['turniere'] === [], 'Turnierleitung ohne Zugang sieht keine Turniere der Sparte');
[$s, $d] = rufe($api, 'GET', 'turnier', null, $tom, ['id' => $kr]);
pruefe($d['turnier']['rechte'] === null, 'und hat dort keine Rechte');
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Toms Turnier', 'datum' => null], $tom);
pruefe($s === 403, 'ohne Recht „Turniere anlegen“ kein neues Turnier');
[$s] = rufe($api, 'GET', 'sparte', null, $tom, ['id' => (string)$sid]);
pruefe($s === 403, 'Mitgliederliste nur für die Spartenleitung');
[$s] = rufe($api, 'POST', 'sparte.einladen', ['sparte' => $sid, 'email' => 'x@example.org', 'name' => 'Xaver', 'rolle' => 'spartenleitung'], $tom);
pruefe($s === 403, 'Turnierleitung kann niemanden in die Sparte einladen');
[$s, $d] = rufe($api, 'POST', 'mitglied.aendern', ['sparte' => $sid, 'konto' => $tomId, 'anlegen' => true], $sara);
pruefe($s === 200 && array_values(array_filter($d['mitglieder'], fn($m) => $m['konto'] === $tomId))[0]['anlegen'] === true, 'Spartenleitung gibt das Recht „Turniere anlegen“');
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Toms Turnier', 'datum' => null], $tom);
pruefe($s === 200, 'Turnierleitung legt mit Recht ein Turnier an');
$toms = $d['turnier']['id'];
[, $d] = rufe($api, 'GET', 'turniere', null, $tom);
pruefe(array_column($d['turniere'], 'id') === [$toms], 'Turnierleitung sieht nur ihr eigenes Turnier');
[, $d] = rufe($api, 'GET', 'turniere', null, $sara);
pruefe(count($d['turniere']) === 3 && in_array($toms, array_column($d['turniere'], 'id'), true), 'Spartenleitung sieht alle Turniere der Sparte');
[, $d] = rufe($api, 'GET', 'turnier', null, $sara, ['id' => $toms]);
pruefe($d['turnier']['rechte'] === 'leitung', 'Spartenleitung leitet auch Turniere der Turnierleitungen');

// Turnier-Einladung: Konto-Zugang zu genau einem Turnier
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Fremd', 'email' => 'fremd17@example.org', 'passwort' => 'fremdfremd', 'volljaehrig' => true, 'bedingungen' => true, 'verein' => 'Anderer Verein'], null, [], '10.17.0.3');
$fremd = $d['token'];
$fremdSparte = $d['konto']['sparten'][0]['id'];
[$s, $d] = rufe($api, 'POST', 'sparte.einladen', ['turnier' => $kr, 'email' => 'fremd17@example.org', 'name' => 'Fremd'], $fremd);
pruefe($s === 403, 'Ohne Leitung des Turniers keine Einladung dazu');
[, $z] = rufe($api, 'POST', 'turnier.zugang', ['turnier' => $kr, 'code' => rufe($api, 'GET', 'codes', null, $sara, ['turnier' => $kr])[1]['codes'][0]['code']]);
[$s] = rufe($api, 'POST', 'sparte.einladen', ['turnier' => $kr, 'email' => 'fremd17@example.org', 'name' => 'Fremd'], $z['token']);
pruefe($s === 401, 'Leitung nur per Kennung (ohne Konto) kann keine Konten einladen');
[$s, $d] = rufe($api, 'POST', 'sparte.einladen', ['turnier' => $kr, 'email' => 'fremd17@example.org', 'name' => 'Fremd'], $sara);
pruefe($s === 200 && count($d['einladungen']) === 1, 'Spartenleitung lädt ein Konto zur Turnierleitung von „Kreisrangliste“ ein');
preg_match('~#/einladung/([a-f0-9]{64})~', $d['link'], $ex);
[$s] = rufe($api, 'POST', 'einladung.annehmen', ['schluessel' => $ex[1]], $tom);
pruefe($s === 403, 'Einladung gilt nur für die eingeladene Adresse');
[$s, $d] = rufe($api, 'POST', 'einladung.annehmen', ['schluessel' => $ex[1]], $fremd);
pruefe($s === 200 && $d['turnier'] === $kr && count($d['sparten']) === 2, 'Einladung angenommen: zweite Sparte, Ziel Turnier');
[, $d] = rufe($api, 'GET', 'turnier', null, $fremd, ['id' => $kr]);
pruefe($d['turnier']['rechte'] === 'leitung', 'Konto-Zugang: leitet das Turnier');
[, $d] = rufe($api, 'GET', 'turnier', null, $fremd, ['id' => $vm]);
pruefe($d['turnier']['rechte'] === null, 'aber keine anderen Turniere der Sparte');
[$s, $d] = rufe($api, 'GET', 'turnier.konten', null, $sara, ['id' => $kr]);
pruefe($s === 200 && count($d['konten']) === 1 && $d['konten'][0]['name'] === 'Fremd', 'Konto-Zugänge des Turniers');
[$s] = rufe($api, 'GET', 'pool', null, $fremd, ['sparte' => (string)$sid]);
pruefe($s === 200, 'Turnierleitung arbeitet mit dem Pool der Sparte');
[$s] = rufe($api, 'GET', 'pool', null, $tom, ['sparte' => (string)$fremdSparte]);
pruefe($s === 403, 'fremder Pool gesperrt');
rufe($api, 'POST', 'pool.speichern', ['spieler' => [['id' => 'p1', 'vorname' => 'Pia', 'nachname' => 'Pool', 'verein' => 'TSV']]], $sara);
[, $d] = rufe($api, 'GET', 'pool', null, $tom);
pruefe(count($d['spieler']) === 1 && $d['spieler'][0]['vorname'] === 'Pia', 'Pool gehört der Sparte (Spartenleitung speichert, Turnierleitung sieht)');
[$s, $d] = rufe($api, 'POST', 'turnier.konto.entfernen', ['turnier' => $kr, 'konto' => array_values(array_filter(rufe($api, 'GET', 'sparte', null, $sara, ['id' => (string)$sid])[1]['mitglieder'], fn($m) => $m['name'] === 'Fremd'))[0]['konto']], $sara);
[, $d2] = rufe($api, 'GET', 'turnier', null, $fremd, ['id' => $kr]);
pruefe($s === 200 && $d['konten'] === [] && $d2['turnier']['rechte'] === null, 'Konto-Zugang entfernt');

// Mitglieder: letzte Spartenleitung bleibt
$saraId = rufe($api, 'GET', 'ich', null, $sara)[1]['konto']['id'];
[$s] = rufe($api, 'POST', 'mitglied.aendern', ['sparte' => $sid, 'konto' => $saraId, 'rolle' => 'turnierleitung'], $sara);
pruefe($s === 409, 'letzte Spartenleitung kann sich nicht herabstufen');
[$s] = rufe($api, 'POST', 'mitglied.entfernen', ['sparte' => $sid, 'konto' => $saraId], $sara);
pruefe($s === 409, 'letzte Spartenleitung kann nicht austreten');

// Ausschüsse
[$s, $d] = rufe($api, 'POST', 'ausschuss.anlegen', ['sparte' => $sid, 'name' => 'Sommerfest'], $tom);
pruefe($s === 403, 'Ausschuss anlegen nur Spartenleitung');
[$s, $d] = rufe($api, 'POST', 'ausschuss.anlegen', ['sparte' => $sid, 'name' => 'Sommerfest'], $sara);
pruefe($s === 200 && $d['ausschuss']['name'] === 'Sommerfest' && count($d['mitglieder']) === 1, 'Ausschuss angelegt, Spartenleitung ist Mitglied');
$aid = $d['ausschuss']['id'];
[$s, $d] = rufe($api, 'POST', 'ausschuss.einladen', ['ausschuss' => $aid, 'email' => 'mia@example.org', 'name' => 'Mia'], $sara);
preg_match('~#/einladung/([a-f0-9]{64})~', $d['link'], $ex);
[$s, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Mia', 'email' => 'mia@example.org', 'passwort' => 'miamia123', 'volljaehrig' => true, 'bedingungen' => true, 'einladung' => $ex[1]], null, [], '10.17.0.4');
pruefe($s === 200 && $d['konto']['sparten'] === [] && $d['konto']['ausschuesse'][0]['id'] === $aid, 'Ausschussmitglied ohne Sparten-Rolle');
$mia = $d['token'];
[$s] = rufe($api, 'GET', 'pool', null, $mia);
pruefe($s === 403, 'Ausschussmitglied hat keinen Zugriff auf den Pool');
[$s, $d] = rufe($api, 'POST', 'ausschuss.nachricht', ['ausschuss' => $aid, 'text' => "Wer bringt Grill mit?\nIch Salat."], $mia);
pruefe($s === 200 && $d['nachrichten'][0]['von'] === 'Mia' && $d['nachrichten'][0]['ich'] === true && str_contains($d['nachrichten'][0]['text'], "\n"), 'Nachricht im Ausschuss (mehrzeilig)');
[$s, $d] = rufe($api, 'POST', 'ausschuss.einladen', ['ausschuss' => $aid, 'email' => 'nils@example.org', 'name' => 'Nils'], $mia);
pruefe($s === 200, 'Mitglied lädt weiteres Mitglied ein');
preg_match('~#/einladung/([a-f0-9]{64})~', $d['link'], $ex);
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Nils', 'email' => 'nils@example.org', 'passwort' => 'nilsnils1', 'volljaehrig' => true, 'bedingungen' => true, 'einladung' => $ex[1]], null, [], '10.17.0.5');
$nils = $d['token'];
$nilsId = $d['konto']['id'];
[$s, $d] = rufe($api, 'GET', 'ausschuss', null, $nils, ['id' => (string)$aid]);
pruefe($s === 200 && count($d['mitglieder']) === 3 && count($d['nachrichten']) === 1 && !isset($d['mitglieder'][0]['email']), 'Mitglieder sehen Namen (ohne E-Mail) und Nachrichten');
[$s] = rufe($api, 'GET', 'ausschuss', null, $tom, ['id' => (string)$aid]);
pruefe($s === 403, 'Nicht-Mitglieder sehen den Ausschuss nicht');
[$s] = rufe($api, 'POST', 'ausschuss.sperren', ['ausschuss' => $aid, 'konto' => $nilsId, 'gesperrt' => true], $nils);
pruefe($s === 400, 'sich selbst sperren geht nicht');
[$s, $d] = rufe($api, 'POST', 'ausschuss.sperren', ['ausschuss' => $aid, 'konto' => $nilsId, 'gesperrt' => true], $mia);
pruefe($s === 200, 'Mitglied sperrt ein anderes Mitglied');
[$s] = rufe($api, 'GET', 'ausschuss', null, $nils, ['id' => (string)$aid]);
[$s2] = rufe($api, 'POST', 'ausschuss.nachricht', ['ausschuss' => $aid, 'text' => 'Hallo?'], $nils);
pruefe($s === 403 && $s2 === 403, 'Gesperrte lesen und schreiben nicht mehr');
[, $d] = rufe($api, 'POST', 'ausschuss.einladen', ['ausschuss' => $aid, 'email' => 'nils@example.org', 'name' => 'Nils'], $mia);
preg_match('~#/einladung/([a-f0-9]{64})~', $d['link'], $ex);
[$s] = rufe($api, 'POST', 'einladung.annehmen', ['schluessel' => $ex[1]], $nils);
pruefe($s === 403, 'Gesperrte heben die Sperre nicht mit einer neuen Einladung auf');
[$s] = rufe($api, 'POST', 'veranstaltung.anlegen', ['sparte' => $sid, 'name' => 'Sommerfest 2027', 'datum' => '2027-07-10', 'ausschuss' => $aid], $sara);
[$s2, $d] = rufe($api, 'GET', 'sparte', null, $sara, ['id' => (string)$sid]);
pruefe($s === 200 && $d['veranstaltungen'][0]['name'] === 'Sommerfest 2027' && $d['veranstaltungen'][0]['ausschuss'] === $aid && $d['ausschuesse'][0]['mitglieder'] === 2, 'Veranstaltung (Platzhalter) mit Ausschuss');
[$s] = rufe($api, 'POST', 'veranstaltung.anlegen', ['sparte' => $fremdSparte, 'name' => 'Fremdfest', 'datum' => null, 'ausschuss' => $aid], $fremd);
pruefe($s === 400, 'Ausschuss einer fremden Sparte nicht verknüpfbar');

echo "Paket 0.17: Jugendturnier, Mail-Sicherung, Löschfristen\n";
rufe($api, 'POST', 'events', ['ereignisse' => [
    ereignis('j-0000001', 'turnier.daten', ['jugend' => true, 'namen' => 'kurz', 'kasse' => ['aussteller' => 'TSV', 'anschrift' => 'Weg 1', 'ust' => 'keiner', 'ustSatz' => 19, 'fusstext' => '', 'empfaenger' => 'TSV Musterdorf', 'iban' => 'DE89370400440532013000', 'bic' => '']]),
]], $krLeit, ['turnier' => $kr]);
// Sparte ist neu: Freigabe durch den Admin nötig
[, $d] = rufe($api, 'POST', 'login', ['email' => 'admin@example.org', 'passwort' => 'geheim123'], null, [], '10.17.0.9');
rufe($api, 'POST', 'sparte.anmeldung', ['id' => $sid, 'anmeldung' => 'frei'], $d['token']);
[$s] = rufe($api, 'POST', 'anmeldung.einstellungen', ['turnier' => $kr, 'offen' => true, 'schluss' => null, 'hinweis' => '', 'angaben' => [], 'ort' => '',
    'konkurrenzen' => [['id' => 'e', 'name' => 'Einzel', 'art' => 'einzel', 'max' => null, 'startgeld' => null]], 'bank' => null], $sara);
pruefe($s === 200, 'Online-Anmeldung eingerichtet');
[$s, $d] = rufe($api, 'GET', 'anmeldung', null, null, ['turnier' => $kr]);
pruefe($s === 200 && $d['jugend'] === true && $d['moeglich'] === false, 'Jugendturnier: Online-Einzelanmeldung geschlossen');
[$s] = rufe($api, 'POST', 'anmeldung.senden', ['turnier' => $kr, 'vorname' => 'Kai', 'nachname' => 'K', 'email' => 'kai@example.org', 'volljaehrig' => true, 'datenschutz' => true, 'konkurrenzen' => [['id' => 'e']]], null, [], '10.17.1.1');
pruefe($s === 410, 'Jugendturnier: Anmeldung abgewiesen');
rufe($api, 'POST', 'turnier.einstellungen', ['turnier' => $kr, 'sicherungAn' => ['sara@example.org'], 'sicherungTakt' => 15], $krLeit);
$zeit += 120;
[$s] = rufe($api, 'POST', 'turnier.sichern', ['turnier' => $kr], $krLeit);
$sm = mailAn($mailer17, 'sara@example.org');
pruefe($s === 200 && $sm !== null && $sm->anhangName !== null && !str_contains((string)$sm->anhangInhalt, 'DE8937') && str_contains((string)$sm->anhangInhalt, 'ohneKontaktdaten')
    && str_contains((string)$sm->anhangInhalt, 'Weg 1'), 'Mail-Sicherung ohne Bankverbindung (Rest bleibt)');

// Turnier ohne Datum, 12 Monate: Erinnerung 30 Tage vorher (mit Sicherung), dann Löschung; Kennung 180 Tage gesperrt
[, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Testturnier', 'datum' => null, 'kennung' => 'TEST-1'], $sara);
$test1 = $d['turnier']['id'];
$saraAnmelden = function () use ($api, &$sara): void {
    [, $d] = rufe($api, 'POST', 'login', ['email' => 'sara@example.org', 'passwort' => 'sarasara1'], null, [], '10.17.0.1');
    $sara = $d['token'] ?? null;
    // Mitglieder bleiben aktiv (sonst würden ihre Konten nach 12 Monaten gelöscht)
    rufe($api, 'POST', 'login', ['email' => 'tom@example.org', 'passwort' => 'tomtom123'], null, [], '10.17.0.2');
    rufe($api, 'POST', 'login', ['email' => 'mia@example.org', 'passwort' => 'miamia123'], null, [], '10.17.0.4');
};
$zeit += 336 * 86400;
$saraAnmelden();
$em = array_values(array_filter($mailer17->mails, fn($m) => $m->an === 'sara@example.org' && str_starts_with($m->betreff, 'Turnier wird gelöscht: Testturnier')))[0] ?? null;
pruefe($em !== null && str_starts_with($em->betreff, 'Turnier wird gelöscht: Testturnier') && $em->anhangName !== null, '30 Tage vorher: Mail an die Leitung mit Sicherung');
[$s] = rufe($api, 'GET', 'turnier', null, null, ['id' => $test1]);
pruefe($s === 200, 'noch nicht gelöscht');
$zeit += 31 * 86400;
$saraAnmelden();
[$s] = rufe($api, 'GET', 'turnier', null, null, ['id' => $test1]);
pruefe($s === 404, 'nach Ablauf automatisch gelöscht');
[$s] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Neu', 'datum' => null, 'kennung' => 'test-1'], $sara);
pruefe($s === 409, 'gelöschte Kennung bleibt gesperrt');
$zeit += 181 * 86400;
$saraAnmelden();
[$s, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Neu', 'datum' => null, 'kennung' => 'test-1'], $sara);
pruefe($s === 200 && $d['turnier']['id'] === 'TEST-1', 'nach 180 Tagen wieder frei');

echo "Paket 0.17: Löschung der Sparte mit dem letzten Spartenleitungs-Konto\n";
$vorher = count($mailer17->mails);
$zeit += 340 * 86400; // Sara lange inaktiv, Tom und Mia melden sich zwischendurch an
rufe($api, 'POST', 'login', ['email' => 'tom@example.org', 'passwort' => 'tomtom123'], null, [], '10.17.0.2');
rufe($api, 'POST', 'login', ['email' => 'mia@example.org', 'passwort' => 'miamia123'], null, [], '10.17.0.4');
$an = array_map(fn($m) => $m->an, array_slice($mailer17->mails, $vorher));
pruefe(in_array('sara@example.org', $an, true) && in_array('tom@example.org', $an, true) && in_array('mia@example.org', $an, true)
    && str_contains((string)array_values(array_filter(array_slice($mailer17->mails, $vorher), fn($m) => $m->an === 'mia@example.org' && str_starts_with($m->betreff, 'Sparte wird gelöscht')))[0]?->text, 'TSV Musterdorf'),
    'Erinnerung an die einzige Spartenleitung und Ankündigung an alle Mitglieder (auch Ausschüsse)');
$zeit += 31 * 86400;
rufe($api, 'GET', 'info');
[$s] = rufe($api, 'GET', 'turnier', null, null, ['id' => $vm]);
pruefe($s === 404, 'Sparte mit Turnieren gelöscht');
[$s] = rufe($api, 'POST', 'login', ['email' => 'sara@example.org', 'passwort' => 'sarasara1']);
pruefe($s === 401, 'Konto der Spartenleitung gelöscht');

echo "Paket 0.17: Sparte löschen, weitere Sparte anlegen\n";
$api = neueApi();
rufe($api, 'POST', 'setup', ['code' => 'einrichtung-123456', 'name' => 'Admin', 'email' => 'admin@example.org', 'passwort' => 'geheim123']);
[, $d] = rufe($api, 'POST', 'registrieren', ['name' => 'Olaf', 'email' => 'olaf@example.org', 'passwort' => 'olafolaf1', 'volljaehrig' => true, 'bedingungen' => true, 'verein' => 'SV Ost'], null, [], '10.17.2.1');
$olaf = $d['token'];
[$s] = rufe($api, 'POST', 'sparte.anlegen', ['verein' => 'SV Ost', 'name' => 'Badminton'], $olaf);
pruefe($s === 400, 'weitere Sparte nur mit Zustimmung zur AVV');
[$s, $d] = rufe($api, 'POST', 'sparte.anlegen', ['verein' => 'SV Ost', 'name' => 'Jugend', 'avv' => true], $olaf);
pruefe($s === 200 && count($d['sparten']) === 2, 'zweite Sparte angelegt');
$zweite = $d['sparte']['id'];
[, $d] = rufe($api, 'POST', 'turnier.anlegen', ['name' => 'Jugendcup', 'datum' => null, 'sparte' => $zweite], $olaf);
$jc = $d['turnier']['id'];
pruefe($d['turnier']['sparte'] === $zweite, 'Turnier in der gewählten Sparte');
[$s] = rufe($api, 'POST', 'sparte.loeschen', ['sparte' => $zweite, 'passwort' => 'falsch'], $olaf);
pruefe($s === 401, 'Sparte löschen nur mit Passwort');
[$s, $d] = rufe($api, 'POST', 'sparte.loeschen', ['sparte' => $zweite, 'passwort' => 'olafolaf1'], $olaf);
[$s2] = rufe($api, 'GET', 'turnier', null, null, ['id' => $jc]);
pruefe($s === 200 && count($d['sparten']) === 1 && $s2 === 404, 'Sparte mit Turnieren gelöscht, erste bleibt');

echo "\n$anzahl Prüfungen, $fehler Fehler\n";
exit($fehler === 0 ? 0 : 1);
