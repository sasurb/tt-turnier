# Tischtennis-Turnier

Kostenlose Open-Source-Web-App für Tischtennisturniere auf **Handy und Tablet**: Turniere anlegen,
Spieler auslosen, Ergebnisse eintragen, auf mehreren Geräten gleichzeitig.

**Stand: Etappe 2 – Grundgerüst.** Die App gleicht ein Turnier zwischen mehreren Geräten ab
(online oder nur auf einem Gerät). Spieler, Auslosung und Ergebnisse folgen ab Etappe 3.

- Demo (nur Einzelgerät-Modus): https://sasurb.github.io/tt-turnier/
- Eigene Installation: [docs/strato-einrichtung.md](docs/strato-einrichtung.md) (funktioniert auf jedem PHP-Webspace)

## Betriebsarten

| Betriebsart | Wofür | Technik |
|---|---|---|
| **Online** | mehrere Geräte, Internet vorhanden | PHP 8.1+ und MySQL/MariaDB auf einem Webspace |
| **Lokal** *(Etappe 4)* | Halle ohne Internet | Android-Gerät der Leitung als Zentrale mit eigenem WLAN |
| **Einzelgerät** | ein Gerät, kein Server | nur der Browser (IndexedDB) |

## Aufbau

```
app/          Svelte + TypeScript (Vite): Oberfläche und Turnier-Engine
  src/lib/engine/   Ereignisspeicher, Abgleich, Zustandsberechnung (ohne Oberfläche, getestet)
  src/lib/ui/       Seiten und Bausteine
  src/lib/texte.ts  alle Texte der Oberfläche
server-php/   schlanker Ereignis-Server (PHP 8.1+, PDO MySQL/SQLite)
shared/       Schnittstellen-Vertrag (protokoll.ts), gilt für alle Server
docs/         Schnittstelle, Strato-Einrichtung
scripts/      Paket für den Webspace bauen
```

Grundprinzip: Jede Änderung ist ein **Ereignis**. Geräte speichern Ereignisse sofort lokal und
gleichen sie mit dem Server ab; der Server vergibt nur die Reihenfolge und prüft Zugänge.
Details: [docs/schnittstelle.md](docs/schnittstelle.md).

## Entwicklung

Voraussetzungen: Node.js 22, PHP 8.1+ mit `pdo_sqlite`.

```bash
# App
cd app
npm install
npm run dev          # http://localhost:5173
npm test             # Engine-Tests
npm run check        # Typprüfung

# Server lokal (zweites Terminal, im Repo-Hauptordner)
cp server-php/config.example.php server-php/config.php
#   in config.php die SQLite-Zeile aktivieren
php -S localhost:8080 -t server-php/public
php server-php/tests/ApiTest.php      # Server-Tests
```

Der Vite-Entwicklungsserver leitet `/api` an `localhost:8080` weiter.

Bei jedem Push laufen in GitHub Actions: Typprüfung, Engine-Tests, Server-Tests (SQLite und MySQL,
PHP 8.1 und 8.3) und ein Abgleichtest zweier Geräte gegen einen echten Server.
Pushes auf `main` werden danach automatisch auf den Webspace und auf GitHub Pages veröffentlicht.

## Lizenz

[MIT](LICENSE)
