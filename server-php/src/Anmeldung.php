<?php
declare(strict_types=1);

namespace TtTurnier;

/**
 * Online-Anmeldung mit Warteliste (ab 0.11, Vertrag: shared/protokoll.ts „Online-Anmeldung“).
 *
 * - Die Turnierleitung öffnet die Anmeldung (Konkurrenzen, Höchstzahl, Startgeld, Meldeschluss).
 * - Spieler melden sich über den Link an und bestätigen per Mail (Link 24 Stunden gültig, danach gelöscht).
 * - Mit der Bestätigung bekommen sie je Konkurrenz einen Platz oder einen Wartelistenplatz;
 *   sagt jemand ab, rückt der Erste der Warteliste nach (Mail).
 * - E-Mail-Adressen bleiben hier und stehen nie in den Ereignissen. 30 Tage nach dem Turniertag
 *   werden alle Anmeldungen des Turniers gelöscht (Wartung).
 */
final class Anmeldung
{
    private const BESTAETIGEN_DAUER = 86400;
    private const LOESCHEN_NACH_TAGEN = 30;          // shared/protokoll.ts ANMELDUNG_LOESCHEN_NACH_TAGEN
    private const MAX_KONKURRENZEN = 30;
    /** Bestätigte Anmeldungen je Turnier */
    private const MAX_JE_TURNIER = 1000;
    /** Unbestätigte je Turnier (gleichzeitig) und neue je Turnier und Stunde bzw. je Konto und Tag (gegen Missbrauch als Mail-Schleuder) */
    private const MAX_UNBESTAETIGT = 200;
    private const MAX_JE_TURNIER_STUNDE = 60;
    private const MAX_JE_KONTO_TAG = 300;
    /** Ersatzfrist: spätestens so viele Tage nach der Anmeldung gelöscht, auch wenn das Turnierdatum verschoben wird */
    private const LOESCHEN_SPAETESTENS_TAGE = 180;
    private const ANGABEN = ['ttr', 'klasse', 'geschlecht', 'jahrgang'];
    private const ID_ZEICHEN = 'abcdefghijkmnpqrstuvwxyz23456789';
    /** Spätere Mails enthalten keinen neuen Link (es gibt einen Schlüssel je Anmeldung, gespeichert nur als Hash) */
    private const LINK_HINWEIS = 'Den Stand siehst du jederzeit über den Link aus deiner Bestätigungsmail; dort kannst du dich auch abmelden.';

    public function __construct(private readonly Api $api, private readonly Datenbank $db)
    {
    }

    /* ---------------- Einstellungen ---------------- */

    /** Gespeicherte Einstellungen oder null (keine Online-Anmeldung) */
    private static function einst(array $t): ?array
    {
        $e = json_decode((string)($t['anmeldung'] ?? ''), true);
        return is_array($e) ? $e : null;
    }

    private static function leer(): array
    {
        return ['offen' => false, 'schluss' => null, 'konkurrenzen' => [], 'hinweis' => '', 'angaben' => [], 'bank' => null, 'ort' => '', 'hinweisMail' => true];
    }

    /** Öffentliche Fassung: ohne „vorab“ (Zählhilfe) und ohne Bankverbindung (die sehen nur bestätigte Anmeldungen) */
    private static function ausgabe(array $e): array
    {
        $e['bank'] = null;
        unset($e['hinweisMail']);
        $e['konkurrenzen'] = array_map(static fn(array $k): array => [
            'id' => $k['id'], 'name' => $k['name'], 'art' => $k['art'], 'max' => $k['max'], 'startgeld' => $k['startgeld'],
        ], $e['konkurrenzen']);
        return $e;
    }

    /** Heute (UTC) als JJJJ-MM-TT */
    private function heute(): string
    {
        return gmdate('Y-m-d', $this->api->jetzt());
    }

    /** Neue Anmeldungen möglich: offen, Datum gesetzt, vor dem Turniertag und vor dem Meldeschluss */
    private function moeglich(array $t, array $e): bool
    {
        if (!($e['offen'] ?? false) || $t['datum'] === null || $this->heute() >= (string)$t['datum']) {
            return false;
        }
        // Konto gesperrt oder (noch) nicht für die Online-Anmeldung freigegeben (Etappe 10)
        if (!$this->api->anmeldungFreigabe((int)$t['konto_id'])['erlaubt']) {
            return false;
        }
        $schluss = $e['schluss'] ?? null;
        return $schluss === null || $this->api->jetzt() < (int)strtotime((string)$schluss);
    }

    /** Abmelden per Link bis zum Vortag; am Turniertag bitte an die Leitung wenden */
    private function abmeldbar(array $t): bool
    {
        return $t['datum'] === null || $this->heute() < (string)$t['datum'];
    }

    /* ---------------- Daten ---------------- */

    /** @return list<array> Zeilen mit entpackten Daten (Feld „d“) */
    private function zeilen(string $turnierId): array
    {
        $aus = [];
        foreach ($this->db->alle('SELECT * FROM anmeldungen WHERE turnier_id = ? ORDER BY angelegt, id', [$turnierId]) as $z) {
            $d = json_decode((string)$z['daten'], true);
            $z['d'] = is_array($d) ? $d : ['konkurrenzen' => []];
            $aus[] = $z;
        }
        return $aus;
    }

    private function speichern(array $z): void
    {
        $this->db->ausfuehren(
            'UPDATE anmeldungen SET daten = ?, bestaetigt = ?, spieler = ? WHERE turnier_id = ? AND id = ?',
            [json_encode($z['d'], JSON_UNESCAPED_UNICODE), $z['bestaetigt'], $z['spieler'], $z['turnier_id'], $z['id']]
        );
    }

