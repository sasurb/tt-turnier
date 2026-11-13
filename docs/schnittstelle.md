# Schnittstelle (Protokoll 1)

Verbindlich für beide Server: den PHP-Server (`server-php/`) und die spätere Android-Zentrale.
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
| GET | `info` | offen | App-Kennung, Protokoll, Version, `eingerichtet`, `registrierung`, `mail` |
| POST | `setup` | Einrichtungscode | Administrator anlegen (nur solange keiner existiert) |
| POST | `login` | offen | `{email, passwort}` → `{token, konto}` |
| POST | `logout` | Token | Token ungültig machen |
| GET | `ich` | Token | Rolle, Name, ggf. Konto |
| POST | `passwort.aendern` | Konto | `{alt, neu}`; beendet andere Sitzungen |
| POST | `registrieren` | offen | `{name, email, passwort, website}` → `{token, konto}`; `website` ist ein Fangfeld und muss leer sein |
| POST | `passwort.vergessen` | offen | `{email}` → immer `{ok}`; bei bekanntem Konto Mail mit Link `…#/zuruecksetzen/<schlüssel>` |
| POST | `passwort.zuruecksetzen` | Schlüssel | `{schluessel, neu}` → `{token, konto}`; Link gilt 1 Stunde, einmalig; beendet alle Sitzungen |
| POST | `konto.loeschen` | Konto | `{passwort}`; löscht Konto, Turniere, Ereignisse, Sitzungen (nicht Admin) |
| POST | `rueckmeldung` | offen | `{art, text, name?, email?, website}` → Mail an den Betreiber; ohne Anmeldung sind `name`/`email` Pflicht |
| GET | `konten` | Admin | alle Konten mit letzter Anmeldung und Turnierzahl |
| POST | `konto.anlegen` | Admin | Veranstalter anlegen `{name, email, passwort}` |
| POST | `konto.sperren` | Admin | `{id, gesperrt}`; Sperre beendet alle Sitzungen des Kontos |
| GET | `turniere` | Konto | eigene Turniere; Admin mit `&alle=1` alle |
| POST | `turnier.anlegen` | Konto | `{name, datum, leitungsCode, sicherungAn?}` → `{turnier, token}` (Leitungs-Token) |
| GET | `turnier&id=…` | offen | Name, Datum, Veranstalter |
| POST | `turnier.zugang` | offen | `{turnier, code, name}` → Leitungs-Token (ältere Turniere: Passwort in `code`) |
| GET | `turnier.einstellungen&id=…` | Leitung | `{leitungsCode, sicherungAn, sicherungTakt, letzteSicherung, mail}` |
| POST | `turnier.einstellungen` | Leitung | `{turnier, leitungsCode?, sicherungAn?, sicherungTakt?}` – nur übergebene Felder |
| POST | `turnier.sichern` | Leitung | `{turnier}` → Sicherung sofort an alle Empfänger |
| GET | `events&turnier=…&ab=N` | offen | bis zu 200 Ereignisse mit `seq > N`, `mehr` wenn weitere vorliegen |
| POST | `events&turnier=…` | Schreibrecht | `{ereignisse: [...]}` (max. 200) → `{angenommen: [{id, seq}], hoechsteSeq}` |

**Leitung** (Einstellungen, Sicherung) bedeutet: Token mit Rolle `leitung` für dieses Turnier, das
Eigentümer-Konto oder der Administrator.

**Schreibrecht für ein Turnier** haben Tokens mit Rolle `leitung`, `helfer` oder `spieler` für dieses
Turnier sowie das Veranstalter-Konto, dem das Turnier gehört.

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

Arten: `turnier.angelegt`, `turnier.umbenannt`, `turnier.abgeschlossen`, `turnier.wiedereroeffnet`,
`turnier.wiederhergestellt`, `test.notiz`. Der Server wertet nur `turnier.abgeschlossen` aus (letzte Sicherung).

## Leitungscode

Genau 6 Ziffern, nicht alle gleich und keine Ziffernfolge (123456, 654321). Der Server speichert ihn
lesbar (damit die Leitung ihn unter „Teilen“ sieht) und zusätzlich als Hash zur Prüfung. Ein neuer Code
beendet bestehende Leitungs-Anmeldungen nicht.

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
- Bremse: 10 Fehlversuche je IP (und je Turnier beim Leitungscode) in 15 Minuten.
- Mengenbegrenzung je IP und Stunde: 5 Registrierungen, 5 × „Passwort vergessen“ (zusätzlich 3 je Adresse),
  5 Rückmeldungen; „Jetzt sichern“ 3 × je 10 Minuten und Turnier.
