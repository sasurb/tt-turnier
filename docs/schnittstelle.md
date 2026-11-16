# Schnittstelle (Protokoll 1)

Verbindlich für beide Server: den PHP-Server (`server-php/`) und die Android-Zentrale (`zentrale/kern/`).
Die Typen stehen in [`shared/protokoll.ts`](../shared/protokoll.ts).

## Grundsätze

- **Ereignisse statt Zustände.** Die App speichert jede Änderung als Ereignis („Ergebnis eingetragen“).
  Der Server versteht den Inhalt nicht, er ordnet und verteilt nur. Turnierlogik läuft auf den Geräten.
- **Laufnummer (`seq`).** Der Server vergibt sie beim Speichern: streng steigend je Turnier, nicht lückenlos.
  Geräte holen „alles ab Laufnummer N“ ab. Laufnummern werden in der Reihenfolge ihrer Vergabe sichtbar
  (MySQL: Zeilensperre je Turnier beim Schreiben).
- **Doppelsendungen sind harmlos.** Jedes Ereignis trägt eine vom Gerät erzeugte UUID. Wird es erneut
  gesendet (z. B. nach Verbindungsabbruch), antwortet der Server mit der bereits vergebenen Laufnummer.
- **Autor setzt der Server** anhand der Anmeldung (Rolle und Name), nie das Gerät.
- **Offline zuerst.** Geräte speichern Einträge sofort lokal (IndexedDB) und senden sie, sobald eine Verbindung besteht.

## Aufruf

```
<basis>/index.php?r=<route>[&weitere=parameter]
```

- Rumpf bei POST: JSON-Objekt.
- Anmeldung: Kopfzeile `X-TT-Token: <token>` (alternativ `Authorization: Bearer <token>`).
- Fehler: HTTP-Status ≥ 400 und `{ "fehler": "<code>", "meldung": "<Text für Menschen>" }`.
  Codes: `ungueltig` 400, `nicht_angemeldet` / `falsche_zugangsdaten` 401, `gesperrt` / `keine_berechtigung` 403,
  `nicht_gefunden` 404, `konflikt` 409, `zu_viele_versuche` 429, `serverfehler` 500, `nicht_eingerichtet` 503.

## Routen