    /** Belegung je Konkurrenz: bestätigte Plätze (+ von der Leitung eingetragene „vorab“) und Warteliste */
    private static function belegung(array $e, array $zeilen): array
    {
        $b = [];
        foreach ($e['konkurrenzen'] as $k) {
            $b[$k['id']] = ['plaetze' => (int)($k['vorab'] ?? 0), 'warteliste' => 0];
        }
        foreach ($zeilen as $z) {
            if ($z['bestaetigt'] === null) {
                continue;
            }
            foreach ($z['d']['konkurrenzen'] as $k) {
                if (!isset($b[$k['id']])) {
                    continue;
                }
                if ($k['status'] === 'platz') {
                    $b[$k['id']]['plaetze']++;
                } elseif ($k['status'] === 'warteliste') {
                    $b[$k['id']]['warteliste']++;
                }
            }
        }
        return $b;
    }

    private static function konkurrenzVon(array $e, string $id): ?array
    {
        foreach ($e['konkurrenzen'] as $k) {
            if ($k['id'] === $id) {
                return $k;
            }
        }
        return null;
    }

    /** Position auf der Warteliste (1 = als Nächstes dran) */
    private static function position(array $zeilen, string $konkurrenz, string $id): ?int
    {
        $warte = [];
        foreach ($zeilen as $z) {
            if ($z['bestaetigt'] === null) {
                continue;
            }
            foreach ($z['d']['konkurrenzen'] as $k) {
                if ($k['id'] === $konkurrenz && $k['status'] === 'warteliste') {
                    $warte[] = [(int)($k['seit'] ?? 0), (int)$z['angelegt'], (string)$z['id']];
                }
            }
        }
        usort($warte, static fn(array $x, array $y): int => $x <=> $y);
        foreach ($warte as $i => $w) {
            if ($w[2] === $id) {
                return $i + 1;
            }
        }
        return null;
    }

    private static function name(array $z): string
    {
        return trim(($z['d']['vorname'] ?? '') . ' ' . ($z['d']['nachname'] ?? ''));
    }

    /** Sicht der Person auf ihre Anmeldung (AnmeldungStand) */
    private function stand(array $t, array $e, array $z, array $zeilen): array
    {
        $summe = 0;
        $liste = [];
        foreach ($z['d']['konkurrenzen'] as $k) {
            $kk = self::konkurrenzVon($e, $k['id']);
            if ($z['bestaetigt'] === null) {
                $k['status'] = null; // noch keine Vergabe
            }
            if ($k['status'] === 'platz' && $kk !== null) {
                $summe += (int)($kk['startgeld'] ?? 0);
            }
            $liste[] = [
                'id' => $k['id'],
                'name' => $kk['name'] ?? $k['id'],
                'status' => $k['status'],
                'position' => ($k['status'] ?? '') === 'warteliste' ? self::position($zeilen, $k['id'], (string)$z['id']) : null,
            ];
        }
        return [
            'turnier' => ['id' => (string)$t['id'], 'name' => (string)$t['name'], 'datum' => $t['datum']],
            'vorname' => (string)($z['d']['vorname'] ?? ''),
            'nachname' => (string)($z['d']['nachname'] ?? ''),
            'konkurrenzen' => $liste,
            'startgeld' => $summe,
            'bank' => $z['bestaetigt'] !== null ? ($e['bank'] ?? null) : null,
            'zweck' => self::zweck($t, $z),
            'abmeldbar' => $this->abmeldbar($t),
            'bestaetigt' => $z['bestaetigt'] !== null,
        ];
    }

    private static function zweck(array $t, array $z): string
    {
        return mb_substr('Startgeld ' . $t['name'] . ' ' . self::name($z), 0, 140);
    }

    private static function euro(int $cent): string
    {
        return number_format($cent / 100, 2, ',', '.') . ' €';
    }

    /** Antworten auf Anmelde-Mails gehen an die Turnierleitung (Eigentümer-Konto), nicht an den Betreiber */
    private function leitungMail(array $t): ?string
    {
        $k = $this->db->eine('SELECT email FROM konten WHERE id = ?', [(int)$t['konto_id']]);
        return $k === null ? null : (string)$k['email'];
    }

    private function mailen(array $t, string $an, string $betreff, string $text): void
    {
        $this->api->mail($an, $betreff, $text, null, null, $this->leitungMail($t));
    }

    /** Höchstens so viele Hinweis-Mails „Neue Anmeldung“ je Turnier und Tag */
    private const HINWEISE_JE_TAG = 50;

    /**
     * Hinweis an die Turnierleitung (abschaltbar unter „Online-Anmeldung“): ohne Namen und Mail-Adressen der
     * Angemeldeten – nur Konkurrenzen und Zahlen. Die Namen stehen in der App.
     */
    private function leitungHinweisen(array $t, array $e, array $z, array $zeilen): void
    {
        if (($e['hinweisMail'] ?? true) === false) {
            return;
        }
        $an = $this->leitungMail($t);
        $schluessel = 'anmeldung-hinweis|' . $t['id'];
        if ($an === null || $this->api->anzahlVersuche($schluessel, 86400) >= self::HINWEISE_JE_TAG) {
            return;
        }
        $this->api->fehlversuch($schluessel);
        $teile = [];
        foreach ($z['d']['konkurrenzen'] as $k) {
            $kk = self::konkurrenzVon($e, (string)$k['id']);
            $teile[] = '• ' . ($kk['name'] ?? $k['id']) . (($k['status'] ?? '') === 'warteliste' ? ' (Warteliste)' : '');
        }
        $bestaetigt = count(array_filter($zeilen, static fn(array $x): bool => $x['bestaetigt'] !== null));
        $this->api->mail($an, "Neue Anmeldung: {$t['name']}", "Hallo,\n\n"
            . "für „{$t['name']}“ (" . self::datumText($t) . ") ist eine neue Anmeldung bestätigt worden:\n"
            . implode("\n", $teile) . "\n\n"
            . "Bestätigte Anmeldungen insgesamt: {$bestaetigt}\n\n"
            . "Namen und Angaben siehst du in der App unter „Spieler“ → „Online-Anmeldungen“: " . $this->api->appUrl() . '#/t/' . $t['id'] . "/spieler\n\n"
            . "Diese Hinweise lassen sich dort unter „Hinweis bei neuen Anmeldungen“ abschalten.");
    }

