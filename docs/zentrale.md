# Android-Zentrale – Einrichtung und Turnier in der Halle

Die Zentrale ist eine Android-App. Sie macht das Handy (oder Tablet) der Turnierleitung zum Server:
Andere Handys und Tablets – auch iPads – verbinden sich mit seinem WLAN und öffnen die App im Browser.
Internet ist in der Halle nicht nötig.

```
 Handy der Leitung = Zentrale             andere Geräte (Browser)
 ┌──────────────────────────┐     WLAN    ┌──────────────┐
 │ App + Turnier-Server     │◄───────────►│ Spielerin    │
 │ Daten auf dem Gerät      │             │ Helfer, iPad │
 └───────────┬──────────────┘             └──────────────┘
             │ nur wenn Internet da ist
             ▼
 Online-Server (saschaurban.de): Turniere holen/zurückgeben, Sicherungsmails
```

Getestet für Android 8 und neuer; Zielgerät: Pixel 9 Pro (Android 15/16).

---

## A. Einmalig: Signatur-Schlüssel bei GitHub hinterlegen

Android installiert ein Update nur, wenn es mit demselben Schlüssel signiert ist wie die erste
Installation. Dafür gibt es einen festen Schlüssel, der nur als GitHub-Secret gespeichert wird.

1. Die Datei `zentrale-signatur.txt` aus dem Chat öffnen. Darin stehen vier Werte.
2. Auf GitHub: Repository **tt-turnier** → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**. Vier Secrets anlegen (Name genau so, Wert aus der Datei):

   | Name | Wert |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | der lange Text (eine Zeile, ohne Leerzeichen am Ende) |
   | `ANDROID_KEYSTORE_PASSWORT` | Passwort |
   | `ANDROID_KEY_ALIAS` | `zentrale` |
   | `ANDROID_KEY_PASSWORT` | dasselbe Passwort |

3. Die Datei `tt-zentrale.jks` und `zentrale-signatur.txt` zusätzlich sicher aufheben
   (z. B. Passwort-Manager). Geht der Schlüssel verloren, muss die App einmal deinstalliert und neu
   installiert werden – die Turniere auf dem Handy wären dann weg.
4. Actions → **Zentrale (Android)** → **Run workflow** (Branch `main`). Nach ca. 5 Minuten gibt es das
   Release **zentrale** mit der Datei `tt-zentrale.apk`.

Ohne die Secrets baut GitHub die APK trotzdem (unter Actions → Lauf → *Artifacts*), aber mit einem
wechselnden Test-Schlüssel; sie wird dann nicht als Release veröffentlicht.

## B. App auf dem Pixel installieren

1. Auf dem Pixel im Browser öffnen:
   **https://github.com/Sasurb/tt-turnier/releases/download/zentrale/tt-zentrale.apk**
2. Download antippen → „Öffnen“. Android fragt: *„Aus dieser Quelle installieren?“* →
   **Einstellungen** → „Dieser Quelle vertrauen“ einschalten → zurück → **Installieren**.
   Play Protect warnt ggf. vor einer „unbekannten App“ → **Trotzdem installieren** (Details: die App
   kommt aus deinem eigenen GitHub, nicht aus dem Play Store).
3. App **TT-Zentrale** öffnen. Benachrichtigungen **erlauben** (daran erkennt man, dass die Zentrale
   läuft).
4. Oben auf die Karte **„Diese Zentrale“** → Abschnitt *Dauerbetrieb* →
   **Akku-Optimierung ausschalten** → „Zulassen“. Sonst bremst Android die Zentrale bei ausgeschaltetem
   Bildschirm.

Updates: dieselbe Adresse wie in Schritt 1 öffnen und installieren – die Turniere bleiben erhalten.

## C. WLAN der Zentrale

**Empfohlen: der normale Hotspot des Pixels.** Name und Passwort bleiben immer gleich; die Geräte
können sich das WLAN merken.

1. In der App: *Zentrale* → **Hotspot-Einstellungen öffnen** (oder Einstellungen → Netzwerk & Internet
   → Hotspot und Tethering → WLAN-Hotspot).
2. Hotspot einschalten. Name und Passwort ablesen (z. B. „TT-Halle“).
   Tipp: unter *Hotspot-Einstellungen* „Hotspot automatisch deaktivieren“ **ausschalten**, sonst geht er
   ohne verbundene Geräte nach einigen Minuten aus.
3. Zurück in der App: Name und Passwort eintragen → **Für den WLAN-Code speichern**.

Alternative: **Hotspot durch die App** startet ein eigenes WLAN mit Knopfdruck. Android vergibt dafür
bei jedem Start Namen und Passwort neu (der QR-Code passt sich an), und es geht nicht gleichzeitig mit dem
normalen Hotspot. Beim ersten Mal fragt Android nach „Geräte in der Nähe“ → Zulassen.

Gibt es in der Halle ein WLAN, können auch alle Geräte (die Zentrale eingeschlossen) dort hinein; die
Adresse auf der Zentrale-Seite passt sich an. Manche Hallen-WLANs trennen Geräte voneinander – dann
lieber den Hotspot nehmen.

## D. Turnier in der Halle

1. **Zentrale-Seite** offen lassen oder ausdrucken (Screenshot): zwei QR-Codes.
   - Code 1 „Mit dem WLAN verbinden“: Kamera eines Handys darauf → WLAN beitreten.
   - Code 2 „App öffnen“: Kamera darauf → App öffnet sich im Browser (z. B. `http://10.x.x.x:8080/`).
