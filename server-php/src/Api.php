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
    public const VERSION = '0.7.0';
    public const PROTOKOLL = 1;
    private const MAX_EREIGNISSE = 200;
    private const MAX_JE_TURNIER = 50000;
    private const MAX_DATEN_BYTES = 16384;
    private const SITZUNG_DAUER = 60 * 60 * 24 * 30;      // 30 Tage
    private const VERSUCHE_FENSTER = 15 * 60;             // 15 Minuten
    private const VERSUCHE_MAX = 10;
    /** Turnierkennung: 8 Ziffern (ab 0.6); ältere Kennungen (10 Zeichen) bleiben gültig */
    private const TURNIER_ID_MUSTER = '/^([0-9]{8}|[a-z0-9]{6,16})$/';
    /** Unbekannte Turnierkennungen je Anschluss und Viertelstunde, bevor gebremst wird (gegen Durchprobieren) */
    private const SUCHE_MAX = 30;
    /** Fehlversuche je Turnier (über alle Anschlüsse) in 15 Minuten, danach werden nur noch richtige Kennungen angenommen */
    private const ZUGANG_TURNIER_MAX = 200;
    /** Ab so vielen Fehlversuchen je Anschluss und Turnier wird jede weitere Anmeldung verzögert (statt alle auszusperren) */
    private const ZUGANG_VERZOEGERN_AB = 5;
    private const CODE_ROLLEN = ['leitung', 'helfer', 'spieler'];
    private const MAX_KLASSEN = 40;
    private const TAG = 86400;
    private const KONTO_LOESCHEN_NACH = 365 * self::TAG;   // shared/protokoll.ts KONTO_LOESCHEN_NACH_TAGEN
    private const KONTO_ERINNERUNG_VORHER = 30 * self::TAG;
    private const RUECKSTELLUNG_DAUER = 3600;              // Link „Passwort zurücksetzen“: 1 Stunde
    private const SICHERUNG_TAKTE = [0, 15, 30, 60, -1];   // Minuten; 0 = aus, -1 = nur beim Abschluss
    private const SICHERUNG_MAX_EMPFAENGER = 3;
    private const ART_ABGESCHLOSSEN = 'turnier.abgeschlossen';
    /** shared/protokoll.ts ARTEN_SPIELER / ARTEN_HELFER */
    private const ARTEN_SPIELER = ['spiel.ergebnis', 'spiel.bestaetigt', 'spiel.angefochten'];
    private const ARTEN_HELFER = ['spiel.ergebnis', 'spiel.aufgerufen', 'spiel.aufruf_zurueck'];
    private const MAX_CODES = 400;
    private const MAX_POOL = 3000;
    private const MAX_UEBERSICHT = 60000;
    private const MAX_SICHERUNG_BYTES = 6 * 1024 * 1024;

    /** @var callable():int */
    private $uhr;
    /** Anschluss der laufenden Anfrage (für Bremsen) */
    private string $ip = '';
    private readonly Mailer $mailer;

    /**
     * @param array{setup_code?:string,app_url?:string,mail?:array{absender?:string,admin?:string},ohne_warten?:bool} $config
     * @param callable():int|null $uhr
     */
    public function __construct(
        private readonly Datenbank $db,
        private readonly array $config,
        ?callable $uhr = null,
        ?Mailer $mailer = null,
    ) {
        $this->uhr = $uhr ?? static fn(): int => time();
        $this->mailer = $mailer ?? new KeinMailer();
    }

    /** Adresse der App mit abschließendem „/“, z. B. https://saschaurban.de/tt-turnier/ */
    private function appUrl(): string
    {
        $u = trim((string)($this->config['app_url'] ?? ''));
        return $u === '' ? '' : rtrim($u, '/') . '/';
    }

    private function adminMail(): string
    {
        return trim((string)($this->config['mail']['admin'] ?? ''));
    }

    /** Mails mit Links sind nur sinnvoll, wenn Versand und Adresse der App eingerichtet sind. */
    private function mailBereit(): bool
    {
        return $this->mailer->bereit() && $this->appUrl() !== '';
    }

    /** System-Mail an eine Person. Antworten gehen an den Administrator. Scheitert still (protokolliert). */
    private function mail(string $an, string $betreff, string $text, ?string $anhangName = null, ?string $anhang = null): bool
    {
        $fuss = "\n\n-- \nTischtennis-Turnier · " . $this->appUrl()
            . "\nDiese Mail wurde automatisch versendet. Antworten erreichen den Betreiber.";
        $ok = $this->mailer->senden(new Mail($an, $betreff, $text . $fuss, $this->adminMail() ?: null, $anhangName, $anhang));
        if (!$ok) {
            error_log("tt-turnier: Mail an {$an} konnte nicht gesendet werden ({$betreff})");
        }
        return $ok;
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
            $this->ip = $a->ip;
            $this->db->migrieren();
            $this->wartung();
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
                'POST registrieren' => $this->registrieren($a),
                'POST passwort.vergessen' => $this->passwortVergessen($a),
                'POST passwort.zuruecksetzen' => $this->passwortZuruecksetzen($a),
                'POST konto.loeschen' => $this->kontoLoeschen($a),
                'POST turnier.loeschen' => $this->turnierLoeschen($a),
                'POST rueckmeldung' => $this->rueckmeldung($a),
                'GET konten' => $this->konten($a),
                'POST konto.anlegen' => $this->kontoAnlegen($a),
                'POST konto.sperren' => $this->kontoSperren($a),
                'GET turniere' => $this->turniere($a),
                'POST turnier.anlegen' => $this->turnierAnlegen($a),
                'GET turnier' => $this->turnier($a),
                'POST turnier.zugang' => $this->turnierZugang($a),
                'GET turnier.einstellungen' => $this->einstellungen($this->turnierLaden((string)($a->query['id'] ?? '')), $a),
                'POST turnier.einstellungen' => $this->einstellungenSetzen($a),
                'POST turnier.sichern' => $this->sichernJetzt($a),
                'GET codes' => $this->codes($a),
                'POST codes.anlegen' => $this->codesAnlegen($a),
                'POST code.neu' => $this->codeNeu($a),
                'POST code.sperren' => $this->codeSperren($a),
                'POST code.entfernen' => $this->codeEntfernen($a),
                'POST code.helfer' => $this->codeHelfer($a),
                'GET konto.einstellungen' => $this->kontoEinstellungen($a),
                'POST konto.einstellungen' => $this->kontoEinstellungenSetzen($a),
                'GET pool' => $this->pool($a),
                'POST pool.speichern' => $this->poolSpeichern($a),
                'POST pool.loeschen' => $this->poolLoeschen($a),
                'POST turnier.uebersicht' => $this->uebersichtSetzen($a),
                'GET events' => $this->abholen($a),
                'POST events' => $this->senden($a),
                'POST zentrale.uebernehmen' => $this->zentraleUebernehmen($a),
                'POST zentrale.rueckgabe' => $this->zentraleRueckgabe($a),
                'POST zentrale.freigeben' => $this->zentraleFreigeben($a),
                'POST sicherung.senden' => $this->sicherungVonZentrale($a),
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
        if ($this->anzahlVersuche($schluessel, self::VERSUCHE_FENSTER) >= self::VERSUCHE_MAX) {
            throw new ApiFehler('zu_viele_versuche', 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
        }
    }

    private function anzahlVersuche(string $schluessel, int $fenster): int
    {
        $grenze = $this->jetzt() - $fenster;
        return (int)($this->db->eine('SELECT COUNT(*) AS n FROM versuche WHERE schluessel = ? AND zeit >= ?', [$schluessel, $grenze])['n'] ?? 0);
    }

    /** Höchstens $max Vorgänge je Fenster (z. B. neue Konten je IP und Stunde); zählt diesen Vorgang mit. */
    private function begrenzen(string $schluessel, int $max, int $fenster, string $meldung): void
    {
        if ($this->anzahlVersuche($schluessel, $fenster) >= $max) {
            throw new ApiFehler('zu_viele_versuche', $meldung);
        }
        $this->fehlversuch($schluessel);
    }

    /** Fangfeld für Bots: echte Nutzer sehen das Feld nicht und lassen es leer. */
    private function fangfeld(Anfrage $a): void
    {
        $w = $a->rumpf['website'] ?? '';
        if (!is_string($w) || trim($w) !== '') {
            throw new ApiFehler('ungueltig', 'Die Anfrage wurde abgelehnt.');
        }
    }

    /** Kennung: 8 Ziffern, nicht alle gleich, keine Ziffernfolge (12345678, 87654321) */
    private static function codeGueltig(string $code): bool
    {
        if (!preg_match('/^[0-9]{8}$/', $code)) {
            return false;
        }
        if (count(array_unique(str_split($code))) === 1) {
            return false; // 00000000, 11111111 …
        }
        $auf = $ab = true;
        for ($i = 1; $i < 8; $i++) {
            $auf = $auf && (int)$code[$i] === ((int)$code[$i - 1] + 1) % 10;
            $ab = $ab && (int)$code[$i] === ((int)$code[$i - 1] + 9) % 10;
        }
        return !$auf && !$ab; // 12345678, 87654321 …
    }

    /** @return list<string> */
    private function empfaengerFeld(mixed $liste): array
    {
        if (!is_array($liste) || !array_is_list($liste) || count($liste) > self::SICHERUNG_MAX_EMPFAENGER) {
            throw new ApiFehler('ungueltig', 'Höchstens ' . self::SICHERUNG_MAX_EMPFAENGER . ' Empfänger für die Sicherung.');
        }
        $aus = [];
        foreach ($liste as $e) {
            $e = is_string($e) ? mb_strtolower(trim($e)) : '';
            if ($e === '') {
                continue;
            }
            if (mb_strlen($e) > 190 || filter_var($e, FILTER_VALIDATE_EMAIL) === false) {
                throw new ApiFehler('ungueltig', "Ungültige E-Mail-Adresse: {$e}");
            }
            $aus[$e] = true;
        }
        return array_keys($aus);
    }

    /** @return list<string> */
    private static function empfaengerAus(array $t): array
    {
        $l = json_decode((string)($t['sicherung_an'] ?? ''), true);
        return is_array($l) ? array_values(array_filter($l, 'is_string')) : [];
    }

    /** Wartezeit in Mikrosekunden (in Tests abschaltbar) */
    private function warten(int $mikros): void
    {
        if (empty($this->config['ohne_warten'])) {
            usleep($mikros);
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

    private function neuesToken(?int $kontoId, ?string $turnierId, string $rolle, string $name, ?string $bezug = null, bool $helfer = false): string
    {
        $token = bin2hex(random_bytes(32));
        $this->db->ausfuehren(
            'INSERT INTO sitzungen (token_hash, konto_id, turnier_id, rolle, name, ablauf, bezug, helfer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [hash('sha256', $token), $kontoId, $turnierId, $rolle, $name, $this->jetzt() + self::SITZUNG_DAUER, $bezug, $helfer ? 1 : 0]
        );
        return $token;
    }

    /** @return array{konto_id:?int,turnier_id:?string,rolle:string,name:string,bezug:?string,helfer:bool}|null */
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
            $k = $this->db->eine('SELECT gesperrt, aktiv FROM konten WHERE id = ?', [(int)$s['konto_id']]);
            if ($k === null || (int)$k['gesperrt'] === 1) {
                throw new ApiFehler('gesperrt', 'Dieses Konto ist gesperrt.');
            }
            // Nutzung merken (höchstens stündlich): Grundlage für die Löschung inaktiver Konten
            if ((int)($k['aktiv'] ?? 0) < $this->jetzt() - 3600) {
                $this->db->ausfuehren('UPDATE konten SET aktiv = ?, erinnert = NULL WHERE id = ?', [$this->jetzt(), (int)$s['konto_id']]);
            }
        }
        return [
            'konto_id' => $s['konto_id'] === null ? null : (int)$s['konto_id'],
            'turnier_id' => $s['turnier_id'],
            'rolle' => (string)$s['rolle'],
            'name' => (string)$s['name'],
            'bezug' => $s['bezug'] === null ? null : (string)$s['bezug'],
            'helfer' => (int)($s['helfer'] ?? 0) === 1,
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
            'zuletztAktiv' => self::iso(($z['aktiv'] ?? null) === null ? null : (int)$z['aktiv']),
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
            'zentrale' => ($z['zentrale'] ?? null) === null ? null : (string)$z['zentrale'],
            'zentraleId' => ($z['zentrale_id'] ?? null) === null ? null : (string)$z['zentrale_id'],
        ];
    }

    /**
     * Liegt das Turnier gerade auf einer Android-Zentrale, nimmt der Online-Server keine Änderungen an.
     * Geräte behalten ihre Einträge und senden sie nach der Rückgabe.
     */
    private static function nichtAufZentrale(array $t): void
    {
        if (($t['zentrale_id'] ?? null) !== null) {
            throw new ApiFehler('konflikt', 'Dieses Turnier läuft gerade auf der Zentrale „' . (string)$t['zentrale']
                . '“. Einträge bleiben auf diesem Gerät gespeichert und werden nach der Rückgabe übertragen.');
        }
    }

    /**
     * Turnier zur Kennung. Unbekannte Kennungen werden je Anschluss gezählt: Wer viele durchprobiert,
     * wird für eine Viertelstunde gebremst (Kennungen sind 8 Ziffern, Turniere sollen nicht auffindbar sein).
     */
    private function turnierLaden(string $id): array
    {
        $t = preg_match(self::TURNIER_ID_MUSTER, $id)
            ? $this->db->eine('SELECT t.*, k.name AS veranstalter FROM turniere t JOIN konten k ON k.id = t.konto_id WHERE t.id = ?', [$id])
            : null;
        if ($t === null) {
            // Bekannte Turniere bleiben immer erreichbar (Hallen-WLAN teilt sich eine Adresse);
            // gebremst wird nur, wer unbekannte Kennungen durchprobiert.
            $schluessel = 'turnier-suche|' . $this->ip;
            if ($this->anzahlVersuche($schluessel, self::VERSUCHE_FENSTER) >= self::SUCHE_MAX) {
                throw new ApiFehler('zu_viele_versuche', 'Zu viele unbekannte Turnierkennungen. Bitte in 15 Minuten erneut versuchen.');
            }
            $this->fehlversuch($schluessel);
            throw new ApiFehler('nicht_gefunden', 'Turnier nicht gefunden.');
        }
        return $t;
    }

    /** Neue Turnierkennung: 8 Ziffern, nicht zu einfach, noch nicht vergeben */
    private function neueTurnierId(): string
    {
        do {
            $id = (string)random_int(10000000, 99999999);
        } while (!self::codeGueltig($id) || $this->db->eine('SELECT id FROM turniere WHERE id = ?', [$id]) !== null);
        return $id;
    }

    /** Kennung für Leitung/Helfer, die der Server selbst vergibt (Bezug) */
    private static function neuerBezug(string $vorsilbe): string
    {
        return $vorsilbe . '-' . bin2hex(random_bytes(5));
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
            'registrierung' => true,
            'mail' => $this->mailBereit(),
            'codes' => true,
            'kennungen' => true,
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
            'INSERT INTO konten (name, email, passwort_hash, rolle, gesperrt, angelegt, aktiv) VALUES (?, ?, ?, ?, 0, ?, ?)',
            [$name, $email, password_hash($pw, PASSWORD_DEFAULT), 'admin', $this->jetzt(), $this->jetzt()]
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
        return $this->anmeldungAusgeben((int)$k['id']);
    }

    /** Anmeldung abschließen: Zeitpunkte setzen, Token ausgeben. */
    private function anmeldungAusgeben(int $kontoId): array
    {
        $this->db->ausfuehren('UPDATE konten SET letzte_anmeldung = ?, aktiv = ?, erinnert = NULL WHERE id = ?', [$this->jetzt(), $this->jetzt(), $kontoId]);
        $k = $this->db->eine('SELECT * FROM konten WHERE id = ?', [$kontoId]);
        $token = $this->neuesToken($kontoId, null, (string)$k['rolle'], (string)$k['name']);
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
        if ($s['rolle'] === 'spieler' && $s['bezug'] !== null) {
            $antwort['spieler'] = $s['bezug'];
            if ($s['helfer']) {
                $antwort['helfer'] = true;
            }
        }
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
                'INSERT INTO konten (name, email, passwort_hash, rolle, gesperrt, angelegt, aktiv) VALUES (?, ?, ?, ?, 0, ?, ?)',
                [$name, $email, password_hash($pw, PASSWORD_DEFAULT), 'veranstalter', $this->jetzt(), $this->jetzt()]
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
        $konto = $this->db->eine('SELECT email FROM konten WHERE id = ?', [$s['konto_id']]);
        $empfaenger = array_key_exists('sicherungAn', $a->rumpf ?? [])
            ? $this->empfaengerFeld($a->rumpf['sicherungAn'])
            : [(string)($konto['email'] ?? '')];
        $id = $this->neueTurnierId();
        $this->db->ausfuehren(
            'INSERT INTO turniere (id, konto_id, name, datum, leitung_hash, leitung_code, sicherung_an, sicherung_takt, angelegt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $s['konto_id'], $name, $datum, password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT), null,
             json_encode(array_values(array_filter($empfaenger))), 30, $this->jetzt()]
        );
        $t = $this->turnierLaden($id);
        // Leitungskennung für die anlegende Person (weitere legt die Leitung unter „Zugänge“ an)
        $leitung = $this->codeAnlegen($t, 'leitung', self::neuerBezug('l'), $s['name']);
        $token = $this->neuesToken($s['konto_id'], $id, 'leitung', $s['name']);
        return ['turnier' => self::turnierAusgabe($t), 'token' => $token, 'leitung' => self::codeAusgabe($leitung)];
    }

    /** Öffentlich. Mit Anmeldung steht in `rechte`, was diese Anmeldung im Turnier darf. */
    private function turnier(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->query['id'] ?? ''));
        $aus = self::turnierAusgabe($t);
        if ($a->token !== null) {
            $s = $this->sitzung($a);
            $aus['rechte'] = $s === null ? null : $this->rechte($s, $t);
        }
        return ['turnier' => $aus];
    }

    /** Was darf eine Sitzung in diesem Turnier? */
    private function rechte(array $s, array $t): ?string
    {
        if ($this->leitungsRecht($s, $t)) {
            return 'leitung';
        }
        if ($s['turnier_id'] === $t['id'] && in_array($s['rolle'], ['helfer', 'spieler'], true)) {
            return (string)$s['rolle'];
        }
        return null;
    }

    private function turnierZugang(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        // Zwei Bremsen, ohne richtige Kennungen auszusperren (im Hallen-WLAN teilen sich alle eine Adresse):
        // je Anschluss und Turnier wächst ab dem 5. Fehlversuch eine Wartezeit, ab 30 gibt es für falsche
        // Kennungen 429; je Turnier insgesamt sind nach 200 Fehlversuchen nur noch richtige Kennungen möglich.
        $schluessel = 'zugang|' . $t['id'] . '|' . $a->ip;
        $schluesselTurnier = 'zugang-turnier|' . $t['id'];
        $fehl = $this->anzahlVersuche($schluessel, self::VERSUCHE_FENSTER);
        if ($fehl >= self::ZUGANG_VERZOEGERN_AB) {
            $this->warten(min(2_000_000, 250_000 * ($fehl - self::ZUGANG_VERZOEGERN_AB + 1)));
        }
        $code = preg_replace('/\s+/', '', (string)($a->rumpf['code'] ?? ''));
        $c = preg_match('/^[0-9]{8}$/', $code)
            ? $this->db->eine('SELECT * FROM codes WHERE turnier_id = ? AND code = ? AND gesperrt = 0', [$t['id'], $code])
            : null;
        if ($c === null) {
            $this->fehlversuch($schluessel);
            $this->fehlversuch($schluesselTurnier);
            if ($fehl + 1 >= self::VERSUCHE_MAX * 3 || $this->anzahlVersuche($schluesselTurnier, self::VERSUCHE_FENSTER) > self::ZUGANG_TURNIER_MAX) {
                throw new ApiFehler('zu_viele_versuche', 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
            }
            throw new ApiFehler('falsche_zugangsdaten', 'Diese Kennung passt nicht zu diesem Turnier.');
        }
        $this->versucheLoeschen($schluessel);
        $rolle = (string)$c['rolle'];
        $helfer = $rolle === 'spieler' && (int)$c['helfer'] === 1;
        $token = $this->neuesToken(null, (string)$t['id'], $rolle, (string)$c['name'], (string)$c['bezug'], $helfer);
        $antwort = ['token' => $token, 'rolle' => $rolle, 'name' => (string)$c['name']];
        if ($rolle === 'spieler') {
            $antwort['spieler'] = (string)$c['bezug'];
            if ($helfer) {
                $antwort['helfer'] = true;
            }
        }
        return $antwort;
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
        $this->sicherungPruefen($t, $hoechste, false);
        return [
            'ereignisse' => array_map(static fn(array $z): array => [
                'seq' => (int)$z['seq'],
                'id' => (string)$z['event_id'],
                'art' => (string)$z['art'],
                'daten' => json_decode((string)$z['daten'], false),
                'zeit' => (string)$z['zeit'],
                'geraet' => (string)$z['geraet'],
                'empfangen' => self::iso((int)$z['empfangen']),
                'autor' => self::autorAusgabe($z),
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
        self::nichtAufZentrale($t);
        $liste = $a->rumpf['ereignisse'] ?? null;
        if (!is_array($liste) || !array_is_list($liste) || count($liste) > self::MAX_EREIGNISSE) {
            throw new ApiFehler('ungueltig', 'Feld „ereignisse“ muss eine Liste mit höchstens ' . self::MAX_EREIGNISSE . ' Einträgen sein.');
        }
        $rolle = $s['rolle'] === 'admin' || $s['rolle'] === 'veranstalter' ? 'leitung' : $s['rolle'];
        // Obergrenze je Turnier (128 Spieler brauchen einige tausend Einträge)
        $bisher = (int)($this->db->eine('SELECT COUNT(*) AS n FROM ereignisse WHERE turnier_id = ?', [$t['id']])['n'] ?? 0);
        if ($bisher + count($liste) > self::MAX_JE_TURNIER) {
            throw new ApiFehler('zu_gross', 'Das Turnier hat die Höchstzahl an Einträgen erreicht.');
        }
        // Helfer und Spieler: höchstens 60 Sendungen pro Minute je Kennung (Schutz vor Dauerschleifen)
        if ($rolle === 'helfer' || $rolle === 'spieler') {
            $this->begrenzen('ev:' . substr(hash('sha256', (string)$a->token), 0, 24), 60, 60, 'Zu viele Einträge in kurzer Zeit. Bitte kurz warten.');
        }
        $erlaubt = match ($rolle) {
            // Spielerkennung mit Helferrecht darf beides
            'spieler' => (int)($s['helfer'] ?? 0) === 1 ? array_values(array_unique([...self::ARTEN_SPIELER, ...self::ARTEN_HELFER])) : self::ARTEN_SPIELER,
            'helfer' => self::ARTEN_HELFER,
            default => null,
        };
        if ($erlaubt !== null) {
            foreach ($liste as $e) {
                $art = is_array($e) ? ($e['art'] ?? null) : ($e instanceof \stdClass ? ($e->art ?? null) : null);
                if (!in_array($art, $erlaubt, true)) {
                    throw new ApiFehler('keine_berechtigung', 'Mit diesem Code dürfen nur Ergebnisse eingetragen werden.');
                }
            }
        }
        $bezug = $rolle === 'spieler' ? $s['bezug'] : null;
        $helfer = $rolle === 'spieler' && $s['helfer'];

        $angenommen = [];
        $this->db->anfangen();
        try {
            // Schreibvorgänge je Turnier nacheinander: so werden Laufnummern in genau der
            // Reihenfolge sichtbar, in der sie vergeben wurden. Sonst könnte ein Gerät, das
            // gerade abholt, eine kleinere Laufnummer überspringen. (SQLite sperrt ohnehin.)
            if ($this->db->treiber === 'mysql') {
                $this->db->eine('SELECT id FROM turniere WHERE id = ? FOR UPDATE', [$t['id']]);
            }
            foreach ($liste as $e) {
                $e = $e instanceof \stdClass ? get_object_vars($e) : $e;
                $seq = $this->einEreignis($t['id'], $e, $rolle, $s['name'], $bezug, $helfer);
                $angenommen[] = ['id' => (string)$e['id'], 'seq' => $seq];
            }
            $this->db->festschreiben();
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
        $hoechste = (int)($this->db->eine('SELECT MAX(seq) AS m FROM ereignisse WHERE turnier_id = ?', [$t['id']])['m'] ?? 0);
        $abschluss = false;
        foreach ($liste as $e) {
            $e = $e instanceof \stdClass ? get_object_vars($e) : $e;
            $abschluss = $abschluss || (is_array($e) && ($e['art'] ?? '') === self::ART_ABGESCHLOSSEN);
        }
        $this->sicherungPruefen($t, $hoechste, $abschluss);
        return ['angenommen' => $angenommen, 'hoechsteSeq' => $hoechste];
    }

    private function einEreignis(string $turnierId, mixed $e, string $rolle, string $name, ?string $bezug = null, bool $helfer = false): int
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
            'INSERT INTO ereignisse (turnier_id, event_id, art, daten, zeit, geraet, autor_rolle, autor_name, empfangen, autor_bezug, autor_helfer)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$turnierId, $id, $art, $json, $zeit, $geraet, $rolle, $name, $this->jetzt(), $bezug, $helfer ? 1 : 0]
        );
        return (int)$this->db->pdo->lastInsertId();
    }

    /* ---------------- Konto selbst verwalten ---------------- */

    private function registrieren(Anfrage $a): array
    {
        if (!$this->eingerichtet()) {
            throw new ApiFehler('nicht_eingerichtet', 'Der Server ist noch nicht eingerichtet.');
        }
        $schluessel = 'registrieren|' . $a->ip;
        $this->begrenzen($schluessel, 5, 3600, 'Von diesem Anschluss wurden gerade viele Konten angelegt. Bitte später erneut versuchen.');
        $this->fangfeld($a);
        $name = $this->text($a, 'name', 2, 120);
        $email = $this->email($a);
        $pw = $this->passwortFeld($a);
        try {
            $this->db->ausfuehren(
                'INSERT INTO konten (name, email, passwort_hash, rolle, gesperrt, angelegt, aktiv) VALUES (?, ?, ?, ?, 0, ?, ?)',
                [$name, $email, password_hash($pw, PASSWORD_DEFAULT), 'veranstalter', $this->jetzt(), $this->jetzt()]
            );
        } catch (\PDOException $e) {
            if (Datenbank::istEindeutigkeitsFehler($e)) {
                throw new ApiFehler('konflikt', 'Für diese E-Mail-Adresse gibt es schon ein Konto. Bitte anmelden oder „Passwort vergessen?“ nutzen.');
            }
            throw $e;
        }
        $k = $this->db->eine('SELECT * FROM konten WHERE email = ?', [$email]);
        $antwort = $this->anmeldungAusgeben((int)$k['id']);

        if ($this->mailBereit()) {
            $url = $this->appUrl();
            $this->mail($email, 'Willkommen beim Tischtennis-Turnier', "Hallo {$name},\n\n"
                . "dein Konto ist angelegt. Du kannst sofort Turniere anlegen:\n{$url}\n\n"
                . "Angemeldet wirst du mit dieser E-Mail-Adresse ({$email}) und deinem Passwort.\n"
                . "Passwort vergessen? Auf der Anmeldeseite „Passwort vergessen?“ wählen.\n\n"
                . "Wird das Konto 12 Monate nicht genutzt, wird es samt Turnieren gelöscht; 30 Tage vorher kommt eine Erinnerung.\n"
                . "Datenschutzhinweis: {$url}#/datenschutz");
            if ($this->adminMail() !== '') {
                $this->mail($this->adminMail(), "Neues Konto: {$name}", "Neues Veranstalter-Konto angelegt:\n\n"
                    . "Name:   {$name}\nE-Mail: {$email}\nZeit:   " . gmdate('d.m.Y H:i', $this->jetzt()) . " UTC\n\n"
                    . "Verwaltung (sperren): {$url}#/verwaltung");
            }
        }
        return $antwort;
    }

    private function passwortVergessen(Anfrage $a): array
    {
        if (!$this->mailBereit()) {
            throw new ApiFehler('nicht_eingerichtet', 'Auf diesem Server ist kein Mailversand eingerichtet. Bitte an den Betreiber wenden.');
        }
        $this->begrenzen('vergessen|' . $a->ip, 5, 3600, 'Zu viele Anfragen. Bitte in einer Stunde erneut versuchen.');
        $email = $this->email($a);
        $k = $this->db->eine('SELECT * FROM konten WHERE email = ?', [$email]);
        // Immer dieselbe Antwort: verrät nicht, ob es die Adresse gibt
        if ($k !== null && (int)$k['gesperrt'] === 0 && $this->anzahlVersuche('vergessen-mail|' . $email, 3600) < 3) {
            $this->fehlversuch('vergessen-mail|' . $email);
            $schluessel = bin2hex(random_bytes(32));
            $this->db->ausfuehren(
                'INSERT INTO rueckstellungen (schluessel_hash, konto_id, ablauf) VALUES (?, ?, ?)',
                [hash('sha256', $schluessel), (int)$k['id'], $this->jetzt() + self::RUECKSTELLUNG_DAUER]
            );
            $link = $this->appUrl() . '#/zuruecksetzen/' . $schluessel;
            $this->mail($email, 'Passwort zurücksetzen', "Hallo {$k['name']},\n\n"
                . "für dein Konto wurde ein neues Passwort angefordert. Über diesen Link legst du es fest:\n\n{$link}\n\n"
                . "Der Link gilt eine Stunde und nur einmal. Danach sind alle bisherigen Anmeldungen beendet.\n"
                . "Hast du nichts angefordert? Dann ignoriere diese Mail – dein Passwort bleibt unverändert.");
        }
        return ['ok' => true];
    }

    private function passwortZuruecksetzen(Anfrage $a): array
    {
        $bremse = 'zuruecksetzen|' . $a->ip;
        $this->bremse($bremse);
        $schluessel = $a->rumpf['schluessel'] ?? '';
        $z = is_string($schluessel) && preg_match('/^[a-f0-9]{64}$/', $schluessel)
            ? $this->db->eine('SELECT * FROM rueckstellungen WHERE schluessel_hash = ?', [hash('sha256', $schluessel)])
            : null;
        if ($z === null || (int)$z['ablauf'] < $this->jetzt()) {
            $this->fehlversuch($bremse);
            throw new ApiFehler('falsche_zugangsdaten', 'Der Link ist abgelaufen oder wurde schon benutzt. Bitte neu anfordern.');
        }
        $kontoId = (int)$z['konto_id'];
        $k = $this->db->eine('SELECT gesperrt FROM konten WHERE id = ?', [$kontoId]);
        if ($k === null || (int)$k['gesperrt'] === 1) {
            throw new ApiFehler('gesperrt', 'Dieses Konto ist gesperrt. Bitte an den Administrator wenden.');
        }
        $neu = $this->passwortFeld($a, 'neu');
        $this->db->ausfuehren('UPDATE konten SET passwort_hash = ? WHERE id = ?', [password_hash($neu, PASSWORD_DEFAULT), $kontoId]);
        $this->db->ausfuehren('DELETE FROM rueckstellungen WHERE konto_id = ?', [$kontoId]);
        $this->db->ausfuehren('DELETE FROM sitzungen WHERE konto_id = ?', [$kontoId]);
        $this->versucheLoeschen($bremse);
        return $this->anmeldungAusgeben($kontoId);
    }

    private function kontoLoeschen(Anfrage $a): array
    {
        $s = $this->konto($a);
        if ($s['rolle'] === 'admin') {
            throw new ApiFehler('ungueltig', 'Das Administrator-Konto kann nicht gelöscht werden.');
        }
        $bremse = 'loeschen|' . $a->ip;
        $this->bremse($bremse);
        $k = $this->db->eine('SELECT passwort_hash FROM konten WHERE id = ?', [$s['konto_id']]);
        if ($k === null || !password_verify((string)($a->rumpf['passwort'] ?? ''), (string)$k['passwort_hash'])) {
            $this->fehlversuch($bremse);
            throw new ApiFehler('falsche_zugangsdaten', 'Das Passwort ist falsch.');
        }
        $this->kontoEntfernen($s['konto_id']);
        return ['ok' => true];
    }

    /**
     * Turnier endgültig löschen (Eigentümer-Konto oder Administrator, mit Passwort): Ereignisse, Kennungen,
     * Sitzungen, Rückstellungen. Für die Speicherbegrenzung nach DSGVO (Jugendturniere!).
     */
    private function turnierLoeschen(Anfrage $a): array
    {
        $s = $this->konto($a);
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        if ($s['rolle'] !== 'admin' && (int)$t['konto_id'] !== (int)$s['konto_id']) {
            throw new ApiFehler('keine_berechtigung', 'Nur die Turnierleitung (Konto) oder der Administrator darf ein Turnier löschen.');
        }
        $bremse = 'loeschen|' . $a->ip;
        $this->bremse($bremse);
        $k = $this->db->eine('SELECT passwort_hash FROM konten WHERE id = ?', [$s['konto_id']]);
        if ($k === null || !password_verify((string)($a->rumpf['passwort'] ?? ''), (string)$k['passwort_hash'])) {
            $this->fehlversuch($bremse);
            throw new ApiFehler('falsche_zugangsdaten', 'Das Passwort ist falsch.');
        }
        $this->db->anfangen();
        try {
            $this->turnierEntfernen((string)$t['id']);
            $this->db->festschreiben();
        } catch (\Throwable $e) {
            $this->db->zurueckrollen();
            throw $e;
        }
        return ['ok' => true];
    }

    private function turnierEntfernen(string $id): void
    {
        $this->db->ausfuehren('DELETE FROM ereignisse WHERE turnier_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM sitzungen WHERE turnier_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM codes WHERE turnier_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM turniere WHERE id = ?', [$id]);
    }

    /** Konto mit allen Turnieren, Ereignissen und Sitzungen endgültig löschen. */
    private function kontoEntfernen(int $kontoId): void
    {
        $this->db->anfangen();
        try {
            foreach ($this->db->alle('SELECT id FROM turniere WHERE konto_id = ?', [$kontoId]) as $t) {
                $this->db->ausfuehren('DELETE FROM ereignisse WHERE turnier_id = ?', [$t['id']]);
                $this->db->ausfuehren('DELETE FROM sitzungen WHERE turnier_id = ?', [$t['id']]);
                $this->db->ausfuehren('DELETE FROM codes WHERE turnier_id = ?', [$t['id']]);
            }
            $this->db->ausfuehren('DELETE FROM pool WHERE konto_id = ?', [$kontoId]);
            $this->db->ausfuehren('DELETE FROM turniere WHERE konto_id = ?', [$kontoId]);
            $this->db->ausfuehren('DELETE FROM sitzungen WHERE konto_id = ?', [$kontoId]);
            $this->db->ausfuehren('DELETE FROM rueckstellungen WHERE konto_id = ?', [$kontoId]);
            $this->db->ausfuehren('DELETE FROM konten WHERE id = ?', [$kontoId]);
            $this->db->festschreiben();
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
    }

    private function rueckmeldung(Anfrage $a): array
    {
        if (!$this->mailBereit() || $this->adminMail() === '') {
            throw new ApiFehler('nicht_eingerichtet', 'Nachrichten sind auf diesem Server nicht eingerichtet.');
        }
        $this->begrenzen('rueckmeldung|' . $a->ip, 5, 3600, 'Zu viele Nachrichten. Bitte in einer Stunde erneut versuchen.');
        $this->fangfeld($a);
        $arten = ['fehler' => 'Fehlermeldung', 'wunsch' => 'Änderungswunsch', 'frage' => 'Frage', 'kontakt' => 'Kontakt'];
        $art = $a->rumpf['art'] ?? '';
        if (!is_string($art) || !isset($arten[$art])) {
            throw new ApiFehler('ungueltig', 'Bitte die Art der Nachricht wählen.');
        }
        $text = $this->text($a, 'text', 5, 4000);
        $s = null;
        try {
            $s = $this->sitzung($a);
        } catch (ApiFehler) {
            $s = null;
        }
        $konto = $s !== null && $s['konto_id'] !== null ? $this->db->eine('SELECT * FROM konten WHERE id = ?', [$s['konto_id']]) : null;
        if ($konto !== null) {
            $name = (string)$konto['name'];
            $email = (string)$konto['email'];
            $wer = "Konto #{$konto['id']} ({$konto['rolle']})";
        } else {
            $name = $this->text($a, 'name', 2, 120);
            $email = $this->email($a);
            $wer = 'ohne Anmeldung';
        }
        $kurz = mb_substr(preg_replace('/\s+/', ' ', $text) ?? '', 0, 60);
        $ok = $this->mailer->senden(new Mail(
            $this->adminMail(),
            "[TT-Turnier] {$arten[$art]}: {$kurz}",
            "{$arten[$art]} über die App\n\nVon:    {$name} <{$email}>, {$wer}\nZeit:   "
                . gmdate('d.m.Y H:i', $this->jetzt()) . " UTC\n\n{$text}\n\n-- \nAntworten auf diese Mail gehen direkt an {$email}.",
            $email,
        ));
        if (!$ok) {
            throw new ApiFehler('serverfehler', 'Die Nachricht konnte nicht gesendet werden. Bitte später erneut versuchen.');
        }
        return ['ok' => true];
    }

    /* ---------------- Turnier-Einstellungen und Sicherung ---------------- */

    /** Leitung dieses Turniers, Eigentümer-Konto oder Administrator. */
    private function leitungsRecht(?array $s, array $t): bool
    {
        if ($s === null) {
            return false;
        }
        return ($s['turnier_id'] === $t['id'] && $s['rolle'] === 'leitung')
            || ($s['konto_id'] !== null && ($s['konto_id'] === (int)$t['konto_id'] || $s['rolle'] === 'admin'));
    }

    private function leitungPruefen(Anfrage $a, array $t): void
    {
        $s = $this->sitzung($a);
        if ($s === null) {
            throw new ApiFehler('nicht_angemeldet', 'Bitte als Turnierleitung anmelden.');
        }
        if (!$this->leitungsRecht($s, $t)) {
            throw new ApiFehler('keine_berechtigung', 'Nur für die Turnierleitung.');
        }
    }

    private function einstellungen(array $t, Anfrage $a): array
    {
        $this->leitungPruefen($a, $t);
        return [
            'sicherungAn' => self::empfaengerAus($t),
            'sicherungTakt' => (int)$t['sicherung_takt'],
            'letzteSicherung' => self::iso($t['sicherung_letzte'] === null ? null : (int)$t['sicherung_letzte']),
            'mail' => $this->mailBereit(),
        ];
    }

    private function einstellungenSetzen(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->leitungPruefen($a, $t);
        self::nichtAufZentrale($t);
        $r = $a->rumpf ?? [];
        if (array_key_exists('sicherungAn', $r)) {
            $this->db->ausfuehren('UPDATE turniere SET sicherung_an = ? WHERE id = ?', [json_encode($this->empfaengerFeld($r['sicherungAn'])), $t['id']]);
        }
        if (array_key_exists('sicherungTakt', $r)) {
            $takt = $r['sicherungTakt'];
            if (!is_int($takt) || !in_array($takt, self::SICHERUNG_TAKTE, true)) {
                throw new ApiFehler('ungueltig', 'Ungültiger Abstand für die Sicherung.');
            }
            $this->db->ausfuehren('UPDATE turniere SET sicherung_takt = ? WHERE id = ?', [$takt, $t['id']]);
        }
        return $this->einstellungen($this->turnierLaden((string)$t['id']), $a);
    }

    private function sichernJetzt(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->leitungPruefen($a, $t);
        self::nichtAufZentrale($t);
        if (!$this->mailBereit()) {
            throw new ApiFehler('nicht_eingerichtet', 'Auf diesem Server ist kein Mailversand eingerichtet.');
        }
        $empf = self::empfaengerAus($t);
        if ($empf === []) {
            throw new ApiFehler('ungueltig', 'Bitte zuerst mindestens einen Empfänger eintragen.');
        }
        $this->begrenzen('sichern|' . $t['id'], 3, 600, 'Bitte einige Minuten warten, bevor erneut gesichert wird.');
        $hoechste = (int)($this->db->eine('SELECT MAX(seq) AS m FROM ereignisse WHERE turnier_id = ?', [$t['id']])['m'] ?? 0);
        if (!$this->sicherungSenden($t, $empf, 'auf Anforderung')) {
            throw new ApiFehler('serverfehler', 'Die Sicherung konnte nicht gesendet werden.');
        }
        $this->db->ausfuehren('UPDATE turniere SET sicherung_letzte = ?, sicherung_seq = ? WHERE id = ?', [$this->jetzt(), $hoechste, $t['id']]);
        return ['ok' => true, 'gesendetAn' => $empf, 'zeit' => self::iso($this->jetzt())];
    }

    /**
     * Automatische Sicherung, bei jedem Abruf eines Turniers geprüft (kein Cronjob nötig):
     * fällig, wenn sich seit der letzten Sicherung etwas geändert hat und der Abstand erreicht ist,
     * oder sofort beim Abschluss des Turniers.
     */
    private function sicherungPruefen(array $t, int $hoechste, bool $abschluss): void
    {
        try {
            $takt = (int)$t['sicherung_takt'];
            $altSeq = (int)$t['sicherung_seq'];
            if ($takt === 0 || $hoechste <= $altSeq || !$this->mailBereit() || ($t['zentrale_id'] ?? null) !== null) {
                return;
            }
            if (!$abschluss) {
                $basis = (int)($t['sicherung_letzte'] ?? $t['angelegt']);
                if ($takt < 0 || $this->jetzt() - $basis < $takt * 60) {
                    return;
                }
            }
            $empf = self::empfaengerAus($t);
            if ($empf === []) {
                return;
            }
            // Nur ein Aufruf darf senden, auch wenn viele Geräte gleichzeitig abholen
            $n = $this->db->ausfuehren(
                'UPDATE turniere SET sicherung_letzte = ?, sicherung_seq = ? WHERE id = ? AND sicherung_seq = ?',
                [$this->jetzt(), $hoechste, $t['id'], $altSeq]
            );
            if ($n !== 1) {
                return;
            }
            if (!$this->sicherungSenden($t, $empf, $abschluss ? 'Turnier abgeschlossen' : "automatisch, alle {$takt} Minuten")) {
                // Beim nächsten fälligen Zeitpunkt erneut versuchen
                $this->db->ausfuehren('UPDATE turniere SET sicherung_seq = ? WHERE id = ?', [$altSeq, $t['id']]);
            }
        } catch (\Throwable $x) {
            error_log('tt-turnier Sicherung: ' . $x);
        }
    }

    /** @param list<string> $empf */
    private function sicherungSenden(array $t, array $empf, string $grund): bool
    {
        $zeilen = $this->db->alle('SELECT * FROM ereignisse WHERE turnier_id = ? ORDER BY seq', [$t['id']]);
        $ereignisse = [];
        foreach ($zeilen as $z) {
            $ereignisse[] = [
                'id' => (string)$z['event_id'],
                'art' => (string)$z['art'],
                'daten' => json_decode((string)$z['daten'], false),
                'zeit' => (string)$z['zeit'],
                'geraet' => (string)$z['geraet'],
                'seq' => (int)$z['seq'],
                'empfangen' => self::iso((int)$z['empfangen']),
                'autor' => self::autorAusgabe($z),
            ];
        }
        $sicherung = [
            'format' => 'tt-turnier-sicherung',
            'version' => 1,
            'erstellt' => self::iso($this->jetzt()),
            'turnier' => ['id' => (string)$t['id'], 'name' => (string)$t['name'], 'datum' => $t['datum'], 'modus' => 'online'],
            'ereignisse' => $ereignisse,
        ];
        $json = json_encode($sicherung, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        $uebersicht = trim((string)($t['uebersicht'] ?? '')) === '' ? null
            : ['text' => (string)$t['uebersicht'], 'zeit' => (int)$t['uebersicht_zeit']];
        return $this->sicherungMailen(
            ['id' => (string)$t['id'], 'name' => (string)$t['name'], 'datum' => $t['datum'], 'veranstalter' => (string)($t['veranstalter'] ?? '')],
            $empf, $grund, $uebersicht, $ereignisse, (string)$json, false
        );
    }

    /**
     * Sicherungsmail mit Anhang an alle Empfänger. Gemeinsam für Online-Turniere und Sicherungen,
     * die eine Android-Zentrale über diesen Server verschickt.
     * @param array{id:string,name:string,datum:?string,veranstalter:string} $t
     * @param list<string> $empf
     * @param array{text:string,zeit:int}|null $uebersicht
     */
    private function sicherungMailen(array $t, array $empf, string $grund, ?array $uebersicht, array $ereignisse, string $json, bool $vonZentrale): bool
    {
        $abgeschlossen = false;
        foreach ($ereignisse as $e) {
            $art = is_array($e) ? ($e['art'] ?? '') : (is_object($e) ? ($e->art ?? '') : '');
            if ($art === self::ART_ABGESCHLOSSEN) {
                $abgeschlossen = true;
            } elseif ($art === 'turnier.wiedereroeffnet') {
                $abgeschlossen = false;
            }
        }
        $stand = gmdate('d.m.Y H:i', $this->jetzt()) . ' UTC';
        $datum = $t['datum'] ? date('d.m.Y', (int)strtotime((string)$t['datum'])) : '–';
        $url = $this->appUrl();
        $abschnitt = '';
        if ($uebersicht !== null && trim($uebersicht['text']) !== '') {
            $zeit = gmdate('d.m.Y H:i', $uebersicht['zeit']) . ' UTC';
            $abschnitt = "Aktueller Stand (von der App erstellt, {$zeit}):\n"
                . str_repeat('-', 60) . "\n" . rtrim($uebersicht['text']) . "\n" . str_repeat('-', 60) . "\n\n";
        }
        $text = "Sicherung des Turniers „{$t['name']}“\n\n"
            . "Datum:        {$datum}\nVeranstalter: {$t['veranstalter']}\nStand:        {$stand}\n"
            . "Einträge:     " . count($ereignisse) . "\nStatus:       " . ($abgeschlossen ? 'abgeschlossen' : 'läuft') . "\n"
            . "Anlass:       {$grund}\n\n"
            . $abschnitt
            . "Im Anhang liegt die Sicherungsdatei. Wiederherstellen: App öffnen → „Neues Turnier“ →\n"
            . "„Aus Sicherung wiederherstellen“ und die Datei auswählen.\n\n"
            . ($vonZentrale
                ? "Das Turnier läuft auf einer Android-Zentrale (ohne Internet in der Halle). Diese Mail hat\n"
                    . "die Zentrale verschickt, sobald sie Internet hatte.\n\n"
                : "Turnier öffnen: {$url}#/t/{$t['id']}\n\n")
            . "Warum diese Mail? Die Turnierleitung hat die Sicherung per Mail eingeschaltet. Abstand und\n"
            . "Empfänger ändern: Turnier öffnen → „Einstellungen“ → „Sicherung per Mail“.";
        $datei = 'sicherung-' . $t['id'] . '-' . gmdate('Ymd-Hi', $this->jetzt()) . '.json';
        $alle = true;
        foreach ($empf as $an) {
            $alle = $this->mail($an, "Sicherung: {$t['name']} ({$stand})", $text, $datei, $json) && $alle;
        }
        return $alle;
    }

    /* ---------------- Android-Zentrale: Übernahme, Rückgabe, Sicherung ---------------- */

    /** Nur das Eigentümer-Konto (oder der Administrator) darf ein Turnier auf eine Zentrale holen. */
    private static function eigentuemerPruefen(array $s, array $t): void
    {
        if ($s['konto_id'] !== (int)$t['konto_id'] && $s['rolle'] !== 'admin') {
            throw new ApiFehler('keine_berechtigung', 'Nur das Konto, dem das Turnier gehört, kann es auf eine Zentrale übernehmen.');
        }
    }

    private function zentraleIdFeld(Anfrage $a): string
    {
        $zid = $a->rumpf['zentraleId'] ?? null;
        if (!is_string($zid) || !preg_match('/^[A-Za-z0-9_-]{4,40}$/', $zid)) {
            throw new ApiFehler('ungueltig', 'Kennung der Zentrale fehlt.');
        }
        return $zid;
    }

    private function zentraleUebernehmen(Anfrage $a): array
    {
        $s = $this->konto($a);
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        self::eigentuemerPruefen($s, $t);
        $name = $this->text($a, 'zentrale', 2, 160);
        $zid = $this->zentraleIdFeld($a);
        if ($t['zentrale_id'] !== null && $t['zentrale_id'] !== $zid && ($a->rumpf['erzwingen'] ?? false) !== true) {
            throw new ApiFehler('konflikt', 'Das Turnier liegt schon auf „' . $t['zentrale'] . '“ (seit '
                . gmdate('d.m.Y H:i', (int)$t['zentrale_seit']) . ' UTC). Erst dort zurückgeben – oder „Trotzdem übernehmen“ wählen.');
        }
        $this->db->ausfuehren('UPDATE turniere SET zentrale = ?, zentrale_id = ?, zentrale_seit = ? WHERE id = ?', [$name, $zid, $this->jetzt(), $t['id']]);
        $t = $this->turnierLaden((string)$t['id']);
        $codes = $this->codesListe((string)$t['id'])['codes'];
        return [
            'turnier' => self::turnierAusgabe($t),
            'einstellungen' => [
                'sicherungAn' => self::empfaengerAus($t),
                'sicherungTakt' => (int)$t['sicherung_takt'],
                'letzteSicherung' => self::iso($t['sicherung_letzte'] === null ? null : (int)$t['sicherung_letzte']),
            ],
            'codes' => $codes,
            'uebersicht' => trim((string)($t['uebersicht'] ?? '')) === '' ? null
                : ['text' => (string)$t['uebersicht'], 'zeit' => self::iso((int)$t['uebersicht_zeit'])],
        ];
    }

    private function zentraleRueckgabe(Anfrage $a): array
    {
        $s = $this->konto($a);
        $zid = $this->zentraleIdFeld($a);
        $id = (string)($a->rumpf['turnier'] ?? '');
        if (!preg_match(self::TURNIER_ID_MUSTER, $id)) {
            throw new ApiFehler('ungueltig', 'Turnier-Kennung ungültig.');
        }
        $roh = $this->db->eine('SELECT id FROM turniere WHERE id = ?', [$id]);
        if ($roh === null) {
            // Auf der Zentrale angelegtes Turnier: hier neu anlegen, gleiche Kennung
            $neu = $a->rumpf['neu'] ?? null;
            $neu = $neu instanceof \stdClass ? get_object_vars($neu) : $neu;
            if (!is_array($neu)) {
                throw new ApiFehler('nicht_gefunden', 'Turnier nicht gefunden.');
            }
            $n = new Anfrage('POST', '', [], $neu, null, $a->ip);
            $name = $this->text($n, 'name', 2, 160);
            $datum = $neu['datum'] ?? null;
            if ($datum !== null && (!is_string($datum) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum))) {
                throw new ApiFehler('ungueltig', 'Datum im Format JJJJ-MM-TT angeben.');
            }
            $konto = $this->db->eine('SELECT email FROM konten WHERE id = ?', [$s['konto_id']]);
            $this->db->ausfuehren(
                'INSERT INTO turniere (id, konto_id, name, datum, leitung_hash, leitung_code, sicherung_an, sicherung_takt, angelegt, zentrale, zentrale_id, zentrale_seit)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$id, $s['konto_id'], $name, $datum, password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT), null,
                 json_encode([(string)($konto['email'] ?? '')]), 30, $this->jetzt(),
                 mb_substr(trim((string)($a->rumpf['zentrale'] ?? 'Zentrale')), 0, 160), $zid, $this->jetzt()]
            );
        }
        $t = $this->turnierLaden($id);
        self::eigentuemerPruefen($s, $t);
        if ($t['zentrale_id'] !== $zid) {
            throw new ApiFehler('konflikt', $t['zentrale_id'] === null
                ? 'Das Turnier ist online nicht (mehr) auf diese Zentrale übernommen. Bitte erneut übernehmen.'
                : 'Das Turnier wurde inzwischen von „' . $t['zentrale'] . '“ übernommen.');
        }
        $liste = $a->rumpf['ereignisse'] ?? null;
        if (!is_array($liste) || !array_is_list($liste) || count($liste) > self::MAX_EREIGNISSE) {
            throw new ApiFehler('ungueltig', 'Feld „ereignisse“ muss eine Liste mit höchstens ' . self::MAX_EREIGNISSE . ' Einträgen sein.');
        }
        $angenommen = [];
        $this->db->anfangen();
        try {
            if ($this->db->treiber === 'mysql') {
                $this->db->eine('SELECT id FROM turniere WHERE id = ? FOR UPDATE', [$t['id']]);
            }
            foreach ($liste as $e) {
                $e = $e instanceof \stdClass ? get_object_vars($e) : $e;
                if (!is_array($e)) {
                    throw new ApiFehler('ungueltig', 'Ereignis muss ein Objekt sein.');
                }
                // Autor wie auf der Zentrale festgestellt (dort hat die Zentrale die Codes geprüft)
                $au = $e['autor'] ?? null;
                $au = $au instanceof \stdClass ? get_object_vars($au) : (is_array($au) ? $au : []);
                $rolle = in_array($au['rolle'] ?? null, ['leitung', 'helfer', 'spieler'], true) ? (string)$au['rolle'] : 'leitung';
                $name = is_string($au['name'] ?? null) && trim($au['name']) !== '' ? mb_substr(trim($au['name']), 0, 120) : 'Zentrale';
                $bezug = $rolle === 'spieler' && is_string($au['spieler'] ?? null) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $au['spieler'])
                    ? $au['spieler'] : null;
                $seq = $this->einEreignis((string)$t['id'], $e, $rolle, $name, $bezug, $rolle === 'spieler' && ($au['helfer'] ?? false) === true);
                $angenommen[] = ['id' => (string)$e['id'], 'seq' => $seq];
            }
            $this->db->festschreiben();
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
        $hoechste = (int)($this->db->eine('SELECT MAX(seq) AS m FROM ereignisse WHERE turnier_id = ?', [$t['id']])['m'] ?? 0);
        return ['angenommen' => $angenommen, 'hoechsteSeq' => $hoechste];
    }

    private function zentraleFreigeben(Anfrage $a): array
    {
        $s = $this->konto($a);
        $zid = $this->zentraleIdFeld($a);
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        self::eigentuemerPruefen($s, $t);
        if ($t['zentrale_id'] !== null && $t['zentrale_id'] !== $zid) {
            throw new ApiFehler('konflikt', 'Das Turnier wurde inzwischen von „' . $t['zentrale'] . '“ übernommen.');
        }
        $r = $a->rumpf ?? [];
        $this->db->anfangen();
        try {
            if (array_key_exists('codes', $r)) {
                $liste = $r['codes'];
                if (!is_array($liste) || !array_is_list($liste) || count($liste) > self::MAX_CODES) {
                    throw new ApiFehler('ungueltig', 'Feld „codes“ muss eine Liste sein.');
                }
                $alt = [];
                foreach ($this->db->alle('SELECT * FROM codes WHERE turnier_id = ?', [$t['id']]) as $c) {
                    $alt[$c['rolle'] . '|' . $c['bezug']] = $c;
                }
                $neu = [];
                $vergeben = [];
                foreach ($liste as $c) {
                    $c = $c instanceof \stdClass ? get_object_vars($c) : $c;
                    $rolle = $c['rolle'] ?? null;
                    $bezug = $c['bezug'] ?? null;
                    $code = $c['code'] ?? null;
                    $name = is_string($c['name'] ?? null) ? mb_substr(trim($c['name']), 0, 160) : '';
                    if (!in_array($rolle, self::CODE_ROLLEN, true) || !is_string($bezug) || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $bezug)
                        || !is_string($code) || !self::codeGueltig($code) || $code === (string)$t['id'] || $name === '' || isset($vergeben[$code])) {
                        continue;
                    }
                    $vergeben[$code] = true;
                    $helfer = $rolle === 'spieler' && ($c['helfer'] ?? false) === true ? 1 : 0;
                    $neu[$rolle . '|' . $bezug] = [$rolle, $bezug, $name, $code, ($c['gesperrt'] ?? false) === true ? 1 : 0, $helfer];
                }
                foreach ($alt as $k => $c) {
                    if (!isset($neu[$k]) || $neu[$k][3] !== (string)$c['code'] || $neu[$k][4] === 1 || $neu[$k][5] !== (int)$c['helfer']) {
                        $this->codeSitzungenBeenden((string)$t['id'], (string)$c['rolle'], (string)$c['bezug']);
                    }
                }
                $this->db->ausfuehren('DELETE FROM codes WHERE turnier_id = ?', [$t['id']]);
                foreach ($neu as [$rolle, $bezug, $name, $code, $gesperrt, $helfer]) {
                    $this->db->ausfuehren(
                        'INSERT INTO codes (turnier_id, rolle, bezug, name, code, gesperrt, angelegt, helfer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [$t['id'], $rolle, $bezug, $name, $code, $gesperrt, $this->jetzt(), $helfer]
                    );
                }
            }
            $ein = $r['einstellungen'] ?? null;
            $ein = $ein instanceof \stdClass ? get_object_vars($ein) : $ein;
            if (is_array($ein)) {
                if (array_key_exists('sicherungAn', $ein)) {
                    $this->db->ausfuehren('UPDATE turniere SET sicherung_an = ? WHERE id = ?', [json_encode($this->empfaengerFeld($ein['sicherungAn'])), $t['id']]);
                }
                if (isset($ein['sicherungTakt']) && is_int($ein['sicherungTakt']) && in_array($ein['sicherungTakt'], self::SICHERUNG_TAKTE, true)) {
                    $this->db->ausfuehren('UPDATE turniere SET sicherung_takt = ? WHERE id = ?', [$ein['sicherungTakt'], $t['id']]);
                }
            }
            $ueb = $r['uebersicht'] ?? null;
            $ueb = $ueb instanceof \stdClass ? get_object_vars($ueb) : $ueb;
            if (is_array($ueb) && is_string($ueb['text'] ?? null) && mb_strlen($ueb['text']) <= self::MAX_UEBERSICHT) {
                $this->db->ausfuehren('UPDATE turniere SET uebersicht = ?, uebersicht_zeit = ? WHERE id = ?', [$ueb['text'], $this->jetzt(), $t['id']]);
            }
            $this->db->ausfuehren('UPDATE turniere SET zentrale = NULL, zentrale_id = NULL, zentrale_seit = NULL WHERE id = ?', [$t['id']]);
            $this->db->festschreiben();
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
        return ['turnier' => self::turnierAusgabe($this->turnierLaden((string)$t['id']))];
    }

    /** Sicherungsmail für ein Turnier, das auf einer Zentrale läuft: die Zentrale liefert Datei und Übersicht. */
    private function sicherungVonZentrale(Anfrage $a): array
    {
        $s = $this->konto($a);
        if (!$this->mailBereit()) {
            throw new ApiFehler('nicht_eingerichtet', 'Auf dem Online-Server ist kein Mailversand eingerichtet.');
        }
        $this->begrenzen('sicherung-zentrale|' . $s['konto_id'], 40, 3600, 'Zu viele Sicherungen in kurzer Zeit. Bitte später erneut versuchen.');
        $tr = $a->rumpf['turnier'] ?? null;
        $tr = $tr instanceof \stdClass ? get_object_vars($tr) : $tr;
        if (!is_array($tr) || !is_string($tr['id'] ?? null) || !preg_match(self::TURNIER_ID_MUSTER, $tr['id'])
            || !is_string($tr['name'] ?? null) || trim($tr['name']) === '') {
            throw new ApiFehler('ungueltig', 'Angaben zum Turnier fehlen.');
        }
        $datum = $tr['datum'] ?? null;
        if ($datum !== null && (!is_string($datum) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum))) {
            $datum = null;
        }
        $empf = $this->empfaengerFeld($a->rumpf['empfaenger'] ?? null);
        if ($empf === []) {
            throw new ApiFehler('ungueltig', 'Keine Empfänger angegeben.');
        }
        $anlass = mb_substr(trim(is_string($a->rumpf['anlass'] ?? null) ? $a->rumpf['anlass'] : 'Zentrale'), 0, 120);
        $sich = $a->rumpf['sicherung'] ?? null;
        $sich = $sich instanceof \stdClass ? get_object_vars($sich) : $sich;
        if (!is_array($sich) || ($sich['format'] ?? '') !== 'tt-turnier-sicherung' || !is_array($sich['ereignisse'] ?? null)) {
            throw new ApiFehler('ungueltig', 'Die Sicherungsdatei fehlt oder ist ungültig.');
        }
        $json = json_encode($sich, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        if ($json === false || strlen($json) > self::MAX_SICHERUNG_BYTES) {
            throw new ApiFehler('ungueltig', 'Die Sicherungsdatei ist zu groß.');
        }
        $ueb = $a->rumpf['uebersicht'] ?? null;
        $ueb = $ueb instanceof \stdClass ? get_object_vars($ueb) : $ueb;
        $uebersicht = null;
        if (is_array($ueb) && is_string($ueb['text'] ?? null) && mb_strlen($ueb['text']) <= self::MAX_UEBERSICHT) {
            $zeit = is_string($ueb['zeit'] ?? null) ? strtotime($ueb['zeit']) : false;
            $uebersicht = ['text' => $ueb['text'], 'zeit' => $zeit === false ? $this->jetzt() : $zeit];
        }
        $konto = $this->db->eine('SELECT name FROM konten WHERE id = ?', [$s['konto_id']]);
        $ok = $this->sicherungMailen(
            ['id' => $tr['id'], 'name' => mb_substr(trim($tr['name']), 0, 160), 'datum' => $datum, 'veranstalter' => (string)($konto['name'] ?? '')],
            $empf, $anlass, $uebersicht, $sich['ereignisse'], (string)$json, true
        );
        if (!$ok) {
            throw new ApiFehler('serverfehler', 'Die Sicherung konnte nicht gesendet werden.');
        }
        return ['ok' => true, 'gesendetAn' => $empf, 'zeit' => self::iso($this->jetzt())];
    }

    /* ---------------- Spieler- und Helfer-Codes ---------------- */

    private static function autorAusgabe(array $z): array
    {
        $a = ['rolle' => (string)$z['autor_rolle'], 'name' => (string)$z['autor_name']];
        if ($z['autor_rolle'] === 'spieler' && ($z['autor_bezug'] ?? null) !== null) {
            $a['spieler'] = (string)$z['autor_bezug'];
            if ((int)($z['autor_helfer'] ?? 0) === 1) {
                $a['helfer'] = true;
            }
        }
        return $a;
    }

    private static function codeAusgabe(array $z): array
    {
        $aus = [
            'rolle' => (string)$z['rolle'],
            'bezug' => (string)$z['bezug'],
            'name' => (string)$z['name'],
            'code' => (string)$z['code'],
            'gesperrt' => (int)$z['gesperrt'] === 1,
        ];
        if ($z['rolle'] === 'spieler') {
            $aus['helfer'] = (int)($z['helfer'] ?? 0) === 1;
        }
        return $aus;
    }

    /** Zufällige gültige Kennung (8 Ziffern), im Turnier noch nicht vergeben */
    private function freierCode(array $t): string
    {
        for ($i = 0; $i < 1000; $i++) {
            $code = (string)random_int(10000000, 99999999);
            if (!self::codeGueltig($code) || $code === (string)$t['id']) {
                continue;
            }
            if ($this->db->eine('SELECT bezug FROM codes WHERE turnier_id = ? AND code = ?', [$t['id'], $code]) === null) {
                return $code;
            }
        }
        throw new ApiFehler('serverfehler', 'Es konnte keine freie Kennung erzeugt werden.');
    }

    /** @return array{0:string,1:string} Rolle und Bezug aus der Anfrage */
    private function codeZiel(Anfrage $a): array
    {
        $rolle = $a->rumpf['rolle'] ?? null;
        $bezug = $a->rumpf['bezug'] ?? null;
        if (!in_array($rolle, self::CODE_ROLLEN, true) || !is_string($bezug) || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $bezug)) {
            throw new ApiFehler('ungueltig', 'Rolle oder Bezug ungültig.');
        }
        return [$rolle, $bezug];
    }

    /** Reihenfolge: Leitung, Helfer, Spieler – je Rolle nach Name */
    private function codesListe(string $turnierId): array
    {
        $zeilen = $this->db->alle(
            "SELECT * FROM codes WHERE turnier_id = ? ORDER BY CASE rolle WHEN 'leitung' THEN 0 WHEN 'helfer' THEN 1 ELSE 2 END, name",
            [$turnierId]
        );
        return ['codes' => array_map([self::class, 'codeAusgabe'], $zeilen)];
    }

    /** Eine Kennung anlegen (Zeile aus der Datenbank zurück) */
    private function codeAnlegen(array $t, string $rolle, string $bezug, string $name): array
    {
        $anzahl = (int)($this->db->eine('SELECT COUNT(*) AS n FROM codes WHERE turnier_id = ?', [$t['id']])['n'] ?? 0);
        if ($anzahl >= self::MAX_CODES) {
            throw new ApiFehler('ungueltig', 'Höchstens ' . self::MAX_CODES . ' Kennungen je Turnier.');
        }
        $this->db->ausfuehren(
            'INSERT INTO codes (turnier_id, rolle, bezug, name, code, gesperrt, angelegt, helfer) VALUES (?, ?, ?, ?, ?, 0, ?, 0)',
            [$t['id'], $rolle, $bezug, $name, $this->freierCode($t), $this->jetzt()]
        );
        return $this->codeLaden($t, $rolle, $bezug);
    }

    /** Mindestens eine Leitungskennung muss nutzbar bleiben, sonst sperrt sich die Leitung aus */
    private function letzteLeitungPruefen(array $t, string $rolle, string $bezug): void
    {
        if ($rolle !== 'leitung') {
            return;
        }
        $n = (int)($this->db->eine(
            "SELECT COUNT(*) AS n FROM codes WHERE turnier_id = ? AND rolle = 'leitung' AND gesperrt = 0 AND bezug <> ?",
            [$t['id'], $bezug]
        )['n'] ?? 0);
        if ($n === 0) {
            throw new ApiFehler('konflikt', 'Das ist die letzte gültige Leitungskennung. Bitte zuerst eine weitere anlegen.');
        }
    }

    private function codes(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->query['turnier'] ?? ''));
        $this->leitungPruefen($a, $t);
        return $this->codesListe((string)$t['id']);
    }

    private function codesAnlegen(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->leitungPruefen($a, $t);
        self::nichtAufZentrale($t);
        $liste = $a->rumpf['eintraege'] ?? null;
        if (!is_array($liste) || !array_is_list($liste) || count($liste) > self::MAX_CODES) {
            throw new ApiFehler('ungueltig', 'Feld „eintraege“ muss eine Liste sein.');
        }
        $this->db->anfangen();
        try {
            foreach ($liste as $e) {
                $e = $e instanceof \stdClass ? get_object_vars($e) : $e;
                $rolle = $e['rolle'] ?? null;
                $bezug = $e['bezug'] ?? null;
                $name = is_string($e['name'] ?? null) ? mb_substr(trim($e['name']), 0, 160) : '';
                if (!in_array($rolle, self::CODE_ROLLEN, true) || !is_string($bezug) || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $bezug) || $name === '') {
                    throw new ApiFehler('ungueltig', 'Ungültiger Eintrag für eine Kennung.');
                }
                $alt = $this->db->eine('SELECT name FROM codes WHERE turnier_id = ? AND rolle = ? AND bezug = ?', [$t['id'], $rolle, $bezug]);
                if ($alt !== null) {
                    if ($alt['name'] !== $name) {
                        $this->db->ausfuehren('UPDATE codes SET name = ? WHERE turnier_id = ? AND rolle = ? AND bezug = ?', [$name, $t['id'], $rolle, $bezug]);
                        $this->db->ausfuehren('UPDATE sitzungen SET name = ? WHERE turnier_id = ? AND rolle = ? AND bezug = ?', [$name, $t['id'], $rolle, $bezug]);
                    }
                    continue;
                }
                $this->codeAnlegen($t, $rolle, $bezug, $name);
            }
            $this->db->festschreiben();
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
        return $this->codesListe((string)$t['id']);
    }

    /** Anmeldungen mit dem bisherigen Code beenden */
    private function codeSitzungenBeenden(string $turnierId, string $rolle, string $bezug): void
    {
        $this->db->ausfuehren('DELETE FROM sitzungen WHERE turnier_id = ? AND rolle = ? AND bezug = ?', [$turnierId, $rolle, $bezug]);
    }

    private function codeLaden(array $t, string $rolle, string $bezug): array
    {
        $c = $this->db->eine('SELECT * FROM codes WHERE turnier_id = ? AND rolle = ? AND bezug = ?', [$t['id'], $rolle, $bezug]);
        if ($c === null) {
            throw new ApiFehler('nicht_gefunden', 'Code nicht gefunden.');
        }
        return $c;
    }

    private function codeNeu(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->leitungPruefen($a, $t);
        self::nichtAufZentrale($t);
        [$rolle, $bezug] = $this->codeZiel($a);
        $this->codeLaden($t, $rolle, $bezug);
        $this->db->ausfuehren('UPDATE codes SET code = ?, gesperrt = 0 WHERE turnier_id = ? AND rolle = ? AND bezug = ?', [$this->freierCode($t), $t['id'], $rolle, $bezug]);
        $this->codeSitzungenBeenden((string)$t['id'], $rolle, $bezug);
        return ['code' => self::codeAusgabe($this->codeLaden($t, $rolle, $bezug))];
    }

    private function codeSperren(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->leitungPruefen($a, $t);
        self::nichtAufZentrale($t);
        [$rolle, $bezug] = $this->codeZiel($a);
        $this->codeLaden($t, $rolle, $bezug);
        $gesperrt = ($a->rumpf['gesperrt'] ?? false) === true;
        if ($gesperrt) {
            $this->letzteLeitungPruefen($t, $rolle, $bezug);
        }
        $this->db->ausfuehren('UPDATE codes SET gesperrt = ? WHERE turnier_id = ? AND rolle = ? AND bezug = ?', [$gesperrt ? 1 : 0, $t['id'], $rolle, $bezug]);
        if ($gesperrt) {
            $this->codeSitzungenBeenden((string)$t['id'], $rolle, $bezug);
        }
        return ['code' => self::codeAusgabe($this->codeLaden($t, $rolle, $bezug))];
    }

    private function codeEntfernen(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->leitungPruefen($a, $t);
        self::nichtAufZentrale($t);
        [$rolle, $bezug] = $this->codeZiel($a);
        $this->letzteLeitungPruefen($t, $rolle, $bezug);
        $this->db->ausfuehren('DELETE FROM codes WHERE turnier_id = ? AND rolle = ? AND bezug = ?', [$t['id'], $rolle, $bezug]);
        $this->codeSitzungenBeenden((string)$t['id'], $rolle, $bezug);
        return ['ok' => true];
    }

    /** Spielerkennung zusätzlich Helfer-Recht geben oder nehmen. Laufende Anmeldungen enden (neu anmelden). */
    private function codeHelfer(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->leitungPruefen($a, $t);
        self::nichtAufZentrale($t);
        $bezug = $a->rumpf['bezug'] ?? null;
        if (!is_string($bezug) || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $bezug)) {
            throw new ApiFehler('ungueltig', 'Bezug ungültig.');
        }
        $this->codeLaden($t, 'spieler', $bezug);
        $helfer = ($a->rumpf['helfer'] ?? false) === true;
        $this->db->ausfuehren('UPDATE codes SET helfer = ? WHERE turnier_id = ? AND rolle = ? AND bezug = ?', [$helfer ? 1 : 0, $t['id'], 'spieler', $bezug]);
        $this->codeSitzungenBeenden((string)$t['id'], 'spieler', $bezug);
        return ['code' => self::codeAusgabe($this->codeLaden($t, 'spieler', $bezug))];
    }

    /* ---------------- Einstellungen des Kontos ---------------- */

    private function kontoEinstellungen(Anfrage $a): array
    {
        $s = $this->konto($a);
        $k = $this->db->eine('SELECT daten FROM konten WHERE id = ?', [$s['konto_id']]);
        $d = json_decode((string)($k['daten'] ?? ''), true);
        $klassen = is_array($d) && is_array($d['klassen'] ?? null) ? array_values(array_filter($d['klassen'], 'is_string')) : [];
        return ['klassen' => $klassen];
    }

    private function kontoEinstellungenSetzen(Anfrage $a): array
    {
        $s = $this->konto($a);
        $liste = $a->rumpf['klassen'] ?? null;
        if (!is_array($liste) || !array_is_list($liste) || count($liste) > self::MAX_KLASSEN) {
            throw new ApiFehler('ungueltig', 'Höchstens ' . self::MAX_KLASSEN . ' Leistungsklassen.');
        }
        $klassen = [];
        foreach ($liste as $k) {
            $k = is_string($k) ? mb_substr(trim($k), 0, 40) : '';
            if ($k !== '' && !in_array($k, $klassen, true)) {
                $klassen[] = $k;
            }
        }
        $this->db->ausfuehren('UPDATE konten SET daten = ? WHERE id = ?', [json_encode(['klassen' => $klassen], JSON_UNESCAPED_UNICODE), $s['konto_id']]);
        return ['klassen' => $klassen];
    }

    /* ---------------- Spielerpool des Kontos ---------------- */

    private static function poolAusgabe(array $z): array
    {
        $d = json_decode((string)$z['daten'], true);
        $d = is_array($d) ? $d : [];
        $d['id'] = (string)$z['id'];
        $d['geaendert'] = self::iso((int)$z['geaendert']);
        return $d;
    }

    /** Ein Pool-Eintrag, auf bekannte Felder beschränkt */
    private static function poolEintrag(mixed $e): array
    {
        $e = $e instanceof \stdClass ? get_object_vars($e) : $e;
        if (!is_array($e)) {
            throw new ApiFehler('ungueltig', 'Spieler muss ein Objekt sein.');
        }
        $id = $e['id'] ?? null;
        if (!is_string($id) || !preg_match('/^[A-Za-z0-9_-]{1,40}$/', $id)) {
            throw new ApiFehler('ungueltig', 'Spieler-ID ungültig.');
        }
        $txt = static fn(mixed $v, int $max): string => is_string($v) ? mb_substr(trim($v), 0, $max) : '';
        $d = [
            'vorname' => $txt($e['vorname'] ?? '', 80),
            'nachname' => $txt($e['nachname'] ?? '', 80),
            'verein' => $txt($e['verein'] ?? '', 120),
        ];
        if ($d['vorname'] === '' && $d['nachname'] === '') {
            throw new ApiFehler('ungueltig', 'Spieler braucht einen Namen.');
        }
        $ttr = $e['ttr'] ?? null;
        $d['ttr'] = is_int($ttr) && $ttr >= 0 && $ttr <= 4000 ? $ttr : null;
        $jg = $e['jahrgang'] ?? null;
        $d['jahrgang'] = is_int($jg) && $jg >= 1900 && $jg <= 2100 ? $jg : null;
        $d['klasse'] = $txt($e['klasse'] ?? '', 40) ?: null;
        $g = $e['geschlecht'] ?? null;
        $d['geschlecht'] = in_array($g, ['m', 'w', 'd'], true) ? $g : null;
        return [$id, $d];
    }

    private function pool(Anfrage $a): array
    {
        $s = $this->konto($a);
        $zeilen = $this->db->alle('SELECT * FROM pool WHERE konto_id = ? ORDER BY id', [$s['konto_id']]);
        return ['spieler' => array_map([self::class, 'poolAusgabe'], $zeilen)];
    }

    private function poolSpeichern(Anfrage $a): array
    {
        $s = $this->konto($a);
        $liste = $a->rumpf['spieler'] ?? null;
        if (!is_array($liste) || !array_is_list($liste) || count($liste) > 500) {
            throw new ApiFehler('ungueltig', 'Feld „spieler“ muss eine Liste mit höchstens 500 Einträgen sein.');
        }
        $eintraege = array_map([self::class, 'poolEintrag'], $liste);
        $this->db->anfangen();
        try {
            foreach ($eintraege as [$id, $d]) {
                $json = json_encode($d, JSON_UNESCAPED_UNICODE);
                $n = $this->db->ausfuehren('UPDATE pool SET daten = ?, geaendert = ? WHERE konto_id = ? AND id = ?', [$json, $this->jetzt(), $s['konto_id'], $id]);
                if ($n === 0 && $this->db->eine('SELECT id FROM pool WHERE konto_id = ? AND id = ?', [$s['konto_id'], $id]) === null) {
                    $anzahl = (int)($this->db->eine('SELECT COUNT(*) AS n FROM pool WHERE konto_id = ?', [$s['konto_id']])['n'] ?? 0);
                    if ($anzahl >= self::MAX_POOL) {
                        throw new ApiFehler('ungueltig', 'Höchstens ' . self::MAX_POOL . ' Spieler im Pool.');
                    }
                    $this->db->ausfuehren('INSERT INTO pool (konto_id, id, daten, geaendert) VALUES (?, ?, ?, ?)', [$s['konto_id'], $id, $json, $this->jetzt()]);
                }
            }
            $this->db->festschreiben();
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
        return $this->pool($a);
    }

    private function poolLoeschen(Anfrage $a): array
    {
        $s = $this->konto($a);
        $ids = $a->rumpf['ids'] ?? null;
        if (!is_array($ids) || !array_is_list($ids) || count($ids) > self::MAX_POOL) {
            throw new ApiFehler('ungueltig', 'Feld „ids“ muss eine Liste sein.');
        }
        foreach ($ids as $id) {
            if (is_string($id)) {
                $this->db->ausfuehren('DELETE FROM pool WHERE konto_id = ? AND id = ?', [$s['konto_id'], $id]);
            }
        }
        return ['ok' => true];
    }

    /* ---------------- Lesbare Übersicht (erzeugt die App) ---------------- */

    private function uebersichtSetzen(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->leitungPruefen($a, $t);
        self::nichtAufZentrale($t);
        $text = $a->rumpf['text'] ?? null;
        if (!is_string($text) || mb_strlen($text) > self::MAX_UEBERSICHT) {
            throw new ApiFehler('ungueltig', 'Übersicht fehlt oder ist zu lang.');
        }
        $this->db->ausfuehren('UPDATE turniere SET uebersicht = ?, uebersicht_zeit = ? WHERE id = ?', [$text, $this->jetzt(), $t['id']]);
        return ['ok' => true];
    }

    /* ---------------- Wartung (höchstens einmal täglich, bei einem beliebigen Aufruf) ---------------- */

    private function wartung(): void
    {
        try {
            $jetzt = $this->jetzt();
            $z = $this->db->eine("SELECT wert FROM meta WHERE schluessel = 'wartung'");
            if ($z === null) {
                try {
                    $this->db->ausfuehren("INSERT INTO meta (schluessel, wert) VALUES ('wartung', '0')");
                } catch (\PDOException) {
                    // gleichzeitig angelegt
                }
                $alt = '0';
            } else {
                $alt = (string)$z['wert'];
            }
            if ((int)$alt > $jetzt - self::TAG) {
                return;
            }
            // Nur ein Aufruf führt die Wartung aus
            if ($this->db->ausfuehren("UPDATE meta SET wert = ? WHERE schluessel = 'wartung' AND wert = ?", [(string)$jetzt, $alt]) !== 1) {
                return;
            }
            $this->db->ausfuehren('DELETE FROM sitzungen WHERE ablauf < ?', [$jetzt]);
            $this->db->ausfuehren('DELETE FROM rueckstellungen WHERE ablauf < ?', [$jetzt]);
            $this->db->ausfuehren('DELETE FROM versuche WHERE zeit < ?', [$jetzt - self::TAG]);

            // Erinnerung 30 Tage vor der Löschung
            $erinnern = $this->db->alle(
                "SELECT * FROM konten WHERE rolle = 'veranstalter' AND erinnert IS NULL AND aktiv < ?",
                [$jetzt - self::KONTO_LOESCHEN_NACH + self::KONTO_ERINNERUNG_VORHER]
            );
            foreach ($erinnern as $k) {
                $am = max((int)$k['aktiv'] + self::KONTO_LOESCHEN_NACH, $jetzt + self::KONTO_ERINNERUNG_VORHER);
                if ($this->mailBereit()) {
                    $this->mail((string)$k['email'], 'Dein Konto wird bald gelöscht', "Hallo {$k['name']},\n\n"
                        . "dein Konto beim Tischtennis-Turnier wurde lange nicht genutzt. Am " . gmdate('d.m.Y', $am)
                        . " wird es deshalb mit allen Turnieren gelöscht.\n\n"
                        . "Möchtest du es behalten, melde dich vorher einfach einmal an:\n" . $this->appUrl() . "#/anmelden\n\n"
                        . "Brauchst du es nicht mehr, musst du nichts tun.");
                }
                $this->db->ausfuehren('UPDATE konten SET erinnert = ? WHERE id = ?', [$jetzt, (int)$k['id']]);
            }

            // Löschen: 12 Monate ohne Nutzung und Erinnerung vor mindestens 30 Tagen
            $loeschen = $this->db->alle(
                "SELECT id FROM konten WHERE rolle = 'veranstalter' AND aktiv < ? AND erinnert IS NOT NULL AND erinnert <= ?",
                [$jetzt - self::KONTO_LOESCHEN_NACH, $jetzt - self::KONTO_ERINNERUNG_VORHER]
            );
            foreach ($loeschen as $k) {
                $this->kontoEntfernen((int)$k['id']);
            }
        } catch (\Throwable $x) {
            error_log('tt-turnier Wartung: ' . $x);
        }
    }
}