    private function link(array $t, string $schluessel): string
    {
        return $this->api->appUrl() . '#/meldung/' . $t['id'] . '/' . $schluessel;
    }

    /** Übersicht für Mails: Platz/Warteliste je Konkurrenz, Startgeld, Bank */
    private function standText(array $t, array $e, array $z, array $zeilen): string
    {
        $s = $this->stand($t, $e, $z, $zeilen);
        $zeilenText = '';
        foreach ($s['konkurrenzen'] as $k) {
            $zeilenText .= '  - ' . $k['name'] . ': ' . match ($k['status']) {
                'platz' => 'Platz sicher',
                'warteliste' => 'Warteliste, Platz ' . ($k['position'] ?? '?'),
                default => 'abgemeldet',
            } . "\n";
        }
        $text = "Deine Meldungen:\n{$zeilenText}";
        if ($s['startgeld'] > 0) {
            $text .= "\nStartgeld (für die Konkurrenzen mit sicherem Platz): " . self::euro($s['startgeld']) . "\n";
            $b = $s['bank'];
            if (is_array($b) && ($b['iban'] ?? '') !== '') {
                $text .= "Überweisung an: {$b['empfaenger']}\nIBAN: " . trim(chunk_split((string)$b['iban'], 4, ' '))
                    . (($b['bic'] ?? '') !== '' ? "\nBIC: {$b['bic']}" : '') . "\nVerwendungszweck: {$s['zweck']}\n"
                    . "(Auf der Seite zum Link unten gibt es dafür auch einen QR-Code für die Banking-App.)\n";
            } else {
                $text .= "Bezahlt wird am Turniertag an der Kasse.\n";
            }
        }
        return $text;
    }

    /* ---------------- Öffentliche Routen ---------------- */

    public function info(Anfrage $a): array
    {
        $t = $this->api->turnierLaden((string)($a->query['turnier'] ?? ''));
        $e = self::einst($t);
        if ($e === null) {
            throw new ApiFehler('nicht_gefunden', 'Für dieses Turnier gibt es keine Online-Anmeldung.');
        }
        return [
            'turnier' => ['id' => (string)$t['id'], 'name' => (string)$t['name'], 'datum' => $t['datum'], 'veranstalter' => (string)($t['veranstalter'] ?? '')],
            'einstellungen' => self::ausgabe($e),
            'moeglich' => $this->moeglich($t, $e) && $this->api->mailBereit(),
            'belegung' => self::belegung($e, $this->zeilen((string)$t['id'])),
        ];
    }

