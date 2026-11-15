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
    public const SCHEMA_VERSION = 5;

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
        // Spätere Versionen: if ($version < 6) { … UPDATE meta … }
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
