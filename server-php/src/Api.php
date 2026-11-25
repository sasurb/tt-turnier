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
    public const VERSION = '0.18.0';
    public const PROTOKOLL = 1;
    private const MAX_EREIGNISSE = 200;
    private const MAX_JE_TURNIER = 50000;
    private const MAX_DATEN_BYTES = 16384;
    private const SITZUNG_DAUER = 60 * 60 * 24 * 30;      // 30 Tage
    private const VERSUCHE_FENSTER = 15 * 60;             // 15 Minuten
    private const VERSUCHE_MAX = 10;
    /**
     * Turnierkennung (ab 0.17): Zufall aus 8 Zeichen ohne Verwechsler (KENNUNG_ZEICHEN) oder Wunschkennung
     * 4–12 Zeichen A–Z, 0–9, Bindestrich (nicht am Rand). Groß/klein egal (gespeichert in Großbuchstaben).
     * Ältere Kennungen aus 8 Ziffern passen ebenfalls.
     */
    public const TURNIER_ID_MUSTER = '/^[A-Z0-9][A-Z0-9-]{2,10}[A-Z0-9]$/D';
    private const KENNUNG_ZEICHEN = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    /** Gelöschte Turnierkennungen werden erst nach so vielen Tagen wieder vergeben (Links in Umlauf) */
    private const KENNUNG_SPERRE_TAGE = 180;
    /** Automatische Löschung eines Turniers: Monate nach dem Turniertag (ohne Datum: nach der letzten Änderung) */
    public const LOESCHFRISTEN = [12, 24];
    private const TURNIER_ERINNERUNG_VORHER = 30 * 86400;
    /** Fassung der Nutzungsbedingungen mit Auftragsverarbeitungsvereinbarung (shared/protokoll.ts BEDINGUNGEN_FASSUNG) */
    public const BEDINGUNGEN_FASSUNG = '2026-11-24';
    /** Unbekannte Turnierkennungen je Anschluss und Viertelstunde, bevor gebremst wird (gegen Durchprobieren) */
    private const SUCHE_MAX = 30;
    /** Fehlversuche je Turnier (über alle Anschlüsse) in 15 Minuten, danach werden nur noch richtige Kennungen angenommen */
    private const ZUGANG_TURNIER_MAX = 200;
    /** Ab so vielen Fehlversuchen je Anschluss und Turnier wird jede weitere Anmeldung verzögert (statt alle auszusperren) */
    private const ZUGANG_VERZOEGERN_AB = 5;
    private const CODE_ROLLEN = ['leitung', 'helfer', 'spieler'];
    private const MAX_KLASSEN = 40;
    private const TAG = 86400;
    /** Missbrauchsschutz (Etappe 10): Turniere je Konto (Admin ausgenommen) und Sicherungsmails je Konto und Tag */
    private const TURNIERE_JE_TAG = 20;
    private const TURNIERE_JE_KONTO = 300;
    private const SICHERUNGEN_JE_TAG = 150;
    /** Online-Anmeldung steht neuen Konten nach so vielen Tagen offen (der Admin kann früher freischalten oder sperren) */
    public const ANMELDUNG_NACH_TAGEN = 7;
    /** Platzhalter für Begleitpersonen in der Sicht der Zuschauer (shared/protokoll.ts BEGLEITUNG_NAME) */
    public const BEGLEITUNG_NAME = 'Begleitperson';

    /** Platzhalter für Namen entfernter Spieler in der Sicht von Spielern und Zuschauern (shared/protokoll.ts ENTFERNT_NAME) */
    public const ENTFERNT_NAME = 'Entfernt';
    private const KONTO_LOESCHEN_NACH = 365 * self::TAG;   // shared/protokoll.ts KONTO_LOESCHEN_NACH_TAGEN
    private const KONTO_ERINNERUNG_VORHER = 30 * self::TAG;
    private const RUECKSTELLUNG_DAUER = 3600;              // Link „Passwort zurücksetzen“: 1 Stunde
    private const SICHERUNG_TAKTE = [0, 15, 30, 60, -1];   // Minuten; 0 = aus, -1 = nur beim Abschluss
    private const SICHERUNG_MAX_EMPFAENGER = 3;
    private const ART_ABGESCHLOSSEN = 'turnier.abgeschlossen';
    /** shared/protokoll.ts ARTEN_SPIELER / ARTEN_HELFER */
    private const ARTEN_SPIELER = ['spiel.ergebnis', 'spiel.bestaetigt', 'spiel.angefochten', 'mannschaft.aufgestellt'];
    private const ARTEN_HELFER = ['spiel.ergebnis', 'spiel.aufgerufen', 'spiel.aufruf_zurueck', 'mannschaft.aufgestellt'];
    private const MAX_CODES = 400;
    /** shared/protokoll.ts ALLE_AUFGABEN, HELFER_STANDARD, ARTEN_JE_AUFGABE, NUR_VOLLE_SICHT */
    private const AUFGABEN = ['ergebnisse', 'aufruf', 'kasse', 'oberschiri'];
    private const HELFER_STANDARD = ['ergebnisse', 'aufruf'];
    private const ARTEN_JE_AUFGABE = [
        'ergebnisse' => ['spiel.ergebnis', 'mannschaft.aufgestellt'],
        'aufruf' => ['spiel.aufgerufen', 'spiel.aufruf_zurueck'],
        'kasse' => ['startgeld.gebucht', 'startgeld.storniert', 'teilnehmer.eingecheckt', 'konkurrenz.checkin', 'praemie.ausgezahlt'],
        'oberschiri' => ['spiel.ergebnis', 'spiel.entschieden', 'spiel.zurueckgesetzt', 'mannschaft.aufgestellt'],
    ];
    /** Spiel-IDs, für die es Aufstellungen gibt: Gruppen „g<nr>-<A>-<B>“, K.-o. „ko|tr|vl|fi-<runde>-<nr>“, „ko-p3“ */
    private const SPIEL_ID_MANNSCHAFT = '/^(g\d{1,3}-m-[A-Za-z0-9-]{4,38}-m-[A-Za-z0-9-]{4,38}|(ko|tr|vl|fi)-\d{1,2}-\d{1,3}|ko-p3)$/';
    /** @var array<string,array<string,array{spieler:list<string>,fuehrer:?string}>> je Anfrage */
    private array $mannschaftenCache = [];
    private const NUR_VOLLE_SICHT = ['startgeld.gebucht', 'startgeld.storniert', 'teilnehmer.eingecheckt', 'praemie.ausgezahlt'];
    private const MAX_POOL = 3000;
    private const MAX_UEBERSICHT = 60000;
    private const MAX_SICHERUNG_BYTES = 6 * 1024 * 1024;

    /** @var callable():int */
    private $uhr;
    /** Anschluss der laufenden Anfrage (für Bremsen) */
    private string $ip = '';
    private readonly Mailer $mailer;
    private readonly Anmeldung $anmeldung;
    public readonly Sparten $sparten;
    public readonly Nachrichten $nachrichten;

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
        $this->anmeldung = new Anmeldung($this, $db);
        $this->sparten = new Sparten($this, $db);
        $this->nachrichten = new Nachrichten($this, $db, $this->mailer, $config);
    }

    /** Adresse der App mit abschließendem „/“, z. B. https://saschaurban.de/tt-turnier/ */
    public function appUrl(): string
    {
        $u = trim((string)($this->config['app_url'] ?? ''));
        return $u === '' ? '' : rtrim($u, '/') . '/';
    }

    private function adminMail(): string
    {
        return trim((string)($this->config['mail']['admin'] ?? ''));
    }

    /** Mails mit Links sind nur sinnvoll, wenn Versand und Adresse der App eingerichtet sind. */
    public function mailBereit(): bool
    {
        return $this->mailer->bereit() && $this->appUrl() !== '';
    }

    /** System-Mail an eine Person. Antworten gehen an den Administrator. Scheitert still (protokolliert). */
    /** @param string|null $antwortAn Antworten an diese Adresse (z. B. Turnierleitung) statt an den Betreiber */
    public function mail(string $an, string $betreff, string $text, ?string $anhangName = null, ?string $anhang = null, ?string $antwortAn = null): bool
    {
        $antwort = $antwortAn ?? ($this->adminMail() ?: null);
        $ok = $this->mailer->senden(new Mail($an, $betreff, $text . $this->mailFuss($antwortAn !== null), $antwort, $anhangName, $anhang));
        if (!$ok) {
            error_log('tt-turnier: Mail ' . $this->logKennung($an) . ' konnte nicht sofort gesendet werden');
            // Ab 0.18: ohne Anhang später erneut versuchen (Warteschlange, bis zu sechs Versuche)
            // Mails mit geheimen Links (Passwort, Bestätigung) nicht speichern – die DB kennt sonst nur deren Hashes
            if ($anhang === null && $this->mailer->bereit() && !preg_match('/[a-f0-9]{48,}/', $text)) {
                try {
                    $this->nachrichten->vormerken($an, $betreff, $text . $this->mailFuss($antwortAn !== null), $antwort, 'system', null, null, [], 1);
                    return true;
                } catch (\Throwable $t) {
                    error_log('tt-turnier: Warteschlange: ' . $t->getMessage());
                }
            }
        }
        return $ok;
    }

    /** Pseudonym einer Adresse fürs Server-Protokoll (HMAC mit dem Server-Geheimnis, nicht zurückrechenbar) */
    public function logKennung(string $adresse): string
    {
        return substr(hash_hmac('sha256', strtolower($adresse), $this->geheimnis()), 0, 12);
    }

    /** Fußzeile aller Mails; $leitung: Antworten erreichen die Turnierleitung statt den Betreiber */
    public function mailFuss(bool $leitung): string
    {
        return "\n\n-- \nTischtennis-Turnier · " . $this->appUrl()
            . "\nDiese Mail wurde automatisch versendet. Antworten erreichen " . ($leitung ? 'die Turnierleitung.' : 'den Betreiber.');
    }

    /** Geheimnis des Servers (für Prüfsummen in Links, z. B. Abmelden vom Verteiler); beim ersten Bedarf erzeugt */
    public function geheimnis(): string
    {
        $z = $this->db->eine("SELECT wert FROM meta WHERE schluessel = 'geheimnis'");
        if ($z !== null && strlen((string)$z['wert']) === 64) {
            return (string)$z['wert'];
        }
        try {
            $this->db->ausfuehren("INSERT INTO meta (schluessel, wert) VALUES ('geheimnis', ?)", [bin2hex(random_bytes(32))]);
        } catch (\PDOException) {
            // gleichzeitig angelegt
        }
        return (string)($this->db->eine("SELECT wert FROM meta WHERE schluessel = 'geheimnis'")['wert'] ?? '');
    }

    public function jetzt(): int
    {
        return ($this->uhr)();
    }

    public static function iso(?int $ts): ?string
    {
        return $ts === null ? null : gmdate('Y-m-d\TH:i:s\Z', $ts);
    }

    public function bearbeiten(Anfrage $a): Antwort
    {
        try {
            $this->ip = $a->ip;
            $this->sparten->cacheLeeren();
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
                'POST konto.bedingungen' => $this->bedingungenAnnehmen($a),
                'GET sparte' => $this->sparten->sparte($a),
                'GET sparte.favoriten' => $this->sparten->favoriten($a),
                'POST sparte.favoriten' => $this->sparten->favoritenSpeichern($a),
                'GET sparten' => $this->sparten->sparten($a),
                'POST sparte.anlegen' => $this->sparten->anlegen($a),
                'POST sparte.aendern' => $this->sparten->aendern($a),
                'POST sparte.anmeldung' => $this->sparten->anmeldungFreigeben($a),
                'POST sparte.loeschen' => $this->sparten->loeschen($a),
                'POST sparte.einladen' => $this->sparten->einladenSparte($a),
                'POST einladung.info' => $this->sparten->einladungInfo($a),
                'POST einladung.annehmen' => $this->sparten->einladungAnnehmen($a),
                'POST einladung.zurueckziehen' => $this->sparten->einladungZurueckziehen($a),
                'POST mitglied.aendern' => $this->sparten->mitgliedAendern($a),
                'POST mitglied.entfernen' => $this->sparten->mitgliedEntfernen($a),
                'GET turnier.konten' => $this->sparten->turnierKonten($a),
                'POST turnier.konto.entfernen' => $this->sparten->turnierKontoEntfernen($a),
                'GET ausschuss' => $this->sparten->ausschuss($a),
                'POST ausschuss.anlegen' => $this->sparten->ausschussAnlegen($a),
                'POST ausschuss.einladen' => $this->sparten->ausschussEinladen($a),
                'POST ausschuss.sperren' => $this->sparten->ausschussSperren($a),
                'POST ausschuss.verlassen' => $this->sparten->ausschussVerlassen($a),
                'POST ausschuss.nachricht' => $this->sparten->ausschussNachricht($a),
                'POST ausschuss.loeschen' => $this->sparten->ausschussLoeschen($a),
                'POST veranstaltung.anlegen' => $this->sparten->veranstaltungAnlegen($a),
                'POST veranstaltung.loeschen' => $this->sparten->veranstaltungLoeschen($a),
                'POST sicherung.bestaetigen' => $this->sicherungBestaetigen($a),
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
                'POST code.aufgaben' => $this->codeAufgaben($a),
                'GET anmeldung' => $this->anmeldung->info($a),
                'POST anmeldung.senden' => $this->anmeldung->senden($a),
                'POST anmeldung.bestaetigen' => $this->anmeldung->bestaetigen($a),
                'POST anmeldung.partner' => $this->anmeldung->partner($a),
                'POST anmeldung.stand' => $this->anmeldung->standAbrufen($a),
                'POST anmeldung.abmelden' => $this->anmeldung->abmelden($a),
                'GET anmeldungen' => $this->anmeldung->liste($a),
                'POST anmeldung.einstellungen' => $this->anmeldung->einstellungenSetzen($a),
                'POST anmeldung.aendern' => $this->anmeldung->aendern($a),
                'POST anmeldung.uebernommen' => $this->anmeldung->uebernommen($a),
                'POST anmeldung.loeschen' => $this->anmeldung->loeschen($a),
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
                'GET nachrichten' => $this->nachrichten->postfach($a),
                'POST nachrichten.gelesen' => $this->nachrichten->gelesen($a),
                'POST rundmail' => $this->nachrichten->rundmail($a),
                'POST turnier.ergebnis' => $this->nachrichten->ergebnis($a),
                'POST verteiler.eintragen' => $this->nachrichten->eintragen($a),
                'POST verteiler.bestaetigen' => $this->nachrichten->bestaetigen($a),
                'POST verteiler.abmelden' => $this->nachrichten->abmelden($a),
                'GET verteiler' => $this->nachrichten->liste($a),
                'POST verteiler.entfernen' => $this->nachrichten->entfernen($a),
                'POST verteiler.senden' => $this->nachrichten->senden($a),
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

    /** @param bool $einzeilig Steuerzeichen/Zeilenumbrüche entfernen (Standard; nur Nachrichtentexte sind mehrzeilig) */
    public function text(Anfrage $a, string $feld, int $min = 1, int $max = 190, bool $einzeilig = true): string
    {
        $wert = $a->rumpf[$feld] ?? null;
        if (!is_string($wert)) {
            throw new ApiFehler('ungueltig', "Feld „{$feld}“ fehlt.");
        }
        // Steuerzeichen und Zeilenumbrüche entfernen (Namen landen in Mails – kein frei gestalteter Mailtext)
        $wert = $einzeilig ? trim(preg_replace('/[\p{Cc}\p{Cf}\x{2028}\x{2029}]+/u', ' ', $wert) ?? '') : trim($wert);
        $laenge = mb_strlen($wert);
        if ($laenge < $min || $laenge > $max) {
            throw new ApiFehler('ungueltig', "Feld „{$feld}“ muss {$min} bis {$max} Zeichen lang sein.");
        }
        return $wert;
    }

    public function email(Anfrage $a): string
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

    public function bremse(string $schluessel): void
    {
        if ($this->anzahlVersuche($schluessel, self::VERSUCHE_FENSTER) >= self::VERSUCHE_MAX) {
            throw new ApiFehler('zu_viele_versuche', 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
        }
    }

    public function anzahlVersuche(string $schluessel, int $fenster): int
    {
        $grenze = $this->jetzt() - $fenster;
        return (int)($this->db->eine('SELECT COUNT(*) AS n FROM versuche WHERE schluessel = ? AND zeit >= ?', [$schluessel, $grenze])['n'] ?? 0);
    }

    /** Höchstens $max Vorgänge je Fenster (z. B. neue Konten je IP und Stunde); zählt diesen Vorgang mit. */
    public function begrenzen(string $schluessel, int $max, int $fenster, string $meldung): void
    {
        if ($this->anzahlVersuche($schluessel, $fenster) >= $max) {
            throw new ApiFehler('zu_viele_versuche', $meldung);
        }
        $this->fehlversuch($schluessel);
    }

    /** Fangfeld für Bots: echte Nutzer sehen das Feld nicht und lassen es leer. */
    public function fangfeld(Anfrage $a): void
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

    public function fehlversuch(string $schluessel): void
    {
        $this->db->ausfuehren('INSERT INTO versuche (schluessel, zeit) VALUES (?, ?)', [$schluessel, $this->jetzt()]);
    }

    public function versucheLoeschen(string $schluessel): void
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
    public function sitzung(Anfrage $a): ?array
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

    /**
     * Angemeldetes Konto. Ab 0.17 müssen die Nutzungsbedingungen (mit AVV) in der aktuellen Fassung
     * angenommen sein (Administrator ausgenommen); sonst Fehler „bedingungen“ – die App fragt dann nach.
     * @return array{konto_id:int,turnier_id:?string,rolle:string,name:string}
     */
    private function konto(Anfrage $a, bool $nurAdmin = false, bool $ohneBedingungen = false): array
    {
        $s = $this->sitzung($a);
        if ($s === null || $s['konto_id'] === null) {
            throw new ApiFehler('nicht_angemeldet', 'Bitte zuerst anmelden.');
        }
        if ($nurAdmin && $s['rolle'] !== 'admin') {
            throw new ApiFehler('keine_berechtigung', 'Nur für den Administrator.');
        }
        if (!$ohneBedingungen && !$this->bedingungenAngenommen((int)$s['konto_id'])) {
            throw new ApiFehler('bedingungen', 'Bitte zuerst den Nutzungsbedingungen (mit Vereinbarung zur Auftragsverarbeitung) zustimmen.');
        }
        return $s;
    }

    /** Für Sparten.php: angemeldetes Konto (mit angenommenen Bedingungen) */
    public function kontoSitzung(Anfrage $a, bool $nurAdmin = false): array
    {
        return $this->konto($a, $nurAdmin);
    }

    public function bedingungenAngenommen(int $konto): bool
    {
        $k = $this->db->eine('SELECT rolle, bedingungen FROM konten WHERE id = ?', [$konto]);
        return $k !== null && ($k['rolle'] === 'admin' || (string)($k['bedingungen'] ?? '') === self::BEDINGUNGEN_FASSUNG);
    }

    /** POST konto.bedingungen { zustimmung: true } – aktuelle Fassung annehmen (bestehende Konten beim nächsten Anmelden) */
    private function bedingungenAnnehmen(Anfrage $a): array
    {
        $s = $this->konto($a, false, true);
        if (($a->rumpf['zustimmung'] ?? false) !== true || ($a->rumpf['volljaehrig'] ?? false) !== true) {
            throw new ApiFehler('ungueltig', 'Bitte den Nutzungsbedingungen zustimmen und bestätigen, dass du mindestens 18 Jahre alt bist.');
        }
        $this->db->ausfuehren('UPDATE konten SET bedingungen = ? WHERE id = ?', [self::BEDINGUNGEN_FASSUNG, (int)$s['konto_id']]);
        // Spartenleitung: Zustimmung gilt auch als AVV der Sparte(n), für die sie noch fehlt
        foreach ($this->db->alle("SELECT sparte_id FROM mitglieder WHERE konto_id = ? AND rolle = 'spartenleitung'", [(int)$s['konto_id']]) as $m) {
            $this->db->ausfuehren('UPDATE sparten SET avv = ?, avv_konto = ? WHERE id = ? AND avv IS NULL', [$this->jetzt(), (int)$s['konto_id'], (int)$m['sparte_id']]);
        }
        return $this->kontoVoll((int)$s['konto_id']);
    }

    /** Konto mit Sparten, Ausschüssen und Stand der Bedingungen (Anmeldung, ich) */
    private function kontoVoll(int $kontoId): array
    {
        $k = $this->db->eine('SELECT * FROM konten WHERE id = ?', [$kontoId]);
        return self::kontoAusgabe($k) + $this->sparten->fuerKonto($kontoId)
            + ['bedingungen' => $k['rolle'] === 'admin' || (string)($k['bedingungen'] ?? '') === self::BEDINGUNGEN_FASSUNG];
    }

    /** Passwort des Kontos prüfen (gebremst) – für Löschungen */
    public function passwortPruefen(Anfrage $a, int $kontoId): void
    {
        $bremse = 'loeschen|' . $a->ip;
        $this->bremse($bremse);
        $k = $this->db->eine('SELECT passwort_hash FROM konten WHERE id = ?', [$kontoId]);
        if ($k === null || !password_verify((string)($a->rumpf['passwort'] ?? ''), (string)$k['passwort_hash'])) {
            $this->fehlversuch($bremse);
            throw new ApiFehler('falsche_zugangsdaten', 'Das Passwort ist falsch.');
        }
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
            'sparte' => ($z['sparte_id'] ?? null) === null ? null : (int)$z['sparte_id'],
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
    /** Turnierkennung aus einer Anfrage: Leerzeichen raus, Großbuchstaben (Kennungen sind ohne Groß/klein) */
    public static function turnierId(mixed $id): string
    {
        return is_string($id) ? strtoupper((string)preg_replace('/\s+/', '', $id)) : '';
    }

    public function turnierLaden(string $id): array
    {
        $id = self::turnierId($id);
        $t = preg_match(self::TURNIER_ID_MUSTER, $id)
            ? $this->db->eine(
                'SELECT t.*, v.name AS veranstalter FROM turniere t LEFT JOIN sparten sp ON sp.id = t.sparte_id
                 LEFT JOIN vereine v ON v.id = sp.verein_id WHERE t.id = ?',
                [$id]
            )
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

    /** Neue Turnierkennung: 8 Zeichen ohne Verwechsler (0/O, 1/I/L), mit Buchstaben und Ziffern, frei */
    private function neueTurnierId(): string
    {
        $n = strlen(self::KENNUNG_ZEICHEN);
        for ($versuch = 0; $versuch < 1000; $versuch++) {
            $id = '';
            for ($i = 0; $i < 8; $i++) {
                $id .= self::KENNUNG_ZEICHEN[random_int(0, $n - 1)];
            }
            if (preg_match('/[A-Z]/', $id) && preg_match('/[0-9]/', $id) && $this->kennungFrei($id)) {
                return $id;
            }
        }
        throw new ApiFehler('serverfehler', 'Es konnte keine Turnierkennung erzeugt werden.');
    }

    /** Kennung weder vergeben noch nach einer Löschung gesperrt */
    private function kennungFrei(string $id): bool
    {
        return $this->db->eine('SELECT id FROM turniere WHERE id = ?', [$id]) === null
            && $this->db->eine('SELECT id FROM kennungen_gesperrt WHERE id = ? AND bis >= ?', [$id, $this->jetzt()]) === null;
    }

    /** Wunschkennung prüfen (4–12 Zeichen A–Z, 0–9, Bindestrich, nicht am Rand) */
    private function wunschKennung(mixed $wunsch): string
    {
        $id = self::turnierId($wunsch);
        if (!preg_match(self::TURNIER_ID_MUSTER, $id) || str_contains($id, '--')) {
            throw new ApiFehler('ungueltig', 'Die Wunschkennung braucht 4 bis 12 Zeichen: Buchstaben A–Z, Ziffern und Bindestriche (nicht am Anfang oder Ende).');
        }
        if (!$this->kennungFrei($id)) {
            throw new ApiFehler('konflikt', 'Die Kennung „' . $id . '“ ist schon vergeben. Bitte eine andere wählen.');
        }
        return $id;
    }

    /** Kennung für Leitung/Helfer, die der Server selbst vergibt (Bezug) */
    private static function neuerBezug(string $vorsilbe): string
    {
        return $vorsilbe . '-' . bin2hex(random_bytes(5));
    }

    /** Aufgaben aus der Datenbank (JSON-Liste) bzw. Anfrage; ungültige fallen weg, Reihenfolge fest */
    private static function aufgabenLesen(mixed $roh): array
    {
        if (is_string($roh)) {
            $roh = json_decode($roh, true);
        }
        if (!is_array($roh)) {
            return self::HELFER_STANDARD;
        }
        return array_values(array_filter(self::AUFGABEN, static fn(string $x): bool => in_array($x, $roh, true)));
    }

    /** Aufgaben einer Helfer-Sitzung – live aus der Kennung, damit Änderungen sofort gelten */
    private function aufgabenDerSitzung(array $s): array
    {
        if ($s['rolle'] !== 'helfer' || $s['turnier_id'] === null || $s['bezug'] === null) {
            return [];
        }
        $c = $this->db->eine("SELECT aufgaben FROM codes WHERE turnier_id = ? AND rolle = 'helfer' AND bezug = ?", [$s['turnier_id'], $s['bezug']]);
        return $c === null ? [] : self::aufgabenLesen($c['aufgaben']);
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
            'aufgaben' => true,
            'anmeldung' => $this->mailBereit(),
            'sparten' => true,
            'bedingungen' => self::BEDINGUNGEN_FASSUNG,
            // ab 0.18: Posteingang je Kennung, Rundmail, Ergebnis-Mail, Verteiler
            'nachrichten' => true,
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
        // Eigene Sparte für den Betreiber (Tests, Vorführung); weitere legt er wie jedes Konto an
        $k = $this->db->eine('SELECT id FROM konten WHERE email = ?', [$email]);
        $this->sparten->neueSparte(is_string($a->rumpf['verein'] ?? null) && trim($a->rumpf['verein']) !== '' ? $this->text($a, 'verein', 2, 160) : $name, 'Tischtennis', (int)$k['id'], true);
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
        return ['token' => $token, 'konto' => $this->kontoVoll($kontoId)];
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
        if ($s['rolle'] === 'helfer') {
            $antwort['aufgaben'] = $this->aufgabenDerSitzung($s);
        }
        if ($s['konto_id'] !== null) {
            $antwort['konto'] = $this->kontoVoll((int)$s['konto_id']);
        }
        return $antwort;
    }

    private function passwortAendern(Anfrage $a): array
    {
        $s = $this->konto($a, false, true);
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
        // Eigene Sparte; Nutzungsbedingungen und AVV bestätigt die Person beim ersten Anmelden
        $this->sparten->neueSparte(is_string($a->rumpf['verein'] ?? null) && trim($a->rumpf['verein']) !== '' ? $this->text($a, 'verein', 2, 160) : $name, 'Tischtennis', (int)$k['id'], false);
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

    /**
     * Darf dieses Konto Online-Anmeldungen anbieten? (Schutz davor, dass ein frisch angelegtes Konto die
     * Anmeldung als Mail-Schleuder nutzt.) Admin immer; sonst Freigabe durch den Admin oder Kontoalter.
     * @return array{erlaubt:bool,ab:?string}
     */
    public function anmeldungFreigabe(array $t): array
    {
        // ab 0.17 je Sparte: Alter der Sparte bzw. Freigabe durch den Administrator; Sparten des Admins immer
        $sp = $t['sparte_id'] === null ? null : $this->db->eine('SELECT angelegt, anmeldung_frei FROM sparten WHERE id = ?', [(int)$t['sparte_id']]);
        $k = $this->db->eine('SELECT rolle, gesperrt FROM konten WHERE id = ?', [(int)$t['konto_id']]);
        if ($sp === null || $k === null || (int)$k['gesperrt'] === 1) {
            return ['erlaubt' => false, 'ab' => null];
        }
        $adminSparte = $this->db->eine("SELECT k.id FROM mitglieder m JOIN konten k ON k.id = m.konto_id WHERE m.sparte_id = ? AND k.rolle = 'admin' LIMIT 1", [(int)$t['sparte_id']]) !== null;
        if ($adminSparte || ($sp['anmeldung_frei'] !== null && (int)$sp['anmeldung_frei'] === 1)) {
            return ['erlaubt' => true, 'ab' => null];
        }
        if ($sp['anmeldung_frei'] !== null) {
            return ['erlaubt' => false, 'ab' => null];
        }
        $ab = (int)$sp['angelegt'] + self::ANMELDUNG_NACH_TAGEN * self::TAG;
        return ['erlaubt' => $this->jetzt() >= $ab, 'ab' => self::iso($ab)];
    }

    private function turniere(Anfrage $a): array
    {
        $s = $this->konto($a);
        $sel = 'SELECT t.*, v.name AS veranstalter FROM turniere t LEFT JOIN sparten sp ON sp.id = t.sparte_id LEFT JOIN vereine v ON v.id = sp.verein_id';
        if ($s['rolle'] === 'admin' && ($a->query['alle'] ?? '') === '1') {
            $zeilen = $this->db->alle("$sel ORDER BY t.angelegt DESC");
        } else {
            // Turniere der Sparten mit Spartenleitung und die mit eigenem Konto-Zugang
            $zeilen = $this->db->alle(
                "$sel WHERE t.sparte_id IN (SELECT sparte_id FROM mitglieder WHERE konto_id = ? AND rolle = 'spartenleitung')
                 OR (t.id IN (SELECT turnier_id FROM turnier_zugaenge WHERE konto_id = ?)
                     AND t.sparte_id IN (SELECT sparte_id FROM mitglieder WHERE konto_id = ?))
                 ORDER BY t.angelegt DESC",
                [$s['konto_id'], $s['konto_id'], $s['konto_id']]
            );
        }
        return ['turniere' => array_map([self::class, 'turnierAusgabe'], $zeilen)];
    }

    /** Grenzen für neue Turniere (Admin ausgenommen): je Sparte höchstens TURNIERE_JE_KONTO, je Konto und Tag TURNIERE_JE_TAG */
    private function turnierGrenzenPruefen(array $s, int $sparte): void
    {
        if ($s['rolle'] === 'admin') {
            return;
        }
        $anzahl = (int)($this->db->eine('SELECT COUNT(*) AS n FROM turniere WHERE sparte_id = ?', [$sparte])['n'] ?? 0);
        if ($anzahl >= self::TURNIERE_JE_KONTO) {
            throw new ApiFehler('zu_gross', 'Die Sparte hat die Höchstzahl von ' . self::TURNIERE_JE_KONTO . ' Turnieren erreicht. Bitte alte Turniere löschen.');
        }
        if ($this->anzahlVersuche('turnier-anlegen|' . $s['konto_id'], self::TAG) >= self::TURNIERE_JE_TAG) {
            throw new ApiFehler('zu_viele_versuche', 'Heute wurden schon sehr viele Turniere angelegt. Bitte morgen weitermachen oder alte Testturniere verwenden.');
        }
    }

    /** Erst nach erfolgreichem Anlegen zählen (fehlerhafte Versuche verbrauchen nichts) */
    private function turnierGezaehlt(array $s): void
    {
        if ($s['rolle'] !== 'admin') {
            $this->fehlversuch('turnier-anlegen|' . $s['konto_id']);
        }
    }

    private function turnierAnlegen(Anfrage $a): array
    {
        $s = $this->konto($a);
        $sp = $this->sparten->sparteFuer($s, $a->rumpf['sparte'] ?? null, 'anlegen');
        $name = $this->text($a, 'name', 2, 160);
        $datum = $a->rumpf['datum'] ?? null;
        if ($datum !== null && (!is_string($datum) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum))) {
            throw new ApiFehler('ungueltig', 'Datum im Format JJJJ-MM-TT angeben.');
        }
        $frist = $a->rumpf['loeschenNach'] ?? 12;
        if (!is_int($frist) || !in_array($frist, self::LOESCHFRISTEN, true)) {
            throw new ApiFehler('ungueltig', 'Löschfrist: 12 oder 24 Monate.');
        }
        $this->turnierGrenzenPruefen($s, (int)$sp['id']);
        $konto = $this->db->eine('SELECT email FROM konten WHERE id = ?', [$s['konto_id']]);
        $empfaenger = array_key_exists('sicherungAn', $a->rumpf ?? [])
            ? $this->empfaengerFeld($a->rumpf['sicherungAn'])
            : [(string)($konto['email'] ?? '')];
        // Fremde Empfänger nur bei freigegebener Sparte (vor dem Anlegen prüfen, nichts halb anlegen)
        $fremd = array_diff(array_map('mb_strtolower', array_filter($empfaenger)), [mb_strtolower((string)($konto['email'] ?? ''))]);
        if ($fremd !== [] && !$this->anmeldungFreigabe(['sparte_id' => (int)$sp['id'], 'konto_id' => (int)$s['konto_id']])['erlaubt']) {
            throw new ApiFehler('keine_berechtigung', 'Neue Sparten können Sicherungen in den ersten ' . self::ANMELDUNG_NACH_TAGEN . ' Tagen nur an die eigene Adresse senden.');
        }
        $wunsch = $a->rumpf['kennung'] ?? null;
        $id = is_string($wunsch) && trim($wunsch) !== '' ? $this->wunschKennung($wunsch) : $this->neueTurnierId();
        try {
            $this->db->ausfuehren(
                'INSERT INTO turniere (id, konto_id, name, datum, leitung_hash, leitung_code, sicherung_an, sicherung_takt, angelegt, sparte_id, loeschen_nach)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$id, $s['konto_id'], $name, $datum, password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT), null,
                 json_encode(array_values(array_filter($empfaenger))), 30, $this->jetzt(), (int)$sp['id'], $frist]
            );
        } catch (\PDOException $e) {
            if (Datenbank::istEindeutigkeitsFehler($e)) {
                throw new ApiFehler('konflikt', 'Die Kennung „' . $id . '“ ist schon vergeben. Bitte eine andere wählen.');
            }
            throw $e;
        }
        // Turnierleitung (nicht Spartenleitung): Zugang zum eigenen Turnier
        if (!$sp['_leitung']) {
            $this->db->ausfuehren('INSERT INTO turnier_zugaenge (turnier_id, konto_id, angelegt) VALUES (?, ?, ?)', [$id, (int)$s['konto_id'], $this->jetzt()]);
        }
        $this->turnierGezaehlt($s);
        $t = $this->turnierLaden($id);
        $this->empfaengerVormerken($t, array_values(array_filter($empfaenger)), $s);
        // Leitungskennung für die anlegende Person (weitere legt die Leitung unter „Zugänge“ an)
        $leitung = $this->codeAnlegen($t, 'leitung', self::neuerBezug('l'), $s['name'], null, (int)$s['konto_id']);
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
            if ($aus['rechte'] === 'helfer') {
                $aus['aufgaben'] = $this->aufgabenDerSitzung($s);
            }
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
        if ($rolle === 'helfer') {
            $antwort['aufgaben'] = self::aufgabenLesen($c['aufgaben'] ?? null);
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
        // Bis hierher gelesen (auch wenn der Datenschutz-Filter Einträge weglässt)
        $bis = $zeilen === [] ? $ab : (int)$zeilen[count($zeilen) - 1]['seq'];
        $hoechste = (int)($this->db->eine('SELECT MAX(seq) AS m FROM ereignisse WHERE turnier_id = ?', [$t['id']])['m'] ?? 0);
        $this->sicherungPruefen($t, $hoechste, false);
        $sicht = $this->sicht($a, $t);
        $liste = array_map(static fn(array $z): array => [
            'seq' => (int)$z['seq'],
            'id' => (string)$z['event_id'],
            'art' => (string)$z['art'],
            'daten' => json_decode((string)$z['daten'], false),
            'zeit' => (string)$z['zeit'],
            'geraet' => (string)$z['geraet'],
            'empfangen' => self::iso((int)$z['empfangen']),
            'autor' => self::autorAusgabe($z),
        ], $zeilen);
        // Spieler und Zuschauer: Namen entfernter Spieler werden ersetzt (Etappe 10). Ändert sich die Menge,
        // ändert sich „filter“ – die Geräte holen dann alles neu ab.
        $weg = in_array($sicht, ['spieler', 'zuschauer', 'kurz'], true) ? $this->entfernteSpieler((string)$t['id']) : [];
        // Mannschaften: noch nicht aufgedeckte Aufstellungen (ab 0.13). In die Filter-Kennung gehen nur aufgedeckte
        // Begegnungen ein: Neu laden müssen die Geräte erst, wenn etwas sichtbar wird.
        $filter = $weg;
        // Begleitpersonen (ab 0.18): für Zuschauer ohne Namen, maßgeblich ist der letzte Stand je Person
        $begl = in_array($sicht, ['zuschauer', 'kurz'], true) ? $this->begleitpersonen((string)$t['id']) : [];
        foreach ($begl as $id => $_) {
            $filter['begleitung:' . $id] = true;
        }
        // Kasse-Helfer haben die volle Sicht (Zahlungen), sehen Aufstellungen aber erst nach dem Aufdecken (ab 0.16)
        $kasseSicht = $sicht === 'voll' && !$this->leitungsSicht($a, $t);
        if ($sicht !== 'voll' || $kasseSicht) {
            $bezug = null;
            if ($sicht === 'spieler' || $sicht === 'helfer') {
                try {
                    $bezug = ($this->sitzung($a) ?? [])['bezug'] ?? null;
                } catch (ApiFehler) {
                    $bezug = null;
                }
            }
            [$verdeckt, $offen] = $this->verdeckteAufstellungen((string)$t['id'], $bezug === null ? null : (string)$bezug);
            $liste = $kasseSicht
                ? array_values(array_filter($liste, static fn(array $e): bool => !isset($verdeckt[$e['id']])))
                : array_values(array_map(
                    static fn(array $e): array => self::gefiltert($e, $sicht, $weg, $begl),
                    array_filter($liste, static fn(array $e): bool => !in_array($e['art'], self::NUR_VOLLE_SICHT, true) && !isset($verdeckt[$e['id']]))
                ));
            foreach ($offen as $schluessel => $_) {
                $filter['aufgedeckt:' . $schluessel] = true;
            }
            // Eigene Kennung für die Kasse-Sicht: Wechselt ein Gerät zwischen Kasse und Leitung, holt es alles neu ab
            if ($kasseSicht) {
                $filter['sicht:kasse'] = true;
            }
        }
        return [
            'ereignisse' => $liste,
            'hoechsteSeq' => $hoechste,
            'mehr' => $mehr,
            'sicht' => $sicht,
            'bis' => $bis,
        ] + ($filter === [] ? [] : ['filter' => self::filterKennung($filter)]);
    }

    /**
     * Mannschaften laut letzter Meldung der Leitung je Konkurrenz: "<konkurrenz>|<id>" → [spieler, fuehrer].
     * @return array<string,array{spieler:list<string>,fuehrer:?string}>
     */
    private function mannschaftenLaut(string $turnierId): array
    {
        $zeilen = $this->db->alle(
            "SELECT daten FROM ereignisse WHERE turnier_id = ? AND art = 'mannschaft.gemeldet' AND autor_rolle IN ('leitung', 'admin', 'veranstalter') ORDER BY seq",
            [$turnierId]
        );
        $aus = [];
        foreach ($zeilen as $z) {
            $x = json_decode((string)$z['daten'], true);
            if (!is_array($x) || !is_string($x['konkurrenz'] ?? null) || !is_string($x['id'] ?? null) || !is_array($x['spieler'] ?? null)) {
                continue;
            }
            $aus[$x['konkurrenz'] . '|' . $x['id']] = [
                'spieler' => array_values(array_filter($x['spieler'], 'is_string')),
                'fuehrer' => is_string($x['fuehrer'] ?? null) ? $x['fuehrer'] : null,
            ];
        }
        return $aus;
    }

    /**
     * Ersatzregel und Wechsel einer Mannschafts-Konkurrenz laut den Einträgen der Leitung (konkurrenz.angelegt bzw.
     * konkurrenz.geaendert, letzter zählt) – wie die Engine (mannschaftEinstLesen). Ohne Angabe: kein Ersatz, kein Wechsel.
     * @return array{ersatz:int,wechsel:bool}
     */
    private function mannschaftsEinst(string $turnierId, string $konkurrenz): array
    {
        $aus = ['ersatz' => 0, 'wechsel' => false, 'e_ersatz' => 0, 'e_wechsel' => false];
        $zeilen = $this->db->alle(
            "SELECT art, daten FROM ereignisse WHERE turnier_id = ? AND art IN ('konkurrenz.angelegt', 'konkurrenz.geaendert', 'phase.gestartet') AND autor_rolle IN ('leitung', 'admin', 'veranstalter') ORDER BY seq",
            [$turnierId]
        );
        $gestartet = false;
        $koGestartet = false;
        foreach ($zeilen as $z) {
            $x = json_decode((string)$z['daten'], true);
            if (is_array($x) && $z['art'] === 'phase.gestartet' && ($x['konkurrenz'] ?? null) === $konkurrenz) {
                $gestartet = true; // danach ist das Spielsystem fest (FEST_NACH_START), die Endrunde bis zum K.-o.-Start nicht
                $koGestartet = $koGestartet || ($x['phase'] ?? null) === 'ko';
                continue;
            }
            if (!is_array($x) || ($x['id'] ?? null) !== $konkurrenz || ($koGestartet && $z['art'] === 'konkurrenz.geaendert')) {
                continue;
            }
            if (!is_array($x['einst'] ?? null)) {
                continue;
            }
            if ($z['art'] === 'konkurrenz.angelegt') {
                $aus = ['ersatz' => 0, 'wechsel' => false, 'e_ersatz' => 0, 'e_wechsel' => false];
            }
            // Vorrunde und (falls eingestellt) Endrunde; der Server nimmt das Großzügigere, die Engine entscheidet je Stufe
            $vorrunde = $gestartet && $z['art'] === 'konkurrenz.geaendert' ? null : ($x['einst']['mannschaft'] ?? null);
            foreach (['' => $vorrunde, 'e_' => $x['einst']['endrunde']['mannschaft'] ?? null] as $p => $m) {
                if (!is_array($m)) {
                    continue;
                }
                if (is_int($m['ersatz'] ?? null) && $m['ersatz'] >= 0 && $m['ersatz'] <= 4) {
                    $aus[$p . 'ersatz'] = $m['ersatz'];
                }
                if (is_bool($m['wechsel'] ?? null)) {
                    $aus[$p . 'wechsel'] = $m['wechsel'];
                }
            }
        }
        return ['ersatz' => max($aus['ersatz'], $aus['e_ersatz']), 'wechsel' => $aus['wechsel'] || $aus['e_wechsel']];
    }

    /**
     * Aufstellung von Helfern und Spielern prüfen (wie die Engine, zustand.ts aufstellen): Mannschaft und Gegner
     * gemeldet, Spieler aus der Mannschaft, keine doppelten Positionen, nicht leer; Gruppenspiel-ID passt genau;
     * Spielerkennung ohne Helferrecht nur als Mannschaftsführung; höchstens 5 Abgaben je Mannschaft und Begegnung.
     * Gibt die Fehlermeldung zurück oder null.
     */
    private function aufstellungPruefen(string $turnierId, mixed $daten, bool $spieler, bool $helfer, string $bezug): ?string
    {
        $roh = json_encode($daten);
        $d = json_decode((string)$roh, true);
        if (!is_array($d) || strlen((string)$roh) > 4096 || array_diff(array_keys($d), ['konkurrenz', 'spiel', 'mannschaft', 'gegner', 'einzel', 'doppel', 'wechsel']) !== []) {
            return 'Aufstellung ungültig.';
        }
        $k = $d['konkurrenz'] ?? null;
        $spiel = $d['spiel'] ?? null;
        $m = $d['mannschaft'] ?? null;
        $g = $d['gegner'] ?? null;
        $muster = '/^m-[A-Za-z0-9-]{4,38}$/';
        if (!is_string($k) || !is_string($spiel) || !preg_match(self::SPIEL_ID_MANNSCHAFT, $spiel) || !is_string($m) || !is_string($g) || $m === $g || !preg_match($muster, $m) || !preg_match($muster, $g)) {
            return 'Aufstellung ungültig.';
        }
        if (preg_match('/^g\d+-(.+)$/', $spiel, $t) && $t[1] !== "$m-$g" && $t[1] !== "$g-$m") {
            return 'Diese Mannschaften spielen nicht in dieser Begegnung.';
        }
        $teams = $this->mannschaftenCache[$turnierId] ??= $this->mannschaftenLaut($turnierId);
        $team = $teams["$k|$m"] ?? null;
        if ($team === null || !isset($teams["$k|$g"])) {
            return 'Mannschaft nicht gemeldet.';
        }
        // Spielerkennung: nur die Führung der eigenen Mannschaft; mit Helferrecht amtlich nur für Begegnungen,
        // in denen die eigene Mannschaft nicht spielt (wie die Engine)
        // ab 0.18 zählt auch die Führung (z. B. Begleitperson) als Mitglied
        $mitglied = in_array($bezug, $team['spieler'], true) || in_array($bezug, $teams["$k|$g"]['spieler'], true)
            || $team['fuehrer'] === $bezug || $teams["$k|$g"]['fuehrer'] === $bezug;
        if ($spieler && (!$helfer || $mitglied) && $team['fuehrer'] !== $bezug) {
            return 'Die Aufstellung gibt die Mannschaftsführung ab.';
        }
        $einzel = $d['einzel'] ?? [];
        $doppel = $d['doppel'] ?? [];
        if (!is_array($einzel) || !is_array($doppel) || count($einzel) > 8 || count($doppel) > 8) {
            return 'Aufstellung ungültig.';
        }
        $alle = [];
        foreach ($einzel as $x) {
            if ($x !== null) {
                $alle[] = $x;
            }
        }
        $imDoppel = [];
        foreach ($doppel as $p) {
            if ($p === null) {
                continue;
            }
            if (!is_array($p) || count($p) !== 2 || $p[0] === $p[1]) {
                return 'Aufstellung ungültig.';
            }
            array_push($imDoppel, $p[0], $p[1]);
        }
        foreach ([...$alle, ...$imDoppel] as $x) {
            if (!is_string($x) || !in_array($x, $team['spieler'], true)) {
                return 'In der Aufstellung steht ein Spieler, der nicht zur Mannschaft gehört.';
            }
        }
        // Ab 0.18: Ersatzregel (Anwesende übernehmen bis zu „ersatz“ weitere Einzelpositionen, jeder höchstens zwei)
        $me = $this->mannschaftsEinst($turnierId, $k);
        $doppelt = count($alle) - count(array_unique($alle));
        $haeufig = $alle === [] ? 0 : max(array_count_values($alle));
        if ($doppelt > $me['ersatz'] || $haeufig > 2 || count(array_unique($imDoppel)) !== count($imDoppel) || ($alle === [] && $imDoppel === [])) {
            return 'Aufstellung ungültig (leer oder doppelt besetzt).';
        }
        // Ab 0.18: Wechsel in der Begegnung (Teilspiel-Nummer → Spieler der Mannschaft), nur wenn eingestellt
        if (array_key_exists('wechsel', $d)) {
            $w = $d['wechsel'];
            if (!is_array($w) || ($w !== [] && !$me['wechsel']) || count($w) > 30) {
                return 'Wechsel ungültig.';
            }
            foreach ($w as $nr => $x) {
                if (!preg_match('/^[0-9]{1,2}$/D', (string)$nr) || (int)$nr < 1 || !is_string($x) || !in_array($x, $team['spieler'], true)) {
                    return 'Wechsel ungültig.';
                }
            }
        }
        $bisher = $this->db->alle(
            "SELECT daten FROM ereignisse WHERE turnier_id = ? AND art = 'mannschaft.aufgestellt' AND daten LIKE ?",
            [$turnierId, '%' . $m . '%']
        );
        $n = 0;
        $begegnungen = [];
        foreach ($bisher as $z) {
            $x = json_decode((string)$z['daten'], true);
            if (is_array($x) && ($x['mannschaft'] ?? null) === $m && ($x['konkurrenz'] ?? null) === $k) {
                $begegnungen[(string)($x['spiel'] ?? '')] = true;
                if (($x['spiel'] ?? null) === $spiel) {
                    $n++;
                }
            }
        }
        if (!isset($begegnungen[$spiel]) && count($begegnungen) >= 200) {
            return 'Zu viele Aufstellungen für diese Mannschaft.';
        }
        return $n >= 5 ? 'Diese Aufstellung wurde schon zu oft geändert. Bitte die Turnierleitung fragen.' : null;
    }

    /**
     * Aufstellungen, die Spieler, Helfer und Zuschauer noch nicht sehen (WO E 5: „ohne Kenntnis der gegnerischen
     * Aufstellung“). Aufgedeckt ist eine Begegnung erst, wenn sich zwei Aufstellungen gegenseitig als Gegner nennen
     * (A nennt B und B nennt A). Vorher sehen eine Aufstellung nur die volle Sicht und die Spieler der eigenen
     * Mannschaft. Kern der Zentrale: Zentrale.verdeckteAufstellungen.
     * @return array{0:array<string,true>,1:array<string,true>} [verdeckte Ereignis-IDs, aufgedeckte Begegnungen]
     */
    private function verdeckteAufstellungen(string $turnierId, ?string $bezug): array
    {
        $zeilen = $this->db->alle(
            "SELECT event_id, daten FROM ereignisse WHERE turnier_id = ? AND art = 'mannschaft.aufgestellt' ORDER BY seq",
            [$turnierId]
        );
        if ($zeilen === []) {
            return [[], []];
        }
        $meine = [];
        if ($bezug !== null) {
            foreach ($this->mannschaftenLaut($turnierId) as $schluessel => $team) {
                // ab 0.18 auch die Begleitperson als Mannschaftsführung
                if (in_array($bezug, $team['spieler'], true) || $team['fuehrer'] === $bezug) {
                    $meine[$schluessel] = true;
                }
            }
        }
        $liste = array_map(static fn(array $z): array => ['id' => (string)$z['event_id'], 'daten' => json_decode((string)$z['daten'], true)], $zeilen);
        return self::verdeckteAus($liste, $meine);
    }

    /**
     * @param list<array{id:string,daten:mixed}> $liste
     * @param array<string,true> $meine "<konkurrenz>|<mannschaft>" der eigenen Mannschaften
     * @return array{0:array<string,true>,1:array<string,true>}
     */
    public static function verdeckteAus(array $liste, array $meine): array
    {
        $nennt = []; // "<konkurrenz>|<spiel>" → mannschaft → gegner → true
        $teile = [];
        foreach ($liste as $e) {
            $d = is_array($e['daten']) ? $e['daten'] : [];
            $ok = is_string($d['konkurrenz'] ?? null) && is_string($d['spiel'] ?? null) && is_string($d['mannschaft'] ?? null) && is_string($d['gegner'] ?? null);
            $teile[] = $ok ? [$e['id'], $d['konkurrenz'] . '|' . $d['spiel'], $d['konkurrenz'], $d['mannschaft'], $d['gegner']] : [$e['id'], null, null, null, null];
            if ($ok) {
                $nennt[$d['konkurrenz'] . '|' . $d['spiel']][$d['mannschaft']][$d['gegner']] = true;
            }
        }
        $verdeckt = [];
        $offen = [];
        foreach ($teile as [$id, $schluessel, $k, $m, $g]) {
            $auf = $schluessel !== null && isset($nennt[$schluessel][$g][$m]);
            if ($auf) {
                $offen[$schluessel] = true;
            } elseif ($schluessel === null || !isset($meine["$k|$m"])) {
                $verdeckt[$id] = true;
            }
        }
        return [$verdeckt, $offen];
    }

    /** Kurzer Fingerabdruck der Menge entfernter Spieler (shared/protokoll.ts AbholenAntwort.filter) */
    public static function filterKennung(array $weg): string
    {
        $ids = array_keys($weg);
        sort($ids, SORT_STRING);
        return substr(hash('sha256', implode(',', $ids)), 0, 16);
    }

    /** IDs der Spieler, die die Leitung je als Begleitperson eingetragen hat (Kern: Zentrale.begleitpersonen) */
    private function begleitpersonen(string $turnierId): array
    {
        $zeilen = $this->db->alle(
            "SELECT daten FROM ereignisse WHERE turnier_id = ? AND art IN ('spieler.angelegt', 'spieler.geaendert') AND autor_rolle IN ('leitung', 'admin', 'veranstalter') ORDER BY seq",
            [$turnierId]
        );
        // Vorsichtig: wer je als Begleitperson eingetragen war, bleibt für Zuschauer ohne Namen (auch bei Rücknahmen)
        $aus = [];
        foreach ($zeilen as $z) {
            $d = json_decode((string)$z['daten'], true);
            if (is_array($d) && is_string($d['id'] ?? null) && ($d['begleitung'] ?? null) === true) {
                $aus[$d['id']] = true;
            }
        }
        return $aus;
    }

    /**
     * Spieler, die nicht mehr zum Turnier gehören: per „spieler.entfernt“ entfernt (nicht zurückgenommen)
     * oder deren Anlegen rückgängig gemacht wurde. Gleiche Regel wie die Engine (zurueckgenommeneEintraege),
     * nur für die Arten, die hier zählen; Kern der Zentrale: Zentrale.entfernteSpieler.
     * @return array<string,true>
     */
    private function entfernteSpieler(string $turnierId): array
    {
        $zeilen = $this->db->alle(
            "SELECT event_id, art, daten, autor_rolle FROM ereignisse WHERE turnier_id = ? AND art IN ('spieler.angelegt', 'spieler.entfernt', 'eintrag.zurueckgenommen') ORDER BY seq",
            [$turnierId]
        );
        return self::entfernteAus(array_map(static fn(array $z): array => [
            'id' => (string)$z['event_id'],
            'art' => (string)$z['art'],
            'daten' => json_decode((string)$z['daten'], true),
            'leitung' => in_array($z['autor_rolle'], ['leitung', 'admin', 'veranstalter'], true),
        ], $zeilen));
    }

    /** @param list<array{id:string,art:string,daten:mixed,leitung:bool}> $liste in Laufnummer-Reihenfolge */
    public static function entfernteAus(array $liste): array
    {
        $ziel = [];   // Ereignis-ID → [art, spieler]
        $zurueck = []; // Ereignis-ID → zurückgenommen?
        foreach ($liste as $e) {
            $d = is_array($e['daten']) ? $e['daten'] : [];
            if ($e['art'] === 'eintrag.zurueckgenommen') {
                if (!$e['leitung'] || !is_array($d['ereignisse'] ?? null)) {
                    continue;
                }
                $z = ($d['zurueck'] ?? true) !== false;
                foreach (array_slice($d['ereignisse'], 0, 200) as $id) {
                    if (is_string($id) && isset($ziel[$id])) {
                        $zurueck[$id] = $z;
                    }
                }
                continue;
            }
            $sp = $d['id'] ?? null;
            if (!is_string($sp) || ($e['art'] === 'spieler.entfernt' && !$e['leitung'])) {
                continue;
            }
            if (!isset($ziel[$e['id']])) {
                $ziel[$e['id']] = [$e['art'], $sp];
            }
        }
        $angelegt = []; // Spieler → mindestens ein gültiges Anlegen
        $entfernt = [];
        foreach ($ziel as $id => [$art, $sp]) {
            $gilt = !($zurueck[$id] ?? false);
            if ($art === 'spieler.angelegt') {
                $angelegt[$sp] = ($angelegt[$sp] ?? false) || $gilt;
            } elseif ($gilt) {
                $entfernt[$sp] = true;
            }
        }
        $weg = $entfernt;
        foreach ($angelegt as $sp => $gilt) {
            if (!$gilt) {
                $weg[$sp] = true;
            }
        }
        return $weg;
    }

    /**
     * Was ein Gerät beim Abholen sieht (Datenschutz, ab 0.9):
     * - voll: Leitung, Helfer, Spieler mit Helfer-Recht
     * - spieler: Spielerkennung – ohne Jahrgang, Geschlecht und Pool-Bezug (Datenminimierung)
     * - zuschauer: zusätzlich ohne Namen von Eintragenden und frei eingetippte Schiedsrichter-Namen
     * - kurz: wie zuschauer, Nachname nur als „M.“ (Einstellung der Leitung „Namen für Zuschauer“)
     */
    /** Hat diese Anfrage Leitungsrechte im Turnier? (volle Sicht ohne verdeckte Aufstellungen) */
    private function leitungsSicht(Anfrage $a, array $t): bool
    {
        if ($a->token === null) {
            return false;
        }
        try {
            $s = $this->sitzung($a);
        } catch (ApiFehler) {
            return false;
        }
        return $s !== null && $this->rechte($s, $t) === 'leitung';
    }

    private function sicht(Anfrage $a, array $t): string
    {
        if ($a->token !== null) {
            try {
                $s = $this->sitzung($a);
            } catch (ApiFehler) {
                $s = null; // gesperrtes Konto: wie Zuschauer
            }
            $r = $s === null ? null : $this->rechte($s, $t);
            if ($r === 'leitung' || ($r === 'helfer' && in_array('kasse', $this->aufgabenDerSitzung($s), true))) {
                return 'voll';
            }
            // Helfer ohne Aufgabe „Kasse“: alles außer Zahlungen, Check-in und Bankverbindung (ab 0.11)
            if ($r === 'helfer' || ($r === 'spieler' && $s['helfer'])) {
                return 'helfer';
            }
            if ($r === 'spieler') {
                return 'spieler';
            }
        }
        return $this->namenKurz((string)$t['id']) ? 'kurz' : 'zuschauer';
    }

    /** Letzte Einstellung der Leitung „Namen für Zuschauer“ (Ereignis turnier.daten, Feld namen) */
    private function namenKurz(string $turnierId): bool
    {
        // Jugendturnier ohne ausdrückliche Einstellung: Kurzform (Frage 7A)
        $namen = $this->turnierDatenWert($turnierId, 'namen', ['kurz', 'voll']);
        return $namen === 'kurz' || ($namen === null && $this->jugendturnier($turnierId));
    }

    /** Jugendturnier (ab 0.17, turnier.daten.jugend): keine Einzel-Online-Anmeldung */
    public function jugendturnier(string $turnierId): bool
    {
        return $this->turnierDatenWert($turnierId, 'jugend', [true, false]) === true;
    }

    /** Letzter gültiger Wert eines Feldes in turnier.daten (nur Einträge der Leitung) */
    private function turnierDatenWert(string $turnierId, string $feld, array $erlaubt): mixed
    {
        // Index (turnier_id, art, seq); LIKE als Vorfilter, gültig ist nur das Feld im JSON
        $zeilen = $this->db->alle(
            "SELECT daten FROM ereignisse WHERE turnier_id = ? AND art = 'turnier.daten' AND autor_rolle IN ('leitung', 'admin', 'veranstalter') AND daten LIKE ? ORDER BY seq DESC",
            [$turnierId, '%"' . $feld . '"%']
        );
        foreach ($zeilen as $z) {
            $d = json_decode((string)$z['daten'], true);
            if (is_array($d) && array_key_exists($feld, $d) && in_array($d[$feld], $erlaubt, true)) {
                return $d[$feld];
            }
        }
        return null;
    }

    /** Kurzform eines Nachnamens: „Müller“ → „M.“ */
    public static function kurzname(string $nachname): string
    {
        $n = trim($nachname);
        return $n === '' ? '' : mb_strtoupper(mb_substr($n, 0, 1)) . '.';
    }

    /**
     * @param array<string,mixed> $e
     * @param array<string,true> $weg entfernte Spieler (nur Sichten spieler/zuschauer/kurz)
     * @param array<string,true> $begl Begleitpersonen (nur Sichten zuschauer/kurz)
     */
    private static function gefiltert(array $e, string $sicht, array $weg = [], array $begl = []): array
    {
        if ($sicht === 'helfer') {
            if ($e['art'] === 'turnier.daten' && $e['daten'] instanceof \stdClass && property_exists($e['daten'], 'kasse')) {
                $d = clone $e['daten'];
                unset($d->kasse);
                $e['daten'] = $d;
            } elseif (($e['art'] === 'spieler.angelegt' || $e['art'] === 'spieler.geaendert') && $e['daten'] instanceof \stdClass) {
                // Datensparsamkeit (ab 0.12): Jahrgang, Geschlecht, Pool-Bezug, Lizenz und (ab 0.15) „geschätzt“ nur für Leitung und Kasse
                $d = clone $e['daten'];
                unset($d->jahrgang, $d->geschlecht, $d->pool, $d->lizenz, $d->ttrGeschaetzt);
                $e['daten'] = $d;
            }
            return $e;
        }
        $kurz = $sicht === 'kurz';
        $zuschauer = $sicht !== 'spieler';
        // Hat eine entfernte Person selbst eingetragen (eigene Kennung), steht ihr Name nicht mehr am Eintrag
        if (!$zuschauer && isset($e['autor']['spieler']) && isset($weg[$e['autor']['spieler']])) {
            $e['autor']['name'] = '';
        }
        if ($zuschauer) {
            $autor = ['rolle' => $e['autor']['rolle'], 'name' => ''];
            foreach (['spieler', 'helfer', 'aufgaben'] as $f) {
                if (isset($e['autor'][$f])) {
                    $autor[$f] = $e['autor'][$f];
                }
            }
            $e['autor'] = $autor;
        }
        $d = $e['daten'];
        if (!($d instanceof \stdClass)) {
            return $e;
        }
        $d = clone $d;
        if ($e['art'] === 'turnier.daten') {
            unset($d->kasse); // Kasse und Bankverbindung nur für Leitung und Helfer
        } elseif ($e['art'] === 'spieler.angelegt' || $e['art'] === 'spieler.geaendert') {
            unset($d->jahrgang, $d->geschlecht, $d->pool, $d->lizenz, $d->ttrGeschaetzt);
            if (isset($d->id) && is_string($d->id) && isset($weg[$d->id])) {
                // Entfernter Spieler: keine Angaben zur Person mehr (bleibt nur als Platzhalter im Protokoll)
                $d = (object)(['id' => $d->id] + ($e['art'] === 'spieler.angelegt' ? ['vorname' => self::ENTFERNT_NAME, 'nachname' => '', 'verein' => ''] : []));
            } elseif ($zuschauer && isset($d->id) && is_string($d->id) && isset($begl[$d->id])) {
                // Begleitperson (z. B. Elternteil als Mannschaftsleitung): für Zuschauer ohne Namen (ab 0.18)
                $d = (object)['id' => $d->id, 'vorname' => self::BEGLEITUNG_NAME, 'nachname' => '', 'verein' => '', 'begleitung' => true];
            } elseif ($kurz && isset($d->nachname) && is_string($d->nachname)) {
                $d->nachname = self::kurzname($d->nachname);
            }
        } elseif ($e['art'] === 'spiel.aufgerufen' && property_exists($d, 'schiri')) {
            $sp = $d->schiri instanceof \stdClass && isset($d->schiri->spieler) && is_string($d->schiri->spieler) ? $d->schiri->spieler : null;
            if ($sp === null && $zuschauer) {
                unset($d->schiri); // frei eingetippter Name: nicht für Zuschauer
            } elseif ($sp !== null && ($zuschauer || isset($weg[$sp]))) {
                $d->schiri = (object)['spieler' => $sp]; // Name kommt aus der Spielerliste (entfernt: „Entfernt“)
            }
        }
        $e['daten'] = $d;
        return $e;
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
        $aufgaben = $rolle === 'helfer' ? $this->aufgabenDerSitzung($s) : null;
        $erlaubt = match ($rolle) {
            // Spielerkennung mit Helferrecht darf beides
            'spieler' => (int)($s['helfer'] ?? 0) === 1 ? array_values(array_unique([...self::ARTEN_SPIELER, ...self::ARTEN_HELFER])) : self::ARTEN_SPIELER,
            'helfer' => array_values(array_unique(array_merge([], ...array_map(static fn(string $x): array => self::ARTEN_JE_AUFGABE[$x], $aufgaben ?? [])))),
            default => null,
        };
        $bezug = $rolle === 'spieler' || $rolle === 'helfer' ? $s['bezug'] : null;
        $helfer = $rolle === 'spieler' && $s['helfer'];

        $angenommen = [];
        $abgelehnt = [];
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
                $eid = is_array($e) && is_string($e['id'] ?? null) ? mb_substr($e['id'], 0, 64) : '';
                // Einzelne Einträge ablehnen statt den ganzen Block: die übrigen gelten, das Gerät
                // sendet den abgelehnten nicht erneut (ab 0.11)
                if ($erlaubt !== null && !in_array(is_array($e) ? ($e['art'] ?? null) : null, $erlaubt, true)) {
                    $abgelehnt[] = ['id' => $eid, 'fehler' => 'keine_berechtigung', 'meldung' => $rolle === 'helfer'
                        ? 'Diese Aufgabe hat deine Helferkennung nicht.'
                        : 'Mit dieser Kennung dürfen nur Ergebnisse eingetragen werden.'];
                    continue;
                }
                // Aufstellung von Helfern und Spielern: Inhalt wie die Engine prüfen (sonst ließe sich die verdeckte
                // Aufstellung des Gegners mit einer ungültigen eigenen aufdecken)
                if ($rolle !== 'leitung' && is_array($e) && ($e['art'] ?? null) === 'mannschaft.aufgestellt') {
                    $f = $this->aufstellungPruefen((string)$t['id'], $e['daten'] ?? null, $rolle === 'spieler', (bool)$helfer, (string)$bezug);
                    if ($f !== null) {
                        $abgelehnt[] = ['id' => $eid, 'fehler' => 'ungueltig', 'meldung' => $f];
                        continue;
                    }
                }
                try {
                    $seq = $this->einEreignis($t['id'], $e, $rolle, $s['name'], $bezug, $helfer, $aufgaben);
                } catch (ApiFehler $f) {
                    if ($f->code_ !== 'ungueltig') {
                        throw $f;
                    }
                    $abgelehnt[] = ['id' => $eid, 'fehler' => 'ungueltig', 'meldung' => $f->getMessage()];
                    continue;
                }
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
        $this->bankAenderungMelden($t, $liste, $angenommen, $s);
        $antwort = ['angenommen' => $angenommen, 'hoechsteSeq' => $hoechste];
        if ($abgelehnt !== []) {
            $antwort['abgelehnt'] = $abgelehnt;
        }
        return $antwort;
    }

    /**
     * Neue Bankverbindung (turnier.daten.kasse.iban) von jemand anderem als dem Eigentümer-Konto:
     * Das Konto bekommt eine Mail (Schutz gegen das Umleiten von Startgeldern über eine weitergegebene Kennung).
     */
    private function bankAenderungMelden(array $t, array $liste, array $angenommen, array $s): void
    {
        if (!$this->mailBereit() || $s['konto_id'] === (int)$t['konto_id']) {
            return;
        }
        $ok = array_column($angenommen, 'id');
        foreach ($liste as $e) {
            $e = $e instanceof \stdClass ? get_object_vars($e) : $e;
            $d = is_array($e) ? ($e['daten'] ?? null) : null;
            $d = $d instanceof \stdClass ? get_object_vars($d) : $d;
            $k = is_array($d) ? ($d['kasse'] ?? null) : null;
            $k = $k instanceof \stdClass ? get_object_vars($k) : $k;
            if (($e['art'] ?? '') === 'turnier.daten' && in_array($e['id'] ?? '', $ok, true) && is_array($k) && trim((string)($k['iban'] ?? '')) !== '') {
                $this->bankAenderungMailen($t, (string)$k['iban'], $s['name']);
                return;
            }
        }
    }

    public function bankAenderungMailen(array $t, string $iban, string $wer): void
    {
        $konto = $this->db->eine('SELECT email, name FROM konten WHERE id = ?', [(int)$t['konto_id']]);
        if ($konto === null) {
            return;
        }
        $iban = strtoupper(preg_replace('/\s+/', '', $iban) ?? '');
        $this->mail((string)$konto['email'], "Bankverbindung geändert: {$t['name']}", "Hallo {$konto['name']},\n\n"
            . "im Turnier „{$t['name']}“ wurde die Bankverbindung für Startgelder geändert.\n\n"
            . "Neue IBAN: " . trim(chunk_split($iban, 4, ' ')) . "\nGeändert von: {$wer}\nZeit: " . gmdate('d.m.Y H:i', $this->jetzt()) . " UTC\n\n"
            . "Warst das nicht du oder jemand aus deiner Turnierleitung? Dann prüfe bitte sofort die Einstellungen\n"
            . "des Turniers und gib die Leitungskennungen unter „Zugänge“ neu aus:\n" . $this->appUrl() . '#/t/' . $t['id']);
    }

    /** @param list<string>|null $aufgaben Helfer: Aufgaben der Kennung (im Autor gespeichert) */
    private function einEreignis(string $turnierId, mixed $e, string $rolle, string $name, ?string $bezug = null, bool $helfer = false, ?array $aufgaben = null): int
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
            'INSERT INTO ereignisse (turnier_id, event_id, art, daten, zeit, geraet, autor_rolle, autor_name, empfangen, autor_bezug, autor_helfer, autor_aufgaben)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$turnierId, $id, $art, $json, $zeit, $geraet, $rolle, $name, $this->jetzt(), $bezug, $helfer ? 1 : 0,
             $rolle === 'helfer' && $aufgaben !== null ? json_encode(array_values($aufgaben)) : null]
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
        // 5 je Stunde und Anschluss; nur Testumgebungen setzen in config.php einen höheren Wert (alle Tests laufen über 127.0.0.1)
        $max = max(1, (int)($this->config['registrieren_je_stunde'] ?? 5));
        $this->begrenzen($schluessel, $max, 3600, 'Von diesem Anschluss wurden gerade viele Konten angelegt. Bitte später erneut versuchen.');
        $this->fangfeld($a);
        $name = $this->text($a, 'name', 2, 120);
        $email = $this->email($a);
        $pw = $this->passwortFeld($a);
        // Ab 0.17: Konten ab 18 (Frage 9A); Nutzungsbedingungen mit AVV (Fragen 1A, 2A)
        if (($a->rumpf['volljaehrig'] ?? false) !== true) {
            throw new ApiFehler('ungueltig', 'Konten gibt es ab 18 Jahren. Bitte bestätigen, dass du mindestens 18 bist.');
        }
        if (($a->rumpf['bedingungen'] ?? false) !== true) {
            throw new ApiFehler('ungueltig', 'Bitte den Nutzungsbedingungen (mit Vereinbarung zur Auftragsverarbeitung) zustimmen.');
        }
        // Mit Einladung: Konto tritt der Sparte/dem Turnier/dem Ausschuss bei; sonst neue Sparte mit Verein
        $einladung = is_string($a->rumpf['einladung'] ?? null) ? $this->sparten->einladungFuerRegistrierung(
            new Anfrage('POST', '', [], ['schluessel' => $a->rumpf['einladung']], null, $a->ip), $email) : null;
        $verein = $einladung === null ? (is_string($a->rumpf['verein'] ?? null) && trim($a->rumpf['verein']) !== '' ? $this->text($a, 'verein', 2, 160) : $name) : '';
        $sparteName = $einladung === null ? (is_string($a->rumpf['sparte'] ?? null) && trim($a->rumpf['sparte']) !== '' ? $this->text($a, 'sparte', 2, 120) : 'Tischtennis') : '';
        $this->db->anfangen();
        try {
            $this->db->ausfuehren(
                'INSERT INTO konten (name, email, passwort_hash, rolle, gesperrt, angelegt, aktiv, bedingungen) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
                [$name, $email, password_hash($pw, PASSWORD_DEFAULT), 'veranstalter', $this->jetzt(), $this->jetzt(), self::BEDINGUNGEN_FASSUNG]
            );
            $k = $this->db->eine('SELECT * FROM konten WHERE email = ?', [$email]);
            if ($einladung !== null) {
                $this->sparten->einloesen($einladung, (int)$k['id']);
            } else {
                $this->sparten->neueSparte($verein, $sparteName, (int)$k['id'], true);
            }
            $this->db->festschreiben();
        } catch (\PDOException $e) {
            $this->db->zurueckrollen();
            if (Datenbank::istEindeutigkeitsFehler($e)) {
                throw new ApiFehler('konflikt', 'Für diese E-Mail-Adresse gibt es schon ein Konto. Bitte anmelden oder „Passwort vergessen?“ nutzen.');
            }
            throw $e;
        } catch (\Throwable $e) {
            $this->db->zurueckrollen();
            throw $e;
        }
        $antwort = $this->anmeldungAusgeben((int)$k['id']);

        if ($this->mailBereit()) {
            $url = $this->appUrl();
            $this->mail($email, 'Willkommen beim Tischtennis-Turnier', "Hallo {$name},\n\n"
                . ($einladung === null ? "dein Konto und die Sparte „{$sparteName}“ von „{$verein}“ sind angelegt. Du kannst sofort Turniere anlegen:\n{$url}\n\n"
                    : "dein Konto ist angelegt und die Einladung angenommen:\n{$url}\n\n")
                . "Angemeldet wirst du mit dieser E-Mail-Adresse ({$email}) und deinem Passwort.\n"
                . "Passwort vergessen? Auf der Anmeldeseite „Passwort vergessen?“ wählen.\n\n"
                . "Wird das Konto 12 Monate nicht genutzt, wird es gelöscht – bist du die einzige Spartenleitung, mit der Sparte\n"
                . "und ihren Turnieren; 30 Tage vorher kommt eine Erinnerung.\n"
                . "Nutzungsbedingungen: {$url}#/bedingungen\n"
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
        $s = $this->konto($a, false, true);
        if ($s['rolle'] === 'admin') {
            throw new ApiFehler('ungueltig', 'Das Administrator-Konto kann nicht gelöscht werden.');
        }
        $this->passwortPruefen($a, (int)$s['konto_id']);
        // Einzige Spartenleitung: Sparte wird mitgelöscht – nur mit ausdrücklicher Bestätigung
        $letzte = $this->sparten->letzteLeitungIn((int)$s['konto_id']);
        if ($letzte !== [] && ($a->rumpf['sparteLoeschen'] ?? false) !== true) {
            throw new ApiFehler('konflikt', 'Du bist die einzige Spartenleitung von „' . implode('“, „', array_map(static fn(array $x): string => $x['verein'] . ' – ' . $x['name'], $letzte))
                . '“. Mit dem Konto werden diese Sparten mit allen Turnieren gelöscht. Lade vorher eine weitere Spartenleitung ein oder bestätige das Löschen.');
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
        if (!$this->sparten->kontoLeitet($s, $t)) {
            throw new ApiFehler('keine_berechtigung', 'Nur die Turnierleitung mit Konto, die Spartenleitung oder der Administrator darf ein Turnier löschen.');
        }
        $this->passwortPruefen($a, (int)$s['konto_id']);
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

    /** Turnier mit allem löschen; die Kennung bleibt 180 Tage gesperrt (alte Links sollen nicht auf ein neues Turnier zeigen). */
    public function turnierEntfernen(string $id): void
    {
        $this->db->ausfuehren('DELETE FROM ereignisse WHERE turnier_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM sitzungen WHERE turnier_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM codes WHERE turnier_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM anmeldungen WHERE turnier_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM turnier_zugaenge WHERE turnier_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM sicherung_empfaenger WHERE turnier_id = ?', [$id]);
        $this->db->ausfuehren("DELETE FROM einladungen WHERE art = 'turnier' AND ziel = ?", [$id]);
        $this->nachrichten->turnierEntfernt($id);
        $this->db->ausfuehren('DELETE FROM turniere WHERE id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM kennungen_gesperrt WHERE id = ?', [$id]);
        $this->db->ausfuehren('INSERT INTO kennungen_gesperrt (id, bis) VALUES (?, ?)', [$id, $this->jetzt() + self::KENNUNG_SPERRE_TAGE * self::TAG]);
    }

    /**
     * Konto endgültig löschen. Sparten, in denen es die einzige Spartenleitung ist, werden mit allen Turnieren
     * gelöscht; übrige Turniere bleiben in ihrer Sparte (Sparten::kontoEntfernt).
     */
    private function kontoEntfernen(int $kontoId): void
    {
        $this->db->anfangen();
        try {
            $this->sparten->kontoEntfernt($kontoId);
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
        $text = $this->text($a, 'text', 5, 4000, false);
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
    public function leitungsRecht(?array $s, array $t): bool
    {
        if ($s === null) {
            return false;
        }
        if ($s['konto_id'] === null) {
            return $s['turnier_id'] === $t['id'] && $s['rolle'] === 'leitung';
        }
        // Konto (ab 0.17): Spartenleitung der Sparte, Konto-Zugang zum Turnier oder Administrator
        return $this->sparten->kontoLeitet($s, $t);
    }

    public function leitungPruefen(Anfrage $a, array $t): void
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
        $alle = self::empfaengerAus($t);
        return [
            'sicherungAn' => $alle,
            // ab 0.17: Adressen außerhalb der Turnierleitung bekommen Sicherungen erst nach Bestätigung per Link
            'unbestaetigt' => array_values(array_diff($alle, $this->bestaetigteEmpfaenger($t))),
            'sicherungTakt' => (int)$t['sicherung_takt'],
            'letzteSicherung' => self::iso($t['sicherung_letzte'] === null ? null : (int)$t['sicherung_letzte']),
            'mail' => $this->mailBereit(),
            'loeschenNach' => (int)($t['loeschen_nach'] ?? 12),
            'loeschungAm' => self::iso($this->loeschTermin($t)),
        ];
    }

    /* ---------------- Löschfrist und Sicherungsempfänger (ab 0.17) ---------------- */

    /** Zeitpunkt der automatischen Löschung: Turniertag bzw. letzte Änderung + 12/24 Monate */
    private function loeschTermin(array $t, ?int $letzte = null): int
    {
        $basis = $t['datum'] !== null ? (int)strtotime((string)$t['datum'] . 'T23:59:59Z') : null;
        if ($basis === null || $basis === 0) {
            $letzte ??= (int)($this->db->eine('SELECT MAX(empfangen) AS m FROM ereignisse WHERE turnier_id = ?', [$t['id']])['m'] ?? 0);
            $basis = max((int)$t['angelegt'], $letzte);
        }
        $monate = in_array((int)($t['loeschen_nach'] ?? 12), self::LOESCHFRISTEN, true) ? (int)$t['loeschen_nach'] : 12;
        return (int)strtotime("+{$monate} months", $basis);
    }

    /** E-Mail-Adressen der Turnierleitung mit Konto (Eigentümer, Spartenleitung, Konto-Zugänge) */
    private function leitungsAdressen(array $t): array
    {
        $zeilen = $this->db->alle(
            "SELECT email FROM konten WHERE id = ? OR id IN (SELECT konto_id FROM turnier_zugaenge WHERE turnier_id = ?)
             OR id IN (SELECT konto_id FROM mitglieder WHERE sparte_id = ? AND rolle = 'spartenleitung')",
            [(int)($t['konto_id'] ?? 0), (string)$t['id'], (int)($t['sparte_id'] ?? 0)]
        );
        return array_values(array_unique(array_map(static fn(array $z): string => mb_strtolower((string)$z['email']), $zeilen)));
    }

    /** Empfänger, die Sicherungen bekommen: Adressen der Leitung und per Link bestätigte */
    private function bestaetigteEmpfaenger(array $t, ?array $liste = null): array
    {
        $liste ??= self::empfaengerAus($t);
        $leitung = isset($t['konto_id']) ? $this->leitungsAdressen($t) : [];
        $ok = [];
        foreach ($liste as $e) {
            if (in_array(mb_strtolower($e), $leitung, true)
                || $this->db->eine('SELECT email FROM sicherung_empfaenger WHERE turnier_id = ? AND email = ? AND bestaetigt IS NOT NULL', [(string)$t['id'], $e]) !== null) {
                $ok[] = $e;
            }
        }
        return $ok;
    }

    /** Neue Empfänger: Bestätigungslink mailen (höchstens einmal je Stunde und Adresse) */
    /** Bestätigungsmails für Sicherungsempfänger: je Turnier, Sparte bzw. Konto und Adresse und Tag begrenzt */
    private const BESTAETIGUNGEN_JE_TURNIER = 10;
    private const BESTAETIGUNGEN_JE_SPARTE = 30;
    private const BESTAETIGUNGEN_JE_ADRESSE = 3;

    /**
     * Neue Empfänger: Bestätigungslink mailen (höchstens einmal je Stunde und Adresse und innerhalb der Tagesgrenzen).
     * $schluesselId: Kennung, unter der die Bestätigung gilt (Turnier bzw. eigener Namensraum der Zentrale).
     */
    private function empfaengerVormerken(array $t, array $liste, ?array $s, ?array $leitung = null, ?string $schluesselId = null): void
    {
        $leitung ??= $this->leitungsAdressen($t);
        $sid = $schluesselId ?? (string)$t['id'];
        foreach ($liste as $e) {
            if (in_array(mb_strtolower($e), $leitung, true)) {
                continue;
            }
            $z = $this->db->eine('SELECT * FROM sicherung_empfaenger WHERE turnier_id = ? AND email = ?', [$sid, $e]);
            if ($z !== null && ($z['bestaetigt'] !== null || (int)$z['angelegt'] > $this->jetzt() - 3600)) {
                continue;
            }
            // Grenzen (die Zählung bleibt, auch wenn die Adresse zwischendurch entfernt wird)
            $kAdresse = 'sich-best-mail|' . hash('sha256', mb_strtolower($e));
            $kTurnier = 'sich-best-turnier|' . $sid;
            $kSparte = 'sich-best-sparte|' . (($t['sparte_id'] ?? null) !== null ? 's' . $t['sparte_id'] : 'k' . (int)($t['konto_id'] ?? 0));
            if ($this->anzahlVersuche($kAdresse, self::TAG) >= self::BESTAETIGUNGEN_JE_ADRESSE
                || $this->anzahlVersuche($kTurnier, self::TAG) >= self::BESTAETIGUNGEN_JE_TURNIER
                || $this->anzahlVersuche($kSparte, self::TAG) >= self::BESTAETIGUNGEN_JE_SPARTE) {
                // Grenze erreicht: Adresse bleibt unbestätigt (kein Abbruch – sonst ginge beim Zurückrollen die Zählung verloren)
                continue;
            }
            $this->fehlversuch($kAdresse);
            $this->fehlversuch($kTurnier);
            $this->fehlversuch($kSparte);
            $schluessel = bin2hex(random_bytes(32));
            $this->db->ausfuehren('DELETE FROM sicherung_empfaenger WHERE turnier_id = ? AND email = ?', [$sid, $e]);
            $this->db->ausfuehren('INSERT INTO sicherung_empfaenger (turnier_id, email, schluessel_hash, angelegt, bestaetigt, name) VALUES (?, ?, ?, ?, NULL, ?)',
                [$sid, $e, hash('sha256', $schluessel), $this->jetzt(), mb_substr((string)$t['name'], 0, 160)]);
            if ($this->mailBereit()) {
                $link = $this->appUrl() . '#/sicherung/' . rawurlencode($sid) . '/' . $schluessel;
                $this->mail($e, 'Bitte bestätigen: Empfang von Turnier-Sicherungen', "Hallo,\n\n"
                    . 'für das Turnier „' . $t['name'] . '“ wurde diese Adresse als Empfänger der Sicherungsmails eingetragen'
                    . ($s !== null && ($s['name'] ?? '') !== '' ? ' (von ' . $s['name'] . ')' : '') . ".\n"
                    . "Sicherungen enthalten Namen und Ergebnisse der Teilnehmenden (ohne E-Mail-Adressen und Bankverbindung).\n\n"
                    . "Erst nach deiner Bestätigung bekommst du sie:\n\n{$link}\n\n"
                    . 'Kennst du das Turnier nicht? Dann ignoriere diese Mail – du bekommst nichts.');
            }
        }
    }

    /**
     * Fremde neue Empfänger (außerhalb der Leitungsadressen) nur bei freigegebener Sparte (sonst entfernt) –
     * gegen Mailversand an Fremde über neue Sparten. Bereits eingetragene Adressen bleiben.
     */
    private function erlaubteEmpfaenger(array $t, array $neu, array $alt): array
    {
        if ($this->anmeldungFreigabe($t)['erlaubt']) {
            return $neu;
        }
        $leitung = $this->leitungsAdressen($t);
        $altKlein = array_map('mb_strtolower', $alt);
        return array_values(array_filter($neu, static fn(string $e): bool => in_array(mb_strtolower($e), $leitung, true) || in_array(mb_strtolower($e), $altKlein, true)));
    }

    /** POST sicherung.bestaetigen { turnier, schluessel } – öffentlich, gebremst */
    private function sicherungBestaetigen(Anfrage $a): array
    {
        $bremse = 'sicherung-link|' . $a->ip;
        $this->bremse($bremse);
        $id = self::turnierId($a->rumpf['turnier'] ?? '');
        $schluessel = $a->rumpf['schluessel'] ?? '';
        $z = preg_match(self::TURNIER_ID_MUSTER, $id) && is_string($schluessel) && preg_match('/^[a-f0-9]{64}$/', $schluessel)
            ? $this->db->eine('SELECT * FROM sicherung_empfaenger WHERE turnier_id = ? AND schluessel_hash = ?', [$id, hash('sha256', $schluessel)])
            : null;
        if ($z === null) {
            $this->fehlversuch($bremse);
            throw new ApiFehler('abgelaufen', 'Der Link ist ungültig oder die Adresse wurde wieder entfernt.');
        }
        $this->db->ausfuehren('UPDATE sicherung_empfaenger SET bestaetigt = ? WHERE turnier_id = ? AND email = ?', [$this->jetzt(), $id, $z['email']]);
        $t = $this->db->eine('SELECT name FROM turniere WHERE id = ?', [$id]);
        return ['ok' => true, 'email' => (string)$z['email'], 'turnier' => (string)($t['name'] ?? $z['name'] ?? '')];
    }

    /**
     * Sicherungen per Mail ohne E-Mail-Adressen und Bankverbindung (Frage 14A): Bankdaten aus turnier.daten.kasse
     * und ggf. Adressfelder werden geleert. Die heruntergeladene Datei bleibt vollständig.
     * @param list<array|object> $ereignisse
     */
    public static function ohneKontaktdaten(array $ereignisse): array
    {
        $aus = [];
        foreach ($ereignisse as $e) {
            $e = json_decode((string)json_encode($e), true);
            if (!is_array($e)) {
                continue;
            }
            if (is_array($e['daten'] ?? null)) {
                if (($e['art'] ?? '') === 'turnier.daten' && is_array($e['daten']['kasse'] ?? null)) {
                    $e['daten']['kasse']['iban'] = '';
                    $e['daten']['kasse']['bic'] = '';
                    $e['daten']['kasse']['empfaenger'] = '';
                }
                foreach (['email', 'mail', 'telefon'] as $f) {
                    unset($e['daten'][$f]);
                }
                $e['daten'] = (object)$e['daten'];
            }
            $aus[] = $e;
        }
        return $aus;
    }

    private function einstellungenSetzen(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->leitungPruefen($a, $t);
        self::nichtAufZentrale($t);
        $r = $a->rumpf ?? [];
        if (array_key_exists('loeschenNach', $r)) {
            $frist = $r['loeschenNach'];
            if (!is_int($frist) || !in_array($frist, self::LOESCHFRISTEN, true)) {
                throw new ApiFehler('ungueltig', 'Löschfrist: 12 oder 24 Monate.');
            }
            $this->db->ausfuehren('UPDATE turniere SET loeschen_nach = ?, loeschung_erinnert = NULL WHERE id = ?', [$frist, $t['id']]);
        }
        if (array_key_exists('sicherungAn', $r)) {
            $neu = $this->empfaengerFeld($r['sicherungAn']);
            $alt = self::empfaengerAus($t);
            $s0 = $this->sitzung($a);
            $fremdNeu = array_diff(array_map('mb_strtolower', array_diff($neu, $alt)), $this->leitungsAdressen($t));
            if ($fremdNeu !== [] && ($s0 === null || $s0['konto_id'] === null)) {
                throw new ApiFehler('keine_berechtigung', 'Neue Empfänger außerhalb der Turnierleitung kann nur die Turnierleitung mit Konto eintragen.');
            }
            if ($fremdNeu !== [] && !$this->anmeldungFreigabe($t)['erlaubt']) {
                throw new ApiFehler('keine_berechtigung', 'Neue Sparten können Sicherungen in den ersten ' . self::ANMELDUNG_NACH_TAGEN . ' Tagen nur an die eigenen Adressen senden. Der Administrator kann die Sparte früher freischalten.');
            }
            $this->db->ausfuehren('UPDATE turniere SET sicherung_an = ? WHERE id = ?', [json_encode($neu), $t['id']]);
            $this->db->ausfuehren('DELETE FROM sicherung_empfaenger WHERE turnier_id = ? AND email NOT IN (' . implode(',', array_fill(0, max(1, count($neu)), '?')) . ')',
                array_merge([(string)$t['id']], $neu === [] ? [''] : $neu));
            $this->empfaengerVormerken($t, $neu, $this->sitzung($a));
            // Neue Empfänger von jemand anderem als dem Eigentümer-Konto: Das Konto erfährt es (die Sicherung
            // enthält alle Daten des Turniers – Schutz gegen Abfluss über eine weitergegebene Leitungskennung)
            $hinzu = array_values(array_diff($neu, $alt));
            $s = $this->sitzung($a);
            if ($hinzu !== [] && ($s['konto_id'] ?? null) !== (int)$t['konto_id'] && $this->mailBereit()
                && array_diff(array_map('mb_strtolower', $hinzu), $this->leitungsAdressen($t)) !== []) {
                $konto = $this->db->eine('SELECT email, name FROM konten WHERE id = ?', [(int)$t['konto_id']]);
                if ($konto !== null) {
                    $this->mail((string)$konto['email'], "Neue Empfänger der Sicherung: {$t['name']}", "Hallo {$konto['name']},\n\n"
                        . "im Turnier „{$t['name']}“ gehen Sicherungen jetzt auch an:\n\n  " . implode("\n  ", $hinzu) . "\n\n"
                        . 'Geändert von: ' . (string)($s['name'] ?? '') . "\nZeit: " . gmdate('d.m.Y H:i', $this->jetzt()) . " UTC\n\n"
                        . "Die Sicherung enthält alle Angaben des Turniers. War das nicht abgesprochen? Dann entferne die\n"
                        . "Adressen unter „Einstellungen“ und gib die Leitungskennungen unter „Zugänge“ neu aus:\n" . $this->appUrl() . '#/t/' . $t['id']);
                }
            }
        }
        // Name und Datum (ab 0.11; die App trägt zusätzlich turnier.umbenannt ein). Das Datum zählt für die
        // Löschfrist der Online-Anmeldung.
        if (array_key_exists('name', $r)) {
            $this->db->ausfuehren('UPDATE turniere SET name = ? WHERE id = ?', [$this->text($a, 'name', 2, 160), $t['id']]);
        }
        if (array_key_exists('datum', $r)) {
            $datum = $r['datum'];
            if ($datum !== null && (!is_string($datum) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum))) {
                throw new ApiFehler('ungueltig', 'Datum im Format JJJJ-MM-TT angeben.');
            }
            $ts = is_string($datum) ? strtotime($datum . 'T12:00:00Z') : false;
            if (is_string($datum) && ($ts === false || $ts < 0)) {
                throw new ApiFehler('ungueltig', 'Ungültiges Datum.');
            }
            // Ein Datum lange vor heute löst die automatische Löschung aus – das darf nur die Leitung mit Konto
            if (is_string($datum) && $ts < $this->jetzt() - 400 * self::TAG && ($this->sitzung($a)['konto_id'] ?? null) === null) {
                throw new ApiFehler('keine_berechtigung', 'Ein Turniertag, der über ein Jahr zurückliegt, lässt sich nur mit Konto eintragen (danach wird das Turnier bald automatisch gelöscht).');
            }
            if ($datum === null && $this->db->eine('SELECT id FROM anmeldungen WHERE turnier_id = ? LIMIT 1', [$t['id']]) !== null) {
                throw new ApiFehler('konflikt', 'Es gibt Online-Anmeldungen – das Datum bleibt gesetzt (die Löschfrist richtet sich danach).');
            }
            $this->db->ausfuehren('UPDATE turniere SET datum = ? WHERE id = ?', [$datum, $t['id']]);
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
        $empf = $this->bestaetigteEmpfaenger($t);
        if ($empf === []) {
            throw new ApiFehler('ungueltig', self::empfaengerAus($t) === [] ? 'Bitte zuerst mindestens einen Empfänger eintragen.'
                : 'Die eingetragenen Empfänger haben ihre Adresse noch nicht bestätigt (Link in der Mail).');
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
            $empf = $this->bestaetigteEmpfaenger($t);
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
    /** Alle Ereignisse eines Turniers im Format der Sicherungsdatei */
    private function sicherungsEreignisse(string $id): array
    {
        $zeilen = $this->db->alle('SELECT * FROM ereignisse WHERE turnier_id = ? ORDER BY seq', [$id]);
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
        return $ereignisse;
    }

    private function sicherungSenden(array $t, array $empf, string $grund): bool
    {
        $ereignisse = $this->sicherungsEreignisse((string)$t['id']);
        $sicherung = [
            'format' => 'tt-turnier-sicherung',
            'version' => 1,
            'erstellt' => self::iso($this->jetzt()),
            'turnier' => ['id' => (string)$t['id'], 'name' => (string)$t['name'], 'datum' => $t['datum'], 'modus' => 'online'],
            'ereignisse' => self::ohneKontaktdaten($ereignisse),
            'ohneKontaktdaten' => true,
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
        // Höchstens SICHERUNGEN_JE_TAG Sicherungsmails je Konto und Tag (die Datei lässt sich jederzeit herunterladen)
        $schluessel = 'sicherung-mail|' . (isset($t['konto_id']) ? 'k' . $t['konto_id'] : 't' . $t['id']);
        if ($this->anzahlVersuche($schluessel, self::TAG) >= self::SICHERUNGEN_JE_TAG) {
            return false;
        }
        $this->fehlversuch($schluessel);
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
            . "„Aus Sicherung wiederherstellen“ und die Datei auswählen. E-Mail-Adressen und Bankverbindung\n"
            . "stehen nicht in der Mail-Sicherung (nur in der Datei, die die Leitung selbst herunterlädt).\n\n"
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

    /** Nur die Turnierleitung mit Konto (Spartenleitung, Konto-Zugang, Administrator) darf ein Turnier auf eine Zentrale holen. */
    private function eigentuemerPruefen(array $s, array $t): void
    {
        if (!$this->sparten->kontoLeitet($s, $t)) {
            throw new ApiFehler('keine_berechtigung', 'Nur die Turnierleitung mit Konto kann das Turnier auf eine Zentrale übernehmen.');
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
        $this->eigentuemerPruefen($s, $t);
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
        $id = self::turnierId($a->rumpf['turnier'] ?? '');
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
            $sp = $this->sparten->sparteFuer($s, $neu['sparte'] ?? null, 'anlegen');
            $this->turnierGrenzenPruefen($s, (int)$sp['id']);
            if ($this->db->eine('SELECT id FROM kennungen_gesperrt WHERE id = ? AND bis >= ?', [$id, $this->jetzt()]) !== null) {
                throw new ApiFehler('konflikt', 'Diese Turnierkennung war vergeben und ist noch gesperrt. Bitte das Turnier auf der Zentrale neu anlegen.');
            }
            $n = new Anfrage('POST', '', [], $neu, null, $a->ip);
            $name = $this->text($n, 'name', 2, 160);
            $datum = $neu['datum'] ?? null;
            if ($datum !== null && (!is_string($datum) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum))) {
                throw new ApiFehler('ungueltig', 'Datum im Format JJJJ-MM-TT angeben.');
            }
            $konto = $this->db->eine('SELECT email FROM konten WHERE id = ?', [$s['konto_id']]);
            $this->db->ausfuehren(
                'INSERT INTO turniere (id, konto_id, name, datum, leitung_hash, leitung_code, sicherung_an, sicherung_takt, angelegt, zentrale, zentrale_id, zentrale_seit, sparte_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$id, $s['konto_id'], $name, $datum, password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT), null,
                 json_encode([(string)($konto['email'] ?? '')]), 30, $this->jetzt(),
                 mb_substr(trim((string)($a->rumpf['zentrale'] ?? 'Zentrale')), 0, 160), $zid, $this->jetzt(), (int)$sp['id']]
            );
            if (!$sp['_leitung']) {
                $this->db->ausfuehren('INSERT INTO turnier_zugaenge (turnier_id, konto_id, angelegt) VALUES (?, ?, ?)', [$id, (int)$s['konto_id'], $this->jetzt()]);
            }
            $this->sparten->cacheLeeren();
            $this->turnierGezaehlt($s);
        }
        $t = $this->turnierLaden($id);
        $this->eigentuemerPruefen($s, $t);
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
                $auf = $rolle === 'helfer' && is_array($au['aufgaben'] ?? null) ? self::aufgabenLesen($au['aufgaben']) : null;
                $seq = $this->einEreignis((string)$t['id'], $e, $rolle, $name, $bezug, $rolle === 'spieler' && ($au['helfer'] ?? false) === true, $auf);
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
        $this->eigentuemerPruefen($s, $t);
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
                    $auf = $rolle === 'helfer' && is_array($c['aufgaben'] ?? null) ? json_encode(self::aufgabenLesen($c['aufgaben'])) : null;
                    $neu[$rolle . '|' . $bezug] = [$rolle, $bezug, $name, $code, ($c['gesperrt'] ?? false) === true ? 1 : 0, $helfer, $auf];
                }
                foreach ($alt as $k => $c) {
                    if (!isset($neu[$k]) || $neu[$k][3] !== (string)$c['code'] || $neu[$k][4] === 1 || $neu[$k][5] !== (int)$c['helfer']) {
                        $this->codeSitzungenBeenden((string)$t['id'], (string)$c['rolle'], (string)$c['bezug']);
                    }
                }
                $this->db->ausfuehren('DELETE FROM codes WHERE turnier_id = ?', [$t['id']]);
                foreach ($neu as $k => [$rolle, $bezug, $name, $code, $gesperrt, $helfer, $auf]) {
                    // Konto, für das die Kennung angelegt wurde, bleibt erhalten (Sperre beim Entfernen des Kontos);
                    // online schon gesperrte Kennungen eines Kontos bleiben gesperrt
                    $kontoId = isset($alt[$k]) && $alt[$k]['konto_id'] !== null ? (int)$alt[$k]['konto_id'] : null;
                    if ($kontoId !== null && (int)$alt[$k]['gesperrt'] === 1) {
                        $gesperrt = 1;
                    }
                    $this->db->ausfuehren(
                        'INSERT INTO codes (turnier_id, rolle, bezug, name, code, gesperrt, angelegt, helfer, aufgaben, konto_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [$t['id'], $rolle, $bezug, $name, $code, $gesperrt, $this->jetzt(), $helfer, $auf, $kontoId]
                    );
                }
            }
            $ein = $r['einstellungen'] ?? null;
            $ein = $ein instanceof \stdClass ? get_object_vars($ein) : $ein;
            if (is_array($ein)) {
                if (array_key_exists('sicherungAn', $ein)) {
                    $liste = $this->erlaubteEmpfaenger($t, $this->empfaengerFeld($ein['sicherungAn']), self::empfaengerAus($t));
                    $this->db->ausfuehren('UPDATE turniere SET sicherung_an = ? WHERE id = ?', [json_encode($liste), $t['id']]);
                    $vormerken = $liste;
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
        if (isset($vormerken)) {
            $this->empfaengerVormerken($t, $vormerken, $s);
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
        if (is_array($tr)) {
            $tr['id'] = self::turnierId($tr['id'] ?? '');
        }
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
        $sich['ereignisse'] = self::ohneKontaktdaten($sich['ereignisse']);
        $sich['ohneKontaktdaten'] = true;
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
        $konto = $this->db->eine('SELECT name, email FROM konten WHERE id = ?', [$s['konto_id']]);
        $erste = $this->db->eine('SELECT sparte_id FROM mitglieder WHERE konto_id = ? ORDER BY sparte_id LIMIT 1', [$s['konto_id']]);
        $pseudo = ['id' => $tr['id'], 'name' => mb_substr(trim($tr['name']), 0, 160), 'konto_id' => (int)$s['konto_id'], 'sparte_id' => $erste === null ? null : (int)$erste['sparte_id']];
        // Noch nicht freigegebene Sparten (jünger als 7 Tage): Sicherung nur an die eigene Adresse (gegen Mail-Missbrauch)
        if (!$this->anmeldungFreigabe($pseudo)['erlaubt'] && array_diff($empf, [(string)($konto['email'] ?? '')]) !== []) {
            throw new ApiFehler('keine_berechtigung', 'Neue Sparten können Sicherungen in den ersten ' . self::ANMELDUNG_NACH_TAGEN . ' Tagen nur an die eigene E-Mail-Adresse senden. Der Administrator kann die Sparte früher freischalten.');
        }
        // Gibt es die Kennung online, darf nur deren Leitung (per Konto) senden – sonst ließe sich unter fremdem
        // Turniernamen an dort bestätigte Adressen schreiben
        $online = $this->db->eine('SELECT * FROM turniere WHERE id = ?', [$tr['id']]);
        if ($online !== null && !$this->sparten->kontoLeitet($s, $online)) {
            throw new ApiFehler('keine_berechtigung', 'Zu dieser Turnierkennung gibt es online ein Turnier einer anderen Turnierleitung.');
        }
        // Ab 0.17: fremde Adressen erst nach Bestätigung; Bestätigungen der Zentrale gelten je Konto und Kennung
        $eigene = [mb_strtolower((string)($konto['email'] ?? ''))];
        $sid = 'Z' . strtoupper(substr(hash('sha256', 'z|' . $s['konto_id'] . '|' . $tr['id']), 0, 11));
        $this->empfaengerVormerken($pseudo, $empf, $s, $eigene, $sid);
        $empf = array_values(array_filter($empf, fn(string $e): bool => in_array(mb_strtolower($e), $eigene, true)
            || $this->db->eine('SELECT email FROM sicherung_empfaenger WHERE turnier_id = ? AND email = ? AND bestaetigt IS NOT NULL', [$sid, $e]) !== null));
        if ($empf === []) {
            return ['ok' => true, 'gesendetAn' => [], 'zeit' => self::iso($this->jetzt()), 'unbestaetigt' => true];
        }
        if ($this->anzahlVersuche('sicherung-mail|k' . $s['konto_id'], self::TAG) >= self::SICHERUNGEN_JE_TAG) {
            throw new ApiFehler('zu_viele_versuche', 'Heute wurden schon sehr viele Sicherungen gesendet. Bitte die Sicherungsdatei herunterladen.');
        }
        $ok = $this->sicherungMailen(
            ['id' => $tr['id'], 'konto_id' => $s['konto_id'], 'name' => mb_substr(trim($tr['name']), 0, 160), 'datum' => $datum, 'veranstalter' => (string)($konto['name'] ?? '')],
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
        if ($z['autor_rolle'] === 'helfer' && ($z['autor_aufgaben'] ?? null) !== null) {
            $a['aufgaben'] = self::aufgabenLesen($z['autor_aufgaben']);
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
        if ($z['rolle'] === 'helfer') {
            $aus['aufgaben'] = self::aufgabenLesen($z['aufgaben'] ?? null);
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
    private function codeAnlegen(array $t, string $rolle, string $bezug, string $name, ?array $aufgaben = null, ?int $kontoId = null): array
    {
        $anzahl = (int)($this->db->eine('SELECT COUNT(*) AS n FROM codes WHERE turnier_id = ?', [$t['id']])['n'] ?? 0);
        if ($anzahl >= self::MAX_CODES) {
            throw new ApiFehler('ungueltig', 'Höchstens ' . self::MAX_CODES . ' Kennungen je Turnier.');
        }
        $this->db->ausfuehren(
            'INSERT INTO codes (turnier_id, rolle, bezug, name, code, gesperrt, angelegt, helfer, aufgaben, konto_id) VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?)',
            [$t['id'], $rolle, $bezug, $name, $this->freierCode($t), $this->jetzt(),
             $rolle === 'helfer' && $aufgaben !== null ? json_encode(self::aufgabenLesen($aufgaben)) : null, $kontoId]
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
                $auf = $e['aufgaben'] ?? null;
                if ($auf !== null && (!is_array($auf) || !array_is_list($auf) || self::aufgabenLesen($auf) === [])) {
                    throw new ApiFehler('ungueltig', 'Bitte mindestens eine Aufgabe wählen.');
                }
                // Kennungen für andere Personen hängen an keinem Konto: sie bleiben gültig, wenn die anlegende Person
                // die Sparte verlässt (nur die eigene Kennung aus turnier.anlegen wird dann gesperrt)
                $this->codeAnlegen($t, $rolle, $bezug, $name, $auf);
            }
            $this->db->festschreiben();
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
        return $this->codesListe((string)$t['id']);
    }

    /** Anmeldungen mit dem bisherigen Code beenden */
    /**
     * Leitungskennungen, die beim Anlegen für ein Konto erzeugt wurden, sperren und ihre Sitzungen beenden –
     * wenn das Konto die Sparte verlässt, den Turnierzugang verliert oder gelöscht wird (sonst bliebe die Leitung).
     * @param list<string>|null $turniere null = alle Turniere
     */
    public function kontoKennungenSperren(int $kontoId, ?array $turniere): void
    {
        foreach ($this->db->alle("SELECT turnier_id, bezug FROM codes WHERE konto_id = ? AND rolle = 'leitung' AND gesperrt = 0", [$kontoId]) as $c) {
            if ($turniere !== null && !in_array((string)$c['turnier_id'], $turniere, true)) {
                continue;
            }
            $this->db->ausfuehren("UPDATE codes SET gesperrt = 1 WHERE turnier_id = ? AND rolle = 'leitung' AND bezug = ?", [$c['turnier_id'], $c['bezug']]);
            $this->codeSitzungenBeenden((string)$c['turnier_id'], 'leitung', (string)$c['bezug']);
        }
    }

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
        $this->nachrichten->kennungEntfernt((string)$t['id'], $rolle, $bezug);
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

    /** Aufgaben einer Helferkennung ändern – gilt ab dem nächsten Eintrag (ohne neue Anmeldung) */
    private function codeAufgaben(Anfrage $a): array
    {
        $t = $this->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->leitungPruefen($a, $t);
        self::nichtAufZentrale($t);
        $bezug = $a->rumpf['bezug'] ?? null;
        if (!is_string($bezug) || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $bezug)) {
            throw new ApiFehler('ungueltig', 'Bezug ungültig.');
        }
        $this->codeLaden($t, 'helfer', $bezug);
        $roh = $a->rumpf['aufgaben'] ?? null;
        $aufgaben = is_array($roh) && array_is_list($roh) ? self::aufgabenLesen($roh) : [];
        if ($aufgaben === []) {
            throw new ApiFehler('ungueltig', 'Bitte mindestens eine Aufgabe wählen.');
        }
        $this->db->ausfuehren("UPDATE codes SET aufgaben = ? WHERE turnier_id = ? AND rolle = 'helfer' AND bezug = ?", [json_encode($aufgaben), $t['id'], $bezug]);
        return ['code' => self::codeAusgabe($this->codeLaden($t, 'helfer', $bezug))];
    }

    /* ---------------- Einstellungen des Kontos ---------------- */

    /** Ab 0.17 je Sparte (Parameter „sparte“; ohne: erste Sparte des Kontos) */
    private function kontoEinstellungen(Anfrage $a): array
    {
        $s = $this->konto($a);
        $sp = $this->sparten->sparteFuer($s, $a->query['sparte'] ?? ($a->rumpf['sparte'] ?? null));
        $k = $this->db->eine('SELECT daten FROM sparten WHERE id = ?', [(int)$sp['id']]);
        $d = json_decode((string)($k['daten'] ?? ''), true);
        $klassen = is_array($d) && is_array($d['klassen'] ?? null) ? array_values(array_filter($d['klassen'], 'is_string')) : [];
        $kasse = is_array($d) && is_array($d['kasse'] ?? null) ? $d['kasse'] : null;
        return ['klassen' => $klassen, 'kasse' => $kasse];
    }

    /** Kasse/Quittung (shared/protokoll.ts KasseEinstellungen) – Felder gekürzt, IBAN geprüft */
    public static function kasseLesen(mixed $k): ?array
    {
        $k = $k instanceof \stdClass ? get_object_vars($k) : $k;
        if (!is_array($k)) {
            return null;
        }
        $t = static fn(string $f, int $max): string => is_string($k[$f] ?? null) ? mb_substr(trim($k[$f]), 0, $max) : '';
        $iban = strtoupper(preg_replace('/\s+/', '', $t('iban', 40)) ?? '');
        if ($iban !== '' && !self::ibanGueltig($iban)) {
            throw new ApiFehler('ungueltig', 'Die IBAN ist ungültig.');
        }
        $bic = strtoupper(preg_replace('/\s+/', '', $t('bic', 11)) ?? '');
        if ($bic !== '' && !preg_match('/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/', $bic)) {
            throw new ApiFehler('ungueltig', 'Die BIC ist ungültig.');
        }
        $ust = in_array($k['ust'] ?? null, ['keiner', 'befreit', 'enthalten'], true) ? $k['ust'] : 'keiner';
        $satz = in_array($k['ustSatz'] ?? null, [7, 19], true) ? $k['ustSatz'] : 19;
        return [
            'aussteller' => $t('aussteller', 160), 'anschrift' => $t('anschrift', 300), 'ust' => $ust, 'ustSatz' => $satz,
            'fusstext' => $t('fusstext', 500), 'empfaenger' => $t('empfaenger', 70), 'iban' => $iban, 'bic' => $bic,
        ];
    }

    /** IBAN-Prüfziffer (ISO 13616, mod 97) */
    public static function ibanGueltig(string $iban): bool
    {
        if (!preg_match('/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/', $iban) || (str_starts_with($iban, 'DE') && strlen($iban) !== 22)) {
            return false;
        }
        $u = substr($iban, 4) . substr($iban, 0, 4);
        $rest = 0;
        foreach (str_split($u) as $z) {
            $w = ctype_alpha($z) ? (string)(ord($z) - 55) : $z;
            foreach (str_split($w) as $ziffer) {
                $rest = ($rest * 10 + (int)$ziffer) % 97;
            }
        }
        return $rest === 1;
    }

    private function kontoEinstellungenSetzen(Anfrage $a): array
    {
        $s = $this->konto($a);
        $alt = $this->kontoEinstellungen($a);
        $r = $a->rumpf ?? [];
        $klassen = $alt['klassen'];
        if (array_key_exists('klassen', $r)) {
            $liste = $r['klassen'];
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
        }
        $sp = $this->sparten->sparteFuer($s, $r['sparte'] ?? null);
        // Kasse-Vorgabe (Bankverbindung für neue Turniere) nur die Spartenleitung; Klassen alle Mitglieder
        if (array_key_exists('kasse', $r) && !$sp['_leitung']) {
            throw new ApiFehler('keine_berechtigung', 'Die Vorgabe für Kasse und Bankverbindung ändert nur die Spartenleitung.');
        }
        $kasse = array_key_exists('kasse', $r) ? self::kasseLesen($r['kasse']) : $alt['kasse'];
        $this->db->ausfuehren('UPDATE sparten SET daten = ? WHERE id = ?', [json_encode(['klassen' => $klassen, 'kasse' => $kasse], JSON_UNESCAPED_UNICODE), (int)$sp['id']]);
        return ['klassen' => $klassen, 'kasse' => $kasse];
    }

    /* ---------------- Spielerpool des Kontos ---------------- */

    private static function poolAusgabe(array $z): array
    {
        $d = json_decode((string)$z['daten'], true);
        $d = is_array($d) ? $d : [];
        unset($d['wertungTurniere']); // nur kurz in 0.15-Tests gespeichert, nicht mehr ausgeben
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
        if (!is_string($id) || !preg_match('/^[A-Za-z0-9_-]{1,40}$/D', $id)) {
            throw new ApiFehler('ungueltig', 'Spieler-ID ungültig.');
        }
        // Steuerzeichen raus (Zeilenumbrüche würden CSV-Export und Anzeige stören)
        $txt = static fn(mixed $v, int $max): string => is_string($v) ? mb_substr(trim((string)preg_replace('/[\x00-\x1F\x7F]/u', '', $v)), 0, $max) : '';
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
        // ab 0.15: geschätzter Wert (Hobby), App-Spiele für den K-Faktor; click-TT-Lizenz
        if (($e['ttrGeschaetzt'] ?? null) === true && $d['ttr'] !== null) {
            $d['ttrGeschaetzt'] = true;
        }
        $n = $e['appSpiele'] ?? null;
        if (is_int($n) && $n > 0 && $n <= 100000) {
            $d['appSpiele'] = $n;
        }
        $li = $e['lizenz'] ?? null;
        if (is_string($li) && preg_match('/^[A-Za-z0-9-]{1,20}$/D', trim($li))) {
            $d['lizenz'] = trim($li);
        }
        return [$id, $d];
    }

    /** Spielerpool der Sparte (Parameter „sparte“; ohne: erste Sparte des Kontos) – Spartenleitung und Turnierleitungen */
    private function poolSparte(Anfrage $a): int
    {
        $s = $this->konto($a);
        return (int)$this->sparten->sparteFuer($s, $a->query['sparte'] ?? ($a->rumpf['sparte'] ?? null))['id'];
    }

    private function pool(Anfrage $a): array
    {
        $sp = $this->poolSparte($a);
        $zeilen = $this->db->alle('SELECT * FROM spieler_pool WHERE sparte_id = ? ORDER BY id', [$sp]);
        return ['spieler' => array_map([self::class, 'poolAusgabe'], $zeilen)];
    }

    private function poolSpeichern(Anfrage $a): array
    {
        $sp = $this->poolSparte($a);
        $liste = $a->rumpf['spieler'] ?? null;
        if (!is_array($liste) || !array_is_list($liste) || count($liste) > 500) {
            throw new ApiFehler('ungueltig', 'Feld „spieler“ muss eine Liste mit höchstens 500 Einträgen sein.');
        }
        $eintraege = array_map([self::class, 'poolEintrag'], $liste);
        $this->db->anfangen();
        try {
            foreach ($eintraege as [$id, $d]) {
                $json = json_encode($d, JSON_UNESCAPED_UNICODE);
                $n = $this->db->ausfuehren('UPDATE spieler_pool SET daten = ?, geaendert = ? WHERE sparte_id = ? AND id = ?', [$json, $this->jetzt(), $sp, $id]);
                if ($n === 0 && $this->db->eine('SELECT id FROM spieler_pool WHERE sparte_id = ? AND id = ?', [$sp, $id]) === null) {
                    $anzahl = (int)($this->db->eine('SELECT COUNT(*) AS n FROM spieler_pool WHERE sparte_id = ?', [$sp])['n'] ?? 0);
                    if ($anzahl >= self::MAX_POOL) {
                        throw new ApiFehler('ungueltig', 'Höchstens ' . self::MAX_POOL . ' Spieler im Pool.');
                    }
                    $this->db->ausfuehren('INSERT INTO spieler_pool (sparte_id, id, daten, geaendert) VALUES (?, ?, ?, ?)', [$sp, $id, $json, $this->jetzt()]);
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
        $sp = (int)$this->sparten->sparteFuer($s, $a->query['sparte'] ?? ($a->rumpf['sparte'] ?? null), 'anlegen')['id'];
        $ids = $a->rumpf['ids'] ?? null;
        if (!is_array($ids) || !array_is_list($ids) || count($ids) > self::MAX_POOL) {
            throw new ApiFehler('ungueltig', 'Feld „ids“ muss eine Liste sein.');
        }
        foreach ($ids as $id) {
            if (is_string($id)) {
                $this->db->ausfuehren('DELETE FROM spieler_pool WHERE sparte_id = ? AND id = ?', [$sp, $id]);
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

    /**
     * Automatische Löschung (ab 0.17, Frage 5): 12 bzw. 24 Monate nach dem Turniertag (ohne Datum: nach der
     * letzten Änderung). 30 Tage vorher Mail an die Leitung mit der Sicherungsdatei; ändert sich danach etwas
     * an der Frist, beginnt die Erinnerung neu.
     */
    private function turniereAufraeumen(): void
    {
        $jetzt = $this->jetzt();
        $letzte = [];
        foreach ($this->db->alle('SELECT turnier_id, MAX(empfangen) AS m FROM ereignisse GROUP BY turnier_id') as $z) {
            $letzte[(string)$z['turnier_id']] = (int)$z['m'];
        }
        foreach ($this->db->alle('SELECT * FROM turniere WHERE zentrale_id IS NULL') as $t) {
            try {
                $this->turnierAufraeumen($t, $letzte[(string)$t['id']] ?? 0, $jetzt);
            } catch (\Throwable $x) {
                error_log('tt-turnier Löschfrist ' . $t['id'] . ': ' . $x);
            }
        }
    }

    private function turnierAufraeumen(array $t, int $letzteAenderung, int $jetzt): void
    {
        {
            $termin = $this->loeschTermin($t, $letzteAenderung);
            $erinnert = $t['loeschung_erinnert'] === null ? null : (int)$t['loeschung_erinnert'];
            if ($jetzt < $termin - self::TURNIER_ERINNERUNG_VORHER) {
                if ($erinnert !== null) {
                    $this->db->ausfuehren('UPDATE turniere SET loeschung_erinnert = NULL WHERE id = ?', [$t['id']]);
                }
                return;
            }
            if ($erinnert === null) {
                $am = max($termin, $jetzt + self::TURNIER_ERINNERUNG_VORHER);
                if ($this->mailBereit()) {
                    $text = "Hallo,\n\ndas Turnier „{$t['name']}“ wird am " . gmdate('d.m.Y', $am) . " automatisch gelöscht "
                        . '(Löschfrist ' . (int)$t['loeschen_nach'] . " Monate, eingestellt von der Turnierleitung).\n\n"
                        . "Im Anhang liegt eine Sicherung (ohne E-Mail-Adressen und Bankverbindung). Soll das Turnier länger bleiben,\n"
                        . "stelle unter „Einstellungen“ → „Löschfrist“ 24 Monate ein:\n" . $this->appUrl() . '#/t/' . $t['id'];
                    $json = (string)json_encode(['format' => 'tt-turnier-sicherung', 'version' => 1, 'erstellt' => self::iso($jetzt),
                        'turnier' => ['id' => (string)$t['id'], 'name' => (string)$t['name'], 'datum' => $t['datum'], 'modus' => 'online'],
                        'ereignisse' => self::ohneKontaktdaten($this->sicherungsEreignisse((string)$t['id'])), 'ohneKontaktdaten' => true],
                        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                    foreach (array_slice($this->leitungsAdressen($t), 0, 10) as $an) {
                        $this->mail($an, "Turnier wird gelöscht: {$t['name']}", $text, 'sicherung-' . $t['id'] . '.json', strlen($json) <= self::MAX_SICHERUNG_BYTES ? $json : null);
                    }
                }
                $this->db->ausfuehren('UPDATE turniere SET loeschung_erinnert = ? WHERE id = ?', [$jetzt, $t['id']]);
                return;
            }
            if ($jetzt >= $termin && $jetzt >= $erinnert + self::TURNIER_ERINNERUNG_VORHER) {
                $this->db->anfangen();
                try {
                    $this->turnierEntfernen((string)$t['id']);
                    $this->db->festschreiben();
                } catch (\Throwable $x) {
                    $this->db->zurueckrollen();
                    throw $x;
                }
            }
        }
    }

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
            $this->anmeldung->aufraeumen();
            $this->sparten->aufraeumen();
            $this->nachrichten->aufraeumen();
            $this->db->ausfuehren('DELETE FROM kennungen_gesperrt WHERE bis < ?', [$jetzt]);
            $this->db->ausfuehren('DELETE FROM sicherung_empfaenger WHERE bestaetigt IS NULL AND angelegt < ?', [$jetzt - 30 * self::TAG]);
            $this->db->ausfuehren('DELETE FROM sicherung_empfaenger WHERE angelegt < ? AND turnier_id NOT IN (SELECT id FROM turniere)', [$jetzt - 365 * self::TAG]);
            $this->turniereAufraeumen();

            // Erinnerung 30 Tage vor der Löschung
            $erinnern = $this->db->alle(
                "SELECT * FROM konten WHERE rolle = 'veranstalter' AND erinnert IS NULL AND aktiv < ?",
                [$jetzt - self::KONTO_LOESCHEN_NACH + self::KONTO_ERINNERUNG_VORHER]
            );
            foreach ($erinnern as $k) {
                $am = max((int)$k['aktiv'] + self::KONTO_LOESCHEN_NACH, $jetzt + self::KONTO_ERINNERUNG_VORHER);
                $letzte = $this->sparten->letzteLeitungIn((int)$k['id']);
                if ($this->mailBereit()) {
                    $this->mail((string)$k['email'], 'Dein Konto wird bald gelöscht', "Hallo {$k['name']},\n\n"
                        . "dein Konto beim Tischtennis-Turnier wurde lange nicht genutzt. Am " . gmdate('d.m.Y', $am)
                        . " wird es deshalb gelöscht"
                        . ($letzte === [] ? '' : ' – und weil du die einzige Spartenleitung bist, auch „'
                            . implode('“, „', array_map(static fn(array $x): string => $x['verein'] . ' – ' . $x['name'], $letzte)) . '“ mit allen Turnieren')
                        . ".\n\n"
                        . "Möchtest du es behalten, melde dich vorher einfach einmal an:\n" . $this->appUrl() . "#/anmelden\n\n"
                        . "Brauchst du es nicht mehr, musst du nichts tun.");
                }
                $this->sparten->loeschungAnkuendigen((int)$k['id'], $am);
                $this->db->ausfuehren('UPDATE konten SET erinnert = ? WHERE id = ?', [$jetzt, (int)$k['id']]);
            }

            // Löschen: 12 Monate ohne Nutzung und Erinnerung vor mindestens 30 Tagen
            $loeschen = $this->db->alle(
                "SELECT id FROM konten WHERE rolle = 'veranstalter' AND aktiv < ? AND erinnert IS NOT NULL AND erinnert <= ?",
                [$jetzt - self::KONTO_LOESCHEN_NACH, $jetzt - self::KONTO_ERINNERUNG_VORHER]
            );
            foreach ($loeschen as $k) {
                try {
                    $this->kontoEntfernen((int)$k['id']);
                } catch (\Throwable $x) {
                    error_log('tt-turnier Kontolöschung ' . $k['id'] . ': ' . $x);
                }
            }
        } catch (\Throwable $x) {
            error_log('tt-turnier Wartung: ' . $x);
        }
    }
}
