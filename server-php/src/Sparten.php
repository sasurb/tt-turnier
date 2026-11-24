<?php
declare(strict_types=1);

namespace TtTurnier;

/**
 * Vereine, Sparten und ihre Mitglieder (ab 0.17, Vertrag: shared/protokoll.ts „Sparten“).
 *
 * - Ein Verein hat Sparten (vorerst je Sportart eine; Turnierfunktionen nur für Tischtennis).
 * - Mitglieder einer Sparte sind Konten mit der Rolle „spartenleitung“ oder „turnierleitung“.
 *   Die Spartenleitung leitet alle Turniere der Sparte, verwaltet Mitglieder, Ausschüsse und
 *   Veranstaltungen. Eine Turnierleitung leitet die Turniere, zu denen sie einen Zugang hat;
 *   mit dem Recht „anlegen“ legt sie selbst Turniere an.
 * - Ausschüsse (z. B. Sommerfest) haben eigene Mitglieder (Konten), die weitere einladen und
 *   sperren können, und eine Nachrichtenliste.
 * - Einladungen gehen per Mail-Link (14 Tage, einmalig, gebunden an die E-Mail-Adresse).
 * - Pool, Klassen/Kasse-Vorlagen und Turniere gehören der Sparte. Wird das letzte Konto der
 *   Spartenleitung gelöscht, wird die Sparte mit allem gelöscht (30 Tage vorher Mail an alle Mitglieder).
 */
final class Sparten
{
    public const ROLLEN = ['spartenleitung', 'turnierleitung'];
    private const EINLADUNG_DAUER = 14 * 86400;
    private const MAX_MITGLIEDER = 200;
    private const MAX_AUSSCHUESSE = 50;
    private const MAX_AUSSCHUSS_MITGLIEDER = 100;
    private const MAX_VERANSTALTUNGEN = 200;
    private const MAX_SPARTEN_JE_KONTO = 5;
    private const MAX_NACHRICHT = 2000;
    private const NACHRICHTEN_AUSGABE = 200;
    /** Nachrichten in Ausschüssen werden nach 12 Monaten gelöscht (Wartung) */
    public const NACHRICHTEN_LOESCHEN_NACH = 365 * 86400;
    private const ID_ZEICHEN = 'abcdefghijkmnpqrstuvwxyz23456789';
    /** Sportarten im Datenmodell; Turnierfunktionen gibt es vorerst nur für Tischtennis */
    public const SPORTARTEN = ['tischtennis'];

    /** @var array<string,?array> je Anfrage */
    private array $cache = [];

    public function __construct(private readonly Api $api, private readonly Datenbank $db)
    {
    }

    public function cacheLeeren(): void
    {
        $this->cache = [];
    }

    /* ---------------- Abfragen für die Rechteprüfung ---------------- */

    /** Mitgliedschaft eines Kontos in einer Sparte oder null */
    public function mitglied(int $konto, int $sparte): ?array
    {
        $k = "m|$konto|$sparte";
        if (!array_key_exists($k, $this->cache)) {
            $this->cache[$k] = $this->db->eine('SELECT * FROM mitglieder WHERE sparte_id = ? AND konto_id = ?', [$sparte, $konto]);
        }
        return $this->cache[$k];
    }

    public function istSpartenleitung(array $s, int $sparte): bool
    {
        if ($s['konto_id'] === null) {
            return false;
        }
        if ($this->istAdmin($s)) {
            return true;
        }
        return ($this->mitglied((int)$s['konto_id'], $sparte)['rolle'] ?? null) === 'spartenleitung';
    }

    private function istAdmin(array $s): bool
    {
        if ($s['konto_id'] === null) {
            return false;
        }
        $k = 'admin|' . $s['konto_id'];
        if (!array_key_exists($k, $this->cache)) {
            $this->cache[$k] = $this->db->eine("SELECT id FROM konten WHERE id = ? AND rolle = 'admin'", [(int)$s['konto_id']]);
        }
        return $this->cache[$k] !== null;
    }

    /** Leitet dieses Konto das Turnier? (Spartenleitung der Sparte, Konto-Zugang zum Turnier oder Administrator) */
    public function kontoLeitet(array $s, array $t): bool
    {
        if ($s['konto_id'] === null) {
            return false;
        }
        if ($this->istAdmin($s)) {
            return true;
        }
        // Ohne Zustimmung zu den Nutzungsbedingungen (mit AVV) keine Leitung per Konto
        $kb = 'b|' . $s['konto_id'];
        if (!array_key_exists($kb, $this->cache)) {
            $this->cache[$kb] = $this->api->bedingungenAngenommen((int)$s['konto_id']) ? [] : null;
        }
        if ($this->cache[$kb] === null) {
            return false;
        }
        if ($t['sparte_id'] !== null && $this->istSpartenleitung($s, (int)$t['sparte_id'])) {
            return true;
        }
        $k = 'z|' . $s['konto_id'] . '|' . $t['id'];
        if (!array_key_exists($k, $this->cache)) {
            $this->cache[$k] = $this->db->eine('SELECT turnier_id FROM turnier_zugaenge WHERE turnier_id = ? AND konto_id = ?', [$t['id'], (int)$s['konto_id']]);
        }
        return $this->cache[$k] !== null && $t['sparte_id'] !== null && $this->mitglied((int)$s['konto_id'], (int)$t['sparte_id']) !== null;
    }

    /**
     * Sparte für eine Anfrage: angegebene ID (muss Mitglied sein) oder die erste Sparte des Kontos.
     * $recht: 'mitglied' (Spartenleitung oder Turnierleitung), 'anlegen' (darf Turniere anlegen), 'leitung' (Spartenleitung)
     */
    public function sparteFuer(array $s, mixed $wunsch, string $recht = 'mitglied'): array
    {
        if ($s['konto_id'] === null) {
            throw new ApiFehler('nicht_angemeldet', 'Bitte zuerst anmelden.');
        }
        $konto = (int)$s['konto_id'];
        if (is_string($wunsch) && ctype_digit($wunsch)) {
            $wunsch = (int)$wunsch;
        }
        if ($wunsch !== null && !is_int($wunsch)) {
            throw new ApiFehler('ungueltig', 'Sparte ungültig.');
        }
        if ($wunsch === null) {
            $m = $this->db->eine('SELECT sparte_id FROM mitglieder WHERE konto_id = ? ORDER BY sparte_id LIMIT 1', [$konto]);
            if ($m === null) {
                throw new ApiFehler('keine_berechtigung', 'Dein Konto gehört noch zu keiner Sparte. Lege unter „Sparte“ eine an oder lass dich einladen.');
            }
            $wunsch = (int)$m['sparte_id'];
        }
        $sp = $this->sparteLaden($wunsch);
        $m = $this->mitglied($konto, $wunsch);
        $admin = $this->istAdmin($s);
        if ($m === null && !$admin) {
            throw new ApiFehler('keine_berechtigung', 'Du gehörst nicht zu dieser Sparte.');
        }
        $leitung = $admin || ($m['rolle'] ?? '') === 'spartenleitung';
        if ($recht === 'leitung' && !$leitung) {
            throw new ApiFehler('keine_berechtigung', 'Nur für die Spartenleitung.');
        }
        if ($recht === 'anlegen' && !$leitung && (int)($m['anlegen'] ?? 0) !== 1) {
            throw new ApiFehler('keine_berechtigung', 'Du darfst in dieser Sparte keine Turniere anlegen. Die Spartenleitung kann dir das Recht geben.');
        }
        $sp['_leitung'] = $leitung;
        return $sp;
    }

    public function sparteLaden(int $id): array
    {
        $sp = $this->db->eine('SELECT s.*, v.name AS verein FROM sparten s JOIN vereine v ON v.id = s.verein_id WHERE s.id = ?', [$id]);
        if ($sp === null) {
            throw new ApiFehler('nicht_gefunden', 'Sparte nicht gefunden.');
        }
        return $sp;
    }