    public function senden(Anfrage $a): array
    {
        if (!$this->api->mailBereit()) {
            throw new ApiFehler('nicht_eingerichtet', 'Auf diesem Server ist kein Mailversand eingerichtet.');
        }
        $this->api->begrenzen('anmeldung|' . $a->ip, 30, 3600, 'Von diesem Anschluss kamen gerade viele Anmeldungen. Bitte später erneut versuchen.');
        $this->api->fangfeld($a);
        $t = $this->api->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $e = self::einst($t);
        if ($e === null || !$this->moeglich($t, $e)) {
            throw new ApiFehler('abgelaufen', 'Die Anmeldung für dieses Turnier ist geschlossen.');
        }
        $this->unbestaetigteLoeschen();
        $r = $a->rumpf ?? [];
        $d = [
            'vorname' => $this->api->text($a, 'vorname', 1, 80),
            'nachname' => $this->api->text($a, 'nachname', 1, 80),
            'verein' => is_string($r['verein'] ?? null) ? mb_substr(trim($r['verein']), 0, 120) : '',
            'ttr' => null, 'klasse' => null, 'geschlecht' => null, 'jahrgang' => null,
        ];
        $email = $this->api->email($a);
        $pflicht = $e['angaben'] ?? [];
        // Datensparsamkeit: nur die Angaben speichern, die die Leitung verlangt (sonst verwerfen)
        foreach (['ttr', 'klasse', 'geschlecht', 'jahrgang'] as $f) {
            if (!in_array($f, $pflicht, true)) {
                unset($r[$f]);
            }
        }
        $ttr = $r['ttr'] ?? null;
        if (is_int($ttr) && $ttr >= 0 && $ttr <= 4000) {
            $d['ttr'] = $ttr;
            // ab 0.15: Wert aus der Einstufung (Hobbyspieler) statt Q-TTR
            if (($r['ttrGeschaetzt'] ?? null) === true) {
                $d['ttrGeschaetzt'] = true;
            }
        } elseif (in_array('ttr', $pflicht, true)) {
            throw new ApiFehler('ungueltig', 'Bitte deinen TTR-Wert angeben (0–4000).');
        }
        $klasse = is_string($r['klasse'] ?? null) ? mb_substr(trim($r['klasse']), 0, 40) : '';
        if ($klasse !== '') {
            $d['klasse'] = $klasse;
        } elseif (in_array('klasse', $pflicht, true)) {
            throw new ApiFehler('ungueltig', 'Bitte deine Leistungsklasse angeben.');
        }
        $g = $r['geschlecht'] ?? null;
        if (in_array($g, ['m', 'w', 'd'], true)) {
            $d['geschlecht'] = $g;
        } elseif (in_array('geschlecht', $pflicht, true)) {
            throw new ApiFehler('ungueltig', 'Bitte das Geschlecht angeben.');
        }
        $jg = $r['jahrgang'] ?? null;
        $jahr = (int)gmdate('Y', $this->api->jetzt());
        if (is_int($jg) && $jg >= 1900 && $jg <= $jahr) {
            $d['jahrgang'] = $jg;
        } elseif (in_array('jahrgang', $pflicht, true)) {
            throw new ApiFehler('ungueltig', 'Bitte deinen Jahrgang angeben.');
        }
        if (($r['datenschutz'] ?? false) !== true) {
            throw new ApiFehler('ungueltig', 'Bitte den Datenschutzhinweis bestätigen.');
        }
        $minderjaehrig = ($r['minderjaehrig'] ?? false) === true;
        // Jahrgang deutet auf unter 18 (im Zweifel: wird in diesem Jahr 18) → Einverständnis nötig
        if ($d['jahrgang'] !== null && $jahr - $d['jahrgang'] <= 18) {
            $minderjaehrig = true;
        }
        if ($minderjaehrig && ($r['einverstanden'] ?? false) !== true) {
            throw new ApiFehler('ungueltig', 'Unter 18 Jahren müssen die Erziehungsberechtigten einverstanden sein.');
        }
        $d['minderjaehrig'] = $minderjaehrig;
        $wahl = $r['konkurrenzen'] ?? null;
        if (!is_array($wahl) || !array_is_list($wahl) || $wahl === [] || count($wahl) > self::MAX_KONKURRENZEN) {
            throw new ApiFehler('ungueltig', 'Bitte mindestens eine Konkurrenz wählen.');
        }
        $d['konkurrenzen'] = [];
        $gesehen = [];
        foreach ($wahl as $w) {
            $w = $w instanceof \stdClass ? get_object_vars($w) : $w;
            $kid = is_array($w) && is_string($w['id'] ?? null) ? $w['id'] : '';
            $kk = self::konkurrenzVon($e, $kid);
            if ($kk === null || isset($gesehen[$kid])) {
                throw new ApiFehler('ungueltig', 'Unbekannte Konkurrenz gewählt.');
            }
            $gesehen[$kid] = true;
            $partner = $kk['art'] !== 'einzel' && is_string($w['partner'] ?? null) ? mb_substr(trim($w['partner']), 0, 80) : '';
            $d['konkurrenzen'][] = ['id' => $kid, 'status' => null, 'partner' => $partner === '' ? null : $partner, 'seit' => null];
        }

        $zeilen = $this->zeilen((string)$t['id']);
        // Je Adresse höchstens 5 Mails pro Stunde. Die Antwort ist immer gleich – sie verrät nicht, ob und wer
        // angemeldet ist; über der Grenze geht nur keine Mail mehr raus.
        $mailSchluessel = 'anmeldung-mail|' . hash('sha256', $email);
        if ($this->api->anzahlVersuche($mailSchluessel, 3600) >= 5) {
            return ['ok' => true, 'mail' => true];
        }
        $this->api->fehlversuch($mailSchluessel);
        // Gleiche Person nochmals: keine zweite Anmeldung, sondern eine Mail mit neuem Link
        foreach ($zeilen as $z) {
            if ($z['email'] === $email && mb_strtolower(self::name($z)) === mb_strtolower(trim($d['vorname'] . ' ' . $d['nachname']))) {
                $schluessel = $this->neuerSchluessel($z);
                $this->mailen($t, $email, "Anmeldung: {$t['name']}", "Hallo,\n\n"
                    . "für diese E-Mail-Adresse gibt es bei „{$t['name']}“ schon eine Anmeldung. Über diesen Link siehst du den Stand"
                    . ($z['bestaetigt'] === null ? ' und bestätigst sie' : '') . ":\n\n" . $this->link($t, $schluessel) . "\n\n"
                    . "Ältere Links aus früheren Mails gelten nicht mehr. Hast du dich nicht angemeldet? Dann ignoriere diese Mail.");
                return ['ok' => true, 'mail' => true];
            }
        }
        $bestaetigt = count(array_filter($zeilen, static fn(array $z): bool => $z['bestaetigt'] !== null));
        if ($bestaetigt >= self::MAX_JE_TURNIER || count($zeilen) - $bestaetigt >= self::MAX_UNBESTAETIGT) {
            throw new ApiFehler('zu_viele_versuche', 'Für dieses Turnier sind gerade keine weiteren Anmeldungen möglich. Bitte später erneut versuchen.');
        }
        $this->api->begrenzen('anmeldung-turnier|' . $t['id'], self::MAX_JE_TURNIER_STUNDE, 3600, 'Für dieses Turnier kamen gerade sehr viele Anmeldungen. Bitte später erneut versuchen.');
        $this->api->begrenzen('anmeldung-konto|' . $t['konto_id'], self::MAX_JE_KONTO_TAG, 86400, 'Gerade sind keine weiteren Anmeldungen möglich. Bitte später erneut versuchen.');
        $id = $this->neueId((string)$t['id']);
        $schluessel = bin2hex(random_bytes(32));
        $this->db->ausfuehren(
            'INSERT INTO anmeldungen (turnier_id, id, email, daten, schluessel_hash, angelegt, bestaetigt, spieler) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)',
            [$t['id'], $id, $email, json_encode($d, JSON_UNESCAPED_UNICODE), hash('sha256', $schluessel), $this->api->jetzt()]
        );
        // Erste Mail ohne frei eingegebenen Text (Namen) – sie geht an eine noch unbestätigte Adresse
        $this->mailen($t, $email, "Bitte bestätigen: Anmeldung {$t['name']}", "Hallo,\n\n"
            . "bitte bestätige die Anmeldung zu „{$t['name']}“ (" . self::datumText($t) . ") über diesen Link:\n\n"
            . $this->link($t, $schluessel) . "\n\n"
            . "Der Link gilt 24 Stunden. Erst mit der Bestätigung bekommst du einen Platz bzw. einen Platz auf der Warteliste.\n"
            . "Hast du dich nicht angemeldet? Dann ignoriere diese Mail – die Angaben werden nach 24 Stunden gelöscht.\n\n"
            . "Datenschutzhinweis: " . $this->api->appUrl() . "#/datenschutz");
        return ['ok' => true, 'mail' => true];
    }

    private static function datumText(array $t): string
    {
        return $t['datum'] ? date('d.m.Y', (int)strtotime((string)$t['datum'])) : 'ohne Datum';
    }

