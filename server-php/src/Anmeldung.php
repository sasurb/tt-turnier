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
    /** Doppel/Mixed mit Partnerin oder Partner je Anmeldung (jede/r bekommt eine Bestätigungsmail) */
    private const MAX_PARTNER = 5;
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
        return ['offen' => false, 'schluss' => null, 'konkurrenzen' => [], 'hinweis' => '', 'angaben' => [], 'bank' => null, 'ort' => '', 'hinweisMail' => true, 'gruppen' => true];
    }

    /** Anmeldeform je Konkurrenz: einzel | gruppe (Paar bzw. Mannschaft) | beides; Einzel-Konkurrenzen immer einzel */
    private static function formLesen(string $art, mixed $form): string
    {
        if ($art === 'einzel') {
            return 'einzel';
        }
        if (in_array($form, ['einzel', 'gruppe', 'beides'], true)) {
            return $form;
        }
        return $art === 'mannschaft' ? 'gruppe' : 'beides';
    }

    private static function staerke(mixed $n, int $ersatz): int
    {
        return is_int($n) && $n >= 1 && $n <= 20 ? $n : max(1, min(20, $ersatz));
    }

    /** Form einer Konkurrenz (ältere Einstellungen ohne Feld: Doppel beides, sonst einzeln) */
    private static function formVon(array $kk): string
    {
        return self::formLesen((string)$kk['art'], $kk['form'] ?? null);
    }

    /** Öffentliche Fassung: ohne „vorab“ (Zählhilfe) und ohne Bankverbindung (die sehen nur bestätigte Anmeldungen) */
    private static function ausgabe(array $e): array
    {
        $e['bank'] = null;
        unset($e['hinweisMail']);
        $e['konkurrenzen'] = array_map(static fn(array $k): array => [
            'id' => $k['id'], 'name' => $k['name'], 'art' => $k['art'], 'max' => $k['max'], 'startgeld' => $k['startgeld'],
            'form' => self::formVon($k), 'min' => $k['min'] ?? null, 'maxSpieler' => $k['maxSpieler'] ?? null,
        ], $e['konkurrenzen']);
        $e['gruppen'] = ($e['gruppen'] ?? true) !== false;
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
        if (!$this->api->anmeldungFreigabe($t)['erlaubt']) {
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

    private static function istGruppe(array $z): bool
    {
        return ($z['d']['typ'] ?? '') === 'gruppe';
    }

    /** Namen der Personen eines Eintrags einer Gruppenanmeldung (bzw. die Mannschaft) */
    private static function werText(array $z, array $k): string
    {
        if (!self::istGruppe($z)) {
            return '';
        }
        $namen = [];
        foreach ($z['d']['personen'] ?? [] as $p) {
            $namen[$p['pid']] = trim($p['vorname'] . ' ' . $p['nachname']);
        }
        $wer = implode(' / ', array_map(static fn(string $pid): string => $namen[$pid] ?? '?', $k['wer'] ?? []));
        return isset($k['mannschaft']['name']) ? $k['mannschaft']['name'] . ' (' . implode(', ', array_map(static fn(string $pid): string => $namen[$pid] ?? '?', $k['wer'] ?? [])) . ')' : $wer;
    }

    /** Spieler, die für einen Eintrag Startgeld zahlen (Startgeld gilt je Spieler, auch im Doppel und in der Mannschaft) */
    private static function zahler(array $z, array $k): int
    {
        return self::istGruppe($z) ? max(1, count($k['wer'] ?? [])) : 1;
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
                $summe += (int)($kk['startgeld'] ?? 0) * self::zahler($z, $k);
            }
            $wer = self::werText($z, $k);
            $liste[] = [
                'id' => $k['id'],
                'name' => ($kk['name'] ?? $k['id']) . ($wer !== '' ? ': ' . $wer : ''),
                'status' => $k['status'],
                'position' => ($k['status'] ?? '') === 'warteliste' ? self::position($zeilen, $k['id'], (string)$z['id']) : null,
                'partner' => $k['partner'] ?? null,
                'partnerStatus' => self::partnerStatus($k),
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
            'gruppe' => self::istGruppe($z),
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
            $teile[] = '• ' . ($kk['name'] ?? $k['id']) . (isset($k['mannschaft']) ? ' (Mannschaft)' : '') . (($k['status'] ?? '') === 'warteliste' ? ' (Warteliste)' : '');
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
            'moeglich' => $this->moeglich($t, $e) && $this->api->mailBereit() && (!$this->api->jugendturnier((string)$t['id']) || ($e['gruppen'] ?? true) !== false),
            // ab 0.17: Jugendturnier – keine Einzelanmeldung online (Frage 8C), ab 0.18 aber Gruppenanmeldung
            'jugend' => $this->api->jugendturnier((string)$t['id']),
            'einzel' => !$this->api->jugendturnier((string)$t['id']),
            'gruppe' => ($e['gruppen'] ?? true) !== false,
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
        if (($a->rumpf['typ'] ?? null) === 'gruppe') {
            return $this->gruppeSenden($a, $t, $e);
        }
        if ($this->api->jugendturnier((string)$t['id'])) {
            throw new ApiFehler('abgelaufen', 'Bei Jugendturnieren gibt es keine Einzelanmeldung online. Bitte meldet euch über euren Verein bzw. die Mannschaftsleitung bei der Turnierleitung.');
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
        // Ab 0.17 (Frage 8C): online nur Volljährige; Minderjährige meldet der Verein bzw. eine Mannschaftsleitung
        if (($r['volljaehrig'] ?? false) !== true || ($d['jahrgang'] !== null && $jahr - $d['jahrgang'] < 18)) {
            throw new ApiFehler('ungueltig', 'Online anmelden können sich nur Volljährige. Unter 18 meldet euch bitte über euren Verein bzw. eine Mannschaftsleitung bei der Turnierleitung.');
        }
        $d['volljaehrig'] = true;
        // Ab 0.18: Einwilligung in Ankündigungen der Sparte (Verteiler); bestätigt mit dem Link der Anmeldung
        if (($r['verteiler'] ?? false) === true) {
            $d['verteiler'] = true;
        }
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
            // ab 0.18: Anmeldeform der Konkurrenz
            if (self::formVon($kk) === 'gruppe' && $kk['art'] === 'mannschaft') {
                throw new ApiFehler('ungueltig', '„' . $kk['name'] . '“: Hier melden sich nur ganze Mannschaften an (Gruppenanmeldung durch die Mannschaftsleitung).');
            }
            if (self::formVon($kk) === 'gruppe' && $kk['art'] !== 'einzel' && trim((string)($w['partner'] ?? '')) === '') {
                throw new ApiFehler('ungueltig', '„' . $kk['name'] . '“: Bitte die Partnerin bzw. den Partner angeben – hier melden sich nur Paare an.');
            }
            if (self::formVon($kk) === 'einzel') {
                unset($w['partner'], $w['partnerEmail']); // Paare bildet die Leitung
            }
            $partner = in_array($kk['art'], ['doppel', 'mixed'], true) && is_string($w['partner'] ?? null) ? mb_substr(trim((string)preg_replace('/[\x00-\x1F\x7F]/u', '', $w['partner'])), 0, 80) : '';
            $eintrag = ['id' => $kid, 'status' => null, 'partner' => $partner === '' ? null : $partner, 'seit' => null];
            // Ab 0.17 (Frage 11B): Partner/in bestätigt selbst per Mail – Adresse nur dafür, nie in der Liste der Leitung
            if ($partner !== '') {
                $pm = is_string($w['partnerEmail'] ?? null) ? mb_strtolower(trim($w['partnerEmail'])) : '';
                if (!filter_var($pm, FILTER_VALIDATE_EMAIL) || mb_strlen($pm) > 190) {
                    throw new ApiFehler('ungueltig', 'Bitte die E-Mail-Adresse von ' . $partner . ' angeben – die Partnerin bzw. der Partner bestätigt die Meldung selbst.');
                }
                if ($pm === $email) {
                    throw new ApiFehler('ungueltig', 'Die Partnerin bzw. der Partner braucht eine eigene E-Mail-Adresse.');
                }
                $eintrag['partnerEmail'] = $pm;
                $eintrag['partnerOk'] = null;
                $mitPartner = ($mitPartner ?? 0) + 1;
                if ($mitPartner > self::MAX_PARTNER) {
                    throw new ApiFehler('ungueltig', 'Höchstens ' . self::MAX_PARTNER . ' Doppel bzw. Mixed mit Partnerin oder Partner je Anmeldung.');
                }
            }
            $d['konkurrenzen'][] = $eintrag;
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
        $this->api->begrenzen('anmeldung-sparte|' . (int)$t['sparte_id'], self::MAX_JE_KONTO_TAG, 86400, 'Gerade sind keine weiteren Anmeldungen möglich. Bitte später erneut versuchen.');
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
            . (($d['verteiler'] ?? false) ? "Mit der Bestätigung trägst du dich außerdem für Ankündigungen künftiger Turniere des Vereins ein (jederzeit abbestellbar).\n" : '')
            . "Hast du dich nicht angemeldet? Dann ignoriere diese Mail – die Angaben werden nach 24 Stunden gelöscht.\n\n"
            . "Datenschutzhinweis: " . $this->api->appUrl() . "#/datenschutz");
        return ['ok' => true, 'mail' => true];
    }

    private const MAX_PERSONEN = 40;
    private const MAX_MELDUNGEN = 60;

    /**
     * Angaben einer Person (Name und die verlangten Angaben); Fehlermeldungen mit dem Präfix $wer.
     * @return array{vorname:string,nachname:string,ttr:?int,klasse:?string,geschlecht:?string,jahrgang:?int}
     */
    private function personLesen(mixed $roh, array $pflicht, string $wer): array
    {
        $r = $roh instanceof \stdClass ? get_object_vars($roh) : $roh;
        if (!is_array($r)) {
            throw new ApiFehler('ungueltig', "{$wer}: Angaben fehlen.");
        }
        $txt = static fn(mixed $v, int $max): string => is_string($v) ? mb_substr(trim((string)preg_replace('/[\x00-\x1F\x7F]/u', '', $v)), 0, $max) : '';
        $p = ['vorname' => $txt($r['vorname'] ?? null, 80), 'nachname' => $txt($r['nachname'] ?? null, 80), 'ttr' => null, 'klasse' => null, 'geschlecht' => null, 'jahrgang' => null];
        if ($p['vorname'] === '' || $p['nachname'] === '') {
            throw new ApiFehler('ungueltig', "{$wer}: Bitte Vor- und Nachnamen angeben.");
        }
        $ttr = $r['ttr'] ?? null;
        if (in_array('ttr', $pflicht, true)) {
            if (!is_int($ttr) || $ttr < 0 || $ttr > 4000) {
                throw new ApiFehler('ungueltig', "{$wer}: Bitte den TTR-Wert angeben (0–4000).");
            }
            $p['ttr'] = $ttr;
            if (($r['ttrGeschaetzt'] ?? null) === true) {
                $p['ttrGeschaetzt'] = true;
            }
        }
        if (in_array('klasse', $pflicht, true)) {
            $p['klasse'] = $txt($r['klasse'] ?? null, 40);
            if ($p['klasse'] === '') {
                throw new ApiFehler('ungueltig', "{$wer}: Bitte die Leistungsklasse angeben.");
            }
        }
        if (in_array('geschlecht', $pflicht, true)) {
            if (!in_array($r['geschlecht'] ?? null, ['m', 'w', 'd'], true)) {
                throw new ApiFehler('ungueltig', "{$wer}: Bitte das Geschlecht angeben.");
            }
            $p['geschlecht'] = $r['geschlecht'];
        }
        if (in_array('jahrgang', $pflicht, true)) {
            $jg = $r['jahrgang'] ?? null;
            if (!is_int($jg) || $jg < 1900 || $jg > (int)gmdate('Y', $this->api->jetzt())) {
                throw new ApiFehler('ungueltig', "{$wer}: Bitte den Jahrgang angeben.");
            }
            $p['jahrgang'] = $jg;
        }
        return $p;
    }

    /**
     * Gruppenanmeldung (ab 0.18, Frage 8C): Eine volljährige Mannschaftsleitung meldet gesammelt Spielerinnen und Spieler
     * (auch Minderjährige, ohne deren Mail-Adressen) für Einzel, Doppel und Mannschaften. Sie bestätigt „mindestens 18“
     * und „Erziehungsberechtigte einverstanden“; Mails (Bestätigung, Ergebnisse) gehen nur an sie.
     *   { typ: "gruppe", turnier, vorname, nachname, verein, email, volljaehrig, erziehungsberechtigte, datenschutz, verteiler?,
     *     personen: [{ vorname, nachname, ttr?, klasse?, geschlecht?, jahrgang? }],
     *     meldungen: [{ konkurrenz, personen: [Index], name?, fuehrer?: Index | -1 (Mannschaftsleitung), wechsler?: [Index] }] }
     */
    private function gruppeSenden(Anfrage $a, array $t, array $e): array
    {
        if (($e['gruppen'] ?? true) === false) {
            throw new ApiFehler('abgelaufen', 'Für dieses Turnier gibt es keine Gruppenanmeldung.');
        }
        $r = $a->rumpf ?? [];
        $email = $this->api->email($a);
        $d = [
            'typ' => 'gruppe',
            'vorname' => $this->api->text($a, 'vorname', 1, 80),
            'nachname' => $this->api->text($a, 'nachname', 1, 80),
            'verein' => $this->api->text($a, 'verein', 2, 120),
        ];
        if (($r['datenschutz'] ?? false) !== true) {
            throw new ApiFehler('ungueltig', 'Bitte den Datenschutzhinweis bestätigen.');
        }
        if (($r['volljaehrig'] ?? false) !== true || ($r['erziehungsberechtigte'] ?? false) !== true) {
            throw new ApiFehler('ungueltig', 'Bitte bestätigen, dass du mindestens 18 Jahre alt bist und die Erziehungsberechtigten der gemeldeten Minderjährigen einverstanden sind.');
        }
        $d['volljaehrig'] = true;
        $d['eltern'] = true;
        if (($r['verteiler'] ?? false) === true) {
            $d['verteiler'] = true;
        }
        $pflicht = $e['angaben'] ?? [];
        $roh = $r['personen'] ?? null;
        if (!is_array($roh) || !array_is_list($roh) || $roh === [] || count($roh) > self::MAX_PERSONEN) {
            throw new ApiFehler('ungueltig', 'Bitte 1 bis ' . self::MAX_PERSONEN . ' Personen angeben.');
        }
        $d['personen'] = [];
        foreach ($roh as $i => $p) {
            $d['personen'][] = ['pid' => 'p' . ($i + 1)] + $this->personLesen($p, $pflicht, 'Person ' . ($i + 1));
        }
        $n = count($d['personen']);
        $meld = $r['meldungen'] ?? null;
        if (!is_array($meld) || !array_is_list($meld) || $meld === [] || count($meld) > self::MAX_MELDUNGEN) {
            throw new ApiFehler('ungueltig', 'Bitte mindestens eine Meldung angeben.');
        }
        $d['konkurrenzen'] = [];
        $belegt = []; // Konkurrenz → Person → true
        foreach ($meld as $m) {
            $m = $m instanceof \stdClass ? get_object_vars($m) : $m;
            $kk = is_array($m) && is_string($m['konkurrenz'] ?? null) ? self::konkurrenzVon($e, $m['konkurrenz']) : null;
            $idx = is_array($m) ? ($m['personen'] ?? null) : null;
            if ($kk === null || !is_array($idx) || !array_is_list($idx) || $idx === []) {
                throw new ApiFehler('ungueltig', 'Unbekannte Konkurrenz oder Meldung ohne Personen.');
            }
            $wer = [];
            foreach ($idx as $x) {
                if (!is_int($x) || $x < 0 || $x >= $n || isset($wer[$x])) {
                    throw new ApiFehler('ungueltig', '„' . $kk['name'] . '“: ungültige Person in der Meldung.');
                }
                if (isset($belegt[$kk['id']][$x])) {
                    throw new ApiFehler('ungueltig', '„' . $kk['name'] . '“: ' . $d['personen'][$x]['vorname'] . ' ' . $d['personen'][$x]['nachname'] . ' ist dort schon gemeldet.');
                }
                $wer[$x] = true;
            }
            $form = self::formVon($kk);
            $anzahl = count($wer);
            $eintrag = ['id' => $kk['id'], 'status' => null, 'seit' => null, 'wer' => array_map(static fn(int $x): string => 'p' . ($x + 1), array_keys($wer))];
            if ($kk['art'] === 'einzel' && $anzahl !== 1) {
                throw new ApiFehler('ungueltig', '„' . $kk['name'] . '“ ist ein Einzel – je Meldung eine Person.');
            }
            if (in_array($kk['art'], ['doppel', 'mixed'], true) && !(($anzahl === 2 && $form !== 'einzel') || ($anzahl === 1 && $form !== 'gruppe'))) {
                throw new ApiFehler('ungueltig', '„' . $kk['name'] . '“: ' . ($form === 'gruppe' ? 'nur Paare (zwei Personen).' : ($form === 'einzel' ? 'nur einzeln – die Paare bildet die Turnierleitung.' : 'ein Paar oder eine Person.')));
            }
            if ($kk['art'] === 'mannschaft') {
                if ($anzahl === 1 && $form !== 'gruppe' && !isset($m['name'])) {
                    // einzeln für eine Mannschaft – die Turnierleitung ordnet zu
                } elseif ($form === 'einzel') {
                    throw new ApiFehler('ungueltig', '„' . $kk['name'] . '“: Hier melden sich nur Einzelne; die Mannschaften stellt die Turnierleitung zusammen.');
                } else {
                    $name = is_string($m['name'] ?? null) ? mb_substr(trim((string)preg_replace('/[\x00-\x1F\x7F]/u', '', $m['name'])), 0, 60) : '';
                    $min = (int)($kk['min'] ?? 1);
                    $max = (int)($kk['maxSpieler'] ?? 20);
                    if ($name === '') {
                        throw new ApiFehler('ungueltig', '„' . $kk['name'] . '“: Bitte einen Namen für die Mannschaft angeben (z. B. „' . $d['verein'] . ' I“).');
                    }
                    if ($anzahl < $min || $anzahl > $max) {
                        throw new ApiFehler('ungueltig', '„' . $kk['name'] . "“: Eine Mannschaft hat {$min} bis {$max} Spieler.");
                    }
                    $f = $m['fuehrer'] ?? -1;
                    if (!is_int($f) || ($f !== -1 && !isset($wer[$f]))) {
                        throw new ApiFehler('ungueltig', '„' . $kk['name'] . '“: Die Mannschaftsführung ist eine Spielerin bzw. ein Spieler der Mannschaft oder die Mannschaftsleitung.');
                    }
                    $wl = is_array($m['wechsler'] ?? null) ? array_values(array_unique(array_filter($m['wechsler'], static fn($x): bool => is_int($x) && isset($wer[$x])))) : [];
                    $eintrag['mannschaft'] = ['name' => $name, 'fuehrer' => $f === -1 ? 'leitung' : 'p' . ($f + 1), 'wechsler' => array_map(static fn(int $x): string => 'p' . ($x + 1), $wl)];
                }
            }
            foreach (array_keys($wer) as $x) {
                $belegt[$kk['id']][$x] = true;
            }
            $d['konkurrenzen'][] = $eintrag;
        }
        $zeilen = $this->zeilen((string)$t['id']);
        $mailSchluessel = 'anmeldung-mail|' . hash('sha256', $email);
        if ($this->api->anzahlVersuche($mailSchluessel, 3600) >= 5) {
            return ['ok' => true, 'mail' => true];
        }
        $this->api->fehlversuch($mailSchluessel);
        $bestaetigt = count(array_filter($zeilen, static fn(array $z): bool => $z['bestaetigt'] !== null));
        if ($bestaetigt >= self::MAX_JE_TURNIER || count($zeilen) - $bestaetigt >= self::MAX_UNBESTAETIGT) {
            throw new ApiFehler('zu_viele_versuche', 'Für dieses Turnier sind gerade keine weiteren Anmeldungen möglich. Bitte später erneut versuchen.');
        }
        $this->api->begrenzen('anmeldung-turnier|' . $t['id'], self::MAX_JE_TURNIER_STUNDE, 3600, 'Für dieses Turnier kamen gerade sehr viele Anmeldungen. Bitte später erneut versuchen.');
        $this->api->begrenzen('anmeldung-sparte|' . (int)$t['sparte_id'], self::MAX_JE_KONTO_TAG, 86400, 'Gerade sind keine weiteren Anmeldungen möglich. Bitte später erneut versuchen.');
        $id = $this->neueId((string)$t['id']);
        $schluessel = bin2hex(random_bytes(32));
        $this->db->ausfuehren(
            'INSERT INTO anmeldungen (turnier_id, id, email, daten, schluessel_hash, angelegt, bestaetigt, spieler) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)',
            [$t['id'], $id, $email, json_encode($d, JSON_UNESCAPED_UNICODE), hash('sha256', $schluessel), $this->api->jetzt()]
        );
        $this->mailen($t, $email, "Bitte bestätigen: Gruppenanmeldung {$t['name']}", "Hallo,\n\n"
            . "bitte bestätige die Gruppenanmeldung zu „{$t['name']}“ (" . self::datumText($t) . ") über diesen Link:\n\n"
            . $this->link($t, $schluessel) . "\n\n"
            . "Der Link gilt 24 Stunden. Erst mit der Bestätigung bekommen die Meldungen einen Platz bzw. einen Platz auf der Warteliste.\n"
            . (($d['verteiler'] ?? false) ? "Mit der Bestätigung trägst du dich außerdem für Ankündigungen künftiger Turniere des Vereins ein (jederzeit abbestellbar).\n" : '')
            . "Hast du nichts angemeldet? Dann ignoriere diese Mail – die Angaben werden nach 24 Stunden gelöscht.\n\n"
            . 'Datenschutzhinweis: ' . $this->api->appUrl() . '#/datenschutz');
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
        $verteiler = '';
        if ($neu && ($z['d']['verteiler'] ?? false) === true) {
            $this->api->nachrichten->ausAnmeldung($t, (string)$z['email'], self::name($z));
            $ab = $this->api->nachrichten->abmeldeLinkFuer($t, (string)$z['email']);
            $verteiler = $ab === null ? '' : "\nAnkündigungen künftiger Turniere: eingetragen. Abbestellen: {$ab}\n";
        }
        if ($neu) {
            $this->mailen($t, (string)$z['email'], "Anmeldung bestätigt: {$t['name']}", "Hallo {$z['d']['vorname']},\n\n"
                . "deine Anmeldung zu „{$t['name']}“ (" . self::datumText($t) . ") ist bestätigt.\n\n"
                . $this->standText($t, $e, $z, $zeilen)
                . "\nStand ansehen oder abmelden: " . $this->link($t, (string)$a->rumpf['schluessel']) . "\n"
                . "Bitte hebe diese Mail auf. Rückst du von der Warteliste nach, bekommst du eine Mail.\n" . $verteiler);
            $this->leitungHinweisen($t, $e, $z, $zeilen);
            $this->partnerEinladen($t, $e, $z);
        }
        return $this->stand($t, $e, $z, $zeilen);
    }

    /**
     * Nach der Bestätigung der eigenen Adresse: Partner/innen per Mail um Bestätigung bitten (Frage 11B).
     * Erst danach, damit über unbestätigte Anmeldungen keine Mails an Dritte gehen.
     */
    private function partnerEinladen(array $t, array $e, array $z): void
    {
        $geaendert = false;
        foreach ($z['d']['konkurrenzen'] as $i => $k) {
            $pm = $k['partnerEmail'] ?? null;
            if (!is_string($pm) || ($k['partnerOk'] ?? null) !== null || isset($k['partnerHash'])) {
                continue;
            }
            $schluessel = bin2hex(random_bytes(32));
            $z['d']['konkurrenzen'][$i]['partnerHash'] = hash('sha256', $schluessel);
            $geaendert = true;
            $mk = 'anmeldung-mail|' . hash('sha256', $pm);
            if ($this->api->anzahlVersuche($mk, 3600) >= 5) {
                continue;
            }
            $this->api->fehlversuch($mk);
            $kk = self::konkurrenzVon($e, (string)$k['id']);
            $this->mailen($t, $pm, "Bitte bestätigen: Doppelmeldung {$t['name']}", "Hallo {$k['partner']},\n\n"
                . self::name($z) . ' hat dich bei „' . $t['name'] . '“ (' . self::datumText($t) . ') als Partner/in für „'
                . ($kk['name'] ?? $k['id']) . "“ gemeldet.\n\n"
                . "Bitte bestätige oder lehne ab:\n\n" . $this->api->appUrl() . '#/partner/' . $t['id'] . '/' . $schluessel . "\n\n"
                . "Deine E-Mail-Adresse wird nur dafür verwendet und mit der Anmeldung gelöscht.\n"
                . 'Datenschutzhinweis: ' . $this->api->appUrl() . '#/datenschutz');
        }
        if ($geaendert) {
            $this->gesperrt((string)$t['id'], function () use ($t, $z): void {
                $frisch = $this->zeile($t, (string)$z['id']);
                foreach ($frisch['d']['konkurrenzen'] as $i => $k) {
                    foreach ($z['d']['konkurrenzen'] as $n) {
                        if ($n['id'] === $k['id'] && isset($n['partnerHash']) && !isset($k['partnerHash'])) {
                            $frisch['d']['konkurrenzen'][$i]['partnerHash'] = $n['partnerHash'];
                        }
                    }
                }
                $this->speichern($frisch);
            });
        }
    }

    /**
     * POST anmeldung.partner { turnier, schluessel, antwort?: ja|nein, volljaehrig? } – öffentlich, gebremst.
     * Ohne Antwort: was bestätigt werden soll. „ja“ braucht die Bestätigung „mindestens 18“.
     */
    public function partner(Anfrage $a): array
    {
        $bremse = 'anmeldung-link|' . $a->ip;
        $this->api->bremse($bremse);
        $t = $this->api->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        $schluessel = $a->rumpf['schluessel'] ?? '';
        $hash = is_string($schluessel) && preg_match('/^[a-f0-9]{64}$/', $schluessel) ? hash('sha256', $schluessel) : null;
        $treffer = null;
        foreach ($hash === null ? [] : $this->zeilen((string)$t['id']) as $z) {
            foreach ($z['d']['konkurrenzen'] as $i => $k) {
                if (isset($k['partnerHash']) && hash_equals((string)$k['partnerHash'], $hash)) {
                    $treffer = [$z, $i];
                }
            }
        }
        if ($treffer === null) {
            $this->api->fehlversuch($bremse);
            throw new ApiFehler('abgelaufen', 'Der Link ist ungültig oder die Anmeldung wurde gelöscht.');
        }
        [$z, $i] = $treffer;
        $e = self::einst($t) ?? self::leer();
        $antwort = $a->rumpf['antwort'] ?? null;
        if ($antwort === 'ja' || $antwort === 'nein') {
            if ($antwort === 'ja' && ($a->rumpf['volljaehrig'] ?? false) !== true) {
                throw new ApiFehler('ungueltig', 'Online bestätigen können nur Volljährige. Unter 18 meldet euch bitte über euren Verein bei der Turnierleitung.');
            }
            $frei = null;
            $geaendert = false;
            $this->gesperrt((string)$t['id'], function () use ($t, &$z, $i, $antwort, &$frei, &$geaendert): void {
                $z = $this->zeile($t, (string)$z['id']);
                $k = $z['d']['konkurrenzen'][$i];
                if (($k['partnerOk'] ?? null) === ($antwort === 'ja')) {
                    return; // schon so beantwortet: keine weitere Mail
                }
                $geaendert = true;
                $z['d']['konkurrenzen'][$i]['partnerOk'] = $antwort === 'ja';
                if ($antwort === 'nein' && $k['status'] !== 'abgemeldet') {
                    $frei = $k['status'] === 'platz' ? (string)$k['id'] : null;
                    $z['d']['konkurrenzen'][$i]['status'] = 'abgemeldet';
                }
                $this->speichern($z);
            });
            if ($frei !== null) {
                $this->nachruecken($t, $e, $frei);
            }
            $kk = self::konkurrenzVon($e, (string)$z['d']['konkurrenzen'][$i]['id']);
            if ($geaendert) $this->mailen($t, (string)$z['email'], ($antwort === 'ja' ? 'Partner/in hat bestätigt: ' : 'Partner/in hat abgelehnt: ') . $t['name'],
                "Hallo {$z['d']['vorname']},\n\n" . (string)$z['d']['konkurrenzen'][$i]['partner']
                . ($antwort === 'ja' ? ' hat die Meldung für „' . ($kk['name'] ?? '') . '“ bestätigt.'
                    : ' hat die Meldung für „' . ($kk['name'] ?? '') . '“ abgelehnt. Diese Meldung ist damit zurückgezogen.')
                . "\n\n" . self::LINK_HINWEIS);
        }
        $k = $z['d']['konkurrenzen'][$i];
        $kk = self::konkurrenzVon($e, (string)$k['id']);
        return [
            'turnier' => ['id' => (string)$t['id'], 'name' => (string)$t['name'], 'datum' => $t['datum']],
            'von' => self::name($z),
            'partner' => (string)($k['partner'] ?? ''),
            'konkurrenz' => (string)($kk['name'] ?? $k['id']),
            'status' => ($k['partnerOk'] ?? null) === null ? 'offen' : (($k['partnerOk'] === true) ? 'bestaetigt' : 'abgelehnt'),
        ];
    }

    private static function partnerStatus(array $k): ?string
    {
        if (!isset($k['partnerEmail'])) {
            return null;
        }
        return ($k['partnerOk'] ?? null) === null ? 'offen' : ($k['partnerOk'] === true ? 'bestaetigt' : 'abgelehnt');
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
                'angelegt' => Api::iso((int)$z['angelegt']),
                'bestaetigt' => $z['bestaetigt'] === null ? null : Api::iso((int)$z['bestaetigt']),
                'konkurrenzen' => array_map(fn(array $k, int $i): array => [
                    'id' => $k['id'],
                    'status' => $k['status'] ?? 'warteliste',
                    'position' => ($k['status'] ?? '') === 'warteliste' ? self::position($zeilen, $k['id'], (string)$z['id']) : null,
                    'partner' => $k['partner'] ?? null,
                    'partnerStatus' => self::partnerStatus($k),
                    // ab 0.18: Gruppenanmeldung – Nummer des Eintrags, Personen, Mannschaft
                    'eintrag' => $i,
                    'wer' => $k['wer'] ?? null,
                    'mannschaft' => $k['mannschaft'] ?? null,
                ], $d['konkurrenzen'] ?? [], array_keys($d['konkurrenzen'] ?? [])),
                'spieler' => $z['spieler'] === null ? null : (string)$z['spieler'],
                'typ' => self::istGruppe($z) ? 'gruppe' : 'einzel',
                'personen' => self::istGruppe($z) ? array_map(static fn(array $p): array => [
                    'pid' => (string)$p['pid'], 'vorname' => (string)$p['vorname'], 'nachname' => (string)$p['nachname'],
                    'ttr' => $p['ttr'] ?? null, 'ttrGeschaetzt' => ($p['ttrGeschaetzt'] ?? false) === true, 'klasse' => $p['klasse'] ?? null,
                    'geschlecht' => $p['geschlecht'] ?? null, 'jahrgang' => $p['jahrgang'] ?? null,
                ], $d['personen'] ?? []) : null,
            ];
        }
        // Für die Leitung mit „vorab“ (von Hand Gemeldete), damit die App Änderungen erkennt
        return ['einstellungen' => $e, 'anmeldungen' => $aus, 'freigabe' => $this->api->anmeldungFreigabe($t)];
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
                'art' => $art = in_array($k['art'] ?? null, ['einzel', 'doppel', 'mixed', 'mannschaft'], true) ? $k['art'] : 'einzel',
                'max' => is_int($max) && $max >= 1 && $max <= 1000 ? $max : null,
                'startgeld' => is_int($geld) && $geld > 0 && $geld <= 100000 ? $geld : null,
                'vorab' => is_int($vorab) && $vorab >= 0 && $vorab <= 1000 ? $vorab : 0,
                // ab 0.18: Anmeldeform (einzeln, als Paar/Mannschaft oder beides) und Sollstärke der Mannschaften
                'form' => self::formLesen($art, $k['form'] ?? null),
                'min' => $art === 'mannschaft' ? self::staerke($k['min'] ?? null, 1) : null,
                'maxSpieler' => $art === 'mannschaft' ? max(self::staerke($k['min'] ?? null, 1), self::staerke($k['maxSpieler'] ?? null, self::staerke($k['min'] ?? null, 1) + 2)) : null,
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
            // ab 0.18: Gruppenanmeldung durch eine Mannschaftsleitung (Standard an; bei Jugendturnieren der einzige Weg)
            'gruppen' => ($r['gruppen'] ?? true) !== false,
            // Fehlt das Feld (ältere App), bleibt die bisherige Einstellung
            'hinweisMail' => array_key_exists('hinweisMail', $r) ? $r['hinweisMail'] !== false : ((self::einst($t)['hinweisMail'] ?? true) !== false),
        ];
        // Freigabe zuletzt prüfen (erst die Eingaben, damit Fehler darin sofort auffallen)
        $frei = $this->api->anmeldungFreigabe($t);
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
        $nur = $a->rumpf['eintrag'] ?? null;
        foreach ($z['d']['konkurrenzen'] as $i => $k) {
            if ($k['id'] === $kid && (!is_int($nur) || $nur === $i)) {
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
