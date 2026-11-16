# Tischtennis-Turnier

Kostenlose Open-Source-Web-App für Tischtennisturniere auf **Handy und Tablet**: Turniere anlegen,
Spieler auslosen, Ergebnisse eintragen, auf mehreren Geräten gleichzeitig.

**Stand: Etappe 3 – erstes spielbares Turnier.** Spielerpool (im Konto oder auf dem Gerät, CSV-Import),
Konkurrenzen mit Leistungsklassen, Setzung nach TTR oder eigener Liste, Auslosung mit Vereinstrennung,
Spielsysteme *Jeder gegen jeden*, *Gruppen + K.-o.* und *K.-o.* (Freilose und Setzplätze nach DTTB-WO),
Tabellen nach DTTB-Wettspielordnung D 7.5 oder ITTF-Regel 3.7.5, Rückzug nach WO D 7.9.
Spieler tragen mit ihrem persönlichen Code (QR-Zettel) ihre Ergebnisse selbst ein; der Gegner kann
bestätigen oder anfechten, die Leitung entscheidet. Helfer-Codes für Schiedsrichter.
Sicherungsmails enthalten die aktuellen Tabellen als Text.

**Etappe 4 – Android-Zentrale:** In Hallen ohne Internet wird das Android-Handy der Leitung zur
Zentrale: eigenes WLAN, Beitritt per QR-Code, alle anderen Geräte (auch iPad) im Browser. Online
vorbereitete Turniere lassen sich auf die Zentrale holen und danach zurückgeben; Sicherungsmails
gehen raus, sobald die Zentrale Internet hat. Anleitung: [docs/zentrale.md](docs/zentrale.md).

**Etappe 7 – Live-Anzeige, Druck, Export:** Vollbild-Anzeige für Beamer und Fernseher (`#/live/<Kennung>`)
mit Tischen, nächsten Spielen, letzten Ergebnissen, Tabellen und Bäumen im Wechsel; neue Aufrufe groß
eingeblendet und auf Wunsch angesagt (nur Gerätestimmen). Spielaufruf mit Automatik (freie Tische
belegen), Pausenschutz und Verlierer als Schiedsrichter. Druckvorlagen (Spielzettel mit QR-Code zur
Ergebniseingabe, Gruppenblätter mit Kreuztabelle, Turnierbaum, Ergebnisliste, Teilnehmerliste,
Aushang, Urkunden) – als PDF über den Druckdialog. CSV-Export für Tabellenkalkulationen.
Datenschutz: Zuschauer bekommen vom Server keine Jahrgänge, kein Geschlecht und keine Namen von
Eintragenden; auf Wunsch nur die Kurzform der Namen.

- Demo (nur Einzelgerät-Modus): https://sasurb.github.io/tt-turnier/
- Eigene Installation: [docs/strato-einrichtung.md](docs/strato-einrichtung.md) (funktioniert auf jedem PHP-Webspace)

## Betriebsarten

| Betriebsart | Wofür | Technik |
|---|---|---|
| **Online** | mehrere Geräte, Internet vorhanden | PHP 8.1+ und MySQL/MariaDB auf einem Webspace |
| **Zentrale** | Halle ohne Internet | Android-App der Leitung als lokaler Server mit eigenem WLAN ([Download](https://github.com/Sasurb/tt-turnier/releases/download/zentrale/tt-zentrale.apk)) |
| **Einzelgerät** | ein Gerät, kein Server | nur der Browser (IndexedDB) |

## Aufbau

```
app/          Svelte + TypeScript (Vite): Oberfläche und Turnier-Engine
  src/lib/engine/   Ereignisspeicher, Abgleich, Zustandsberechnung, Auslosung, Wertung, K.-o.
                    (ohne Oberfläche, mit Vitest getestet: turnierlogik.test.ts)
  src/lib/ui/       Seiten und Bausteine
  src/lib/texte.ts  alle Texte der Oberfläche
server-php/   schlanker Ereignis-Server (PHP 8.1+, PDO MySQL/SQLite)
zentrale/     Android-Zentrale
  kern/             derselbe Server in reinem Java (ohne Bibliotheken), mit JDK getestet: ./pruefen.sh
  android/          Android-Hülle: WebView, Vordergrunddienst, Hotspot (Gradle, gebaut in GitHub Actions)
shared/       Schnittstellen-Vertrag (protokoll.ts), gilt für alle Server
docs/         Schnittstelle, Strato-Einrichtung
e2e/          Oberflächentests mit Playwright (Handy, Tablet, PC) gegen den echten PHP-Server
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
#   für Mails ohne Versand in config.php: 'mail' => ['datei' => __DIR__ . '/mails'], 'app_url' => 'http://localhost:5173/'

# Oberflächentests (startet App + PHP-Server selbst, Screenshots in e2e/bilder/)
cd e2e && npm install && npx playwright install chromium && npx playwright test
```

Der Vite-Entwicklungsserver leitet `/api` an `localhost:8080` weiter.

Bei jedem Push laufen in GitHub Actions: Typprüfung, Engine-Tests, Server-Tests (SQLite und MySQL,
PHP 8.1 und 8.3), ein Abgleichtest zweier Geräte gegen einen echten Server und die Oberflächentests
auf Handy, Tablet und PC (Screenshots als Artefakt des Laufs).
Pushes auf `main` werden danach automatisch auf den Webspace und auf GitHub Pages veröffentlicht.

## Lizenz

[MIT](LICENSE)