| Methode | Route | Zugang | Zweck |
|---|---|---|---|
| GET | `info` | offen | App-Kennung, Protokoll, Version, `eingerichtet`, `registrierung`, `mail`, `codes` (ab 0.4) |
| POST | `setup` | Einrichtungscode | Administrator anlegen (nur solange keiner existiert) |
| POST | `login` | offen | `{email, passwort}` → `{token, konto}` |
| POST | `logout` | Token | Token ungültig machen |
| GET | `ich` | Token | Rolle, Name, ggf. Konto bzw. `spieler` (Spieler-ID) |
| POST | `passwort.aendern` | Konto | `{alt, neu}`; beendet andere Sitzungen |
| POST | `registrieren` | offen | `{name, email, passwort, website}` → `{token, konto}`; `website` ist ein Fangfeld und muss leer sein |
| POST | `passwort.vergessen` | offen | `{email}` → immer `{ok}`; bei bekanntem Konto Mail mit Link `…#/zuruecksetzen/<schlüssel>` |
| POST | `passwort.zuruecksetzen` | Schlüssel | `{schluessel, neu}` → `{token, konto}`; Link gilt 1 Stunde, einmalig; beendet alle Sitzungen |
| POST | `konto.loeschen` | Konto | `{passwort}`; löscht Konto, Turniere, Ereignisse, Sitzungen (nicht Admin) |
| POST | `rueckmeldung` | offen | `{art, text, name?, email?, website}` → Mail an den Betreiber; ohne Anmeldung sind `name`/`email` Pflicht |
| GET | `konten` | Admin | alle Konten mit letzter Anmeldung und Turnierzahl |
| POST | `konto.anlegen` | Admin | Turnierleitungs-Konto anlegen `{name, email, passwort}` (Rolle technisch `veranstalter`) |
| POST | `konto.sperren` | Admin | `{id, gesperrt}`; Sperre beendet alle Sitzungen des Kontos |
| GET | `turniere` | Konto | eigene Turniere; Admin mit `&alle=1` alle |
| POST | `turnier.anlegen` | Konto | `{name, datum, sicherungAn?}` → `{turnier, token, leitung}`; `turnier.id` ist die 8-stellige Turnierkennung, `leitung` die erste Leitungskennung (auf den Kontonamen) |
| GET | `turnier&id=…` | offen | Name, Datum, Turnierleitung (`veranstalter`); mit Token zusätzlich `rechte` (`leitung`/`helfer`/`spieler`/null) und `spieler` |
| POST | `turnier.zugang` | offen | `{turnier, code}` → `{token, rolle, name, spieler?, helfer?}`. `code` ist eine Leitungs-, Helfer- oder Spielerkennung (8 Ziffern); der Name steht an der Kennung |
| GET | `codes&turnier=…` | Leitung | `{codes: [{rolle, bezug, name, code, gesperrt, helfer?}]}` – Rollen `leitung`, `helfer`, `spieler` |
| POST | `codes.anlegen` | Leitung | `{turnier, eintraege: [{rolle, bezug, name}]}` – fehlende Kennungen erzeugen, Namen nachziehen; vorhandene bleiben |
| POST | `code.neu` | Leitung | `{turnier, rolle, bezug}` → neue Kennung; Anmeldungen mit der alten enden |
| POST | `code.sperren` | Leitung | `{turnier, rolle, bezug, gesperrt}`; Sperre beendet Anmeldungen. Die letzte gültige Leitungskennung lässt sich nicht sperren |
| POST | `code.entfernen` | Leitung | `{turnier, rolle, bezug}` (z. B. Helfer streichen; die letzte Leitungskennung bleibt) |
| POST | `code.helfer` | Leitung | `{turnier, bezug, helfer}` – Spielerkennung zusätzlich mit Helferrecht (eine Kennung, beide Rechte) |
| POST | `turnier.loeschen` | Eigentümer-Konto/Admin | `{turnier, passwort}` – löscht Turnier, Ereignisse, Kennungen, Sitzungen endgültig (DSGVO-Speicherbegrenzung) |
| GET | `konto.einstellungen` | Konto | `{klassen}` – Begriffe für Leistungsklassen |
| POST | `konto.einstellungen` | Konto | `{klassen?}` (max. 40 Begriffe) |
| GET | `pool` | Konto | Spielerpool des eigenen Kontos |
| POST | `pool.speichern` | Konto | `{spieler: [...]}` (max. 500 je Aufruf, 3000 je Konto) – anlegen/ändern je `id` |
| POST | `pool.loeschen` | Konto | `{ids: [...]}` |
| POST | `turnier.uebersicht` | Leitung | `{turnier, text}` (max. 60 000 Zeichen) – lesbarer Stand, den die App erzeugt; steht in der Sicherungsmail |
| GET | `turnier.einstellungen&id=…` | Leitung | `{sicherungAn, sicherungTakt, letzteSicherung, mail}` |
| POST | `turnier.einstellungen` | Leitung | `{turnier, sicherungAn?, sicherungTakt?}` – nur übergebene Felder |
| POST | `turnier.sichern` | Leitung | `{turnier}` → Sicherung sofort an alle Empfänger |
| GET | `events&turnier=…&ab=N` | offen (Token optional) | bis zu 200 Ereignisse mit `seq > N`, `mehr` wenn weitere vorliegen; `sicht` (ab 0.9, siehe „Datenschutz beim Abholen“) |
| POST | `events&turnier=…` | Schreibrecht | `{ereignisse: [...]}` (max. 200) → `{angenommen: [{id, seq}], hoechsteSeq}` |

**Leitung** (Einstellungen, Sicherung) bedeutet: Token mit Rolle `leitung` für dieses Turnier, das
Eigentümer-Konto oder der Administrator.

**Schreibrecht für ein Turnier** haben Tokens mit Rolle `leitung`, `helfer` oder `spieler` für dieses
Turnier sowie das Konto (Turnierleitung), dem das Turnier gehört. Ab Server 0.4 dürfen Spieler nur
`spiel.ergebnis`, `spiel.bestaetigt` und `spiel.angefochten` senden, Helfer `spiel.ergebnis`,
`spiel.aufgerufen` und `spiel.aufruf_zurueck` (ab 0.7); Spieler mit Helferrecht beide Listen
(`ARTEN_SPIELER`/`ARTEN_HELFER` in `shared/protokoll.ts`); alles andere lehnt der Server mit 403 ab.
`tisch.gesperrt` und `paar.gemeldet` darf nur die Leitung senden.
Bei Spielern setzt der Server `autor.spieler` (Spieler-ID aus dem Code). Ob ein Spieler zu einem Spiel
gehört, prüft die Turnier-Logik auf den Geräten – der Server kennt keine Spiele.

