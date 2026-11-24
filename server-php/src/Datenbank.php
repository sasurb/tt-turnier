<?php
declare(strict_types=1);

namespace TtTurnier;

use PDO;

/**
 * Datenbankzugang für MySQL/MariaDB (Webspace) und SQLite (Tests, lokale Entwicklung).
 * Legt die Tabellen beim ersten Zugriff selbst an und hebt das Schema bei
 * neuen Versionen automatisch an.
 */
final class Datenbank
{
    public const SCHEMA_VERSION = 9;

    public readonly PDO $pdo;
    public readonly string $treiber;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->treiber = (string)$this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($this->treiber === 'sqlite') {
            $this->pdo->exec('PRAGMA foreign_keys = ON');
            $this->pdo->exec('PRAGMA journal_mode = WAL');
            $this->pdo->exec('PRAGMA busy_timeout = 5000');
        }
    }

    /**
     * Schreibtransaktion. SQLite: BEGIN IMMEDIATE holt die Schreibsperre sofort; eine
     * aufgeschobene Transaktion, die erst liest und dann schreibt, scheitert bei gleichzeitigen
     * Schreibern sonst sofort mit „database is locked“ (der Busy-Timeout greift dort nicht).
     */
    private int $tiefe = 0;

    public function inTransaktion(): bool
    {
        return $this->tiefe > 0;
    }

    public function anfangen(): void
    {
        $this->tiefe++;
        if ($this->treiber === 'sqlite') {
            $this->pdo->exec('BEGIN IMMEDIATE');
        } else {
            $this->pdo->beginTransaction();
        }
    }

    public function festschreiben(): void
    {
        $this->tiefe = max(0, $this->tiefe - 1);
        if ($this->treiber === 'sqlite') {
            $this->pdo->exec('COMMIT');
        } else {
            $this->pdo->commit();
        }
    }

    public function zurueckrollen(): void
    {
        $this->tiefe = max(0, $this->tiefe - 1);
        if ($this->treiber === 'sqlite') {
            try {
                $this->pdo->exec('ROLLBACK');
            } catch (\PDOException) {
                // keine offene Transaktion
            }
        } else {
            $this->pdo->rollBack();
        }
    }

    /** @param array{dsn:string,user?:string,pass?:string} $cfg */
    public static function verbinden(array $cfg): self
    {
        $pdo = new PDO($cfg['dsn'], $cfg['user'] ?? null, $cfg['pass'] ?? null, [
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        return new self($pdo);
    }

    public function migrieren(): void
    {
        $version = 0;
        try {
            $wert = $this->pdo->query("SELECT wert FROM meta WHERE schluessel = 'schema'")->fetchColumn();
            $version = (int)$wert;
        } catch (\PDOException) {
            $version = 0;
        }
        if ($version >= self::SCHEMA_VERSION) {
            return;
        }
        if ($version < 1) {
            foreach ($this->schemaV1() as $sql) {
                $this->pdo->exec($sql);
            }
            $this->pdo->prepare('INSERT INTO meta (schluessel, wert) VALUES (?, ?)')->execute(['schema', '1']);
        }
        if ($version < 2) {
            foreach ($this->schemaV2() as $sql) {
                try {
                    $this->pdo->exec($sql);
                } catch (\PDOException $e) {
                    // Zwei Aufrufe gleichzeitig direkt nach dem Hochladen: Spalte/Tabelle gibt es schon.
                    if (!preg_match('/duplicate|already exists|exists/i', $e->getMessage())) {
                        throw $e;
                    }
                }
            }
            $this->pdo->prepare('UPDATE meta SET wert = ? WHERE schluessel = ?')->execute(['2', 'schema']);
        }
        if ($version < 3) {
            foreach ($this->schemaV3() as $sql) {
                try {
                    $this->pdo->exec($sql);
                } catch (\PDOException $e) {
                    if (!preg_match('/duplicate|already exists|exists/i', $e->getMessage())) {
                        throw $e;
                    }
                }
            }
            $this->pdo->prepare('UPDATE meta SET wert = ? WHERE schluessel = ?')->execute(['3', 'schema']);
        }
        if ($version < 4) {
            foreach ($this->schemaV4() as $sql) {
                try {
                    $this->pdo->exec($sql);
                } catch (\PDOException $e) {
                    if (!preg_match('/duplicate|already exists|exists/i', $e->getMessage())) {
                        throw $e;
                    }
                }
            }
            $this->pdo->prepare('UPDATE meta SET wert = ? WHERE schluessel = ?')->execute(['4', 'schema']);
        }
        if ($version < 5) {
            foreach ($this->schemaV5() as $sql) {
                try {
                    $this->pdo->exec($sql);
                } catch (\PDOException $e) {
                    if (!preg_match('/duplicate|already exists|exists/i', $e->getMessage())) {
                        throw $e;
                    }
                }
            }
            $this->pdo->prepare('UPDATE meta SET wert = ? WHERE schluessel = ?')->execute(['5', 'schema']);
        }
        if ($version < 6) {
            // Version 6 (Etappe 7): Index für die Abfrage „Namen für Zuschauer“ (turnier.daten je Turnier)
            try {
                $this->pdo->exec('CREATE INDEX idx_ereignisse_art ON ereignisse (turnier_id, art, seq)');
            } catch (\PDOException $e) {
                if (!preg_match('/duplicate|already exists|exists/i', $e->getMessage())) {
                    throw $e;
                }
            }
            $this->pdo->prepare('UPDATE meta SET wert = ? WHERE schluessel = ?')->execute(['6', 'schema']);
        }
        if ($version < 7) {
            foreach ($this->schemaV7() as $sql) {
                try {
                    $this->pdo->exec($sql);
                } catch (\PDOException $e) {
                    if (!preg_match('/duplicate|already exists|exists/i', $e->getMessage())) {
                        throw $e;
                    }
                }
            }
            $this->pdo->prepare('UPDATE meta SET wert = ? WHERE schluessel = ?')->execute(['7', 'schema']);
        }
        if ($version < 8) {
            // Etappe 10: Freigabe der Online-Anmeldung je Konto (NULL = automatisch nach 7 Tagen, 1 = frei, 0 = gesperrt)
            try {
                $this->pdo->exec('ALTER TABLE konten ADD COLUMN anmeldung_frei INTEGER NULL');
            } catch (\PDOException $e) {
                if (!preg_match('/duplicate|already exists|exists/i', $e->getMessage())) {
                    throw $e;
                }
            }
            $this->pdo->prepare('UPDATE meta SET wert = ? WHERE schluessel = ?')->execute(['8', 'schema']);
        }
        if ($version < 9) {
            foreach ($this->schemaV9() as $sql) {
                try {
                    $this->pdo->exec($sql);
                } catch (\PDOException $e) {
                    if (!preg_match('/duplicate|already exists|exists/i', $e->getMessage())) {
                        throw $e;
                    }
                }
            }
            $this->spartenUebernehmen();
            $this->pdo->prepare('UPDATE meta SET wert = ? WHERE schluessel = ?')->execute(['9', 'schema']);
        }
        // Spätere Versionen: if ($version < 10) { … UPDATE meta … }
    }

    /**
     * Version 9 (Paket 0.17): Verein → Sparte → Mitglieder (Spartenleitung, Turnierleitung), Konto-Zugänge je
     * Turnier, Einladungen, Ausschüsse mit Nachrichten, Veranstaltungen (Platzhalter), Spielerpool je Sparte,
     * gesperrte (gelöschte) Turnierkennungen, bestätigte Sicherungsempfänger, Löschfrist je Turnier,
     * angenommene Nutzungsbedingungen je Konto.
     * @return list<string>
     */
    private function schemaV9(): array
    {
        $mysql = $this->treiber === 'mysql';
        $pk = $mysql ? 'BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        $nach = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
        return [
            "CREATE TABLE vereine (
                id $pk,
                name VARCHAR(160) NOT NULL,
                angelegt BIGINT NOT NULL
            )$nach",
            "CREATE TABLE sparten (
                id $pk,
                verein_id BIGINT NOT NULL,
                name VARCHAR(120) NOT NULL,
                sportart VARCHAR(40) NOT NULL,
                daten TEXT NULL,
                angelegt BIGINT NOT NULL,
                anmeldung_frei INTEGER NULL,
                avv BIGINT NULL,
                avv_konto BIGINT NULL,
                loeschung_erinnert BIGINT NULL
            )$nach",
            "CREATE TABLE mitglieder (
                sparte_id BIGINT NOT NULL,
                konto_id BIGINT NOT NULL,
                rolle VARCHAR(20) NOT NULL,
                anlegen INTEGER NOT NULL DEFAULT 0,
                angelegt BIGINT NOT NULL,
                PRIMARY KEY (sparte_id, konto_id)
            )$nach",
            'CREATE INDEX idx_mitglieder_konto ON mitglieder (konto_id)',
            "CREATE TABLE turnier_zugaenge (
                turnier_id VARCHAR(16) NOT NULL,
                konto_id BIGINT NOT NULL,
                angelegt BIGINT NOT NULL,
                PRIMARY KEY (turnier_id, konto_id)
            )$nach",
            'CREATE INDEX idx_zugaenge_konto ON turnier_zugaenge (konto_id)',
            "CREATE TABLE einladungen (
                id VARCHAR(16) NOT NULL PRIMARY KEY,
                schluessel_hash CHAR(64) NOT NULL,
                art VARCHAR(20) NOT NULL,
                sparte_id BIGINT NOT NULL,
                ziel VARCHAR(40) NULL,
                rolle VARCHAR(20) NOT NULL,
                anlegen INTEGER NOT NULL DEFAULT 0,
                email VARCHAR(190) NOT NULL,
                name VARCHAR(120) NOT NULL,
                von_konto BIGINT NOT NULL,
                angelegt BIGINT NOT NULL,
                ablauf BIGINT NOT NULL
            )$nach",
            'CREATE UNIQUE INDEX idx_einladungen_schluessel ON einladungen (schluessel_hash)',
            "CREATE TABLE ausschuesse (
                id $pk,
                sparte_id BIGINT NOT NULL,
                name VARCHAR(120) NOT NULL,
                angelegt BIGINT NOT NULL
            )$nach",
            "CREATE TABLE ausschuss_mitglieder (
                ausschuss_id BIGINT NOT NULL,
                konto_id BIGINT NOT NULL,
                gesperrt INTEGER NOT NULL DEFAULT 0,
                angelegt BIGINT NOT NULL,
                PRIMARY KEY (ausschuss_id, konto_id)
            )$nach",
            "CREATE TABLE ausschuss_nachrichten (
                id $pk,
                ausschuss_id BIGINT NOT NULL,
                konto_id BIGINT NULL,
                name VARCHAR(120) NOT NULL,
                text TEXT NOT NULL,
                zeit BIGINT NOT NULL
            )$nach",
            'CREATE INDEX idx_nachrichten_ausschuss ON ausschuss_nachrichten (ausschuss_id, id)',
            "CREATE TABLE veranstaltungen (
                id $pk,
                sparte_id BIGINT NOT NULL,
                name VARCHAR(160) NOT NULL,
                datum VARCHAR(10) NULL,
                ausschuss_id BIGINT NULL,
                angelegt BIGINT NOT NULL
            )$nach",
            "CREATE TABLE spieler_pool (
                sparte_id BIGINT NOT NULL,
                id VARCHAR(40) NOT NULL,
                daten TEXT NOT NULL,
                geaendert BIGINT NOT NULL,
                PRIMARY KEY (sparte_id, id)
            )$nach",
            "CREATE TABLE kennungen_gesperrt (
                id VARCHAR(16) NOT NULL PRIMARY KEY,
                bis BIGINT NOT NULL
            )$nach",
            "CREATE TABLE sicherung_empfaenger (
                turnier_id VARCHAR(16) NOT NULL,
                email VARCHAR(190) NOT NULL,
                schluessel_hash CHAR(64) NOT NULL,
                angelegt BIGINT NOT NULL,
                bestaetigt BIGINT NULL,
                name VARCHAR(160) NULL,
                PRIMARY KEY (turnier_id, email)
            )$nach",
            'ALTER TABLE turniere ADD COLUMN sparte_id BIGINT NULL',
            'ALTER TABLE turniere ADD COLUMN loeschen_nach INTEGER NOT NULL DEFAULT 12',
            'ALTER TABLE turniere ADD COLUMN loeschung_erinnert BIGINT NULL',
            'CREATE INDEX idx_turniere_sparte ON turniere (sparte_id)',
            'ALTER TABLE konten ADD COLUMN bedingungen VARCHAR(20) NULL',
            // Konto, für das eine Leitungskennung beim Anlegen erzeugt wurde (wird beim Entfernen gesperrt)
            'ALTER TABLE codes ADD COLUMN konto_id BIGINT NULL',
            // Turnierkennungen ohne Groß/klein (ab 0.17 in Großbuchstaben gespeichert; ältere waren Ziffern bzw. a–z)
            'UPDATE turniere SET id = UPPER(id)',
            'UPDATE ereignisse SET turnier_id = UPPER(turnier_id)',
            'UPDATE codes SET turnier_id = UPPER(turnier_id)',
            'UPDATE sitzungen SET turnier_id = UPPER(turnier_id) WHERE turnier_id IS NOT NULL',
            'UPDATE anmeldungen SET turnier_id = UPPER(turnier_id)',
        ];
    }

    /**
     * Bestehende Konten (bis 0.16) werden je zu Verein + Sparte „Tischtennis“ mit ihnen als Spartenleitung;
     * ihre Turniere, ihr Spielerpool und ihre Einstellungen (Klassen, Kasse) gehen an die Sparte.
     * Die Nutzungsbedingungen bestätigen sie beim nächsten Anmelden.
     */
    private function spartenUebernehmen(): void
    {
        try {
            $this->pdo->query('SELECT COUNT(*) FROM pool')->fetchColumn();
            $altPool = true;
        } catch (\PDOException) {
            $altPool = false; // keine alte Pool-Tabelle (neue Installation oder schon übernommen)
        }
        $konten = $this->alle('SELECT * FROM konten WHERE id NOT IN (SELECT konto_id FROM mitglieder)');
        foreach ($konten as $k) {
            $jetzt = (int)($k['angelegt'] ?? time());
            $this->ausfuehren('INSERT INTO vereine (name, angelegt) VALUES (?, ?)', [mb_substr((string)$k['name'], 0, 160), $jetzt]);
            $verein = (int)$this->pdo->lastInsertId();
            $this->ausfuehren(
                'INSERT INTO sparten (verein_id, name, sportart, daten, angelegt, anmeldung_frei) VALUES (?, ?, ?, ?, ?, ?)',
                [$verein, 'Tischtennis', 'tischtennis', $k['daten'] ?? null, $jetzt, $k['anmeldung_frei'] ?? null]
            );
            $sparte = (int)$this->pdo->lastInsertId();
            $this->ausfuehren(
                'INSERT INTO mitglieder (sparte_id, konto_id, rolle, anlegen, angelegt) VALUES (?, ?, ?, 1, ?)',
                [$sparte, (int)$k['id'], 'spartenleitung', $jetzt]
            );
            $this->ausfuehren('UPDATE turniere SET sparte_id = ? WHERE konto_id = ?', [$sparte, (int)$k['id']]);
            if ($altPool) {
                $this->ausfuehren(
                    'INSERT INTO spieler_pool (sparte_id, id, daten, geaendert) SELECT ?, id, daten, geaendert FROM pool WHERE konto_id = ?',
                    [$sparte, (int)$k['id']]
                );
            }
        }
        // Alte Tabelle erst entfernen, wenn alles übernommen ist (Zahl der Einträge gleich)
        if ($altPool) {
            $alt = (int)$this->pdo->query('SELECT COUNT(*) FROM pool')->fetchColumn();
            $neu = (int)$this->pdo->query('SELECT COUNT(*) FROM spieler_pool')->fetchColumn();
            if ($neu >= $alt) {
                $this->pdo->exec('DROP TABLE pool');
            }
        }
    }

    /**
     * Version 7 (Etappe 9): Aufgaben für Helferkennungen (Sprecher, Kasse, Oberschiedsrichter),
     * Online-Anmeldung mit Warteliste (Einstellungen je Turnier, Tabelle anmeldungen).
     * @return list<string>
     */
    private function schemaV7(): array
    {
        $mysql = $this->treiber === 'mysql';
        $nach = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
        return [
            'ALTER TABLE codes ADD COLUMN aufgaben VARCHAR(80) NULL',
            'ALTER TABLE ereignisse ADD COLUMN autor_aufgaben VARCHAR(80) NULL',
            'ALTER TABLE turniere ADD COLUMN anmeldung TEXT NULL',
            "CREATE TABLE anmeldungen (
                turnier_id VARCHAR(16) NOT NULL,
                id VARCHAR(16) NOT NULL,
                email VARCHAR(190) NOT NULL,
                daten TEXT NOT NULL,
                schluessel_hash CHAR(64) NOT NULL,
                angelegt BIGINT NOT NULL,
                bestaetigt BIGINT NULL,
                spieler VARCHAR(16) NULL,
                PRIMARY KEY (turnier_id, id)
            )$nach",
            'CREATE INDEX idx_anmeldungen_schluessel ON anmeldungen (schluessel_hash)',
        ];
    }

    /**
     * Version 5 (Paket 4b): 8-stellige Kennungen, Leitungskennungen je Person (Tabelle codes, Rolle „leitung“),
     * Helfer-Recht an Spielerkennungen, Einstellungen je Konto (Leistungsklassen).
     * Alte 6-stellige Codes und Anmeldungen damit werden gelöscht (Testphase); die App erzeugt neue.
     * @return list<string>
     */
    private function schemaV5(): array
    {
        return [
            'ALTER TABLE codes ADD COLUMN helfer INTEGER NOT NULL DEFAULT 0',
            'ALTER TABLE sitzungen ADD COLUMN helfer INTEGER NOT NULL DEFAULT 0',
            'ALTER TABLE ereignisse ADD COLUMN autor_helfer INTEGER NOT NULL DEFAULT 0',
            'ALTER TABLE konten ADD COLUMN daten TEXT NULL',
            'DELETE FROM codes',
            'DELETE FROM sitzungen WHERE konto_id IS NULL',
            $this->treiber === 'sqlite' ? 'DROP INDEX IF EXISTS idx_codes_code' : 'DROP INDEX idx_codes_code ON codes',
            'CREATE UNIQUE INDEX idx_codes_code ON codes (turnier_id, code)',
            'UPDATE turniere SET leitung_code = NULL',
        ];
    }

    /**
     * Version 4 (Etappe 4): Turnier liegt auf einer Android-Zentrale (gesperrt für Einträge online).
     * @return list<string>
     */
    private function schemaV4(): array
    {
        return [
            'ALTER TABLE turniere ADD COLUMN zentrale VARCHAR(160) NULL',
            'ALTER TABLE turniere ADD COLUMN zentrale_id VARCHAR(40) NULL',
            'ALTER TABLE turniere ADD COLUMN zentrale_seit BIGINT NULL',
        ];
    }

    /** @return list<string> */
    private function schemaV1(): array
    {
        $mysql = $this->treiber === 'mysql';
        $pk = $mysql ? 'BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        $langtext = $mysql ? 'MEDIUMTEXT' : 'TEXT';
        $nach = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';

        return [
            "CREATE TABLE meta (
                schluessel VARCHAR(64) NOT NULL PRIMARY KEY,
                wert VARCHAR(255) NOT NULL
            )$nach",
            "CREATE TABLE konten (
                id $pk,
                name VARCHAR(120) NOT NULL,
                email VARCHAR(190) NOT NULL UNIQUE,
                passwort_hash VARCHAR(255) NOT NULL,
                rolle VARCHAR(20) NOT NULL,
                gesperrt INTEGER NOT NULL DEFAULT 0,
                angelegt BIGINT NOT NULL,
                letzte_anmeldung BIGINT NULL
            )$nach",
            "CREATE TABLE turniere (
                id VARCHAR(16) NOT NULL PRIMARY KEY,
                konto_id BIGINT NOT NULL,
                name VARCHAR(160) NOT NULL,
                datum VARCHAR(10) NULL,
                leitung_hash VARCHAR(255) NOT NULL,
                angelegt BIGINT NOT NULL
            )$nach",
            "CREATE TABLE sitzungen (
                token_hash CHAR(64) NOT NULL PRIMARY KEY,
                konto_id BIGINT NULL,
                turnier_id VARCHAR(16) NULL,
                rolle VARCHAR(20) NOT NULL,
                name VARCHAR(120) NOT NULL,
                ablauf BIGINT NOT NULL
            )$nach",
            "CREATE TABLE ereignisse (
                seq $pk,
                turnier_id VARCHAR(16) NOT NULL,
                event_id VARCHAR(64) NOT NULL,
                art VARCHAR(64) NOT NULL,
                daten $langtext NOT NULL,
                zeit VARCHAR(40) NOT NULL,
                geraet VARCHAR(64) NOT NULL,
                autor_rolle VARCHAR(20) NOT NULL,
                autor_name VARCHAR(120) NOT NULL,
                empfangen BIGINT NOT NULL,
                UNIQUE (turnier_id, event_id)
            )$nach",
            'CREATE INDEX idx_ereignisse_turnier ON ereignisse (turnier_id, seq)',
            "CREATE TABLE versuche (
                id $pk,
                schluessel VARCHAR(190) NOT NULL,
                zeit BIGINT NOT NULL
            )$nach",
            'CREATE INDEX idx_versuche ON versuche (schluessel, zeit)',
        ];
    }

    /**
     * Version 2 (Etappe 2b): Selbst-Registrierung, Passwort zurücksetzen, Leitungscode,
     * Sicherung per Mail, Löschung inaktiver Konten.
     * @return list<string>
     */
    private function schemaV2(): array
    {
        $mysql = $this->treiber === 'mysql';
        $nach = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
        return [
            'ALTER TABLE konten ADD COLUMN aktiv BIGINT NULL',
            'ALTER TABLE konten ADD COLUMN erinnert BIGINT NULL',
            'UPDATE konten SET aktiv = COALESCE(letzte_anmeldung, angelegt)',
            'ALTER TABLE turniere ADD COLUMN leitung_code VARCHAR(12) NULL',
            'ALTER TABLE turniere ADD COLUMN sicherung_an VARCHAR(600) NULL',
            'ALTER TABLE turniere ADD COLUMN sicherung_takt INTEGER NOT NULL DEFAULT 30',
            'ALTER TABLE turniere ADD COLUMN sicherung_letzte BIGINT NULL',
            'ALTER TABLE turniere ADD COLUMN sicherung_seq BIGINT NOT NULL DEFAULT 0',
            'CREATE INDEX idx_turniere_konto ON turniere (konto_id)',
            "CREATE TABLE rueckstellungen (
                schluessel_hash CHAR(64) NOT NULL PRIMARY KEY,
                konto_id BIGINT NOT NULL,
                ablauf BIGINT NOT NULL
            )$nach",
        ];
    }

    /**
     * Version 3 (Etappe 3): Spieler- und Helfer-Codes, Spielerpool je Konto,
     * lesbare Übersicht für die Sicherungsmail.
     * @return list<string>
     */
    private function schemaV3(): array
    {
        $mysql = $this->treiber === 'mysql';
        $langtext = $mysql ? 'MEDIUMTEXT' : 'TEXT';
        $nach = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
        return [
            'ALTER TABLE sitzungen ADD COLUMN bezug VARCHAR(64) NULL',
            'ALTER TABLE ereignisse ADD COLUMN autor_bezug VARCHAR(64) NULL',
            "ALTER TABLE turniere ADD COLUMN uebersicht $langtext NULL",
            'ALTER TABLE turniere ADD COLUMN uebersicht_zeit BIGINT NULL',
            "CREATE TABLE codes (
                turnier_id VARCHAR(16) NOT NULL,
                rolle VARCHAR(20) NOT NULL,
                bezug VARCHAR(64) NOT NULL,
                name VARCHAR(160) NOT NULL,
                code VARCHAR(12) NOT NULL,
                gesperrt INTEGER NOT NULL DEFAULT 0,
                angelegt BIGINT NOT NULL,
                PRIMARY KEY (turnier_id, rolle, bezug)
            )$nach",
            'CREATE UNIQUE INDEX idx_codes_code ON codes (turnier_id, code)',
            "CREATE TABLE pool (
                konto_id BIGINT NOT NULL,
                id VARCHAR(40) NOT NULL,
                daten TEXT NOT NULL,
                geaendert BIGINT NOT NULL,
                PRIMARY KEY (konto_id, id)
            )$nach",
        ];
    }

    /** @param list<mixed> $params */
    public function eine(string $sql, array $params = []): ?array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        $zeile = $st->fetch();
        return $zeile === false ? null : $zeile;
    }

    /** @param list<mixed> $params */
    public function alle(string $sql, array $params = []): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    /** @param list<mixed> $params */
    public function ausfuehren(string $sql, array $params = []): int
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    public static function istEindeutigkeitsFehler(\PDOException $e): bool
    {
        $code = (string)$e->getCode();
        // MySQL: 23000 / 1062, SQLite: 23000 bzw. "UNIQUE constraint failed"
        return $code === '23000' || str_contains($e->getMessage(), 'UNIQUE') || str_contains($e->getMessage(), 'Duplicate');
    }
}
