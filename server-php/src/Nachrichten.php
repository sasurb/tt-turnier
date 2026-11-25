<?php
declare(strict_types=1);

namespace TtTurnier;

/**
 * Nachrichten (ab 0.18, Vertrag: shared/protokoll.ts „Nachrichten“):
 *
 * - Mail-Warteschlange: Rundmails, Ergebnis-Mails und Verteiler-Mails gehen nicht sofort raus, sondern gedrosselt
 *   (Standard 20 je Minute, config mail.je_minute) nach den Antworten des Servers (bootstrap.php). Einzelne
 *   System-Mails, die scheitern, landen ebenfalls hier und werden bis zu sechsmal wiederholt.
 * - Posteingang je Kennung im Turnier (Spieler, Helfer, Leitung) mit Glocke in der App; keine Spielerkonten.
 * - Rundmail der Turnierleitung an Gruppen (die App bestimmt die Spieler; der Server kennt keine Turnierlogik).
 * - Ergebnis-Mail nach „Turnier abschließen“ mit eigener Platzierung und Ergebnisliste.
 * - Verteiler je Sparte für spätere Ankündigungen: nur mit eigener Einwilligung, bestätigt per Mail
 *   (Double-Opt-In), Abmeldelink in jeder Mail, unter 18 nur mit Einverständnis der Erziehungsberechtigten.
 */
final class Nachrichten
{
    public const MAX_TITEL = 150;
    public const MAX_TEXT = 5000;
    private const MAX_LISTE = 50000;
    private const MAX_EMPFAENGER = 2000;
    private const MAX_POSTFACH = 200;
    /** Rundmails je Turnier bzw. Sparte und Tag */
    private const RUNDMAILS_JE_TURNIER = 10;
    private const RUNDMAILS_JE_SPARTE = 30;
    /** Ergebnis-Mails je Turnier insgesamt (z. B. nach Korrektur und erneutem Abschluss) */
    private const ERGEBNIS_MAX = 3;
    private const VERTEILER_JE_TAG = 3;
    private const MAX_VERSUCHE = 6;
    /** Mails, die so lange nicht zugestellt werden konnten, werden verworfen (Datensparsamkeit) */
    private const AUFBEWAHREN = 3 * 86400;
    private const BESTAETIGEN_DAUER = 86400;
    private const ID_ZEICHEN = 'abcdefghijkmnpqrstuvwxyz23456789';
    private const ARTEN_POSTFACH = ['rundmail', 'ergebnis', 'hinweis'];

    public function __construct(private readonly Api $api, private readonly Datenbank $db, private readonly Mailer $mailer, private readonly array $config)
    {
    }

    /* ---------------- Warteschlange ---------------- */

    private function jeMinute(): int
    {
        $n = (int)($this->config['mail']['je_minute'] ?? 20);
        return max(1, min(200, $n ?: 20));
    }