2. **Neues Turnier** auf der Zentrale anlegen (Auswahl „Mehrere Geräte (Zentrale)“) – oder ein online
   vorbereitetes Turnier holen (Abschnitt E).
3. Alles Weitere wie online: Spieler, Konkurrenzen, Auslosung, **Zugänge** mit Spieler-QR-Zetteln.
   Die Links auf den Zetteln zeigen auf die Zentrale – sie funktionieren, sobald das Gerät im WLAN der
   Zentrale ist.
4. Weitere Leitungsgeräte (z. B. iPad am Turniertisch): App über Code 2 öffnen, Turnier antippen,
   mit ihrer **Leitungskennung** anmelden (unter *Zugänge* → *Turnierleitung*). Am PC (`java -jar kern.jar`) öffnest du die Adresse, die beim Start als „Am Gerät selbst öffnen“ ausgegeben wird – nur sie schaltet die Zentrale-Seite frei.
5. Handy der Zentrale ans **Ladegerät**. Bildschirm darf ausgehen; die App darf im Hintergrund sein.
   Solange die Benachrichtigung **„Zentrale läuft“** zu sehen ist, läuft der Server. Beenden: in der
   Benachrichtigung auf **Beenden**.

Fällt die Zentrale kurz aus (Akku, Neustart), behalten die anderen Geräte ihre Einträge und senden sie,
sobald die Zentrale wieder läuft. Die Daten der Zentrale liegen im App-Speicher des Handys.

## E. Mit dem Online-Server zusammenarbeiten (optional)

Dafür braucht das Handy kurz Internet (mobile Daten oder WLAN zu Hause).

1. *Zentrale* → **Online-Konto**: E-Mail und Passwort deines Kontos auf saschaurban.de → **Verbinden**.
2. **Spielerpool abgleichen** holt den Pool aus dem Konto (und lädt auf der Zentrale ergänzte Spieler hoch).
3. **Online vorbereitete Turniere** → *Liste laden* → **Auf die Zentrale holen**. Das Turnier kommt mit
   allen Spielern, Auslosungen und Kennungen. Online ist es solange nur lesbar
   (Hinweis „läuft gerade auf der Zentrale“). QR-Zettel aus der Vorbereitung gelten weiter – die Codes
   bleiben gleich; nur die Adresse ist in der Halle die der Zentrale.
4. Nach dem Turnier (wieder mit Internet): *Turniere auf dieser Zentrale* →
   **An den Online-Server zurückgeben**. Alle Einträge aus der Halle gehen hoch, mit den ursprünglichen
   Namen im Protokoll. Danach geht es online weiter, auf der Zentrale ist das Turnier nur noch lesbar
   (und kann mit ✕ entfernt werden).
   Auf der Zentrale angelegte Turniere heißen hier **Zum Online-Server hochladen** – sie erscheinen dann
   in deinem Online-Konto.

**Sicherungsmails:** Mit verbundenem Online-Konto verschickt die Zentrale Sicherungen (Abstand wie im
Turnier unter *Einstellungen*) über den Online-Server – sobald sie Internet hat. Bis dahin stehen sie unter
*Sicherungsmails in Warteschlange*. Ohne Internet in der Halle geht beim Abschließen trotzdem nichts
verloren: Die Mail geht raus, sobald das Handy wieder Internet hat (z. B. auf dem Heimweg). Ohne Konto:
im Turnier *Einstellungen* → **Sicherung teilen** (Android-Teilen-Menü, z. B. an sich selbst mailen).

## F. Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| Andere Geräte erreichen die Adresse nicht | Ist das Gerät wirklich im WLAN der Zentrale (nicht in mobilen Daten)? Manche Handys fragen „WLAN ohne Internet – trotzdem verbunden bleiben?“ → **Ja**. |
| iPhone/iPad wechselt ständig zu mobilen Daten | Einstellungen → WLAN → (i) beim Hotspot → „Mobile Daten verwenden“/„WLAN-Assist“ ausschalten. |
| Zentrale-Seite zeigt keine Adresse | Hotspot ist aus oder das Handy in keinem WLAN. |
| Nach einiger Zeit keine Verbindung mehr | Akku-Optimierung ausschalten (Abschnitt B, Schritt 4); Hotspot-Abschaltung „automatisch deaktivieren“ aus (Abschnitt C). |
| „Hotspot durch die App“ geht nicht | normalen Hotspot ausschalten; Berechtigung „Geräte in der Nähe“ erlauben. |
| Rückgabe: „inzwischen von … übernommen“ | Das Turnier wurde mit „Trotzdem holen“ auf eine andere Zentrale geholt. Einträge dieser Zentrale: *Sicherung teilen* und online wiederherstellen. |

## Technik (für Entwickler)

- `zentrale/kern/`: Server in reinem Java ohne Fremdbibliotheken (HTTP, JSON, Speicher). Tests:
  `./pruefen.sh` (im JDK) bzw. `./pruefen.sh --online` (zusätzlich gegen `php -S` mit SQLite).
  Am PC ausprobieren: `java -jar build/kern.jar --app ../../app/dist --port 8080`.
- `zentrale/android/`: Hülle (WebView auf `http://127.0.0.1:<port>/`, Vordergrunddienst `specialUse`,
  WakeLock/WifiLock, LocalOnlyHotspot, Teilen per ContentProvider, Brücke `window.TTNativ`).
  Gebaut wird in GitHub Actions (`.github/workflows/android.yml`) mit Gradle 8.10, AGP 8.7, JDK 17.
- Oberflächentests: `cd e2e && npx playwright test -c zentrale.config.ts` (Gerät der Zentrale über
  127.0.0.1, zweites Gerät über die Netzwerkadresse).
