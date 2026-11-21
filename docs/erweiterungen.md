# Erweiterungen: Mannschaftsturniere und click-TT

Stand 21.11.2026 (Version 0.13). Mannschaftsturniere sind seit Etappe 11 umgesetzt (Abschnitt unten beschreibt den
umgesetzten Stand), click-TT bleibt zurückgestellt und lässt sich ohne Umbau ergänzen.

## Grundsätze, die beides möglich machen

- **Ereignisse statt Zustand.** Alles, was passiert, ist ein Eintrag im Ereignis-Log (`shared/protokoll.ts`, `ART`).
  Neue Funktionen bringen neue Ereignisarten mit. Die Server prüfen nur Rechte und Reihenfolge, die Turnierlogik
  rechnet auf jedem Gerät gleich (`app/src/lib/engine/zustand.ts`). Ältere App-Versionen überspringen unbekannte
  Arten, statt abzustürzen.
- **Teilnehmer sind IDs.** Gruppen, K.-o., Schweizer System, Kaiser und Cup arbeiten mit Teilnehmer-IDs. Ob dahinter
  ein Spieler (`spieler.angelegt`), ein Paar (`paar.gemeldet`, Muster `p-…`) oder künftig eine Mannschaft steht,
  ist ihnen gleich. Namen und Setzwerte holen sie über `teilnehmerDaten()`/`teilnehmerVon()` in `abfragen.ts`.
- **Gleiche Server-Schnittstelle** für PHP (online) und Java-Kern (Zentrale). Neue Arten kommen in beide
  Whitelists (`ARTEN_SPIELER`, `ARTEN_JE_AUFGABE`) und in die Datenschutz-Filter (`Api::gefiltert`,
  `Zentrale.gefiltert`).

## Mannschaftsturniere (umgesetzt in Etappe 11, 0.13)

Umsetzung: `app/src/lib/engine/mannschaft.ts` (Spielsysteme, Teilspiele, Auswertung), `zustand.ts` (Ereignisse
`mannschaft.gemeldet`, `mannschaft.aufgestellt`, `mannschaft.los`, Teilspiel-Ergebnisse mit Spiel-ID `<Begegnung>~<n>`),
`wertung.ts` (Mannschaftstabelle), Oberfläche `BegegnungDialog.svelte`, `MannschaftenMeldung.svelte`, Spielbericht in
`DruckAnsicht.svelte`. Abweichungen vom Entwurf: Die Aufstellung nennt die Mannschaft (`mannschaft`) statt der Seite;
Aufstellungen speichert die Engine je Mannschafts-ID. Die Mannschaftsführung ist das Feld `fuehrer` in
`mannschaft.gemeldet` (keine eigene Kennung). Verdeckte Aufstellungen filtern die Server (`Api::verdeckteAufstellungen`,
`Zentrale.verdeckteAufstellungen`); Spielerkennungen ohne Helferrecht dürfen nur für die eigene Mannschaft aufstellen
(`istMannschaftsfuehrung`). Spielfolgen nach DTTB-WO E 6 (Stand 01.06.2024): Sechser-Paarkreuz, Bundessystem,
Werner-Scheffler, modifiziertes Swaythling, Corbillon; dazu Swaythling-Cup (9 Einzel), Olympisches System (ITTF) und
eigene Folgen. Braunschweiger System fehlt (Varianten je nach Mannschaftsstärke).

### Entwurf (Etappe 10)

### Datenmodell

| Baustein | Umsetzung |
|---|---|
| Konkurrenz | `einst.art = 'mannschaft'` (neben `einzel`, `doppel`, `mixed`), dazu `einst.mannschaft = { system, spieler, bisSiege, doppel }` |
| Mannschaft | neues Ereignis `mannschaft.gemeldet { konkurrenz, id: 'm-xxxx', name, verein, spieler: [IDs], fuehrer?: ID }` – wie `paar.gemeldet`, Teilnehmer-ID `m-…` |
| Begegnung | ein `Spiel` wie heute (Gruppe, K.-o., Runden), zusätzlich `teile: TeilSpiel[]` |
| Teilspiel | `{ id: '<spiel>~<n>', art: 'einzel' \| 'doppel', a: Position[], b: Position[], eintrag }`; ID-Muster `~` kommt in keiner heutigen Spiel-ID vor |
| Aufstellung | neues Ereignis `mannschaft.aufgestellt { spiel, seite, positionen: { A: ID, B: ID, …, D1: [ID, ID] } }` |
| Ergebnis | wie heute `spiel.ergebnis`, aber mit der ID des Teilspiels. Das Ergebnis der Begegnung (z. B. 6:3) rechnet die Engine aus den Teilspielen. |