    /**
     * Mail in die Warteschlange (mit Fußzeile wie Api::mail). $versuche > 0: Wiederholung einer gescheiterten System-Mail.
     * @param array<string,string> $zusatz Kopfzeilen
     */
    public function vormerken(string $an, string $betreff, string $text, ?string $antwortAn, string $art, ?string $turnier = null, ?int $sparte = null, array $zusatz = [], int $versuche = 0): void
    {
        if (filter_var($an, FILTER_VALIDATE_EMAIL) === false) {
            return;
        }
        $jetzt = $this->api->jetzt();
        $this->db->ausfuehren(
            'INSERT INTO mail_warteschlange (an, betreff, text, antwort, zusatz, art, turnier_id, sparte_id, angelegt, naechster, versuche) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$an, mb_substr($betreff, 0, 250), $text, $antwortAn, $zusatz === [] ? null : json_encode($zusatz), $art, $turnier, $sparte, $jetzt,
                $versuche > 0 ? $jetzt + $this->warteZeit($versuche) : $jetzt, $versuche]
        );
    }

    private function warteZeit(int $versuche): int
    {
        return min(6 * 3600, 300 * (2 ** max(0, $versuche - 1)));
    }

    /** Wartende Mails (für Tests und die Statusanzeige) */
    public function wartend(?string $turnier = null): int
    {
        $z = $turnier === null
            ? $this->db->eine('SELECT COUNT(*) AS n FROM mail_warteschlange')
            : $this->db->eine('SELECT COUNT(*) AS n FROM mail_warteschlange WHERE turnier_id = ?', [$turnier]);
        return (int)($z['n'] ?? 0);
    }

    /**
     * Höchstens $max Mails versenden, gedrosselt auf je_minute. Jede Mail wird vorher „reserviert“, damit zwei
     * gleichzeitige Aufrufe sie nicht doppelt senden. Gibt die Zahl der gesendeten Mails zurück.
     */
    public function abarbeiten(int $max = 25, float $sekunden = 20.0): int
    {
        if (!$this->mailer->bereit()) {
            return 0;
        }
        $start = microtime(true);
        $gesendet = 0;
        while ($gesendet < $max && microtime(true) - $start < $sekunden) {
            $jetzt = $this->api->jetzt();
            if ($this->api->anzahlVersuche('mail-versand', 60) >= $this->jeMinute()) {
                break;
            }
            $z = $this->db->eine('SELECT * FROM mail_warteschlange WHERE naechster <= ? ORDER BY naechster, id LIMIT 1', [$jetzt]);
            if ($z === null) {
                break;
            }
            // Reservieren: nur wer die Zeile ändern konnte, sendet
            if ($this->db->ausfuehren('UPDATE mail_warteschlange SET naechster = ? WHERE id = ? AND naechster = ?', [$jetzt + 900, (int)$z['id'], (int)$z['naechster']]) !== 1) {
                continue;
            }
            $zusatz = json_decode((string)($z['zusatz'] ?? ''), true);
            $ok = $this->mailer->senden(new Mail((string)$z['an'], (string)$z['betreff'], (string)$z['text'], $z['antwort'] === null ? null : (string)$z['antwort'], null, null, 'application/json', is_array($zusatz) ? $zusatz : []));
            $this->api->fehlversuch('mail-versand');
            if ($ok) {
                $this->db->ausfuehren('DELETE FROM mail_warteschlange WHERE id = ?', [(int)$z['id']]);
                $gesendet++;
                continue;
            }
            $versuche = (int)$z['versuche'] + 1;
            $fehler = $this->mailer instanceof SmtpMailer ? $this->mailer->fehler() : 'Versand fehlgeschlagen';
            if ($versuche >= self::MAX_VERSUCHE) {
                error_log("tt-turnier: Mail an {$z['an']} nach {$versuche} Versuchen verworfen ({$fehler})");
                $this->db->ausfuehren('DELETE FROM mail_warteschlange WHERE id = ?', [(int)$z['id']]);
            } else {
                $this->db->ausfuehren('UPDATE mail_warteschlange SET versuche = ?, naechster = ?, fehler = ? WHERE id = ?', [$versuche, $jetzt + $this->warteZeit($versuche), mb_substr($fehler, 0, 250), (int)$z['id']]);
            }
        }
        return $gesendet;
    }

    /* ---------------- Posteingang ---------------- */

    /** Nachricht in den Posteingang einer Kennung (rolle spieler|helfer|leitung, bezug wie in codes) */
    private function zustellen(string $turnier, string $rolle, string $bezug, string $art, string $titel, string $text, string $von): void
    {
        $this->db->ausfuehren(
            'INSERT INTO nachrichten (turnier_id, rolle, bezug, art, titel, text, von, zeit, gelesen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
            [$turnier, $rolle, $bezug, $art, mb_substr($titel, 0, 160), $text, mb_substr($von, 0, 120), $this->api->jetzt()]
        );
    }

    /** Empfänger der Sitzung im Turnier: [rolle, bezug] einer Kennung oder ['gesendet', ''] für die Leitung mit Konto */
    private function empfaengerDerSitzung(Anfrage $a, array $t): array
    {
        $s = $this->api->sitzung($a);
        if ($s === null) {
            throw new ApiFehler('nicht_angemeldet', 'Der Posteingang gehört zu einer Kennung. Bitte mit deiner Kennung anmelden.');
        }
        if ($s['konto_id'] === null && $s['turnier_id'] === $t['id'] && in_array($s['rolle'], ['spieler', 'helfer', 'leitung'], true) && $s['bezug'] !== null) {
            return [(string)$s['rolle'], (string)$s['bezug']];
        }
        if ($this->api->leitungsRecht($s, $t)) {
            return ['gesendet', ''];
        }
        throw new ApiFehler('keine_berechtigung', 'Kein Posteingang für dieses Turnier.');
    }

    /** GET nachrichten&turnier= – Posteingang der eigenen Kennung (Leitung mit Konto: gesendete Rundmails) */
    public function postfach(Anfrage $a): array
    {
        $t = $this->api->turnierLaden((string)($a->query['turnier'] ?? ''));
        [$rolle, $bezug] = $this->empfaengerDerSitzung($a, $t);
        $zeilen = $this->db->alle(
            'SELECT * FROM nachrichten WHERE turnier_id = ? AND rolle = ? AND bezug = ? ORDER BY id DESC LIMIT ' . self::MAX_POSTFACH,
            [$t['id'], $rolle, $bezug]
        );
        $liste = array_map(static fn(array $z): array => [
            'id' => (int)$z['id'], 'art' => (string)$z['art'], 'titel' => (string)$z['titel'], 'text' => (string)$z['text'],
            'von' => (string)$z['von'], 'zeit' => Api::iso((int)$z['zeit']), 'gelesen' => $z['gelesen'] !== null,
        ], $zeilen);
        return [
            'nachrichten' => $liste,
            'ungelesen' => count(array_filter($liste, static fn(array $n): bool => !$n['gelesen'])),
            'gesendet' => $rolle === 'gesendet',
            'wartend' => $rolle === 'gesendet' ? $this->wartend((string)$t['id']) : 0,
        ];
    }

    /** POST nachrichten.gelesen { turnier, bis } – alle eigenen bis zu dieser ID als gelesen markieren */
    public function gelesen(Anfrage $a): array
    {
        $t = $this->api->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        [$rolle, $bezug] = $this->empfaengerDerSitzung($a, $t);
        $bis = $a->rumpf['bis'] ?? null;
        if (!is_int($bis) || $bis < 1) {
            throw new ApiFehler('ungueltig', 'Feld „bis“ fehlt.');
        }
        $this->db->ausfuehren(
            'UPDATE nachrichten SET gelesen = ? WHERE turnier_id = ? AND rolle = ? AND bezug = ? AND id <= ? AND gelesen IS NULL',
            [$this->api->jetzt(), $t['id'], $rolle, $bezug, $bis]
        );
        return ['ok' => true];
    }

    /* ---------------- Rundmail und Ergebnis ---------------- */

    /** Antwortadresse der Turnierleitung: das sendende Konto, sonst das Eigentümer-Konto */
    private function antwortAdresse(Anfrage $a, array $t): ?string
    {
        $s = $this->api->sitzung($a);
        $id = $s !== null && $s['konto_id'] !== null ? (int)$s['konto_id'] : (int)($t['konto_id'] ?? 0);
        $k = $this->db->eine('SELECT email FROM konten WHERE id = ?', [$id]);
        return $k === null ? null : (string)$k['email'];
    }

    /** Liste von Spieler-IDs aus dem Rumpf (geprüft) */
    private static function idListe(mixed $roh, string $feld): array
    {
        if ($roh === null) {
            return [];
        }
        if (!is_array($roh) || !array_is_list($roh) || count($roh) > self::MAX_EMPFAENGER) {
            throw new ApiFehler('ungueltig', "Feld „{$feld}“ muss eine Liste sein (höchstens " . self::MAX_EMPFAENGER . ').');
        }
        $aus = [];
        foreach ($roh as $id) {
            if (!is_string($id) || !preg_match('/^[a-z0-9]{1,16}$/D', $id)) {
                throw new ApiFehler('ungueltig', "Ungültige Kennung in „{$feld}“.");
            }
            $aus[$id] = true;
        }
        return array_keys($aus);
    }

    /** Kennungen (nicht gesperrt) einer Rolle im Turnier, als bezug => true */
    private function kennungen(string $turnier, string $rolle): array
    {
        $aus = [];
        foreach ($this->db->alle('SELECT bezug FROM codes WHERE turnier_id = ? AND rolle = ? AND gesperrt = 0', [$turnier, $rolle]) as $z) {
            $aus[(string)$z['bezug']] = true;
        }
        return $aus;
    }

    /**
     * E-Mail-Adressen zu Spieler-IDs aus der Online-Anmeldung: Einzelanmeldung (Spieler-ID = Anmelde-ID) bzw.
     * Gruppenanmeldung (Spieler-ID = Anmelde-ID + „p“ + Nummer → Mail an die Mannschaftsleitung).
     * @return array<string,list<string>> email => Spieler-IDs
     */
    private function adressenZu(string $turnier, array $spieler): array
    {
        $aus = [];
        if ($spieler === []) {
            return $aus;
        }
        $zeilen = [];
        foreach ($this->db->alle('SELECT id, email, bestaetigt FROM anmeldungen WHERE turnier_id = ? AND bestaetigt IS NOT NULL', [$turnier]) as $z) {
            $zeilen[(string)$z['id']] = mb_strtolower((string)$z['email']);
        }
        foreach ($spieler as $id) {
            $anm = isset($zeilen[$id]) ? $id : (preg_match('/^([a-z0-9]{10})(p\d{1,3}|l)$/D', $id, $m) && isset($zeilen[$m[1]]) ? $m[1] : null);
            if ($anm !== null) {
                $aus[$zeilen[$anm]][] = $id;
            }
        }
        return $aus;
    }

    /** E-Mail-Adressen der Warteliste in den genannten Konkurrenzen */
    private function wartelisteAdressen(string $turnier, array $konkurrenzen): array
    {
        $aus = [];
        if ($konkurrenzen === []) {
            return $aus;
        }
        $will = array_fill_keys($konkurrenzen, true);
        foreach ($this->db->alle('SELECT email, daten FROM anmeldungen WHERE turnier_id = ? AND bestaetigt IS NOT NULL', [$turnier]) as $z) {
            $d = json_decode((string)$z['daten'], true);
            foreach (is_array($d['konkurrenzen'] ?? null) ? $d['konkurrenzen'] : [] as $k) {
                if (isset($will[$k['id'] ?? '']) && ($k['status'] ?? '') === 'warteliste') {
                    $aus[mb_strtolower((string)$z['email'])] = true;
                }
            }
        }
        return array_keys($aus);
    }

    private function textFeld(Anfrage $a, string $feld, int $min, int $max, bool $einzeilig): string
    {
        return $this->api->text($a, $feld, $min, $max, $einzeilig);
    }

    /**
     * POST rundmail { turnier, betreff, text, gruppe, spieler: [IDs], helfer, leitung, warteliste: [Konkurrenz-IDs], mail }
     * Nur Turnierleitung. Posteingang für Kennungen; mit mail=true zusätzlich Mails an die Online-Angemeldeten
     * (bzw. ihre Mannschaftsleitung) und die Warteliste.
     */
    public function rundmail(Anfrage $a): array
    {
        $t = $this->api->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->api->leitungPruefen($a, $t);
        $betreff = $this->textFeld($a, 'betreff', 2, self::MAX_TITEL, true);
        $text = $this->textFeld($a, 'text', 2, self::MAX_TEXT, false);
        $gruppe = is_string($a->rumpf['gruppe'] ?? null) ? mb_substr(trim((string)preg_replace('/[\x00-\x1F\x7F]/u', '', $a->rumpf['gruppe'])), 0, 120) : '';
        $spieler = self::idListe($a->rumpf['spieler'] ?? null, 'spieler');
        $warte = self::idListe($a->rumpf['warteliste'] ?? null, 'warteliste');
        $helfer = ($a->rumpf['helfer'] ?? false) === true;
        $leitung = ($a->rumpf['leitung'] ?? false) === true;
        $mail = ($a->rumpf['mail'] ?? false) === true;
        if ($spieler === [] && $warte === [] && !$helfer && !$leitung) {
            throw new ApiFehler('ungueltig', 'Bitte mindestens eine Empfängergruppe wählen.');
        }
        $this->api->begrenzen('rundmail|' . $t['id'], self::RUNDMAILS_JE_TURNIER, 86400, 'Heute wurden für dieses Turnier schon viele Nachrichten verschickt. Bitte morgen wieder.');
        $this->api->begrenzen('rundmail-sparte|' . (int)$t['sparte_id'], self::RUNDMAILS_JE_SPARTE, 86400, 'Heute wurden in dieser Sparte schon viele Nachrichten verschickt. Bitte morgen wieder.');
        $von = 'Turnierleitung';
        $postfach = 0;
        $this->db->anfangen();
        try {
            $sp = $this->kennungen((string)$t['id'], 'spieler');
            foreach ($spieler as $id) {
                if (isset($sp[$id])) {
                    $this->zustellen((string)$t['id'], 'spieler', $id, 'rundmail', $betreff, $text, $von);
                    $postfach++;
                }
            }
            foreach ($helfer ? array_keys($this->kennungen((string)$t['id'], 'helfer')) : [] as $b) {
                $this->zustellen((string)$t['id'], 'helfer', $b, 'rundmail', $betreff, $text, $von);
                $postfach++;
            }
            $s = $this->api->sitzung($a);
            foreach ($leitung ? array_keys($this->kennungen((string)$t['id'], 'leitung')) : [] as $b) {
                if ($s !== null && $s['konto_id'] === null && $s['bezug'] === $b) {
                    continue; // nicht an sich selbst
                }
                $this->zustellen((string)$t['id'], 'leitung', $b, 'rundmail', $betreff, $text, $von);
                $postfach++;
            }
            $mails = 0;
            if ($mail && $this->api->mailBereit()) {
                $antwort = $this->antwortAdresse($a, $t);
                $adressen = array_keys($this->adressenZu((string)$t['id'], $spieler));
                $adressen = array_values(array_unique(array_merge($adressen, $this->wartelisteAdressen((string)$t['id'], $warte))));
                foreach (array_slice($adressen, 0, self::MAX_EMPFAENGER) as $an) {
                    $this->vormerken($an, "{$betreff} – {$t['name']}", "Nachricht der Turnierleitung zu „{$t['name']}“:\n\n{$text}"
                        . $this->api->mailFuss(true), $antwort, 'rundmail', (string)$t['id'], (int)$t['sparte_id']);
                    $mails++;
                }
            }
            // Kopie für die Leitung (Liste „Gesendet“)
            $this->zustellen((string)$t['id'], 'gesendet', '', 'rundmail', $betreff,
                ($gruppe !== '' ? "An: {$gruppe}\n" : '') . "Posteingang: {$postfach} · E-Mails: {$mails}\n\n{$text}", $s['name'] ?? $von);
            $this->db->festschreiben();
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
        return ['postfach' => $postfach, 'mails' => $mails];
    }

    /** Ist das Turnier abgeschlossen (letzter Eintrag von abgeschlossen/wiedereröffnet)? */
    private function abgeschlossen(string $turnier): bool
    {
        $z = $this->db->eine("SELECT art FROM ereignisse WHERE turnier_id = ? AND art IN ('turnier.abgeschlossen', 'turnier.wiedereroeffnet') ORDER BY seq DESC LIMIT 1", [$turnier]);
        return $z !== null && $z['art'] === 'turnier.abgeschlossen';
    }

    /**
     * POST turnier.ergebnis { turnier, liste: Text, plaetze: [{ spieler, text }] } – nur Leitung, nur abgeschlossene Turniere,
     * höchstens dreimal je Turnier. Die App erstellt die Texte nach den Einstellungen zu Veröffentlichung und Namen.
     */
    public function ergebnis(Anfrage $a): array
    {
        $t = $this->api->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $this->api->leitungPruefen($a, $t);
        if (!$this->abgeschlossen((string)$t['id'])) {
            throw new ApiFehler('konflikt', 'Ergebnisse lassen sich erst nach „Turnier abschließen“ versenden.');
        }
        if ((int)($t['ergebnis_mails'] ?? 0) >= self::ERGEBNIS_MAX) {
            throw new ApiFehler('zu_viele_versuche', 'Die Ergebnisse wurden für dieses Turnier schon ' . self::ERGEBNIS_MAX . '-mal verschickt.');
        }
        $liste = $this->textFeld($a, 'liste', 1, self::MAX_LISTE, false);
        $roh = $a->rumpf['plaetze'] ?? [];
        if (!is_array($roh) || !array_is_list($roh) || count($roh) > self::MAX_EMPFAENGER) {
            throw new ApiFehler('ungueltig', 'Feld „plaetze“ muss eine Liste sein.');
        }
        $plaetze = [];
        foreach ($roh as $p) {
            $p = $p instanceof \stdClass ? get_object_vars($p) : $p;
            $id = is_array($p) ? ($p['spieler'] ?? null) : null;
            $txt = is_array($p) ? ($p['text'] ?? null) : null;
            if (!is_string($id) || !preg_match('/^[a-z0-9]{1,16}$/D', $id) || !is_string($txt) || mb_strlen($txt) > 600) {
                throw new ApiFehler('ungueltig', 'Ungültiger Eintrag in „plaetze“.');
            }
            $plaetze[$id] = trim((string)preg_replace('/[\x00-\x09\x0B-\x1F\x7F]/u', '', $txt));
        }
        $titel = "Ergebnisse: {$t['name']}";
        $postfach = 0;
        $mails = 0;
        $this->db->anfangen();
        try {
            if ($this->db->treiber === 'mysql') {
                $this->db->eine('SELECT id FROM turniere WHERE id = ? FOR UPDATE', [$t['id']]);
            }
            $frisch = $this->db->eine('SELECT ergebnis_mails FROM turniere WHERE id = ?', [$t['id']]);
            if ((int)($frisch['ergebnis_mails'] ?? 0) >= self::ERGEBNIS_MAX) {
                throw new ApiFehler('zu_viele_versuche', 'Die Ergebnisse wurden für dieses Turnier schon ' . self::ERGEBNIS_MAX . '-mal verschickt.');
            }
            $sp = $this->kennungen((string)$t['id'], 'spieler');
            foreach ($plaetze as $id => $txt) {
                if (isset($sp[$id])) {
                    $this->zustellen((string)$t['id'], 'spieler', $id, 'ergebnis', $titel, ($txt !== '' ? $txt . "\n\n" : '') . $liste, 'Turnierleitung');
                    $postfach++;
                }
            }
            if ($this->api->mailBereit()) {
                $antwort = $this->antwortAdresse($a, $t);
                $verteiler = $this->api->appUrl() . '#/verteiler/' . $t['id'];
                foreach ($this->adressenZu((string)$t['id'], array_keys($plaetze)) as $an => $ids) {
                    $eigene = implode("\n", array_values(array_filter(array_map(static fn(string $i): string => $plaetze[$i] ?? '', $ids))));
                    $this->vormerken($an, $titel, "Hallo,\n\n„{$t['name']}“ ist abgeschlossen. Danke fürs Mitmachen!\n\n"
                        . ($eigene !== '' ? $eigene . "\n\n" : '') . $liste
                        . "\n\nÜber künftige Turniere informiert werden? Hier eintragen (jederzeit abbestellbar): {$verteiler}"
                        . $this->api->mailFuss(true), $antwort, 'ergebnis', (string)$t['id'], (int)$t['sparte_id']);
                    $mails++;
                }
            }
            $this->db->ausfuehren('UPDATE turniere SET ergebnis_mails = ergebnis_mails + 1 WHERE id = ?', [$t['id']]);
            $this->zustellen((string)$t['id'], 'gesendet', '', 'ergebnis', $titel, "Posteingang: {$postfach} · E-Mails: {$mails}\n\n{$liste}", 'Turnierleitung');
            $this->db->festschreiben();
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
        return ['postfach' => $postfach, 'mails' => $mails, 'verbleibend' => self::ERGEBNIS_MAX - (int)($t['ergebnis_mails'] ?? 0) - 1];
    }

    /* ---------------- Verteiler ---------------- */

    private function neueId(): string
    {
        for ($i = 0; $i < 50; $i++) {
            $id = '';
            for ($j = 0; $j < 12; $j++) {
                $id .= self::ID_ZEICHEN[random_int(0, strlen(self::ID_ZEICHEN) - 1)];
            }
            if ($this->db->eine('SELECT id FROM verteiler WHERE id = ?', [$id]) === null) {
                return $id;
            }
        }
        throw new ApiFehler('serverfehler', 'Es konnte keine Kennung erzeugt werden.');
    }

    /** Abmelde-Kennung für Links: ID + Prüfsumme (ohne gespeichertes Geheimnis je Eintrag) */
    public function abmeldeKennung(string $id): string
    {
        return $id . '-' . substr(hash_hmac('sha256', 'verteiler-ab|' . $id, $this->api->geheimnis()), 0, 24);
    }

    private function abmeldeLink(string $id): string
    {
        return $this->api->appUrl() . '#/verteiler/ab/' . $this->abmeldeKennung($id);
    }

    private function sparteVon(array $t): array
    {
        $sp = $t['sparte_id'] === null ? null : $this->db->eine('SELECT s.*, v.name AS verein FROM sparten s JOIN vereine v ON v.id = s.verein_id WHERE s.id = ?', [(int)$t['sparte_id']]);
        if ($sp === null) {
            throw new ApiFehler('nicht_gefunden', 'Zu diesem Turnier gibt es keinen Verteiler.');
        }
        return $sp;
    }

    /**
     * Eintrag aus einer bestätigten Online-Anmeldung (die Bestätigungsmail hat die Einwilligung genannt und
     * die Adresse bestätigt – Double-Opt-In). Vorhandene Einträge bleiben, unbestätigte werden bestätigt.
     */
    public function ausAnmeldung(array $t, string $email, string $name): void
    {
        if ($t['sparte_id'] === null) {
            return;
        }
        $email = mb_strtolower($email);
        $alt = $this->db->eine('SELECT id, bestaetigt FROM verteiler WHERE sparte_id = ? AND email = ?', [(int)$t['sparte_id'], $email]);
        $jetzt = $this->api->jetzt();
        if ($alt !== null) {
            if ($alt['bestaetigt'] === null) {
                $this->db->ausfuehren('UPDATE verteiler SET bestaetigt = ? WHERE id = ?', [$jetzt, $alt['id']]);
            }
            return;
        }
        $this->db->ausfuehren(
            'INSERT INTO verteiler (id, sparte_id, email, name, schluessel_hash, angelegt, bestaetigt, jugend, quelle) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
            [$this->neueId(), (int)$t['sparte_id'], $email, mb_substr($name, 0, 120), hash('sha256', bin2hex(random_bytes(32))), $jetzt, $jetzt, (string)$t['id']]
        );
    }

    /** Abmeldelink für eine Adresse (für die Bestätigungsmail der Anmeldung) */
    public function abmeldeLinkFuer(array $t, string $email): ?string
    {
        $z = $t['sparte_id'] === null ? null : $this->db->eine('SELECT id FROM verteiler WHERE sparte_id = ? AND email = ? AND bestaetigt IS NOT NULL', [(int)$t['sparte_id'], mb_strtolower($email)]);
        return $z === null ? null : $this->abmeldeLink((string)$z['id']);
    }

    /**
     * POST verteiler.eintragen { turnier, name, email, volljaehrig, erziehungsberechtigte, datenschutz, website } – öffentlich.
     * Die Antwort ist immer gleich (verrät nicht, wer eingetragen ist).
     */
    public function eintragen(Anfrage $a): array
    {
        if (!$this->api->mailBereit()) {
            throw new ApiFehler('nicht_eingerichtet', 'Auf diesem Server ist kein Mailversand eingerichtet.');
        }
        $this->api->begrenzen('verteiler|' . $a->ip, 10, 3600, 'Von diesem Anschluss kamen gerade viele Einträge. Bitte später erneut versuchen.');
        $this->api->fangfeld($a);
        $t = $this->api->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $sp = $this->sparteVon($t);
        if (!$this->api->anmeldungFreigabe($t)['erlaubt']) {
            throw new ApiFehler('abgelaufen', 'Für diesen Verein ist der Verteiler (noch) nicht freigeschaltet.');
        }
        $name = $this->textFeld($a, 'name', 2, 120, true);
        $email = $this->api->email($a);
        if (($a->rumpf['datenschutz'] ?? false) !== true) {
            throw new ApiFehler('ungueltig', 'Bitte den Datenschutzhinweis bestätigen.');
        }
        $voll = ($a->rumpf['volljaehrig'] ?? false) === true;
        $eltern = ($a->rumpf['erziehungsberechtigte'] ?? false) === true;
        if (!$voll && !$eltern) {
            throw new ApiFehler('ungueltig', 'Unter 18 geht es nur mit Einverständnis der Erziehungsberechtigten – bitte bestätigen.');
        }
        $mk = 'verteiler-mail|' . hash('sha256', $email);
        if ($this->api->anzahlVersuche($mk, 3600) >= 3) {
            return ['ok' => true];
        }
        $this->api->fehlversuch($mk);
        $alt = $this->db->eine('SELECT id, bestaetigt FROM verteiler WHERE sparte_id = ? AND email = ?', [(int)$sp['id'], $email]);
        if ($alt !== null && $alt['bestaetigt'] !== null) {
            return ['ok' => true]; // schon eingetragen: keine weitere Mail
        }
        $schluessel = bin2hex(random_bytes(32));
        if ($alt === null) {
            $this->db->ausfuehren(
                'INSERT INTO verteiler (id, sparte_id, email, name, schluessel_hash, angelegt, bestaetigt, jugend, quelle) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)',
                [$this->neueId(), (int)$sp['id'], $email, $name, hash('sha256', $schluessel), $this->api->jetzt(), $voll ? 0 : 1, (string)$t['id']]
            );
        } else {
            $this->db->ausfuehren('UPDATE verteiler SET schluessel_hash = ?, name = ?, jugend = ?, angelegt = ? WHERE id = ?', [hash('sha256', $schluessel), $name, $voll ? 0 : 1, $this->api->jetzt(), $alt['id']]);
        }
        // Erste Mail ohne frei eingegebenen Text (Name) – sie geht an eine noch unbestätigte Adresse
        $this->api->mail($email, 'Bitte bestätigen: Ankündigungen von ' . $sp['verein'], "Hallo,\n\n"
            . "bitte bestätige, dass du Ankündigungen zu Turnieren von „{$sp['verein']} – {$sp['name']}“ per Mail bekommen möchtest:\n\n"
            . $this->api->appUrl() . '#/verteiler/b/' . $schluessel . "\n\n"
            . "Der Link gilt 24 Stunden. Abbestellen kannst du jederzeit über den Link in jeder Mail.\n"
            . "Hast du dich nicht eingetragen? Dann ignoriere diese Mail – die Angaben werden nach 24 Stunden gelöscht.\n\n"
            . 'Datenschutzhinweis: ' . $this->api->appUrl() . '#/datenschutz');
        return ['ok' => true];
    }

    /** POST verteiler.bestaetigen { schluessel } – öffentlich, gebremst */
    public function bestaetigen(Anfrage $a): array
    {
        $bremse = 'verteiler-link|' . $a->ip;
        $this->api->bremse($bremse);
        $s = $a->rumpf['schluessel'] ?? '';
        $z = is_string($s) && preg_match('/^[a-f0-9]{64}$/D', $s) ? $this->db->eine('SELECT * FROM verteiler WHERE schluessel_hash = ?', [hash('sha256', $s)]) : null;
        if ($z === null || ($z['bestaetigt'] === null && (int)$z['angelegt'] < $this->api->jetzt() - self::BESTAETIGEN_DAUER)) {
            $this->api->fehlversuch($bremse);
            throw new ApiFehler('abgelaufen', 'Der Link ist ungültig oder abgelaufen. Bitte trage dich erneut ein.');
        }
        if ($z['bestaetigt'] === null) {
            $this->db->ausfuehren('UPDATE verteiler SET bestaetigt = ? WHERE id = ?', [$this->api->jetzt(), $z['id']]);
        }
        $sp = $this->db->eine('SELECT s.name, v.name AS verein FROM sparten s JOIN vereine v ON v.id = s.verein_id WHERE s.id = ?', [(int)$z['sparte_id']]);
        return ['verein' => (string)($sp['verein'] ?? ''), 'sparte' => (string)($sp['name'] ?? ''), 'abmelden' => $this->abmeldeKennung((string)$z['id'])];
    }

    /** POST verteiler.abmelden { kennung } – öffentlich, gebremst. Löscht den Eintrag. */
    public function abmelden(Anfrage $a): array
    {
        $bremse = 'verteiler-link|' . $a->ip;
        $this->api->bremse($bremse);
        $k = $a->rumpf['kennung'] ?? '';
        if (!is_string($k) || !preg_match('/^([a-z2-9]{12})-[a-f0-9]{24}$/D', $k, $m) || !hash_equals($this->abmeldeKennung($m[1]), $k)) {
            $this->api->fehlversuch($bremse);
            throw new ApiFehler('abgelaufen', 'Der Link ist ungültig.');
        }
        $this->db->ausfuehren('DELETE FROM verteiler WHERE id = ?', [$m[1]]);
        return ['ok' => true];
    }

    private function sparteLeitung(Anfrage $a, mixed $id): array
    {
        $s = $this->api->kontoSitzung($a);
        $sp = $this->api->sparten->sparteLaden((int)(is_numeric($id) ? $id : 0));
        if (!$this->api->sparten->istSpartenleitung($s, (int)$sp['id'])) {
            throw new ApiFehler('keine_berechtigung', 'Nur für die Spartenleitung.');
        }
        return [$s, $sp];
    }

    /** GET verteiler&sparte= – nur Spartenleitung */
    public function liste(Anfrage $a): array
    {
        [, $sp] = $this->sparteLeitung($a, $a->query['sparte'] ?? null);
        $zeilen = $this->db->alle('SELECT * FROM verteiler WHERE sparte_id = ? ORDER BY name, email', [(int)$sp['id']]);
        return [
            'eintraege' => array_map(static fn(array $z): array => [
                'id' => (string)$z['id'], 'name' => (string)$z['name'], 'email' => (string)$z['email'],
                'bestaetigt' => $z['bestaetigt'] === null ? null : Api::iso((int)$z['bestaetigt']),
                'jugend' => (int)$z['jugend'] === 1, 'quelle' => $z['quelle'] === null ? null : (string)$z['quelle'],
            ], $zeilen),
            'gesendetHeute' => $this->api->anzahlVersuche('verteiler-senden|' . (int)$sp['id'], 86400),
            'jeTag' => self::VERTEILER_JE_TAG,
        ];
    }

    /** POST verteiler.entfernen { sparte, id } – nur Spartenleitung */
    public function entfernen(Anfrage $a): array
    {
        [, $sp] = $this->sparteLeitung($a, $a->rumpf['sparte'] ?? null);
        $id = $a->rumpf['id'] ?? '';
        $this->db->ausfuehren('DELETE FROM verteiler WHERE sparte_id = ? AND id = ?', [(int)$sp['id'], is_string($id) ? $id : '']);
        return $this->liste(new Anfrage('GET', 'verteiler', ['sparte' => (string)$sp['id']], null, $a->token, $a->ip));
    }

    /** POST verteiler.senden { sparte, betreff, text } – Ankündigung an alle Bestätigten, mit Abmeldelink */
    public function senden(Anfrage $a): array
    {
        [$s, $sp] = $this->sparteLeitung($a, $a->rumpf['sparte'] ?? null);
        if (!$this->api->mailBereit()) {
            throw new ApiFehler('nicht_eingerichtet', 'Auf diesem Server ist kein Mailversand eingerichtet.');
        }
        if (!$this->api->anmeldungFreigabe(['sparte_id' => (int)$sp['id'], 'konto_id' => (int)$s['konto_id']])['erlaubt']) {
            throw new ApiFehler('keine_berechtigung', 'Ankündigungen sind erst möglich, wenn die Sparte freigegeben ist.');
        }
        $betreff = $this->textFeld($a, 'betreff', 2, self::MAX_TITEL, true);
        $text = $this->textFeld($a, 'text', 2, self::MAX_TEXT, false);
        $this->api->begrenzen('verteiler-senden|' . (int)$sp['id'], self::VERTEILER_JE_TAG, 86400, 'Heute wurden schon ' . self::VERTEILER_JE_TAG . ' Ankündigungen verschickt. Bitte morgen wieder.');
        $k = $this->db->eine('SELECT email FROM konten WHERE id = ?', [(int)$s['konto_id']]);
        $n = 0;
        $this->db->anfangen();
        try {
            foreach ($this->db->alle('SELECT id, email FROM verteiler WHERE sparte_id = ? AND bestaetigt IS NOT NULL', [(int)$sp['id']]) as $z) {
                $ab = $this->abmeldeLink((string)$z['id']);
                $this->vormerken((string)$z['email'], $betreff, "Ankündigung von „{$sp['verein']} – {$sp['name']}“:\n\n{$text}\n\n"
                    . "Du bekommst diese Mail, weil du dich für Ankündigungen eingetragen hast. Abbestellen: {$ab}"
                    . $this->api->mailFuss(true), $k === null ? null : (string)$k['email'], 'verteiler', null, (int)$sp['id'], ['List-Unsubscribe' => "<{$ab}>"]);
                $n++;
            }
            $this->db->festschreiben();
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
        return ['mails' => $n];
    }

    /* ---------------- Löschen und Aufräumen ---------------- */

    public function turnierEntfernt(string $id): void
    {
        $this->db->ausfuehren('DELETE FROM nachrichten WHERE turnier_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM mail_warteschlange WHERE turnier_id = ?', [$id]);
    }

    public function sparteEntfernt(int $id): void
    {
        $this->db->ausfuehren('DELETE FROM verteiler WHERE sparte_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM mail_warteschlange WHERE sparte_id = ?', [$id]);
    }

    /** Gesperrte bzw. entfernte Kennung: ihr Posteingang wird gelöscht */
    public function kennungEntfernt(string $turnier, string $rolle, string $bezug): void
    {
        $this->db->ausfuehren('DELETE FROM nachrichten WHERE turnier_id = ? AND rolle = ? AND bezug = ?', [$turnier, $rolle, $bezug]);
    }

    public function aufraeumen(): void
    {
        $jetzt = $this->api->jetzt();
        $this->db->ausfuehren('DELETE FROM mail_warteschlange WHERE angelegt < ?', [$jetzt - self::AUFBEWAHREN]);
        $this->db->ausfuehren('DELETE FROM verteiler WHERE bestaetigt IS NULL AND angelegt < ?', [$jetzt - self::BESTAETIGEN_DAUER]);
        $this->db->ausfuehren('DELETE FROM nachrichten WHERE turnier_id NOT IN (SELECT id FROM turniere)');
    }
}