## Ereignis

```json
{
  "id": "6f1c…-UUID",
  "art": "test.notiz",
  "daten": { "text": "Tisch 3 frei" },
  "zeit": "2026-11-13T09:24:49.123Z",
  "geraet": "g-1b2c…",
  "seq": 17,
  "empfangen": "2026-11-13T09:24:50Z",
  "autor": { "rolle": "leitung", "name": "Helferin Jana" }
}
```

Grenzen: `id` 8–64 Zeichen `[A-Za-z0-9-]`, `art` `[a-z][a-z0-9_.]{1,63}`, `daten` ein JSON-Objekt bis 16 KB.
Unbekannte Arten werden von Geräten übersprungen (Vorwärtskompatibilität).

Arten: siehe `ART` in `shared/protokoll.ts`. Turnier: `turnier.angelegt`, `turnier.umbenannt`,
`turnier.daten`, `turnier.abgeschlossen`, `turnier.wiedereroeffnet`, `turnier.wiederhergestellt`.
Spieler: `spieler.angelegt|geaendert|entfernt`. Konkurrenzen: `konkurrenz.angelegt|geaendert|entfernt`,
`teilnehmer.gemeldet|abgemeldet`, `paar.gemeldet` (Doppel/Mixed, ab 0.7), `konkurrenz.setzliste`, `auslosung.gesetzt`, `phase.gestartet`,
`phase.zurueckgenommen`, `gruppe.los`. Spiele: `spiel.ergebnis`, `spiel.bestaetigt`, `spiel.angefochten`,
`spiel.entschieden`, `spiel.zurueckgesetzt`, `spiel.aufgerufen` (`{konkurrenz, spiel, tisch, schiri?}`,
`schiri` = `{spieler}` oder `{name}`, höchstens 80 Zeichen), `spiel.aufruf_zurueck`. Tische: `tisch.gesperrt`
(`{tisch, gesperrt}`). K.-o.-Varianten (Trostrunde, Doppel-K.-o., zweites Endspiel) und Doppel/Mixed
stehen in den Konkurrenz-Einstellungen (`art`, `trostrunde`, `finaleWiederholung`, Modus `doppel_ko`). Ab 0.8: Modi `schweizer` und `kaiser` (eine Startliste als einzige „Gruppe“ in `auslosung.gesetzt`, Runden entstehen in der Engine aus den Ergebnissen; Spiel-IDs `sw-<runde>-<nr>` bzw. `ks-<runde>-<nr>`), `runden` (1–30, null = automatisch), Vorgabe `vorgabe` (TTR-Punkte je Vorgabepunkt, 10–500, null = aus) und `vorgabeMax` (1–10), `bestOf` 1 erlaubt. Ab 0.10: Modus `cup` (Cup-System wie MKTT, Spiel-IDs `cp-<runde>-<nr>`), `festeSaetze` (2/4, Schweizer/Cup: Unentschieden möglich), `beschleunigt` (Schweizer), `beginn` je Konkurrenz („HH:MM“); `turnier.daten` mit `beginn` und `satzMinuten` (2–15, null = lernen) für den Zeitplan; `spiel.geplant` (`{konkurrenz, spiel, tisch, zeit}`, nur Leitung); `auslosung.geaendert` (Auslosung im laufenden Turnier ändern, nur Leitung); `eintrag.zurueckgenommen` (`{ereignisse: [IDs], zurueck}` – Rückgängig/Wiederherstellen, nur Leitung; die genannten früheren Einträge zählen nicht mehr bzw. wieder, gelöscht wird nichts). Nachmeldung nach dem Start: `teilnehmer.gemeldet`/`paar.gemeldet` mit `gruppe` (Gruppenphase) oder `platz` (Freilos im K.-o.-Plan); in Schweizer/Cup/Kaiser ohne Zusatz. Alle neuen Arten tragen nur IDs, Zahlen und Uhrzeiten – keine personenbezogenen Daten. Der Server wertet nur `turnier.abgeschlossen` aus (letzte Sicherung).

Die Auslosung wird mit ihrem Ergebnis gespeichert (nicht nur mit dem Zufallswert), damit spätere
App-Versionen mit geänderten Verfahren alte Turniere unverändert anzeigen.

## Kennungen (ab 0.6)

Alle Kennungen haben 8 Ziffern, geschrieben als zwei Viererblöcke („4839 2017“).