    /** Sparten und Ausschüsse eines Kontos (für „ich“ und die Anmeldung) */
    public function fuerKonto(int $konto): array
    {
        $sparten = [];
        foreach ($this->db->alle(
            'SELECT s.id, s.name, s.sportart, s.avv, v.name AS verein, m.rolle, m.anlegen FROM mitglieder m
             JOIN sparten s ON s.id = m.sparte_id JOIN vereine v ON v.id = s.verein_id WHERE m.konto_id = ? ORDER BY s.id',
            [$konto]
        ) as $z) {
            $sparten[] = [
                'id' => (int)$z['id'], 'name' => (string)$z['name'], 'verein' => (string)$z['verein'], 'sportart' => (string)$z['sportart'],
                'rolle' => (string)$z['rolle'], 'anlegen' => (string)$z['rolle'] === 'spartenleitung' || (int)$z['anlegen'] === 1,
            ];
        }
        $ausschuesse = [];
        foreach ($this->db->alle(
            'SELECT a.id, a.name, a.sparte_id, s.name AS sparte FROM ausschuss_mitglieder am JOIN ausschuesse a ON a.id = am.ausschuss_id
             JOIN sparten s ON s.id = a.sparte_id WHERE am.konto_id = ? AND am.gesperrt = 0 ORDER BY a.name',
            [$konto]
        ) as $z) {
            $ausschuesse[] = ['id' => (int)$z['id'], 'name' => (string)$z['name'], 'sparte' => (int)$z['sparte_id'], 'sparteName' => (string)$z['sparte']];
        }
        return ['sparten' => $sparten, 'ausschuesse' => $ausschuesse];
    }

    /** Neue Sparte mit Verein; das Konto wird Spartenleitung. */
    public function neueSparte(string $verein, string $name, int $konto, bool $avv): int
    {
        $jetzt = $this->api->jetzt();
        $this->db->ausfuehren('INSERT INTO vereine (name, angelegt) VALUES (?, ?)', [$verein, $jetzt]);
        $v = (int)$this->db->pdo->lastInsertId();
        $this->db->ausfuehren(
            'INSERT INTO sparten (verein_id, name, sportart, daten, angelegt, avv, avv_konto) VALUES (?, ?, ?, NULL, ?, ?, ?)',
            [$v, $name, 'tischtennis', $jetzt, $avv ? $jetzt : null, $avv ? $konto : null]
        );
        $sp = (int)$this->db->pdo->lastInsertId();
        $this->db->ausfuehren(
            "INSERT INTO mitglieder (sparte_id, konto_id, rolle, anlegen, angelegt) VALUES (?, ?, 'spartenleitung', 1, ?)",
            [$sp, $konto, $jetzt]
        );
        $this->cacheLeeren();
        return $sp;
    }

    /* ---------------- Ausgaben ---------------- */

    private function sparteAusgabe(array $sp): array
    {
        return [
            'id' => (int)$sp['id'],
            'name' => (string)$sp['name'],
            'verein' => (string)$sp['verein'],
            'sportart' => (string)$sp['sportart'],
            'angelegt' => Api::iso((int)$sp['angelegt']),
            'avv' => Api::iso($sp['avv'] === null ? null : (int)$sp['avv']),
            'anmeldung' => ($sp['anmeldung_frei'] ?? null) === null ? 'auto' : ((int)$sp['anmeldung_frei'] === 1 ? 'frei' : 'gesperrt'),
        ];
    }

    private static function einladungAusgabe(array $z): array
    {
        return [
            'id' => (string)$z['id'], 'art' => (string)$z['art'], 'ziel' => $z['ziel'] === null ? null : (string)$z['ziel'],
            'rolle' => (string)$z['rolle'], 'anlegen' => (int)$z['anlegen'] === 1, 'email' => (string)$z['email'],
            'name' => (string)$z['name'], 'angelegt' => Api::iso((int)$z['angelegt']), 'ablauf' => Api::iso((int)$z['ablauf']),
        ];
    }

    /* ---------------- Endpunkte: Sparte ---------------- */

    /** GET sparte&id= – nur Spartenleitung (und Administrator) */
    public function sparte(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $sp = $this->sparteFuer($s, $a->query['id'] ?? null, 'leitung');
        $id = (int)$sp['id'];
        $mitglieder = [];
        foreach ($this->db->alle(
            'SELECT m.*, k.name, k.email, k.aktiv FROM mitglieder m JOIN konten k ON k.id = m.konto_id WHERE m.sparte_id = ? ORDER BY m.rolle, k.name',
            [$id]
        ) as $z) {
            $turniere = array_map(static fn(array $x): string => (string)$x['turnier_id'], $this->db->alle(
                'SELECT z.turnier_id FROM turnier_zugaenge z JOIN turniere t ON t.id = z.turnier_id WHERE z.konto_id = ? AND t.sparte_id = ?',
                [(int)$z['konto_id'], $id]
            ));
            $mitglieder[] = [
                'konto' => (int)$z['konto_id'], 'name' => (string)$z['name'], 'email' => (string)$z['email'],
                'rolle' => (string)$z['rolle'], 'anlegen' => (string)$z['rolle'] === 'spartenleitung' || (int)$z['anlegen'] === 1,
                'turniere' => $turniere, 'ich' => (int)$z['konto_id'] === (int)$s['konto_id'],
                'zuletztAktiv' => Api::iso($z['aktiv'] === null ? null : (int)$z['aktiv']),
            ];
        }
        $einladungen = array_map([self::class, 'einladungAusgabe'], $this->db->alle(
            "SELECT * FROM einladungen WHERE sparte_id = ? AND art IN ('sparte', 'turnier') AND ablauf >= ? ORDER BY angelegt DESC",
            [$id, $this->api->jetzt()]
        ));
        $ausschuesse = [];
        foreach ($this->db->alle('SELECT * FROM ausschuesse WHERE sparte_id = ? ORDER BY name', [$id]) as $z) {
            $n = $this->db->eine('SELECT COUNT(*) AS n FROM ausschuss_mitglieder WHERE ausschuss_id = ? AND gesperrt = 0', [(int)$z['id']]);
            $ausschuesse[] = ['id' => (int)$z['id'], 'name' => (string)$z['name'], 'mitglieder' => (int)($n['n'] ?? 0), 'angelegt' => Api::iso((int)$z['angelegt'])];
        }
        $veranstaltungen = array_map(static fn(array $z): array => [
            'id' => (int)$z['id'], 'name' => (string)$z['name'], 'datum' => $z['datum'] === null ? null : (string)$z['datum'],
            'ausschuss' => $z['ausschuss_id'] === null ? null : (int)$z['ausschuss_id'],
        ], $this->db->alle('SELECT * FROM veranstaltungen WHERE sparte_id = ? ORDER BY datum, name', [$id]));
        $anzahl = (int)($this->db->eine('SELECT COUNT(*) AS n FROM turniere WHERE sparte_id = ?', [$id])['n'] ?? 0);
        return [
            'sparte' => $this->sparteAusgabe($sp) + ['turniere' => $anzahl],
            'mitglieder' => $mitglieder,
            'einladungen' => $einladungen,
            'ausschuesse' => $ausschuesse,
            'veranstaltungen' => $veranstaltungen,
        ];
    }

    /** GET sparten – Administrator: alle Sparten mit Zahlen */
    public function sparten(Anfrage $a): array
    {
        $this->api->kontoSitzung($a, true);
        $aus = [];
        foreach ($this->db->alle('SELECT s.*, v.name AS verein FROM sparten s JOIN vereine v ON v.id = s.verein_id ORDER BY v.name, s.name') as $sp) {
            $leitung = array_map(static fn(array $z): string => (string)$z['name'], $this->db->alle(
                "SELECT k.name FROM mitglieder m JOIN konten k ON k.id = m.konto_id WHERE m.sparte_id = ? AND m.rolle = 'spartenleitung' ORDER BY k.name",
                [(int)$sp['id']]
            ));
            $aus[] = $this->sparteAusgabe($sp) + [
                'leitung' => $leitung,
                'mitglieder' => (int)($this->db->eine('SELECT COUNT(*) AS n FROM mitglieder WHERE sparte_id = ?', [(int)$sp['id']])['n'] ?? 0),
                'turniere' => (int)($this->db->eine('SELECT COUNT(*) AS n FROM turniere WHERE sparte_id = ?', [(int)$sp['id']])['n'] ?? 0),
            ];
        }
        return ['sparten' => $aus];
    }

