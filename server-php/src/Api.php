<?php
declare(strict_types=1);

namespace TtTurnier;

/**
 * Der schlanke Turnier-Server: nimmt Ereignisse an, vergibt die Reihenfolge,
 * prüft Zugänge und liefert aus. Fachlogik (Auslosung, Tabellen) liegt in der App.
 * Vertrag: shared/protokoll.ts und docs/schnittstelle.md.
 */
final class Api
{
    public const VERSION = '0.2.0';
    public const PROTOKOLL = 1;
    private const MAX_EREIGNISSE = 200;
    private const MAX_DATEN_BYTES = 16384;
    private const SITZUNG_DAUER = 60 * 60 * 24 * 30;      // 30 Tage
    private const VERSUCHE_FENSTER = 15 * 60;             // 15 Minuten
    private const VERSUCHE_MAX = 10;
    private const TURNIER_ID_ZEICHEN = 'abcdefghijkmnpqrstuvwxyz23456789';

    /** @var callable():int */
    private $uhr;

    /**
     * @param array{setup_code?:string} $config
     * @param callable():int|null $uhr
     */
    public function __construct(
        private readonly Datenbank $db,
        private readonly array $config,
        ?callable $uhr = null,
    ) {
        $this->uhr = $uhr ?? static fn(): int => time();
    }

    private function jetzt(): int
    {
        return ($this->uhr)();
    }

    private static function iso(?int $ts): ?string
    {
        return $ts === null ? null : gmdate('Y-m-d\TH:i:s\Z', $ts);
    }

    public function bearbeiten(Anfrage $a): Antwort
    {
        try {
            $this->db->migrieren();
            if (is_array($a->rumpf) && isset($a->rumpf['__ungueltig'])) {
                throw new ApiFehler('ungueltig', 'Der Inhalt der Anfrage ist kein gültiges JSON.');
            }
            $schluessel = $a->methode . ' ' . $a->route;
            $daten = match ($schluessel) {
                'GET info' => $this->info(),
                'POST setup' => $this->setup($a),
                'POST login' => $this->login($a),
                'POST logout' => $this->logout($a),
                'GET ich' => $this->ich($a),
                'POST passwort.aendern' => $this->passwortAendern($a),
                'GET konten' => $this->konten($a),
                'POST konto.anlegen' => $this->kontoAnlegen($a),
                'POST konto.sperren' => $this->kontoSperren($a),
                'GET turniere' => $this->turniere($a),
                'POST turnier.anlegen' => $this->turnierAnlegen($a),
                'GET turnier' => $this->turnier($a),
                'POST turnier.zugang' => $this->turnierZugang($a),
                'GET events' => $this->abholen($a),
                'POST events' => $this->senden($a),
                default => throw new ApiFehler('nicht_gefunden', 'Unbekannte Route: ' . $schluessel),
            };
            return new Antwort(200, $daten);
        } catch (ApiFehler $f) {
            return new Antwort($f->status(), ['fehler' => $f->code_, 'meldung' => $f->getMessage()]);
        } catch (\Throwable $t) {
            error_log('tt-turnier: ' . $t);
            return new Antwort(500, ['fehler' => 'serverfehler', 'meldung' => 'Interner Fehler auf dem Server.']);
        }
    }

    /* ---------------- Hilfen ---------------- */

    private function text(Anfrage $a, string $feld, int $min = 1, int $max = 190): string
    {
        $wert = $a->rumpf[$feld] ?? null;
        if (!is_string($wert)) {
            throw new ApiFehler('ungueltig', "Feld „{$feld}“ fehlt.");
        }
        $wert = trim($wert);
        $laenge = mb_strlen($wert);
        if ($laenge < $min || $laenge > $max) {
            throw new ApiFehler('ungueltig', "Feld „{$feld}“ muss {$min} bis {$max} Zeichen lang sein.");
        }
        return $wert;
    }