- **Turnierkennung** = `turnier.id`, öffentlich, aber nicht auflistbar. Der Server bremst das
  Durchprobieren: höchstens 30 Abfragen *unbekannter* Kennungen je Anschluss in 15 Minuten; bekannte
  Turniere bleiben immer erreichbar (im Hallen-WLAN teilen sich alle Geräte eine Adresse). IPv6 wird
  je /64-Netz gezählt. Ältere Turniere behalten ihre 10-stellige Kennung.
- **Leitungs-, Helfer- und Spielerkennungen** liegen nur in der Tabelle `codes` (je Person eine, mit
  Namen), nicht in den öffentlich lesbaren Ereignissen; nicht alle Ziffern gleich, keine Ziffernfolge,
  je Turnier eindeutig. Die Leitung sieht sie, sperrt sie einzeln und gibt sie neu aus. Beim Anlegen eines
  Turniers entsteht die erste Leitungskennung auf den Namen des Kontos; weitere Leitungspersonen
  legt jede Leitung an. Ein Spieler kann zusätzlich Helferrecht bekommen (`code.helfer`): seine Einträge
  in fremden Spielen gelten wie vom Helfer (`autor.helfer = true`), die in eigenen wie vom Spieler.
- Persönlicher Link: `…/#/c/<turnier>/<kennung>` (meldet direkt an). Bremsen bei `turnier.zugang`,
  ohne richtige Kennungen auszusperren: ab dem 5. Fehlversuch je Anschluss und Turnier wächst eine
  Wartezeit (bis 2 s), ab 30 bekommen *falsche* Kennungen 429; je Turnier insgesamt werden nach 200
  Fehlversuchen in 15 Minuten nur noch richtige Kennungen angenommen. Richtige Kennungen setzen den
  Zähler des Anschlusses zurück.
- Das Konto-Token wird in der App nie am Turnier gespeichert; die Rechte des Kontos liefert
  `GET turnier` mit Token (`rechte`). Nach „Abmelden“ ist das Gerät sofort Zuschauer.

## Veröffentlichung und Leistungsklassen (App-Ereignisse)

- `turnier.daten` kann `veroeffentlichung: {tabellen, ko}` tragen (Standard beides `true`) und mit
  `alleKonkurrenzen: true` abweichende Einstellungen der Konkurrenzen aufheben. Je Konkurrenz steht in
  `einst.veroeffentlichung` `null` (wie Turnier) oder ein eigenes Paar. Verdeckt wird nur die Anzeige für
  Zuschauer, Spieler und Helfer; die Ereignisse selbst bleiben lesbar.
- `einst.klassenTrennung`: `keine` | `klasse` | `ttr` (mit `einst.ttrGrenzen`): Gruppen werden je
  Leistungsklasse getrennt ausgelost, die Endrunde ist gemischt. Getrennte Konkurrenzen je Klasse legt die
  App mit dem Assistenten an (normale `konkurrenz.angelegt`-Ereignisse mit passender Zulassung).

## Datenschutz beim Abholen (ab 0.9)

`GET events` liefert je nach Anmeldung eine von vier Sichten (`sicht` in der Antwort):

- `voll`: Leitung, Eigentümer, Admin, Helfer und Spieler mit Helfer-Recht
- `spieler`: Spielerkennung – ohne `jahrgang`, `geschlecht`, `pool` (Datenminimierung)
- `zuschauer`: ohne Token, mit ungültigem Token oder ohne Rechte im Turnier, gefiltert wie folgt:
- `spieler.angelegt` / `spieler.geaendert`: ohne `jahrgang`, `geschlecht`, `pool`
- `spiel.aufgerufen`: `schiri` nur noch als `{spieler}`; frei eingetippte Namen fallen weg
- `autor.name` ist leer (Rolle, `spieler`, `helfer` bleiben – die App braucht sie für die Rechteprüfung)

Steht im letzten `turnier.daten` der Leitung `namen: "kurz"`, ist die Sicht `kurz`: zusätzlich wird der
Nachname zu „M.“ gekürzt. `namen: "voll"` (Standard) hebt das auf. Der Filter lässt alle Ereignisse
gültig – die Berechnung auf dem Gerät kommt mit fehlenden Feldern aus. Ändert sich die Sicht eines
Geräts (Anmeldung, Abmeldung, Umstellung), verwirft es die bestätigten Ereignisse und holt alles neu ab;
noch nicht gesendete Einträge bleiben. Sendet ein Gerät ein Token und bekommt trotzdem nur die
Zuschauer-Sicht (Kennung gesperrt, Konto ohne Rechte), übernimmt es nichts und meldet „nicht angemeldet“;
die Oberfläche nimmt die Anmeldung zurück. Die Berechnung (zustand.ts) benutzt keine gefilterten Felder,
damit alle Sichten denselben Stand ergeben (Test „gleicher Stand aus voller und gefilterter Sicht“).
Die Zentrale holt bei der Übernahme mit dem Konto-Token ab und bricht ab, wenn die Sicht nicht `voll` ist.