Das **Spielsystem** ist eine Tabelle von Teilspielen (Reihenfolge, Positionen, Doppel) mit „bis X Siege“
(Abbruch, sobald eine Mannschaft uneinholbar führt). Vorgesehen sind die üblichen Systeme, die vor der
Umsetzung mit der Wettspielordnung abgeglichen werden: Paarkreuzsystem (6er-Mannschaft), Werner-Scheffler- und
Bundessystem (4er), Swaythling-Cup und Olympisches System (3er), Corbillon-Cup (2er), dazu eigene Tabellen.

### Wertung

Die Tabellen der Begegnungen folgen der Reihenfolge der Mannschaftswertung: Punkte aus Begegnungen, dann
Spiel-, Satz- und Balldifferenz. `wertung.ts` erhält dafür eine eigene Vergleichsfunktion, die auf den Summen der
Teilspiele arbeitet. Gruppen, K.-o. und Rundenmodi bleiben unverändert.

### Rechte

- Die **Mannschaftsführung** ist eine Spielerkennung (Rolle `spieler`) eines Spielers der Mannschaft mit dem Zusatz
  `fuehrer`. Sie darf die Aufstellung der eigenen Seite und Ergebnisse von Teilspielen der eigenen Begegnung
  eintragen. Der Gegner bestätigt wie heute.
- Die Aufstellung der Gegenseite bleibt bis zur Abgabe beider Aufstellungen verdeckt. Den Zeitpunkt des
  Aufdeckens legt die Engine fest, es braucht dafür keinen Server-Filter.
- Server: `mannschaft.aufgestellt` kommt in `ARTEN_SPIELER`. Der Server prüft wie bisher nur die Art, die Engine
  prüft die Seite.

### Oberfläche

Spielkarte der Begegnung mit Zwischenstand (z. B. „4:2“), aufklappbar zu den Teilspielen. Aufstellung per
Auswahl aus den gemeldeten Spielern. Druck: Spielberichtsbogen je Begegnung.

## click-TT (zurückgestellt)

click-TT ist das Ergebnis- und Meldesystem der Tischtennisverbände. Eine offene, dokumentierte Schnittstelle
für Vereinsturniere gibt es dort nach heutigem Stand nicht. Vorgesehen ist daher der Austausch über Dateien,
die die Turnierleitung herunter- bzw. hochlädt.

| Richtung | Vorgehen | Andockpunkt |
|---|---|---|
| Import der Meldungen | Meldeliste aus click-TT (XML/CSV) einlesen → `spieler.angelegt` mit Name, Verein, TTR und `lizenz` | gleicher Weg wie der CSV-Import des Spielerpools (`lib/export.ts`/Pool) |
| TTR aktualisieren | Liste erneut einlesen → `spieler.geaendert { id, ttr }` für Spieler mit gleicher `lizenz` | Abgleich über `lizenz` |
| Ergebnismeldung | Export der Einzelergebnisse mit `lizenz` beider Spieler, Satzergebnissen und Datum im verlangten Format | `lib/export.ts` (heute CSV), Daten aus `abfragen.ts` |

**Schon vorbereitet (0.12):** Der Spieler hat das Feld `lizenz` (bis 20 Zeichen, Buchstaben, Ziffern,
Bindestrich). Die Engine liest es, die Server geben es wie den Jahrgang nur in der vollen Sicht heraus.

**Vor der Umsetzung zu klären:** Dateiformate und Nutzungsbedingungen des jeweiligen Landesverbands. Klären,
ob Lizenznummern gespeichert werden dürfen. Die Datenschutzerklärung entsprechend ergänzen.