    /** POST sparte.anlegen { verein, name, avv: true } – weitere Sparte (das Konto wird Spartenleitung) */
    public function anlegen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        if (($a->rumpf['avv'] ?? false) !== true) {
            throw new ApiFehler('ungueltig', 'Bitte der Vereinbarung zur Auftragsverarbeitung zustimmen.');
        }
        $verein = $this->api->text($a, 'verein', 2, 160);
        $name = $this->api->text($a, 'name', 2, 120);
        $n = (int)($this->db->eine("SELECT COUNT(*) AS n FROM mitglieder WHERE konto_id = ? AND rolle = 'spartenleitung'", [(int)$s['konto_id']])['n'] ?? 0);
        if ($n >= self::MAX_SPARTEN_JE_KONTO && !$this->istAdmin($s)) {
            throw new ApiFehler('zu_gross', 'Höchstens ' . self::MAX_SPARTEN_JE_KONTO . ' Sparten je Konto.');
        }
        $this->api->begrenzen('sparte-anlegen|' . $s['konto_id'], 5, 86400, 'Heute wurden schon mehrere Sparten angelegt. Bitte morgen weitermachen.');
        $id = $this->neueSparte($verein, $name, (int)$s['konto_id'], true);
        return ['sparte' => $this->sparteAusgabe($this->sparteLaden($id))] + $this->fuerKonto((int)$s['konto_id']);
    }

    /** POST sparte.aendern { sparte, name?, verein?, avv? } – Spartenleitung */
    public function aendern(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $sp = $this->sparteFuer($s, $a->rumpf['sparte'] ?? null, 'leitung');
        $r = $a->rumpf ?? [];
        if (array_key_exists('name', $r)) {
            $this->db->ausfuehren('UPDATE sparten SET name = ? WHERE id = ?', [$this->api->text($a, 'name', 2, 120), (int)$sp['id']]);
        }
        if (array_key_exists('verein', $r)) {
            $this->db->ausfuehren('UPDATE vereine SET name = ? WHERE id = ?', [$this->api->text($a, 'verein', 2, 160), (int)$sp['verein_id']]);
        }
        if (($r['avv'] ?? null) === true) {
            $this->db->ausfuehren('UPDATE sparten SET avv = ?, avv_konto = ? WHERE id = ?', [$this->api->jetzt(), (int)$s['konto_id'], (int)$sp['id']]);
        }
        return ['sparte' => $this->sparteAusgabe($this->sparteLaden((int)$sp['id']))];
    }

    /** POST sparte.anmeldung { id, anmeldung: auto|frei|gesperrt } – Administrator: Online-Anmeldung der Sparte freigeben */
    public function anmeldungFreigeben(Anfrage $a): array
    {
        $this->api->kontoSitzung($a, true);
        $id = $a->rumpf['id'] ?? null;
        $stufe = $a->rumpf['anmeldung'] ?? null;
        if (!is_int($id) || !in_array($stufe, ['auto', 'frei', 'gesperrt'], true)) {
            throw new ApiFehler('ungueltig', 'Felder „id“ und „anmeldung“ (auto, frei, gesperrt) erforderlich.');
        }
        $this->sparteLaden($id);
        $wert = $stufe === 'auto' ? null : ($stufe === 'frei' ? 1 : 0);
        $this->db->ausfuehren('UPDATE sparten SET anmeldung_frei = ? WHERE id = ?', [$wert, $id]);
        return ['sparte' => $this->sparteAusgabe($this->sparteLaden($id))];
    }

    /** POST sparte.loeschen { sparte, passwort } – Spartenleitung: Sparte mit allen Turnieren, Pool, Ausschüssen löschen */
    public function loeschen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $sp = $this->sparteFuer($s, $a->rumpf['sparte'] ?? null, 'leitung');
        $this->api->passwortPruefen($a, (int)$s['konto_id']);
        $empfaenger = $this->alleAdressen((int)$sp['id'], (int)$s['konto_id']);
        $wer = (string)($this->db->eine('SELECT name FROM konten WHERE id = ?', [(int)$s['konto_id']])['name'] ?? '');
        $this->entfernen((int)$sp['id']);
        if ($this->api->mailBereit()) {
            foreach (array_slice($empfaenger, 0, 300) as $m) {
                $this->api->mail((string)$m['email'], "Sparte gelöscht: {$sp['verein']} – {$sp['name']}", "Hallo {$m['name']},\n\n"
                    . "{$wer} hat die Sparte „{$sp['verein']} – {$sp['name']}“ mit allen Turnieren, dem Spielerpool und den Ausschüssen gelöscht.\n"
                    . 'Dein Konto bleibt bestehen. Fragen dazu bitte an die Spartenleitung.');
            }
        }
        return ['ok' => true] + $this->fuerKonto((int)$s['konto_id']);
    }

    /** Sparte endgültig löschen (Turniere, Pool, Mitglieder, Einladungen, Ausschüsse, Veranstaltungen; Verein, wenn leer) */
    public function entfernen(int $id): void
    {
        $sp = $this->db->eine('SELECT * FROM sparten WHERE id = ?', [$id]);
        if ($sp === null) {
            return;
        }
        $eigene = !$this->db->inTransaktion();
        if ($eigene) {
            $this->db->anfangen();
        }
        try {
            foreach ($this->db->alle('SELECT id FROM turniere WHERE sparte_id = ?', [$id]) as $t) {
                $this->api->turnierEntfernen((string)$t['id']);
            }
            foreach ($this->db->alle('SELECT id FROM ausschuesse WHERE sparte_id = ?', [$id]) as $au) {
                $this->ausschussEntfernen((int)$au['id']);
            }
            $this->db->ausfuehren('DELETE FROM spieler_pool WHERE sparte_id = ?', [$id]);
            $this->db->ausfuehren('DELETE FROM mitglieder WHERE sparte_id = ?', [$id]);
            $this->db->ausfuehren('DELETE FROM einladungen WHERE sparte_id = ?', [$id]);
            $this->db->ausfuehren('DELETE FROM veranstaltungen WHERE sparte_id = ?', [$id]);
            $this->db->ausfuehren('DELETE FROM sparten WHERE id = ?', [$id]);
            if ($this->db->eine('SELECT id FROM sparten WHERE verein_id = ?', [(int)$sp['verein_id']]) === null) {
                $this->db->ausfuehren('DELETE FROM vereine WHERE id = ?', [(int)$sp['verein_id']]);
            }
            if ($eigene) {
                $this->db->festschreiben();
            }
        } catch (\Throwable $x) {
            if ($eigene) {
                $this->db->zurueckrollen();
            }
            throw $x;
        }
        $this->cacheLeeren();
    }

    private function ausschussEntfernen(int $id): void
    {
        $this->db->ausfuehren('DELETE FROM ausschuss_nachrichten WHERE ausschuss_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM ausschuss_mitglieder WHERE ausschuss_id = ?', [$id]);
        $this->db->ausfuehren("DELETE FROM einladungen WHERE art = 'ausschuss' AND ziel = ?", [(string)$id]);
        $this->db->ausfuehren('UPDATE veranstaltungen SET ausschuss_id = NULL WHERE ausschuss_id = ?', [$id]);
        $this->db->ausfuehren('DELETE FROM ausschuesse WHERE id = ?', [$id]);
    }

    /**
     * Sparten, in denen dieses Konto die einzige Spartenleitung ist (beim Löschen des Kontos werden sie mitgelöscht).
     * @return list<array>
     */
    public function letzteLeitungIn(int $konto): array
    {
        return $this->db->alle(
            "SELECT s.*, v.name AS verein FROM mitglieder m JOIN sparten s ON s.id = m.sparte_id JOIN vereine v ON v.id = s.verein_id
             WHERE m.konto_id = ? AND m.rolle = 'spartenleitung'
             AND NOT EXISTS (SELECT 1 FROM mitglieder m2 WHERE m2.sparte_id = m.sparte_id AND m2.rolle = 'spartenleitung' AND m2.konto_id <> m.konto_id)",
            [$konto]
        );
    }

    /** E-Mail-Adressen aller Mitglieder einer Sparte (Spartenleitung, Turnierleitung, Ausschüsse) */
    public function alleAdressen(int $sparte, ?int $ohneKonto = null): array
    {
        $zeilen = $this->db->alle(
            'SELECT DISTINCT k.id, k.email, k.name FROM konten k WHERE k.id IN (SELECT konto_id FROM mitglieder WHERE sparte_id = ?)
             OR k.id IN (SELECT am.konto_id FROM ausschuss_mitglieder am JOIN ausschuesse a ON a.id = am.ausschuss_id WHERE a.sparte_id = ? AND am.gesperrt = 0)',
            [$sparte, $sparte]
        );
        return array_values(array_filter($zeilen, static fn(array $z): bool => (int)$z['id'] !== $ohneKonto));
    }

    /** Mails an alle Mitglieder: Sparte wird mit dem letzten Spartenleitungs-Konto am $am gelöscht. */
    public function loeschungAnkuendigen(int $konto, int $am): void
    {
        if (!$this->api->mailBereit()) {
            return;
        }
        $wer = $this->db->eine('SELECT name FROM konten WHERE id = ?', [$konto]);
        foreach ($this->letzteLeitungIn($konto) as $sp) {
            foreach ($this->alleAdressen((int)$sp['id'], $konto) as $m) {
                $this->api->mail((string)$m['email'], "Sparte wird gelöscht: {$sp['verein']} – {$sp['name']}", "Hallo {$m['name']},\n\n"
                    . "das Konto von „" . (string)($wer['name'] ?? '') . "“ ist die einzige Spartenleitung von „{$sp['verein']} – {$sp['name']}“ und wurde\n"
                    . "lange nicht genutzt. Wird es bis zum " . gmdate('d.m.Y', $am) . " nicht verwendet, wird es gelöscht – und mit ihm die\n"
                    . "Sparte mit allen Turnieren, dem Spielerpool, den Ausschüssen und ihren Nachrichten.\n\n"
                    . "Soll die Sparte bleiben? Dann bitte die Spartenleitung, sich einmal anzumelden und unter „Sparte“\n"
                    . "eine weitere Person als Spartenleitung einzuladen.\n\n" . $this->api->appUrl());
            }
        }
    }

    /**
     * Konto wird gelöscht: Sparten mit ihm als einziger Spartenleitung werden gelöscht, sonst gehen
     * seine Turniere an eine andere Spartenleitung. Mitgliedschaften, Zugänge und Einladungen entfallen;
     * Ausschuss-Nachrichten bleiben ohne Namen stehen.
     */
    public function kontoEntfernt(int $konto): void
    {
        foreach ($this->letzteLeitungIn($konto) as $sp) {
            $this->entfernen((int)$sp['id']);
        }
        $this->api->kontoKennungenSperren($konto, null);
        // Adresse aus den Sicherungsempfängern der weitergeführten Turniere entfernen
        $mail = mb_strtolower((string)($this->db->eine('SELECT email FROM konten WHERE id = ?', [$konto])['email'] ?? ''));
        if ($mail !== '') {
            foreach ($this->db->alle('SELECT id, sicherung_an FROM turniere WHERE sicherung_an LIKE ?', ['%' . $mail . '%']) as $t) {
                $liste = json_decode((string)$t['sicherung_an'], true);
                if (is_array($liste)) {
                    $neu = array_values(array_filter($liste, static fn(mixed $e): bool => is_string($e) && mb_strtolower($e) !== $mail));
                    $this->db->ausfuehren('UPDATE turniere SET sicherung_an = ? WHERE id = ?', [json_encode($neu), $t['id']]);
                }
            }
            $this->db->ausfuehren('DELETE FROM sicherung_empfaenger WHERE email = ?', [$mail]);
        }
        foreach ($this->db->alle('SELECT DISTINCT sparte_id FROM turniere WHERE konto_id = ? AND sparte_id IS NOT NULL', [$konto]) as $z) {
            $neu = $this->db->eine(
                "SELECT konto_id FROM mitglieder WHERE sparte_id = ? AND rolle = 'spartenleitung' AND konto_id <> ? ORDER BY angelegt LIMIT 1",
                [(int)$z['sparte_id'], $konto]
            );
            if ($neu !== null) {
                $this->db->ausfuehren('UPDATE turniere SET konto_id = ? WHERE konto_id = ? AND sparte_id = ?', [(int)$neu['konto_id'], $konto, (int)$z['sparte_id']]);
            }
        }
        $this->db->ausfuehren('DELETE FROM mitglieder WHERE konto_id = ?', [$konto]);
        $this->db->ausfuehren('DELETE FROM turnier_zugaenge WHERE konto_id = ?', [$konto]);
        $this->db->ausfuehren('DELETE FROM einladungen WHERE von_konto = ?', [$konto]);
        $this->db->ausfuehren('DELETE FROM ausschuss_mitglieder WHERE konto_id = ?', [$konto]);
        $this->db->ausfuehren("UPDATE ausschuss_nachrichten SET konto_id = NULL, name = 'Gelöschtes Konto' WHERE konto_id = ?", [$konto]);
        $this->cacheLeeren();
    }

    /* ---------------- Mitglieder ---------------- */

    /** POST mitglied.aendern { sparte, konto, rolle?, anlegen? } – Spartenleitung */
    public function mitgliedAendern(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $sp = $this->sparteFuer($s, $a->rumpf['sparte'] ?? null, 'leitung');
        $konto = $a->rumpf['konto'] ?? null;
        $m = is_int($konto) ? $this->mitglied($konto, (int)$sp['id']) : null;
        if ($m === null) {
            throw new ApiFehler('nicht_gefunden', 'Mitglied nicht gefunden.');
        }
        $rolle = $a->rumpf['rolle'] ?? $m['rolle'];
        if (!in_array($rolle, self::ROLLEN, true)) {
            throw new ApiFehler('ungueltig', 'Rolle ungültig.');
        }
        $anlegen = $a->rumpf['anlegen'] ?? ((int)$m['anlegen'] === 1);
        if (!is_bool($anlegen)) {
            throw new ApiFehler('ungueltig', 'Feld „anlegen“ muss wahr oder falsch sein.');
        }
        if ($m['rolle'] === 'spartenleitung' && $rolle !== 'spartenleitung') {
            $this->nichtLetzteLeitung((int)$sp['id'], $konto);
        }
        $this->db->ausfuehren('UPDATE mitglieder SET rolle = ?, anlegen = ? WHERE sparte_id = ? AND konto_id = ?',
            [$rolle, $rolle === 'spartenleitung' || $anlegen ? 1 : 0, (int)$sp['id'], $konto]);
        $this->cacheLeeren();
        return $this->sparte(new Anfrage('GET', 'sparte', ['id' => (string)$sp['id']], null, $a->token, $a->ip));
    }

    private function nichtLetzteLeitung(int $sparte, int $konto): void
    {
        $andere = $this->db->eine("SELECT konto_id FROM mitglieder WHERE sparte_id = ? AND rolle = 'spartenleitung' AND konto_id <> ? LIMIT 1", [$sparte, $konto]);
        if ($andere === null) {
            throw new ApiFehler('konflikt', 'Die Sparte braucht mindestens eine Spartenleitung. Lade zuerst eine weitere Person als Spartenleitung ein.');
        }
    }

    /** POST mitglied.entfernen { sparte, konto } – Spartenleitung oder das Mitglied selbst (Austritt) */
    public function mitgliedEntfernen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $konto = $a->rumpf['konto'] ?? null;
        if (!is_int($konto)) {
            throw new ApiFehler('ungueltig', 'Feld „konto“ fehlt.');
        }
        $selbst = $konto === (int)$s['konto_id'];
        $sp = $this->sparteFuer($s, $a->rumpf['sparte'] ?? null, $selbst ? 'mitglied' : 'leitung');
        $m = $this->mitglied($konto, (int)$sp['id']);
        if ($m === null) {
            throw new ApiFehler('nicht_gefunden', 'Mitglied nicht gefunden.');
        }
        if ($m['rolle'] === 'spartenleitung') {
            $this->nichtLetzteLeitung((int)$sp['id'], $konto);
        }
        $turniere = array_map(static fn(array $z): string => (string)$z['id'], $this->db->alle('SELECT id FROM turniere WHERE sparte_id = ?', [(int)$sp['id']]));
        $this->api->kontoKennungenSperren($konto, $turniere);
        $this->db->ausfuehren("DELETE FROM einladungen WHERE von_konto = ? AND sparte_id = ? AND art <> 'ausschuss'", [$konto, (int)$sp['id']]);
        $this->db->ausfuehren('DELETE FROM mitglieder WHERE sparte_id = ? AND konto_id = ?', [(int)$sp['id'], $konto]);
        $this->db->ausfuehren('DELETE FROM turnier_zugaenge WHERE konto_id = ? AND turnier_id IN (SELECT id FROM turniere WHERE sparte_id = ?)', [$konto, (int)$sp['id']]);
        // Sitzungen des Kontos für Turniere dieser Sparte enden (Konto-Token ohne Turnier bleiben gültig)
        $this->db->ausfuehren('DELETE FROM sitzungen WHERE konto_id = ? AND turnier_id IN (SELECT id FROM turniere WHERE sparte_id = ?)', [$konto, (int)$sp['id']]);
        $neu = $this->db->eine("SELECT konto_id FROM mitglieder WHERE sparte_id = ? AND rolle = 'spartenleitung' ORDER BY angelegt LIMIT 1", [(int)$sp['id']]);
        if ($neu !== null) {
            $this->db->ausfuehren('UPDATE turniere SET konto_id = ? WHERE konto_id = ? AND sparte_id = ?', [(int)$neu['konto_id'], $konto, (int)$sp['id']]);
        }
        $this->cacheLeeren();
        return $selbst ? ['ok' => true] + $this->fuerKonto($konto)
            : $this->sparte(new Anfrage('GET', 'sparte', ['id' => (string)$sp['id']], null, $a->token, $a->ip));
    }

    /** GET turnier.konten&id= – Konten mit Zugang zum Turnier (Leitung per Konto) */
    public function turnierKonten(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $t = $this->api->turnierLaden((string)($a->query['id'] ?? ''));
        if (!$this->kontoLeitet($s, $t)) {
            throw new ApiFehler('keine_berechtigung', 'Nur für die Turnierleitung mit Konto.');
        }
        return $this->turnierKontenListe($t);
    }

    private function turnierKontenListe(array $t): array
    {
        $konten = array_map(static fn(array $z): array => ['konto' => (int)$z['konto_id'], 'name' => (string)$z['name']], $this->db->alle(
            'SELECT z.konto_id, k.name FROM turnier_zugaenge z JOIN konten k ON k.id = z.konto_id WHERE z.turnier_id = ? ORDER BY k.name',
            [$t['id']]
        ));
        $einladungen = array_map([self::class, 'einladungAusgabe'], $this->db->alle(
            "SELECT * FROM einladungen WHERE art = 'turnier' AND ziel = ? AND ablauf >= ? ORDER BY angelegt DESC",
            [$t['id'], $this->api->jetzt()]
        ));
        return ['konten' => $konten, 'einladungen' => $einladungen];
    }

    /** POST turnier.konto.entfernen { turnier, konto } – Leitung per Konto */
    public function turnierKontoEntfernen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $t = $this->api->turnierLaden((string)($a->rumpf['turnier'] ?? ''));
        if (!$this->kontoLeitet($s, $t)) {
            throw new ApiFehler('keine_berechtigung', 'Nur für die Turnierleitung mit Konto.');
        }
        $konto = $a->rumpf['konto'] ?? null;
        if (!is_int($konto)) {
            throw new ApiFehler('ungueltig', 'Feld „konto“ fehlt.');
        }
        if ($this->db->eine('SELECT konto_id FROM turnier_zugaenge WHERE turnier_id = ? AND konto_id = ?', [$t['id'], $konto]) === null) {
            return $this->turnierKontenListe($t);
        }
        $this->db->ausfuehren('DELETE FROM turnier_zugaenge WHERE turnier_id = ? AND konto_id = ?', [$t['id'], $konto]);
        $this->db->ausfuehren('DELETE FROM sitzungen WHERE konto_id = ? AND turnier_id = ?', [$konto, $t['id']]);
        // Spartenleitung behält die Leitung ohnehin; sonst auch die beim Anlegen erzeugte Kennung sperren
        if ($t['sparte_id'] === null || ($this->mitglied($konto, (int)$t['sparte_id'])['rolle'] ?? '') !== 'spartenleitung') {
            $this->api->kontoKennungenSperren($konto, [(string)$t['id']]);
        }
        $this->cacheLeeren();
        return $this->turnierKontenListe($t);
    }

    /* ---------------- Einladungen ---------------- */

    private function neueId(): string
    {
        $id = '';
        for ($j = 0; $j < 12; $j++) {
            $id .= self::ID_ZEICHEN[random_int(0, strlen(self::ID_ZEICHEN) - 1)];
        }
        return $id;
    }

    /**
     * Einladung anlegen und mailen. Antwort enthält den Link, damit die Einladung auch ohne Mailversand
     * weitergegeben werden kann (er gilt nur für die eingeladene E-Mail-Adresse).
     */
    private function einladen(array $s, array $sp, string $art, ?string $ziel, string $rolle, bool $anlegen, string $email, string $name, string $was): array
    {
        $konto = (int)$s['konto_id'];
        $this->api->begrenzen('einladung|' . $konto, 30, 3600, 'Zu viele Einladungen in kurzer Zeit. Bitte später erneut versuchen.');
        // Eigenes Tageskontingent für Ausschüsse (sonst verbrauchen Ausschussmitglieder das der Spartenleitung);
        // neue, nicht freigegebene Sparten (jünger als 7 Tage) nur wenige Einladungen am Tag (gegen Mail-Missbrauch)
        $frei = $this->api->anmeldungFreigabe(['sparte_id' => (int)$sp['id'], 'konto_id' => $konto])['erlaubt'];
        $this->api->begrenzen(($art === 'ausschuss' ? 'einladung-ausschuss-sparte|' : 'einladung-sparte|') . $sp['id'], $frei ? 60 : 10, 86400,
            $frei ? 'Heute wurden für diese Sparte schon sehr viele Einladungen verschickt.'
                : 'Neue Sparten können in den ersten 7 Tagen höchstens 10 Einladungen am Tag verschicken. Der Administrator kann die Sparte früher freischalten.');
        $jetzt = $this->api->jetzt();
        // Gleiche Einladung nochmals: alte ersetzen
        $this->db->ausfuehren('DELETE FROM einladungen WHERE sparte_id = ? AND art = ? AND email = ? AND ' . ($ziel === null ? 'ziel IS NULL' : 'ziel = ?'),
            $ziel === null ? [(int)$sp['id'], $art, $email] : [(int)$sp['id'], $art, $email, $ziel]);
        $offen = (int)($this->db->eine('SELECT COUNT(*) AS n FROM einladungen WHERE sparte_id = ? AND ablauf >= ?', [(int)$sp['id'], $jetzt])['n'] ?? 0);
        if ($offen >= 200) {
            throw new ApiFehler('zu_gross', 'Es sind schon sehr viele Einladungen offen. Bitte alte zurückziehen.');
        }
        $schluessel = bin2hex(random_bytes(32));
        $id = $this->neueId();
        $this->db->ausfuehren(
            'INSERT INTO einladungen (id, schluessel_hash, art, sparte_id, ziel, rolle, anlegen, email, name, von_konto, angelegt, ablauf) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, hash('sha256', $schluessel), $art, (int)$sp['id'], $ziel, $rolle, $anlegen ? 1 : 0, $email, $name, $konto, $jetzt, $jetzt + self::EINLADUNG_DAUER]
        );
        $link = $this->api->appUrl() . '#/einladung/' . $schluessel;
        $von = (string)($this->db->eine('SELECT name FROM konten WHERE id = ?', [$konto])['name'] ?? '');
        $gesendet = false;
        if ($this->api->mailBereit()) {
            // Ohne frei eingegebenen Namen der eingeladenen Person (die Mail geht an eine fremde Adresse)
            $gesendet = $this->api->mail($email, 'Einladung zur Turnier-App', "Hallo,\n\n"
                . "{$von} lädt dich ein: {$was} ({$sp['verein']} – {$sp['name']}).\n\n"
                . "Über diesen Link nimmst du die Einladung an. Hast du noch kein Konto, legst du dort eines an –\n"
                . "bitte mit dieser E-Mail-Adresse ({$email}):\n\n{$link}\n\n"
                . "Der Link gilt 14 Tage und nur einmal. Kennst du die Person nicht? Dann ignoriere diese Mail.");
        }
        // Den Link bekommt die einladende Person nur, wenn keine Mail verschickt wurde (sonst könnte sie selbst
        // ein Konto auf die fremde Adresse anlegen)
        return ['einladung' => self::einladungAusgabe($this->db->eine('SELECT * FROM einladungen WHERE id = ?', [$id])), 'link' => $gesendet ? '' : $link, 'gesendet' => $gesendet];
    }

    private function einladungsFelder(Anfrage $a): array
    {
        return [$this->api->email($a), $this->api->text($a, 'name', 2, 120)];
    }

    /**
     * POST sparte.einladen { sparte, email, name, rolle, anlegen?, turnier? }
     * - Rolle spartenleitung/turnierleitung für die ganze Sparte: nur Spartenleitung
     * - mit turnier: Turnierleitung für dieses Turnier (Spartenleitung oder Leitung des Turniers per Konto)
     */
    public function einladenSparte(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        [$email, $name] = $this->einladungsFelder($a);
        $turnier = $a->rumpf['turnier'] ?? null;
        if ($turnier !== null) {
            $t = $this->api->turnierLaden((string)$turnier);
            if (!$this->kontoLeitet($s, $t) || $t['sparte_id'] === null) {
                throw new ApiFehler('keine_berechtigung', 'Konten einladen darf nur die Turnierleitung mit Konto.');
            }
            // Die Einladung macht zum Mitglied der Sparte (mit Spielerpool): nur Spartenleitung oder Turnierleitungen,
            // denen die Spartenleitung das Recht „Turniere anlegen“ gegeben hat
            $m = $this->mitglied((int)$s['konto_id'], (int)$t['sparte_id']);
            if (!$this->istSpartenleitung($s, (int)$t['sparte_id']) && (int)($m['anlegen'] ?? 0) !== 1) {
                throw new ApiFehler('keine_berechtigung', 'Konten zu einem Turnier einladen dürfen die Spartenleitung und Turnierleitungen mit dem Recht „Turniere anlegen“.');
            }
            $sp = $this->sparteLaden((int)$t['sparte_id']);
            $antwort = $this->einladen($s, $sp, 'turnier', (string)$t['id'], 'turnierleitung', false, $email, $name, "Turnierleitung „{$t['name']}“");
            return $antwort + $this->turnierKontenListe($t);
        }
        $sp = $this->sparteFuer($s, $a->rumpf['sparte'] ?? null, 'leitung');
        $rolle = $a->rumpf['rolle'] ?? 'turnierleitung';
        if (!in_array($rolle, self::ROLLEN, true)) {
            throw new ApiFehler('ungueltig', 'Rolle ungültig.');
        }
        $anlegen = ($a->rumpf['anlegen'] ?? false) === true;
        $n = (int)($this->db->eine('SELECT COUNT(*) AS n FROM mitglieder WHERE sparte_id = ?', [(int)$sp['id']])['n'] ?? 0);
        if ($n >= self::MAX_MITGLIEDER) {
            throw new ApiFehler('zu_gross', 'Höchstens ' . self::MAX_MITGLIEDER . ' Mitglieder je Sparte.');
        }
        $was = $rolle === 'spartenleitung' ? 'Spartenleitung' : ('Turnierleitung' . ($anlegen ? ' (darf Turniere anlegen)' : ''));
        return $this->einladen($s, $sp, 'sparte', null, $rolle, $anlegen, $email, $name, $was);
    }

    /** POST einladung.zurueckziehen { id } – wer einladen durfte (Spartenleitung bzw. Leitung des Turniers bzw. Ausschussmitglied) */
    public function einladungZurueckziehen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $id = $a->rumpf['id'] ?? null;
        $e = is_string($id) ? $this->db->eine('SELECT * FROM einladungen WHERE id = ?', [$id]) : null;
        if ($e === null) {
            throw new ApiFehler('nicht_gefunden', 'Einladung nicht gefunden.');
        }
        $eigene = (int)$e['von_konto'] === (int)$s['konto_id']
            && ($e['art'] === 'ausschuss' ? $this->ausschussMitglied((int)$e['ziel'], (int)$s['konto_id']) : $this->mitglied((int)$s['konto_id'], (int)$e['sparte_id']) !== null);
        $darf = $this->istSpartenleitung($s, (int)$e['sparte_id']) || $eigene;
        if (!$darf && $e['art'] === 'turnier') {
            $darf = $this->kontoLeitet($s, $this->api->turnierLaden((string)$e['ziel']));
        }
        if (!$darf && $e['art'] === 'ausschuss') {
            $darf = $this->ausschussMitglied((int)$e['ziel'], (int)$s['konto_id']);
        }
        if (!$darf) {
            throw new ApiFehler('keine_berechtigung', 'Diese Einladung darfst du nicht zurückziehen.');
        }
        $this->db->ausfuehren('DELETE FROM einladungen WHERE id = ?', [$id]);
        return ['ok' => true];
    }

    private function einladungZumSchluessel(Anfrage $a): array
    {
        $bremse = 'einladung-link|' . $a->ip;
        $this->api->bremse($bremse);
        $schluessel = $a->rumpf['schluessel'] ?? '';
        $e = is_string($schluessel) && preg_match('/^[a-f0-9]{64}$/', $schluessel)
            ? $this->db->eine('SELECT * FROM einladungen WHERE schluessel_hash = ?', [hash('sha256', $schluessel)])
            : null;
        if ($e === null || (int)$e['ablauf'] < $this->api->jetzt()) {
            $this->api->fehlversuch($bremse);
            throw new ApiFehler('abgelaufen', 'Die Einladung ist abgelaufen, wurde schon angenommen oder zurückgezogen. Bitte um eine neue Einladung.');
        }
        return $e;
    }

    /** Was die Einladung bedeutet – für die Seite #/einladung/<schlüssel> (öffentlich, gebremst) */
    private function einladungBeschreibung(array $e): array
    {
        $sp = $this->sparteLaden((int)$e['sparte_id']);
        $ziel = null;
        if ($e['art'] === 'turnier') {
            $t = $this->db->eine('SELECT name FROM turniere WHERE id = ?', [(string)$e['ziel']]);
            $ziel = $t === null ? null : (string)$t['name'];
        } elseif ($e['art'] === 'ausschuss') {
            $au = $this->db->eine('SELECT name FROM ausschuesse WHERE id = ?', [(int)$e['ziel']]);
            $ziel = $au === null ? null : (string)$au['name'];
        }
        $von = $this->db->eine('SELECT name FROM konten WHERE id = ?', [(int)$e['von_konto']]);
        // E-Mail nur teilweise zeigen (der Link könnte weitergegeben worden sein)
        [$lokal, $domain] = array_pad(explode('@', (string)$e['email'], 2), 2, '');
        return [
            'art' => (string)$e['art'], 'rolle' => (string)$e['rolle'], 'anlegen' => (int)$e['anlegen'] === 1,
            'verein' => (string)$sp['verein'], 'sparte' => (string)$sp['name'], 'ziel' => $ziel,
            'von' => (string)($von['name'] ?? ''), 'name' => (string)$e['name'],
            'email' => mb_substr($lokal, 0, 2) . '…@' . $domain, 'ablauf' => Api::iso((int)$e['ablauf']),
        ];
    }

    /** POST einladung.info { schluessel } – öffentlich */
    public function einladungInfo(Anfrage $a): array
    {
        return ['einladung' => $this->einladungBeschreibung($this->einladungZumSchluessel($a))];
    }

    /** Einladung für ein Konto einlösen (nur mit derselben E-Mail-Adresse) */
    public function einloesen(array $e, int $konto): void
    {
        $k = $this->db->eine('SELECT email FROM konten WHERE id = ?', [$konto]);
        if ($k === null || mb_strtolower((string)$k['email']) !== mb_strtolower((string)$e['email'])) {
            throw new ApiFehler('keine_berechtigung', 'Diese Einladung gilt für eine andere E-Mail-Adresse. Bitte mit der eingeladenen Adresse anmelden oder ein Konto anlegen.');
        }
        $sparte = (int)$e['sparte_id'];
        $jetzt = $this->api->jetzt();
        $m = $this->mitglied($konto, $sparte);
        if ($e['art'] === 'ausschuss') {
            $au = $this->db->eine('SELECT id FROM ausschuesse WHERE id = ?', [(int)$e['ziel']]);
            if ($au === null) {
                throw new ApiFehler('nicht_gefunden', 'Den Ausschuss gibt es nicht mehr.');
            }
            $am = $this->db->eine('SELECT gesperrt FROM ausschuss_mitglieder WHERE ausschuss_id = ? AND konto_id = ?', [(int)$e['ziel'], $konto]);
            if ($am !== null && (int)$am['gesperrt'] === 1) {
                throw new ApiFehler('gesperrt', 'Du bist in diesem Ausschuss gesperrt. Bitte an ein Mitglied des Ausschusses wenden.');
            }
            if ($am === null) {
                $n = (int)($this->db->eine('SELECT COUNT(*) AS n FROM ausschuss_mitglieder WHERE ausschuss_id = ?', [(int)$e['ziel']])['n'] ?? 0);
                if ($n >= self::MAX_AUSSCHUSS_MITGLIEDER) {
                    throw new ApiFehler('zu_gross', 'Der Ausschuss hat schon die Höchstzahl an Mitgliedern.');
                }
                $this->db->ausfuehren('INSERT INTO ausschuss_mitglieder (ausschuss_id, konto_id, gesperrt, angelegt) VALUES (?, ?, 0, ?)', [(int)$e['ziel'], $konto, $jetzt]);
            }
        } else {
            if ($e['art'] === 'turnier' && $this->db->eine('SELECT id FROM turniere WHERE id = ?', [(string)$e['ziel']]) === null) {
                throw new ApiFehler('nicht_gefunden', 'Das Turnier gibt es nicht mehr.');
            }
            $rolle = (string)$e['rolle'];
            $anlegen = (int)$e['anlegen'];
            if ($m === null) {
                $this->db->ausfuehren('INSERT INTO mitglieder (sparte_id, konto_id, rolle, anlegen, angelegt) VALUES (?, ?, ?, ?, ?)',
                    [$sparte, $konto, $rolle, $rolle === 'spartenleitung' ? 1 : $anlegen, $jetzt]);
            } elseif ($m['rolle'] !== 'spartenleitung' && ($rolle === 'spartenleitung' || $anlegen === 1)) {
                // Nur hochstufen, nie zurückstufen
                $this->db->ausfuehren('UPDATE mitglieder SET rolle = ?, anlegen = 1 WHERE sparte_id = ? AND konto_id = ?', [$rolle, $sparte, $konto]);
            }
            if ($e['art'] === 'turnier') {
                $this->db->ausfuehren('DELETE FROM turnier_zugaenge WHERE turnier_id = ? AND konto_id = ?', [(string)$e['ziel'], $konto]);
                $this->db->ausfuehren('INSERT INTO turnier_zugaenge (turnier_id, konto_id, angelegt) VALUES (?, ?, ?)', [(string)$e['ziel'], $konto, $jetzt]);
            }
        }
        $this->db->ausfuehren('DELETE FROM einladungen WHERE id = ?', [$e['id']]);
        $this->cacheLeeren();
    }

    /** Schlüssel aus der Registrierung prüfen (vor dem Anlegen des Kontos) */
    public function einladungFuerRegistrierung(Anfrage $a, string $email): array
    {
        $e = $this->einladungZumSchluessel($a);
        if (mb_strtolower((string)$e['email']) !== mb_strtolower($email)) {
            throw new ApiFehler('ungueltig', 'Bitte mit der E-Mail-Adresse registrieren, an die die Einladung ging.');
        }
        return $e;
    }

    /** POST einladung.annehmen { schluessel } – angemeldetes Konto */
    public function einladungAnnehmen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $e = $this->einladungZumSchluessel($a);
        $this->einloesen($e, (int)$s['konto_id']);
        $ziel = $e['art'] === 'turnier' ? ['turnier' => (string)$e['ziel']] : ($e['art'] === 'ausschuss' ? ['ausschuss' => (int)$e['ziel']] : ['sparte' => (int)$e['sparte_id']]);
        return ['ok' => true, 'art' => (string)$e['art']] + $ziel + $this->fuerKonto((int)$s['konto_id']);
    }

    /* ---------------- Ausschüsse ---------------- */

    private function ausschussLaden(mixed $id): array
    {
        if (is_string($id) && ctype_digit($id)) {
            $id = (int)$id;
        }
        $au = is_int($id) ? $this->db->eine('SELECT * FROM ausschuesse WHERE id = ?', [$id]) : null;
        if ($au === null) {
            throw new ApiFehler('nicht_gefunden', 'Ausschuss nicht gefunden.');
        }
        return $au;
    }

    private function ausschussMitglied(int $ausschuss, int $konto): bool
    {
        return $this->db->eine('SELECT konto_id FROM ausschuss_mitglieder WHERE ausschuss_id = ? AND konto_id = ? AND gesperrt = 0', [$ausschuss, $konto]) !== null;
    }

    /** Mitglied (nicht gesperrt) oder Spartenleitung der Sparte */
    private function ausschussZugang(array $s, array $au): void
    {
        if (!$this->ausschussMitglied((int)$au['id'], (int)$s['konto_id']) && !$this->istSpartenleitung($s, (int)$au['sparte_id'])) {
            throw new ApiFehler('keine_berechtigung', 'Nur für Mitglieder des Ausschusses.');
        }
    }

    /** POST ausschuss.anlegen { sparte, name } – Spartenleitung; sie wird erstes Mitglied */
    public function ausschussAnlegen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $sp = $this->sparteFuer($s, $a->rumpf['sparte'] ?? null, 'leitung');
        $name = $this->api->text($a, 'name', 2, 120);
        $n = (int)($this->db->eine('SELECT COUNT(*) AS n FROM ausschuesse WHERE sparte_id = ?', [(int)$sp['id']])['n'] ?? 0);
        if ($n >= self::MAX_AUSSCHUESSE) {
            throw new ApiFehler('zu_gross', 'Höchstens ' . self::MAX_AUSSCHUESSE . ' Ausschüsse je Sparte.');
        }
        $this->db->ausfuehren('INSERT INTO ausschuesse (sparte_id, name, angelegt) VALUES (?, ?, ?)', [(int)$sp['id'], $name, $this->api->jetzt()]);
        $id = (int)$this->db->pdo->lastInsertId();
        $this->db->ausfuehren('INSERT INTO ausschuss_mitglieder (ausschuss_id, konto_id, gesperrt, angelegt) VALUES (?, ?, 0, ?)', [$id, (int)$s['konto_id'], $this->api->jetzt()]);
        return $this->ausschussAusgabe($s, $this->ausschussLaden($id), 0);
    }

    private function ausschussAusgabe(array $s, array $au, int $ab): array
    {
        $id = (int)$au['id'];
        $mitglieder = array_map(static fn(array $z): array => [
            'konto' => (int)$z['konto_id'], 'name' => (string)$z['name'], 'gesperrt' => (int)$z['gesperrt'] === 1,
            'ich' => (int)$z['konto_id'] === (int)$s['konto_id'],
        ], $this->db->alle(
            'SELECT am.konto_id, am.gesperrt, k.name FROM ausschuss_mitglieder am JOIN konten k ON k.id = am.konto_id WHERE am.ausschuss_id = ? ORDER BY am.gesperrt, k.name',
            [$id]
        ));
        $zeilen = $this->db->alle(
            'SELECT * FROM ausschuss_nachrichten WHERE ausschuss_id = ? AND id > ? ORDER BY id DESC LIMIT ' . self::NACHRICHTEN_AUSGABE,
            [$id, $ab]
        );
        $nachrichten = array_reverse(array_map(static fn(array $z): array => [
            'id' => (int)$z['id'], 'von' => (string)$z['name'], 'text' => (string)$z['text'], 'zeit' => Api::iso((int)$z['zeit']),
            'ich' => $z['konto_id'] !== null && (int)$z['konto_id'] === (int)$s['konto_id'],
        ], $zeilen));
        $leitung = $this->istSpartenleitung($s, (int)$au['sparte_id']);
        $einladungen = array_map(static function (array $z) use ($leitung, $s): array {
            $e = self::einladungAusgabe($z);
            if (!$leitung && (int)$z['von_konto'] !== (int)$s['konto_id']) {
                [$lokal, $domain] = array_pad(explode('@', $e['email'], 2), 2, '');
                $e['email'] = mb_substr($lokal, 0, 2) . '…@' . $domain;
            }
            return $e;
        }, $this->db->alle(
            "SELECT * FROM einladungen WHERE art = 'ausschuss' AND ziel = ? AND ablauf >= ? ORDER BY angelegt DESC",
            [(string)$id, $this->api->jetzt()]
        ));
        $sp = $this->sparteLaden((int)$au['sparte_id']);
        return [
            'ausschuss' => ['id' => $id, 'name' => (string)$au['name'], 'sparte' => (int)$au['sparte_id'], 'sparteName' => (string)$sp['verein'] . ' – ' . (string)$sp['name']],
            'mitglieder' => $mitglieder,
            'nachrichten' => $nachrichten,
            'einladungen' => $einladungen,
            'leitung' => $leitung,
        ];
    }

    /** GET ausschuss&id=[&ab=<nachricht>] */
    public function ausschuss(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $au = $this->ausschussLaden($a->query['id'] ?? null);
        $this->ausschussZugang($s, $au);
        $ab = (string)($a->query['ab'] ?? '0');
        return $this->ausschussAusgabe($s, $au, ctype_digit($ab) ? (int)$ab : 0);
    }

    /** POST ausschuss.einladen { ausschuss, email, name } – Mitglieder und Spartenleitung */
    public function ausschussEinladen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $au = $this->ausschussLaden($a->rumpf['ausschuss'] ?? null);
        $this->ausschussZugang($s, $au);
        [$email, $name] = $this->einladungsFelder($a);
        $this->api->begrenzen('einladung-ausschuss|' . $au['id'], 30, 86400, 'Heute wurden für diesen Ausschuss schon viele Einladungen verschickt.');
        $antwort = $this->einladen($s, $this->sparteLaden((int)$au['sparte_id']), 'ausschuss', (string)$au['id'], 'mitglied', false, $email, $name, "Ausschuss „{$au['name']}“");
        return $antwort + $this->ausschussAusgabe($s, $au, 0);
    }

    /** POST ausschuss.sperren { ausschuss, konto, gesperrt } – Mitglieder und Spartenleitung, nicht sich selbst */
    public function ausschussSperren(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $au = $this->ausschussLaden($a->rumpf['ausschuss'] ?? null);
        $this->ausschussZugang($s, $au);
        $konto = $a->rumpf['konto'] ?? null;
        $gesperrt = $a->rumpf['gesperrt'] ?? null;
        if (!is_int($konto) || !is_bool($gesperrt)) {
            throw new ApiFehler('ungueltig', 'Felder „konto“ und „gesperrt“ erforderlich.');
        }
        if ($konto === (int)$s['konto_id']) {
            throw new ApiFehler('ungueltig', 'Dich selbst kannst du nicht sperren – nutze „Ausschuss verlassen“.');
        }
        if ($this->db->eine('SELECT konto_id FROM ausschuss_mitglieder WHERE ausschuss_id = ? AND konto_id = ?', [(int)$au['id'], $konto]) === null) {
            throw new ApiFehler('nicht_gefunden', 'Mitglied nicht gefunden.');
        }
        if ($gesperrt) {
            $aktive = (int)($this->db->eine('SELECT COUNT(*) AS n FROM ausschuss_mitglieder WHERE ausschuss_id = ? AND gesperrt = 0 AND konto_id <> ?', [(int)$au['id'], $konto])['n'] ?? 0);
            if ($aktive === 0) {
                throw new ApiFehler('konflikt', 'Das letzte Mitglied kann nicht gesperrt werden.');
            }
        }
        $this->db->ausfuehren('UPDATE ausschuss_mitglieder SET gesperrt = ? WHERE ausschuss_id = ? AND konto_id = ?', [$gesperrt ? 1 : 0, (int)$au['id'], $konto]);
        if ($gesperrt) {
            // Offene Einladungen der gesperrten Person in diesem Ausschuss verfallen
            $this->db->ausfuehren("DELETE FROM einladungen WHERE art = 'ausschuss' AND ziel = ? AND von_konto = ?", [(string)$au['id'], $konto]);
        }
        return $this->ausschussAusgabe($s, $au, 0);
    }

    /** POST ausschuss.verlassen { ausschuss } */
    public function ausschussVerlassen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $au = $this->ausschussLaden($a->rumpf['ausschuss'] ?? null);
        $this->db->ausfuehren('DELETE FROM ausschuss_mitglieder WHERE ausschuss_id = ? AND konto_id = ? AND gesperrt = 0', [(int)$au['id'], (int)$s['konto_id']]);
        return ['ok' => true] + $this->fuerKonto((int)$s['konto_id']);
    }

    /** POST ausschuss.nachricht { ausschuss, text } – Mitglieder (nicht gesperrt) und Spartenleitung */
    public function ausschussNachricht(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $au = $this->ausschussLaden($a->rumpf['ausschuss'] ?? null);
        $this->ausschussZugang($s, $au);
        $text = $this->api->text($a, 'text', 1, self::MAX_NACHRICHT, false);
        $this->api->begrenzen('nachricht|' . $s['konto_id'], 60, 3600, 'Zu viele Nachrichten in kurzer Zeit. Bitte etwas warten.');
        $name = (string)($this->db->eine('SELECT name FROM konten WHERE id = ?', [(int)$s['konto_id']])['name'] ?? '');
        $this->db->ausfuehren('INSERT INTO ausschuss_nachrichten (ausschuss_id, konto_id, name, text, zeit) VALUES (?, ?, ?, ?, ?)',
            [(int)$au['id'], (int)$s['konto_id'], $name, $text, $this->api->jetzt()]);
        return $this->ausschussAusgabe($s, $au, 0);
    }

    /** POST ausschuss.loeschen { ausschuss } – Spartenleitung */
    public function ausschussLoeschen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $au = $this->ausschussLaden($a->rumpf['ausschuss'] ?? null);
        if (!$this->istSpartenleitung($s, (int)$au['sparte_id'])) {
            throw new ApiFehler('keine_berechtigung', 'Nur für die Spartenleitung.');
        }
        $this->db->anfangen();
        try {
            $this->ausschussEntfernen((int)$au['id']);
            $this->db->festschreiben();
        } catch (\Throwable $x) {
            $this->db->zurueckrollen();
            throw $x;
        }
        return ['ok' => true];
    }

    /* ---------------- Veranstaltungen (Platzhalter, Ausarbeitung folgt) ---------------- */

    /** POST veranstaltung.anlegen { sparte, name, datum?, ausschuss? } – Spartenleitung */
    public function veranstaltungAnlegen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $sp = $this->sparteFuer($s, $a->rumpf['sparte'] ?? null, 'leitung');
        $name = $this->api->text($a, 'name', 2, 160);
        $datum = $a->rumpf['datum'] ?? null;
        if ($datum !== null && (!is_string($datum) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $datum))) {
            throw new ApiFehler('ungueltig', 'Datum im Format JJJJ-MM-TT angeben.');
        }
        $ausschuss = $a->rumpf['ausschuss'] ?? null;
        if ($ausschuss !== null) {
            $au = $this->ausschussLaden($ausschuss);
            if ((int)$au['sparte_id'] !== (int)$sp['id']) {
                throw new ApiFehler('ungueltig', 'Der Ausschuss gehört zu einer anderen Sparte.');
            }
        }
        $n = (int)($this->db->eine('SELECT COUNT(*) AS n FROM veranstaltungen WHERE sparte_id = ?', [(int)$sp['id']])['n'] ?? 0);
        if ($n >= self::MAX_VERANSTALTUNGEN) {
            throw new ApiFehler('zu_gross', 'Höchstens ' . self::MAX_VERANSTALTUNGEN . ' Veranstaltungen je Sparte.');
        }
        $this->db->ausfuehren('INSERT INTO veranstaltungen (sparte_id, name, datum, ausschuss_id, angelegt) VALUES (?, ?, ?, ?, ?)',
            [(int)$sp['id'], $name, $datum, $ausschuss === null ? null : (int)$ausschuss, $this->api->jetzt()]);
        return $this->sparte(new Anfrage('GET', 'sparte', ['id' => (string)$sp['id']], null, $a->token, $a->ip));
    }

    /** POST veranstaltung.loeschen { sparte, id } – Spartenleitung */
    public function veranstaltungLoeschen(Anfrage $a): array
    {
        $s = $this->api->kontoSitzung($a);
        $sp = $this->sparteFuer($s, $a->rumpf['sparte'] ?? null, 'leitung');
        $id = $a->rumpf['id'] ?? null;
        if (!is_int($id)) {
            throw new ApiFehler('ungueltig', 'Feld „id“ fehlt.');
        }
        $this->db->ausfuehren('DELETE FROM veranstaltungen WHERE id = ? AND sparte_id = ?', [$id, (int)$sp['id']]);
        return $this->sparte(new Anfrage('GET', 'sparte', ['id' => (string)$sp['id']], null, $a->token, $a->ip));
    }

    /* ---------------- Wartung ---------------- */

    public function aufraeumen(): void
    {
        $jetzt = $this->api->jetzt();
        $this->db->ausfuehren('DELETE FROM einladungen WHERE ablauf < ?', [$jetzt]);
        $this->db->ausfuehren('DELETE FROM ausschuss_nachrichten WHERE zeit < ?', [$jetzt - self::NACHRICHTEN_LOESCHEN_NACH]);
    }
}
