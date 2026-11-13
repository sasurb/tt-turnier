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
| GET | `info` | offen | App-Kennung, Protokoll, Version, `eingerichtet` |
| POST | `setup` | Einrichtungscode | Administrator anlegen (nur solange keiner existiert) |
| POST | `login` | offen | `{email, passwort}` → `{token, konto}` |
| POST | `logout` | Token | Token ungültig machen |
| GET | `ich` | Token | Rolle, Name, ggf. Konto |
| POST | `passwort.aendern` | Konto | `{alt, neu}`; beendet andere Sitzungen |
| GET | `konten` | Admin | alle Konten mit letzter Anmeldung und Turnierzahl |
| POST | `konto.anlegen` | Admin | Veranstalter anlegen `{name, email, passwort}` |
| POST | `konto.sperren` | Admin | `{id, gesperrt}`; Sperre beendet alle Sitzungen des Kontos |
| GET | `turniere` | Konto | eigene Turniere; Admin mit `&alle=1` alle |
| POST | `turnier.anlegen` | Konto | `{name, datum, leitungsPasswort}` → `{turnier, token}` (Leitungs-Token) |
| GET | `turnier&id=…` | offen | Name, Datum, Veranstalter |
| POST | `turnier.zugang` | offen | `{turnier, passwort, name}` → Leitungs-Token |
| GET | `events&turnier=…&ab=N` | offen | bis zu 200 Ereignisse mit `seq > N`, `mehr` wenn weitere vorliegen |
| POST | `events&turnier=…` | Schreibrecht | `{ereignisse: [...]}` (max. 200) → `{angenommen: [{id, seq}], hoechsteSeq}` |

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

Arten in Etappe 2: `turnier.angelegt`, `turnier.umbenannt`, `test.notiz`.

## Sitzungen und Schutz

- Tokens: 64 Hex-Zeichen, Gültigkeit 30 Tage, serverseitig nur als SHA-256 gespeichert.
- Passwörter: `password_hash` (bcrypt/argon2, je nach PHP).
- Bremse: 10 Fehlversuche je IP (und je Turnier beim Leitungspasswort) in 15 Minuten.