    private function email(Anfrage $a): string
    {
        $email = mb_strtolower($this->text($a, 'email', 3, 190));
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new ApiFehler('ungueltig', 'Die E-Mail-Adresse ist ungültig.');
        }
        return $email;
    }

    private function passwortFeld(Anfrage $a, string $feld = 'passwort', int $min = 8): string
    {
        $pw = $a->rumpf[$feld] ?? null;
        if (!is_string($pw) || strlen($pw) < $min || strlen($pw) > 200) {
            throw new ApiFehler('ungueltig', "Das Passwort muss mindestens {$min} Zeichen haben.");
        }
        return $pw;
    }

    private function bremse(string $schluessel): void
    {
        $grenze = $this->jetzt() - self::VERSUCHE_FENSTER;
        $this->db->ausfuehren('DELETE FROM versuche WHERE zeit < ?', [$grenze]);
        $anzahl = (int)($this->db->eine('SELECT COUNT(*) AS n FROM versuche WHERE schluessel = ? AND zeit >= ?', [$schluessel, $grenze])['n'] ?? 0);
        if ($anzahl >= self::VERSUCHE_MAX) {
            throw new ApiFehler('zu_viele_versuche', 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
        }
    }

    private function fehlversuch(string $schluessel): void
    {
        $this->db->ausfuehren('INSERT INTO versuche (schluessel, zeit) VALUES (?, ?)', [$schluessel, $this->jetzt()]);
    }

    private function versucheLoeschen(string $schluessel): void
    {
        $this->db->ausfuehren('DELETE FROM versuche WHERE schluessel = ?', [$schluessel]);
    }

    private function neuesToken(?int $kontoId, ?string $turnierId, string $rolle, string $name): string
    {
        $token = bin2hex(random_bytes(32));
        $this->db->ausfuehren(
            'INSERT INTO sitzungen (token_hash, konto_id, turnier_id, rolle, name, ablauf) VALUES (?, ?, ?, ?, ?, ?)',
            [hash('sha256', $token), $kontoId, $turnierId, $rolle, $name, $this->jetzt() + self::SITZUNG_DAUER]
        );
        return $token;
    }

    /** @return array{konto_id:?int,turnier_id:?string,rolle:string,name:string}|null */
    private function sitzung(Anfrage $a): ?array
    {
        if ($a->token === null || !preg_match('/^[a-f0-9]{64}$/', $a->token)) {
            return null;
        }
        $s = $this->db->eine('SELECT * FROM sitzungen WHERE token_hash = ?', [hash('sha256', $a->token)]);
        if ($s === null || (int)$s['ablauf'] < $this->jetzt()) {
            return null;
        }
        if ($s['konto_id'] !== null) {
            $k = $this->db->eine('SELECT gesperrt FROM konten WHERE id = ?', [(int)$s['konto_id']]);
            if ($k === null || (int)$k['gesperrt'] === 1) {
                throw new ApiFehler('gesperrt', 'Dieses Konto ist gesperrt.');
            }
        }
        return [
            'konto_id' => $s['konto_id'] === null ? null : (int)$s['konto_id'],
            'turnier_id' => $s['turnier_id'],
            'rolle' => (string)$s['rolle'],
            'name' => (string)$s['name'],
        ];
    }

    /** @return array{konto_id:int,turnier_id:?string,rolle:string,name:string} */
    private function konto(Anfrage $a, bool $nurAdmin = false): array
    {
        $s = $this->sitzung($a);
        if ($s === null || $s['konto_id'] === null) {
            throw new ApiFehler('nicht_angemeldet', 'Bitte zuerst anmelden.');
        }
        if ($nurAdmin && $s['rolle'] !== 'admin') {
            throw new ApiFehler('keine_berechtigung', 'Nur für den Administrator.');
        }
        return $s;
    }

    private function eingerichtet(): bool
    {
        return $this->db->eine("SELECT id FROM konten WHERE rolle = 'admin' LIMIT 1") !== null;
    }

    /** @param array<string,mixed> $z */
    private static function kontoAusgabe(array $z): array
    {
        $k = [
            'id' => (int)$z['id'],
            'name' => (string)$z['name'],
            'email' => (string)$z['email'],
            'rolle' => (string)$z['rolle'],
            'gesperrt' => (int)$z['gesperrt'] === 1,
            'angelegt' => self::iso((int)$z['angelegt']),
            'letzteAnmeldung' => self::iso($z['letzte_anmeldung'] === null ? null : (int)$z['letzte_anmeldung']),
        ];
        if (array_key_exists('turniere', $z)) {
            $k['turniere'] = (int)$z['turniere'];
        }
        return $k;
    }

    /** @param array<string,mixed> $z */
    private static function turnierAusgabe(array $z): array
    {
        return [
            'id' => (string)$z['id'],
            'name' => (string)$z['name'],
            'datum' => $z['datum'] === null ? null : (string)$z['datum'],
            'angelegt' => self::iso((int)$z['angelegt']),
            'veranstalter' => (string)($z['veranstalter'] ?? ''),
        ];
    }

    private function turnierLaden(string $id): array
    {
        if (!preg_match('/^[a-z0-9]{6,16}$/', $id)) {
            throw new ApiFehler('nicht_gefunden', 'Turnier nicht gefunden.');
        }
        $t = $this->db->eine(
            'SELECT t.*, k.name AS veranstalter FROM turniere t JOIN konten k ON k.id = t.konto_id WHERE t.id = ?',
            [$id]
        );
        if ($t === null) {
            throw new ApiFehler('nicht_gefunden', 'Turnier nicht gefunden.');
        }
        return $t;
    }

    private function neueTurnierId(): string
    {
        $zeichen = self::TURNIER_ID_ZEICHEN;
        do {
            $id = '';
            for ($i = 0; $i < 10; $i++) {
                $id .= $zeichen[random_int(0, strlen($zeichen) - 1)];
            }
        } while ($this->db->eine('SELECT id FROM turniere WHERE id = ?', [$id]) !== null);
        return $id;
    }

    /* ---------------- Endpunkte ---------------- */

    private function info(): array
    {
        return [
            'app' => 'tt-turnier',
            'protokoll' => self::PROTOKOLL,
            'version' => self::VERSION,
            'eingerichtet' => $this->eingerichtet(),
            'zeit' => self::iso($this->jetzt()),
        ];
    }

    private function setup(Anfrage $a): array
    {
        $schluessel = 'setup|' . $a->ip;
        $this->bremse($schluessel);
        if ($this->eingerichtet()) {
            throw new ApiFehler('konflikt', 'Der Server ist bereits eingerichtet.');
        }
        $soll = (string)($this->config['setup_code'] ?? '');
        if (strlen($soll) < 12) {
            throw new ApiFehler('nicht_eingerichtet', 'Auf dem Server ist kein Einrichtungscode (mind. 12 Zeichen) hinterlegt.');
        }
        $code = $a->rumpf['code'] ?? '';
        if (!is_string($code) || !hash_equals($soll, trim($code))) {
            $this->fehlversuch($schluessel);
            throw new ApiFehler('falsche_zugangsdaten', 'Der Einrichtungscode ist falsch.');
        }
        $name = $this->text($a, 'name', 2, 120);
        $email = $this->email($a);
        $pw = $this->passwortFeld($a);
        $this->db->ausfuehren(
            'INSERT INTO konten (name, email, passwort_hash, rolle, gesperrt, angelegt) VALUES (?, ?, ?, ?, 0, ?)',
            [$name, $email, password_hash($pw, PASSWORD_DEFAULT), 'admin', $this->jetzt()]
        );
        $this->versucheLoeschen($schluessel);
        return ['ok' => true];
    }

    private function login(Anfrage $a): array
    {
        if (!$this->eingerichtet()) {
            throw new ApiFehler('nicht_eingerichtet', 'Der Server ist noch nicht eingerichtet.');
        }
        $email = mb_strtolower(trim((string)($a->rumpf['email'] ?? '')));
        $pw = (string)($a->rumpf['passwort'] ?? '');
        $schluessel = 'login|' . $a->ip;
        $this->bremse($schluessel);
        $k = $this->db->eine('SELECT * FROM konten WHERE email = ?', [$email]);
        if ($k === null || !password_verify($pw, (string)$k['passwort_hash'])) {
            $this->fehlversuch($schluessel);
            throw new ApiFehler('falsche_zugangsdaten', 'E-Mail oder Passwort ist falsch.');
        }
        if ((int)$k['gesperrt'] === 1) {
            throw new ApiFehler('gesperrt', 'Dieses Konto ist gesperrt. Bitte an den Administrator wenden.');
        }
        $this->versucheLoeschen($schluessel);
        if (password_needs_rehash((string)$k['passwort_hash'], PASSWORD_DEFAULT)) {
            $this->db->ausfuehren('UPDATE konten SET passwort_hash = ? WHERE id = ?', [password_hash($pw, PASSWORD_DEFAULT), (int)$k['id']]);
        }
        $this->db->ausfuehren('UPDATE konten SET letzte_anmeldung = ? WHERE id = ?', [$this->jetzt(), (int)$k['id']]);
        $k['letzte_anmeldung'] = $this->jetzt();
        $token = $this->neuesToken((int)$k['id'], null, (string)$k['rolle'], (string)$k['name']);
        return ['token' => $token, 'konto' => self::kontoAusgabe($k)];
    }

    private function logout(Anfrage $a): array
    {
        if ($a->token !== null) {
            $this->db->ausfuehren('DELETE FROM sitzungen WHERE token_hash = ?', [hash('sha256', $a->token)]);
        }
        return ['ok' => true];
    }

    private function ich(Anfrage $a): array
    {
        $s = $this->sitzung($a);
        if ($s === null) {
            throw new ApiFehler('nicht_angemeldet', 'Nicht angemeldet.');
        }
        $antwort = ['rolle' => $s['rolle'], 'name' => $s['name'], 'turnier' => $s['turnier_id']];
        if ($s['konto_id'] !== null) {
            $k = $this->db->eine('SELECT * FROM konten WHERE id = ?', [$s['konto_id']]);
            $antwort['konto'] = $k === null ? null : self::kontoAusgabe($k);
        }
        return $antwort;
    }

    private function passwortAendern(Anfrage $a): array
    {
        $s = $this->konto($a);
        $k = $this->db->eine('SELECT * FROM konten WHERE id = ?', [$s['konto_id']]);
        $alt = (string)($a->rumpf['alt'] ?? '');
        if ($k === null || !password_verify($alt, (string)$k['passwort_hash'])) {
            throw new ApiFehler('falsche_zugangsdaten', 'Das bisherige Passwort ist falsch.');
        }
        $neu = $this->passwortFeld($a, 'neu');
        $this->db->ausfuehren('UPDATE konten SET passwort_hash = ? WHERE id = ?', [password_hash($neu, PASSWORD_DEFAULT), $s['konto_id']]);
        // Alle anderen Sitzungen dieses Kontos beenden
        $this->db->ausfuehren('DELETE FROM sitzungen WHERE konto_id = ? AND token_hash <> ?', [$s['konto_id'], hash('sha256', (string)$a->token)]);
        return ['ok' => true];
    }

    private function konten(Anfrage $a): array
    {
        $this->konto($a, true);
        $zeilen = $this->db->alle(
            'SELECT k.*, (SELECT COUNT(*) FROM turniere t WHERE t.konto_id = k.id) AS turniere
             FROM konten k ORDER BY k.rolle, k.name'
        );
        return ['konten' => array_map([self::class, 'kontoAusgabe'], $zeilen)];
    }

    private function kontoAnlegen(Anfrage $a): array
    {
        $this->konto($a, true);
        $name = $this->text($a, 'name', 2, 120);
        $email = $this->email($a);
        $pw = $this->passwortFeld($a);
        try {
            $this->db->ausfuehren(
                'INSERT INTO konten (name, email, passwort_hash, rolle, gesperrt, angelegt) VALUES (?, ?, ?, ?, 0, ?)',
                [$name, $email, password_hash($pw, PASSWORD_DEFAULT), 'veranstalter', $this->jetzt()]
            );
        } catch (\PDOException $e) {
            if (Datenbank::istEindeutigkeitsFehler($e)) {
                throw new ApiFehler('konflikt', 'Diese E-Mail-Adresse ist bereits vergeben.');
            }
            throw $e;
        }
        $k = $this->db->eine('SELECT * FROM konten WHERE email = ?', [$email]);
        return ['konto' => self::kontoAusgabe($k)];
    }

    private function kontoSperren(Anfrage $a): array
    {
        $s = $this->konto($a, true);
        $id = $a->rumpf['id'] ?? null;
        $gesperrt = $a->rumpf['gesperrt'] ?? null;
        if (!is_int($id) || !is_bool($gesperrt)) {
            throw new ApiFehler('ungueltig', 'Felder „id“ und „gesperrt“ erforderlich.');
        }
        if ($id === $s['konto_id']) {
            throw new ApiFehler('ungueltig', 'Das eigene Konto kann nicht gesperrt werden.');
        }
        $k = $this->db->eine('SELECT * FROM konten WHERE id = ?', [$id]);
        if ($k === null) {
            throw new ApiFehler('nicht_gefunden', 'Konto nicht gefunden.');
        }
        $this->db->ausfuehren('UPDATE konten SET gesperrt = ? WHERE id = ?', [$gesperrt ? 1 : 0, $id]);
        if ($gesperrt) {
            $this->db->ausfuehren('DELETE FROM sitzungen WHERE konto_id = ?', [$id]);
        }
        $k['gesperrt'] = $gesperrt ? 1 : 0;
        return ['konto' => self::kontoAusgabe($k)];
    }

    private function turniere(Anfrage $a): array
    {
        $s = $this->konto($a);
        if ($s['rolle'] === 'admin' && ($a->query['alle'] ?? '') === '1') {
            $zeilen = $this->db->alle('SELECT t.*, k.name AS veranstalter FROM turniere t JOIN konten k ON k.id = t.konto_id ORDER BY t.angelegt DESC');
        } else {
            $zeilen = $this->db->alle(
                'SELECT t.*, k.name AS veranstalter FROM turniere t JOIN konten k ON k.id = t.konto_id WHERE t.konto_id = ? ORDER BY t.angelegt DESC',
                [$s['konto_id']]
            );
        }
        return ['turniere' => array_map([self::class, 'turnierAusgabe'], $zeilen)];
    }

    private function turnierAnlegen(Anfrage $a): array
    {
        $s = $this->konto($a);
        $name = $this->text($a, 'name', 2, 160);
        $datum = $a->rumpf['datum'] ?? null;
        if ($datum !== null && (!is_string($datum) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum))) {
            throw new ApiFehler('ungueltig', 'Datum im Format JJJJ-MM-TT angeben.');
        }
        $pw = $this->passwortFeld($a, 'leitungsPasswort', 6);
        $id = $this->neueTurnierId();
        $this->db->ausfuehren(
            'INSERT INTO turniere (id, konto_id, name, datum, leitung_hash, angelegt) VALUES (?, ?, ?, ?, ?, ?)',
            [$id, $s['konto_id'], $name, $datum, password_hash($pw, PASSWORD_DEFAULT), $this->jetzt()]
        );
        $token = $this->neuesToken($s['konto_id'], $id, 'leitung', $s['name']);
        return ['turnier' => self::turnierAusgabe($this->turnierLaden($id)), 'token' => $token];
    }

    private function turnier(Anfrage $a): array
    {
        return ['turnier' => self::turnierAusgabe($this->turnierLaden((string)($a->query['id'] ?? '')))];
    }

    private function turnierZugang(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $schluessel = 'zugang|' . $t['id'] . '|' . $a->ip;
        $this->bremse($schluessel);
        $pw = (string)($a->rumpf['passwort'] ?? '');
        if (!password_verify($pw, (string)$t['leitung_hash'])) {
            $this->fehlversuch($schluessel);
            throw new ApiFehler('falsche_zugangsdaten', 'Das Leitungspasswort ist falsch.');
        }
        $this->versucheLoeschen($schluessel);
        $name = $this->text($a, 'name', 1, 120);
        return ['token' => $this->neuesToken(null, (string)$t['id'], 'leitung', $name), 'rolle' => 'leitung'];
    }

    private function abholen(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->query['turnier'] ?? ''));
        $ab = (int)($a->query['ab'] ?? 0);
        $zeilen = $this->db->alle(
            'SELECT * FROM ereignisse WHERE turnier_id = ? AND seq > ? ORDER BY seq LIMIT ' . (self::MAX_EREIGNISSE + 1),
            [$t['id'], $ab]
        );
        $mehr = count($zeilen) > self::MAX_EREIGNISSE;
        if ($mehr) {
            array_pop($zeilen);
        }
        $hoechste = (int)($this->db->eine('SELECT MAX(seq) AS m FROM ereignisse WHERE turnier_id = ?', [$t['id']])['m'] ?? 0);
        return [
            'ereignisse' => array_map(static fn(array $z): array => [
                'seq' => (int)$z['seq'],
                'id' => (string)$z['event_id'],
                'art' => (string)$z['art'],
                'daten' => json_decode((string)$z['daten'], false),
                'zeit' => (string)$z['zeit'],
                'geraet' => (string)$z['geraet'],
                'empfangen' => self::iso((int)$z['empfangen']),
                'autor' => ['rolle' => (string)$z['autor_rolle'], 'name' => (string)$z['autor_name']],
            ], $zeilen),
            'hoechsteSeq' => $hoechste,
            'mehr' => $mehr,
        ];
    }

    private function senden(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->query['turnier'] ?? ''));
        $s = $this->sitzung($a);
        if ($s === null) {
            throw new ApiFehler('nicht_angemeldet', 'Zum Eintragen bitte anmelden.');
        }
        $darf = ($s['turnier_id'] === $t['id'] && in_array($s['rolle'], ['leitung', 'helfer', 'spieler'], true))
            || ($s['konto_id'] !== null && $s['konto_id'] === (int)$t['konto_id']);
        if (!$darf) {
            throw new ApiFehler('keine_berechtigung', 'Keine Berechtigung für dieses Turnier.');
        }
        $liste = $a->rumpf['ereignisse'] ?? null;
        if (!is_array($liste) || !array_is_list($liste) || count($liste) > self::MAX_EREIGNISSE) {
            throw new ApiFehler('ungueltig', 'Feld „ereignisse“ muss eine Liste mit höchstens ' . self::MAX_EREIGNISSE . ' Einträgen sein.');
        }
        $rolle = $s['rolle'] === 'admin' || $s['rolle'] === 'veranstalter' ? 'leitung' : $s['rolle'];

        $angenommen = [];
        $this->db->pdo->beginTransaction();
        try {
            // Schreibvorgänge je Turnier nacheinander: so werden Laufnummern in genau der
            // Reihenfolge sichtbar, in der sie vergeben wurden. Sonst könnte ein Gerät, das
            // gerade abholt, eine kleinere Laufnummer überspringen. (SQLite sperrt ohnehin.)
            if ($this->db->treiber === 'mysql') {
                $this->db->eine('SELECT id FROM turniere WHERE id = ? FOR UPDATE', [$t['id']]);
            }
            foreach ($liste as $e) {
                $e = $e instanceof \stdClass ? get_object_vars($e) : $e;
                $seq = $this->einEreignis($t['id'], $e, $rolle, $s['name']);
                $angenommen[] = ['id' => (string)$e['id'], 'seq' => $seq];
            }
            $this->db->pdo->commit();
        } catch (\Throwable $x) {
            $this->db->pdo->rollBack();
            throw $x;
        }
        $hoechste = (int)($this->db->eine('SELECT MAX(seq) AS m FROM ereignisse WHERE turnier_id = ?', [$t['id']])['m'] ?? 0);
        return ['angenommen' => $angenommen, 'hoechsteSeq' => $hoechste];
    }

    private function einEreignis(string $turnierId, mixed $e, string $rolle, string $name): int
    {
        if ($e instanceof \stdClass) {
            $e = get_object_vars($e);
        }
        if (!is_array($e)) {
            throw new ApiFehler('ungueltig', 'Ereignis muss ein Objekt sein.');
        }
        $id = $e['id'] ?? null;
        $art = $e['art'] ?? null;
        $zeit = $e['zeit'] ?? null;
        $geraet = $e['geraet'] ?? null;
        $daten = $e['daten'] ?? null;
        if (!is_string($id) || !preg_match('/^[A-Za-z0-9-]{8,64}$/', $id)) {
            throw new ApiFehler('ungueltig', 'Ereignis-ID ungültig.');
        }
        if (!is_string($art) || !preg_match('/^[a-z][a-z0-9_.]{1,63}$/', $art)) {
            throw new ApiFehler('ungueltig', 'Ereignis-Art ungültig.');
        }
        if (!is_string($zeit) || strlen($zeit) > 40 || strtotime($zeit) === false) {
            throw new ApiFehler('ungueltig', 'Ereignis-Zeit ungültig.');
        }
        if (!is_string($geraet) || !preg_match('/^[A-Za-z0-9-]{4,64}$/', $geraet)) {
            throw new ApiFehler('ungueltig', 'Geräte-Kennung ungültig.');
        }
        if (is_array($daten) && !array_is_list($daten)) {
            $daten = (object)$daten; // Aufruf aus Tests mit assoziativem Array
        }
        if (!$daten instanceof \stdClass) {
            throw new ApiFehler('ungueltig', 'Ereignis-Daten müssen ein Objekt sein.');
        }
        $json = json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false || strlen($json) > self::MAX_DATEN_BYTES) {
            throw new ApiFehler('ungueltig', 'Ereignis-Daten sind zu groß.');
        }

        $vorhanden = $this->db->eine('SELECT seq FROM ereignisse WHERE turnier_id = ? AND event_id = ?', [$turnierId, $id]);
        if ($vorhanden !== null) {
            return (int)$vorhanden['seq'];
        }
        $this->db->ausfuehren(
            'INSERT INTO ereignisse (turnier_id, event_id, art, daten, zeit, geraet, autor_rolle, autor_name, empfangen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$turnierId, $id, $art, $json, $zeit, $geraet, $rolle, $name, $this->jetzt()]
        );
        return (int)$this->db->pdo->lastInsertId();
    }
}