    /** Neuer Schlüssel für eine vorhandene Anmeldung (alter Link gilt nicht mehr; die 24-Stunden-Frist läuft weiter) */
    private function neuerSchluessel(array $z): string
    {
        $s = bin2hex(random_bytes(32));
        $this->db->ausfuehren('UPDATE anmeldungen SET schluessel_hash = ? WHERE turnier_id = ? AND id = ?', [hash('sha256', $s), $z['turnier_id'], $z['id']]);
        return $s;
    }

    private function neueId(string $turnierId): string
    {
        for ($i = 0; $i < 100; $i++) {
            $id = '';
            for ($j = 0; $j < 10; $j++) {
                $id .= self::ID_ZEICHEN[random_int(0, strlen(self::ID_ZEICHEN) - 1)];
            }
            if ($this->db->eine('SELECT id FROM anmeldungen WHERE turnier_id = ? AND id = ?', [$turnierId, $id]) === null) {
                return $id;
            }
        }
        throw new ApiFehler('serverfehler', 'Es konnte keine Kennung erzeugt werden.');
    }

    /** Anmeldung zum Schlüssel aus dem Link (gebremst gegen Durchprobieren) */
    private function zumSchluessel(Anfrage $a): array
    {
        $bremse = 'anmeldung-link|' . $a->ip;
        $this->api->bremse($bremse);
        $t = $this->api->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $s = $a->rumpf['schluessel'] ?? '';
        $z = is_string($s) && preg_match('/^[a-f0-9]{64}$/', $s)
            ? $this->db->eine('SELECT * FROM anmeldungen WHERE turnier_id = ? AND schluessel_hash = ?', [$t['id'], hash('sha256', $s)])
            : null;
        if ($z === null) {
            $this->api->fehlversuch($bremse);
            throw new ApiFehler('falsche_zugangsdaten', 'Dieser Link ist ungültig oder abgelaufen (eine Anmeldung muss innerhalb von 24 Stunden bestätigt werden). Bitte melde dich neu an.');
        }
        if ($z['bestaetigt'] === null && (int)$z['angelegt'] < $this->api->jetzt() - self::BESTAETIGEN_DAUER) {
            $this->db->ausfuehren('DELETE FROM anmeldungen WHERE turnier_id = ? AND id = ?', [$t['id'], $z['id']]);
            throw new ApiFehler('abgelaufen', 'Der Bestätigungslink ist abgelaufen. Bitte melde dich neu an.');
        }
        $d = json_decode((string)$z['daten'], true);
        $z['d'] = is_array($d) ? $d : ['konkurrenzen' => []];
        return [$t, $z];
    }