Weitere App-Felder in `turnier.daten` (nur Leitung): `pause` (Mindestpause in Minuten, 0–60, für den
Pausenschutz beim Spielaufruf).

## Sicherung per Mail

- `sicherungTakt` in Minuten: `0` aus, `15`, `30` (Standard), `60`, `-1` nur beim Abschluss.
- Kein Cronjob: Bei jedem `GET/POST events` eines Turniers prüft der Server, ob eine Sicherung fällig ist –
  also solange das Turnier auf mindestens einem Gerät geöffnet ist. Gesendet wird nur bei Änderungen seit
  der letzten Sicherung (`sicherung_seq`). Ein bedingtes UPDATE sorgt dafür, dass bei vielen gleichzeitigen
  Abrufen nur einer sendet.
- `turnier.abgeschlossen` löst sofort eine Sicherung aus (außer bei Takt `0`).
- Anhang: Sicherungsdatei nach `Sicherung` in `shared/protokoll.ts` – dasselbe Format, das die App zum
  Herunterladen erzeugt. Wiederherstellen legt immer ein neues Turnier an.

## Konten und Wartung

- Selbst-Registrierung ist offen. Schutz: Fangfeld, höchstens 5 neue Konten je IP und Stunde.
- Mails (reiner Text, `Reply-To` an den Betreiber): Willkommen, Info an den Betreiber bei jedem neuen Konto,
  Passwort zurücksetzen, Sicherungen, Erinnerung vor der Löschung.
- Einmal täglich (beim ersten Aufruf nach 24 h): abgelaufene Sitzungen/Links und IP-Einträge älter als
  24 h löschen; Konten ohne Nutzung seit 335 Tagen bekommen eine Erinnerung, nach 365 Tagen (und frühestens
  30 Tage nach der Erinnerung) werden sie samt Turnieren gelöscht. Der Administrator ist ausgenommen.
- Konfiguration (`config.php`): `app_url` (für Links), `mail.absender`, `mail.admin`; für die Entwicklung
  `mail.datei` (Mails als Dateien).

## Sitzungen und Schutz

- Tokens: 64 Hex-Zeichen, Gültigkeit 30 Tage, serverseitig nur als SHA-256 gespeichert.
- Passwörter: `password_hash` (bcrypt/argon2, je nach PHP).
- Bremsen: Anmeldung 10 Fehlversuche je Anschluss in 15 Minuten; Kennungen und Turnierkennungen siehe „Kennungen“ (IPv6 je /64).
- Sicherheits-Header: `scripts/paket-bauen.sh` legt `public/.htaccess` mit Content-Security-Policy (`script-src 'self'`,
  kein Inline-Skript – deshalb liegt die Pfadkorrektur in `pfad.js`), `frame-ancestors 'none'`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS an. Die Zentrale setzt dieselbe CSP auf HTML-Antworten.
- Mengenbegrenzung je IP und Stunde: 5 Registrierungen, 5 × „Passwort vergessen“ (zusätzlich 3 je Adresse),
  5 Rückmeldungen; „Jetzt sichern“ 3 × je 10 Minuten und Turnier.

## Android-Zentrale (ab 0.5)

Geräte-Routen (`zentrale.*`, Konto der Zentrale ohne Passwort) nimmt die Zentrale nur vom Gerät selbst an:
Loopback-Verbindung **und** Kopfzeile `X-TT-Zentrale` mit dem Geheimnis dieses Laufs, das die Hülle beim Öffnen
der App als `?zentrale=<32 Hex>` übergibt (`Zentrale.startAdresse()`; am PC gibt `Start.java` die Adresse aus,
`--geheimnis` setzt es fest für Tests). Ein mitgeschickter `Origin`/`Referer` muss auf 127.0.0.1/localhost mit
dem eigenen Port zeigen – so kann keine fremde Webseite im Browser des Handys die Zentrale fernsteuern.

Die Zentrale (`zentrale/kern/…/Zentrale.java`) beantwortet alle Turnier-Routen oben genauso wie der
PHP-Server. Unterschiede:

- `info` liefert zusätzlich `zentrale: {version, adresse, online}`; `registrierung` ist `false`.
- Konten gibt es nicht (`login`, `registrieren`, `konten` … → 503). Die Zentrale hat genau ein Konto;
  es wird mit `POST zentrale.anmelden` ohne Passwort angemeldet – **nur vom Gerät der Zentrale selbst**
  (Verbindung über 127.0.0.1). Andere Geräte nutzen Leitungs-, Helfer- und Spieler-Codes.
- Speicher: Ordner mit JSON-Dateien und je Turnier einem Ereignis-Journal (`ereignisse.jsonl`, nur
  angehängt, sofort auf den Datenträger geschrieben). Laufnummern sind je Turnier 1, 2, 3 …
- Sicherungsmails sendet die Zentrale über den Online-Server (`sicherung.senden`), sobald ein Online-Konto
  verbunden ist und Internet besteht; bis dahin stehen sie in einer Warteschlange.
- `turnier.einstellungen` meldet `wartend: true`, `turnier.sichern` ggf. `{wartend: true}`.

Nur vom Gerät der Zentrale (sonst 403):

| Methode | Route | Zweck |
|---|---|---|
| POST | `zentrale.anmelden` | Konto der Zentrale → `{token, konto}` |
| GET | `zentrale.status` | Adressen, Geräte, WLAN, Hotspot, Akku, Internet, Online-Konto, Warteschlange |
| POST | `zentrale.wlan` | `{ssid, passwort}` des Handy-Hotspots (für den WLAN-QR-Code) |
| POST | `zentrale.hotspot` | `{an}` – Hotspot durch die App (Android LocalOnlyHotspot) |
| POST | `zentrale.oeffnen` | `{ziel: hotspot|akku|wlan}` – Systemeinstellungen öffnen |
| POST | `zentrale.online.anmelden` / `.abmelden` | Online-Konto verbinden (`{email, passwort, url?}`) / trennen |
| GET | `zentrale.online.turniere` | Turniere des Online-Kontos mit `aufDieserZentrale` |
| POST | `zentrale.uebernehmen` | `{turnier, erzwingen?}` – Online-Turnier mit Ereignissen, Codes, Einstellungen holen |
| POST | `zentrale.rueckgabe` | `{turnier}` – neue Einträge, Codes, Einstellungen hochladen; danach nur lesbar |
| POST | `zentrale.pool.abgleichen` | Spielerpool mit dem Online-Konto abgleichen (neuere Änderung gewinnt) |
| POST | `zentrale.sicherungen.senden` | Warteschlange jetzt senden |
| POST | `zentrale.turnier.loeschen` | `{turnier, trotzdem?}` – nur ohne ungesicherte Einträge (sonst `trotzdem`) |

Dafür kennt der **Online-Server** (Schema 4: `turniere.zentrale`, `zentrale_id`, `zentrale_seit`):

| Methode | Route | Zugang | Zweck |
|---|---|---|---|
| POST | `zentrale.uebernehmen` | Eigentümer-Konto | `{turnier, zentrale, zentraleId, erzwingen?}` → sperrt das Turnier, liefert `{turnier, einstellungen, codes, uebersicht}`. Ohne Leitungscode (alte Turniere) → 400 |
| POST | `zentrale.rueckgabe` | Eigentümer-Konto | `{turnier, zentraleId, ereignisse[≤200] mit autor, neu?: {name, datum, leitungsCode}}` – Ereignisse mit dem Autor von der Zentrale übernehmen; mit `neu` wird ein auf der Zentrale angelegtes Turnier mit derselben Kennung angelegt |
| POST | `zentrale.freigeben` | Eigentümer-Konto | `{turnier, zentraleId, codes?, einstellungen?, uebersicht?}` – Codes ersetzen (Anmeldungen mit geänderten Codes enden), Sperre aufheben |
| POST | `sicherung.senden` | Konto | `{turnier: {id, name, datum}, empfaenger[≤3], anlass, uebersicht?, sicherung}` → Sicherungsmail mit Anhang (40 je Stunde und Konto) |

Solange ein Turnier gesperrt ist, lehnt der Online-Server Änderungen (`events`, Codes, Einstellungen,
Übersicht, Sicherung) mit **409** ab. Die Geräte behalten ihre Einträge als „ausstehend“ und senden sie
nach der Rückgabe; Lesen bleibt möglich. `TurnierInfo.zentrale` nennt die Zentrale.