    /** Transaktion mit Sperre des Turniers (gleichzeitige Bestätigungen vergeben Plätze nacheinander) */
    private function gesperrt(string $turnierId, callable $f): mixed
    {
        $this->db->anfangen();
        try {
            if ($this->db->treiber === 'mysql') {
                $this->db->eine('SELECT id FROM turniere WHERE id = ? FOR UPDATE', [$turnierId]);
            }
            $r = $f();
            $this->db->festschreiben();
            return $r;
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
    }

    /** Stand ansehen, ohne zu bestätigen (Mail-Scanner öffnen Links – bestätigt wird erst per Knopf) */
    public function standAbrufen(Anfrage $a): array
    {
        [$t, $z] = $this->zumSchluessel($a);
        return $this->stand2($t, $z);
    }

    private function stand2(array $t, array $z): array
    {
        return $this->stand($t, self::einst($t) ?? self::leer(), $z, $this->zeilen((string)$t['id']));
    }

    public function bestaetigen(Anfrage $a): array
    {
        [$t, $z] = $this->zumSchluessel($a);
        $e = self::einst($t) ?? self::leer();
        $neu = false;
        if ($z['bestaetigt'] === null) {
            $this->gesperrt((string)$t['id'], function () use ($t, $e, &$z, &$neu): void {
                // in der Sperre neu lesen: Doppelklick/zwei Tabs bestätigen nur einmal
                $frisch = $this->db->eine('SELECT bestaetigt FROM anmeldungen WHERE turnier_id = ? AND id = ?', [$t['id'], $z['id']]);
                if ($frisch === null || $frisch['bestaetigt'] !== null) {
                    return;
                }
                $neu = true;
                $zeilen = $this->zeilen((string)$t['id']);
                $b = self::belegung($e, $zeilen);
                $jetzt = $this->api->jetzt();
                foreach ($z['d']['konkurrenzen'] as $i => $k) {
                    $kk = self::konkurrenzVon($e, $k['id']);
                    $frei = $kk === null || $kk['max'] === null || $b[$k['id']]['plaetze'] < (int)$kk['max'];
                    // Wer schon wartet, bleibt hinten: keine Plätze vorbei an der Warteliste
                    if ($frei && $kk !== null && $b[$k['id']]['warteliste'] > 0) {
                        $frei = false;
                    }
                    $z['d']['konkurrenzen'][$i]['status'] = $frei ? 'platz' : 'warteliste';
                    $z['d']['konkurrenzen'][$i]['seit'] = $jetzt;
                    if (isset($b[$k['id']])) {
                        $b[$k['id']][$frei ? 'plaetze' : 'warteliste']++;
                    }
                }
                $z['bestaetigt'] = $jetzt;
                $this->speichern($z);
            });
        }
        if (!$neu) {
            return $this->stand2($t, $this->zeile($t, (string)$z['id']));
        }
        $zeilen = $this->zeilen((string)$t['id']);
        if ($neu) {
            $this->mailen($t, (string)$z['email'], "Anmeldung bestätigt: {$t['name']}", "Hallo {$z['d']['vorname']},\n\n"
                . "deine Anmeldung zu „{$t['name']}“ (" . self::datumText($t) . ") ist bestätigt.\n\n"
                . $this->standText($t, $e, $z, $zeilen)
                . "\nStand ansehen oder abmelden: " . $this->link($t, (string)$a->rumpf['schluessel']) . "\n"
                . "Bitte hebe diese Mail auf. Rückst du von der Warteliste nach, bekommst du eine Mail.");
            $this->leitungHinweisen($t, $e, $z, $zeilen);
        }
        return $this->stand($t, $e, $z, $zeilen);
    }

    public function abmelden(Anfrage $a): array
    {
        [$t, $z] = $this->zumSchluessel($a);
        if ($z['bestaetigt'] === null) {
            $this->db->ausfuehren('DELETE FROM anmeldungen WHERE turnier_id = ? AND id = ?', [$t['id'], $z['id']]);
            throw new ApiFehler('nicht_gefunden', 'Die Anmeldung war noch nicht bestätigt und ist jetzt gelöscht.');
        }
        if (!$this->abmeldbar($t)) {
            throw new ApiFehler('abgelaufen', 'Abmelden über den Link geht bis zum Vortag. Bitte wende dich an die Turnierleitung.');
        }
        $e = self::einst($t) ?? self::leer();
        $nur = is_string($a->rumpf['konkurrenz'] ?? null) ? $a->rumpf['konkurrenz'] : null;
        $geaendert = false;
        $frei = $this->gesperrt((string)$t['id'], function () use (&$z, $nur, &$geaendert): array {
            $frei = [];
            foreach ($z['d']['konkurrenzen'] as $i => $k) {
                if (($nur === null || $k['id'] === $nur) && $k['status'] !== 'abgemeldet') {
                    if ($k['status'] === 'platz') {
                        $frei[] = $k['id'];
                    }
                    $z['d']['konkurrenzen'][$i]['status'] = 'abgemeldet';
                    $geaendert = true;
                }
            }
            if ($geaendert) {
                $this->speichern($z);
            }
            return $frei;
        });
        foreach ($frei as $k) {
            $this->nachruecken($t, $e, $k);
        }
        $zeilen = $this->zeilen((string)$t['id']);
        if ($geaendert) {
            $this->mailen($t, (string)$z['email'], "Abmeldung: {$t['name']}", "Hallo {$z['d']['vorname']},\n\n"
                . "deine Abmeldung ist eingegangen.\n\n" . $this->standText($t, $e, $z, $zeilen));
        }
        return $this->stand($t, $e, $z, $zeilen);
    }

    /** Freie Plätze an die Warteliste vergeben (Reihenfolge der Warteliste), mit Mail */
    private function nachruecken(array $t, array $e, string $konkurrenz): void
    {
        $kk = self::konkurrenzVon($e, $konkurrenz);
        if ($kk === null) {
            return;
        }
        $gerueckt = $this->gesperrt((string)$t['id'], function () use ($t, $e, $kk, $konkurrenz): array {
            $zeilen = $this->zeilen((string)$t['id']);
            $b = self::belegung($e, $zeilen)[$konkurrenz] ?? ['plaetze' => 0, 'warteliste' => 0];
            $frei = $kk['max'] === null ? PHP_INT_MAX : (int)$kk['max'] - $b['plaetze'];
            $warte = [];
            foreach ($zeilen as $z) {
                if ($z['bestaetigt'] === null) {
                    continue;
                }
                foreach ($z['d']['konkurrenzen'] as $i => $k) {
                    if ($k['id'] === $konkurrenz && $k['status'] === 'warteliste') {
                        $warte[] = [(int)($k['seit'] ?? 0), (int)$z['angelegt'], (string)$z['id'], $i, $z];
                    }
                }
            }
            usort($warte, static fn(array $x, array $y): int => [$x[0], $x[1], $x[2]] <=> [$y[0], $y[1], $y[2]]);
            $gerueckt = [];
            foreach ($warte as [, , , $i, $z]) {
                if ($frei <= 0) {
                    break;
                }
                $z['d']['konkurrenzen'][$i]['status'] = 'platz';
                $z['d']['konkurrenzen'][$i]['seit'] = $this->api->jetzt();
                $this->speichern($z);
                $gerueckt[] = $z;
                $frei--;
            }
            return $gerueckt;
        });
        if ($gerueckt === []) {
            return;
        }
        $zeilen = $this->zeilen((string)$t['id']);
        foreach ($gerueckt as $z) {
            $this->mailen($t, (string)$z['email'], "Nachgerückt: {$t['name']}", "Hallo {$z['d']['vorname']},\n\n"
                . "gute Nachricht: In „{$kk['name']}“ ist ein Platz frei geworden – du bist von der Warteliste nachgerückt.\n\n"
                . $this->standText($t, $e, $z, $zeilen)
                . "\n" . self::LINK_HINWEIS);
        }
    }

    /* ---------------- Routen der Turnierleitung ---------------- */

    private function leitung(Anfrage $a, bool $ausRumpf): array
    {
        $id = $ausRumpf ? (string)($a->rumpf['turnier'] ?? '') : (string)($a->query['turnier'] ?? '');
        $t = $this->api->turnierLaden($id);
        $this->api->leitungPruefen($a, $t);
        return $t;
    }

    private function listeAusgabe(array $t): array
    {
        $e = self::einst($t) ?? self::leer();
        $zeilen = $this->zeilen((string)$t['id']);
        $aus = [];
        foreach ($zeilen as $z) {
            $d = $z['d'];
            $aus[] = [
                'id' => (string)$z['id'],
                'vorname' => (string)($d['vorname'] ?? ''),
                'nachname' => (string)($d['nachname'] ?? ''),
                'verein' => (string)($d['verein'] ?? ''),
                'email' => (string)$z['email'],
                'ttr' => $d['ttr'] ?? null,
                'ttrGeschaetzt' => ($d['ttrGeschaetzt'] ?? false) === true,
                'klasse' => $d['klasse'] ?? null,
                'geschlecht' => $d['geschlecht'] ?? null,
                'jahrgang' => $d['jahrgang'] ?? null,
                'minderjaehrig' => (bool)($d['minderjaehrig'] ?? false),
                'angelegt' => Api::iso((int)$z['angelegt']),
                'bestaetigt' => $z['bestaetigt'] === null ? null : Api::iso((int)$z['bestaetigt']),
                'konkurrenzen' => array_map(fn(array $k): array => [
                    'id' => $k['id'],
                    'status' => $k['status'] ?? 'warteliste',
                    'position' => ($k['status'] ?? '') === 'warteliste' ? self::position($zeilen, $k['id'], (string)$z['id']) : null,
                    'partner' => $k['partner'] ?? null,
                ], $d['konkurrenzen'] ?? []),
                'spieler' => $z['spieler'] === null ? null : (string)$z['spieler'],
            ];
        }
        // Für die Leitung mit „vorab“ (von Hand Gemeldete), damit die App Änderungen erkennt
        return ['einstellungen' => $e, 'anmeldungen' => $aus, 'freigabe' => $this->api->anmeldungFreigabe((int)$t['konto_id'])];
    }

    public function liste(Anfrage $a): array
    {
        return $this->listeAusgabe($this->leitung($a, false));
    }

    public function einstellungenSetzen(Anfrage $a): array
    {
        $t = $this->leitung($a, true);
        $r = $a->rumpf ?? [];
        $offen = ($r['offen'] ?? false) === true;
        if ($offen && $t['datum'] === null) {
            throw new ApiFehler('ungueltig', 'Bitte zuerst ein Turnierdatum eintragen – Anmeldungen werden 30 Tage danach gelöscht.');
        }
        if ($offen && !$this->api->mailBereit()) {
            throw new ApiFehler('nicht_eingerichtet', 'Auf diesem Server ist kein Mailversand eingerichtet.');
        }
        $schluss = $r['schluss'] ?? null;
        if ($schluss !== null && (!is_string($schluss) || strlen($schluss) > 40 || strtotime($schluss) === false)) {
            throw new ApiFehler('ungueltig', 'Meldeschluss ungültig.');
        }
        $liste = $r['konkurrenzen'] ?? [];
        if (!is_array($liste) || !array_is_list($liste) || count($liste) > self::MAX_KONKURRENZEN) {
            throw new ApiFehler('ungueltig', 'Höchstens ' . self::MAX_KONKURRENZEN . ' Konkurrenzen.');
        }
        $konk = [];
        foreach ($liste as $k) {
            $k = $k instanceof \stdClass ? get_object_vars($k) : $k;
            if (!is_array($k) || !is_string($k['id'] ?? null) || !preg_match('/^[a-z0-9]{1,16}$/', $k['id'])) {
                throw new ApiFehler('ungueltig', 'Ungültige Konkurrenz.');
            }
            $max = $k['max'] ?? null;
            $geld = $k['startgeld'] ?? null;
            $vorab = $k['vorab'] ?? 0;
            $konk[] = [
                'id' => $k['id'],
                'name' => is_string($k['name'] ?? null) && trim($k['name']) !== '' ? mb_substr(trim($k['name']), 0, 80) : $k['id'],
                'art' => in_array($k['art'] ?? null, ['einzel', 'doppel', 'mixed'], true) ? $k['art'] : 'einzel',
                'max' => is_int($max) && $max >= 1 && $max <= 1000 ? $max : null,
                'startgeld' => is_int($geld) && $geld > 0 && $geld <= 100000 ? $geld : null,
                'vorab' => is_int($vorab) && $vorab >= 0 && $vorab <= 1000 ? $vorab : 0,
            ];
        }
        $angaben = is_array($r['angaben'] ?? null) ? array_values(array_intersect(self::ANGABEN, $r['angaben'])) : [];
        $bank = $r['bank'] ?? null;
        $bank = $bank instanceof \stdClass ? get_object_vars($bank) : $bank;
        if (is_array($bank) && trim((string)($bank['iban'] ?? '')) !== '') {
            $k = Api::kasseLesen(['empfaenger' => $bank['empfaenger'] ?? '', 'iban' => $bank['iban'] ?? '', 'bic' => $bank['bic'] ?? '']);
            if ($k['empfaenger'] === '') {
                throw new ApiFehler('ungueltig', 'Bitte den Kontoinhaber für die Überweisung angeben.');
            }
            $bank = ['empfaenger' => $k['empfaenger'], 'iban' => $k['iban'], 'bic' => $k['bic']];
        } else {
            $bank = null;
        }
        $e = [
            'offen' => $offen,
            'schluss' => $schluss,
            'konkurrenzen' => $konk,
            'hinweis' => is_string($r['hinweis'] ?? null) ? mb_substr(trim($r['hinweis']), 0, 1000) : '',
            'angaben' => $angaben,
            'bank' => $bank,
            'ort' => is_string($r['ort'] ?? null) ? mb_substr(trim($r['ort']), 0, 120) : '',
            // Fehlt das Feld (ältere App), bleibt die bisherige Einstellung
            'hinweisMail' => array_key_exists('hinweisMail', $r) ? $r['hinweisMail'] !== false : ((self::einst($t)['hinweisMail'] ?? true) !== false),
        ];
        // Freigabe zuletzt prüfen (erst die Eingaben, damit Fehler darin sofort auffallen)
        $frei = $this->api->anmeldungFreigabe((int)$t['konto_id']);
        if ($offen && !$frei['erlaubt']) {
            throw new ApiFehler('keine_berechtigung', $frei['ab'] !== null
                ? 'Die Online-Anmeldung steht neuen Konten ab ' . gmdate('d.m.Y', (int)strtotime($frei['ab'])) . ' zur Verfügung (Schutz vor Missbrauch). Der Administrator kann sie früher freischalten.'
                : 'Die Online-Anmeldung ist für dieses Konto nicht freigegeben. Bitte wende dich an den Administrator.');
        }
        $alt = self::einst($t);
        $this->db->ausfuehren('UPDATE turniere SET anmeldung = ? WHERE id = ?', [json_encode($e, JSON_UNESCAPED_UNICODE), $t['id']]);
        $s = $this->api->sitzung($a);
        if ($bank !== null && ($alt['bank']['iban'] ?? null) !== $bank['iban'] && ($s['konto_id'] ?? null) !== (int)$t['konto_id'] && $this->api->mailBereit()) {
            $this->api->bankAenderungMailen($t, $bank['iban'], (string)($s['name'] ?? ''));
        }
        $t['anmeldung'] = json_encode($e);
        // Höchstzahl erhöht oder Platz frei geworden: Warteliste nachrücken lassen
        foreach ($konk as $k) {
            $this->nachruecken($t, $e, $k['id']);
        }
        return $this->listeAusgabe($t);
    }

    private function zeile(array $t, string $id): array
    {
        $z = $this->db->eine('SELECT * FROM anmeldungen WHERE turnier_id = ? AND id = ?', [$t['id'], $id]);
        if ($z === null) {
            throw new ApiFehler('nicht_gefunden', 'Anmeldung nicht gefunden.');
        }
        $d = json_decode((string)$z['daten'], true);
        $z['d'] = is_array($d) ? $d : ['konkurrenzen' => []];
        return $z;
    }

    public function aendern(Anfrage $a): array
    {
        $t = $this->leitung($a, true);
        $e = self::einst($t) ?? self::leer();
        $z = $this->zeile($t, (string)($a->rumpf['id'] ?? ''));
        if ($z['bestaetigt'] === null) {
            throw new ApiFehler('konflikt', 'Die Anmeldung ist noch nicht per Mail bestätigt.');
        }
        $kid = (string)($a->rumpf['konkurrenz'] ?? '');
        $status = $a->rumpf['status'] ?? null;
        if (!in_array($status, ['platz', 'warteliste', 'abgemeldet'], true)) {
            throw new ApiFehler('ungueltig', 'Status ungültig.');
        }
        $alt = null;
        foreach ($z['d']['konkurrenzen'] as $i => $k) {
            if ($k['id'] === $kid) {
                $alt = $k['status'];
                $z['d']['konkurrenzen'][$i]['status'] = $status;
                $z['d']['konkurrenzen'][$i]['seit'] = $this->api->jetzt();
            }
        }
        if ($alt === null) {
            throw new ApiFehler('nicht_gefunden', 'Für diese Konkurrenz liegt keine Meldung vor.');
        }
        if ($alt === $status) {
            return $this->listeAusgabe($t);
        }
        $this->speichern($z);
        $kk = self::konkurrenzVon($e, $kid);
        $name = $kk['name'] ?? $kid;
        $text = match ($status) {
            'platz' => "die Turnierleitung hat dir in „{$name}“ einen Platz gegeben.",
            'warteliste' => "die Turnierleitung hat dich in „{$name}“ auf die Warteliste gesetzt.",
            default => "die Turnierleitung hat deine Meldung für „{$name}“ gestrichen. Bei Fragen wende dich bitte an sie.",
        };
        $zeilen = $this->zeilen((string)$t['id']);
        $this->mailen($t, (string)$z['email'], "Änderung deiner Anmeldung: {$t['name']}", "Hallo {$z['d']['vorname']},\n\n{$text}\n\n"
            . $this->standText($t, $e, $z, $zeilen)
            . ($this->abmeldbar($t) ? "\n" . self::LINK_HINWEIS : ''));
        if ($alt === 'platz') {
            $this->nachruecken($t, $e, $kid);
        }
        return $this->listeAusgabe($t);
    }

    public function uebernommen(Anfrage $a): array
    {
        $t = $this->leitung($a, true);
        $ids = $a->rumpf['ids'] ?? null;
        if (!is_array($ids) || !array_is_list($ids) || count($ids) > self::MAX_JE_TURNIER) {
            throw new ApiFehler('ungueltig', 'Feld „ids“ muss eine Liste sein.');
        }
        foreach ($ids as $id) {
            if (is_string($id) && preg_match('/^[a-z0-9]{1,16}$/', $id)) {
                $this->db->ausfuehren('UPDATE anmeldungen SET spieler = ? WHERE turnier_id = ? AND id = ? AND bestaetigt IS NOT NULL', [$id, $t['id'], $id]);
            }
        }
        return ['ok' => true];
    }

    public function loeschen(Anfrage $a): array
    {
        $t = $this->leitung($a, true);
        $e = self::einst($t) ?? self::leer();
        $z = $this->zeile($t, (string)($a->rumpf['id'] ?? ''));
        $this->db->ausfuehren('DELETE FROM anmeldungen WHERE turnier_id = ? AND id = ?', [$t['id'], $z['id']]);
        foreach ($z['d']['konkurrenzen'] as $k) {
            if (($k['status'] ?? null) === 'platz') {
                $this->nachruecken($t, $e, $k['id']);
            }
        }
        return $this->listeAusgabe($t);
    }

    /* ---------------- Löschfristen ---------------- */

    private function unbestaetigteLoeschen(): void
    {
        $this->db->ausfuehren('DELETE FROM anmeldungen WHERE bestaetigt IS NULL AND angelegt < ?', [$this->api->jetzt() - self::BESTAETIGEN_DAUER]);
    }

    /** Wartung: unbestätigte nach 24 Stunden, alle 30 Tage nach dem Turniertag */
    public function aufraeumen(): void
    {
        $this->unbestaetigteLoeschen();
        $grenze = gmdate('Y-m-d', $this->api->jetzt() - self::LOESCHEN_NACH_TAGEN * 86400);
        $this->db->ausfuehren(
            'DELETE FROM anmeldungen WHERE turnier_id IN (SELECT id FROM turniere WHERE datum IS NOT NULL AND datum < ?)',
            [$grenze]
        );
        // Ersatzfrist, falls das Turnierdatum weit verschoben wurde
        $this->db->ausfuehren('DELETE FROM anmeldungen WHERE angelegt < ?', [$this->api->jetzt() - self::LOESCHEN_SPAETESTENS_TAGE * 86400]);
    }
}
