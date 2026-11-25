# Einrichtung auf Strato – Schritt für Schritt

Ziel: Die App läuft unter **https://saschaurban.de/tt-turnier/** mit eigener Datenbank, verschlüsselt über das SSL-Zertifikat der Hauptdomain. Danach
lädt GitHub jede neue Version automatisch hoch, ohne dass du noch etwas per Hand kopierst.

Dauer: etwa 30 Minuten. Du brauchst den Strato-Kundenlogin und Zugang zu GitHub (Konto Sasurb).

> **Notizzettel:** Lege dir für die Werte aus den Schritten 1 bis 3 eine Notiz an (z. B. im
> Passwortmanager). Du trägst sie in Schritt 4 bei GitHub ein und brauchst sie danach nicht mehr.

---

## Schritt 1 – Datenbank anlegen

1. Im [Strato-Kundenlogin](https://www.strato.de/apps/CustomerService) anmelden und dein Hosting-Paket wählen.
2. Links **Datenbanken und Webspace → Datenbankverwaltung**.
3. **Datenbank anlegen** klicken, Typ **MySQL** wählen, ein **neues, sicheres Passwort** vergeben,
   als Kommentar z. B. „tt-turnier“ eintragen und anlegen.
4. Bei der neuen Datenbank auf die **drei Punkte → Details** klicken und notieren:

| Notiz | Steht bei Strato als | Beispiel |
|---|---|---|
| `DB_HOST` | Server | `database-0123456789.webspace-host.com` |
| `DB_NAME` | Datenbankname | `dbs1234567` |
| `DB_USER` | Benutzername | `dbu1234567` |
| `DB_PASSWORT` | das Passwort aus Punkt 3 | – |

Tabellen musst du nicht anlegen; das erledigt die App beim ersten Aufruf selbst.

## Schritt 2 – SFTP-Zugang für GitHub anlegen

Ein eigener Zugang nur für GitHub. So kannst du ihn jederzeit sperren, ohne deine anderen Zugänge zu ändern.

1. **Datenbanken und Webspace → SFTP & SSH**.
2. Rechts oben stehen **Server** und **Port 22**. Notiere den Server als `SFTP_HOST`
   (Muster: `50xxxxxx03.ssh.w2.strato.hosting`).
3. **+ Neu anlegen**:
   - Kommentar: „GitHub tt-turnier“
   - Passwort: neues, sicheres Passwort → notieren als `SFTP_PASSWORT`
   - Startverzeichnis: **/** (das Hauptverzeichnis)
   - Typ: **SFTP**
4. **Speichern**. In der Liste erscheint der erzeugte Benutzername (Muster `su1234567`) → notieren als `SFTP_USER`.

> Ältere Strato-Pakete zeigen statt des persönlichen Servers `ssh.strato.de`; dann ist der
> Benutzername deine Domain (`saschaurban.de`). Beides funktioniert.

## Schritt 3 – Einrichtungscode ausdenken

Mit diesem Code legst du nach dem ersten Hochladen einmalig dein Administrator-Konto an.
Danach ist die Einrichtungsseite gesperrt.

- Mindestens 12 Zeichen, z. B. vier zufällige Wörter: `Ahorn-Netzball-Kreide-Sieben`
- notieren als `SETUP_CODE`

## Schritt 4 – Werte als Secrets bei GitHub eintragen

Secrets sind verschlüsselt. Niemand kann sie später wieder auslesen, auch du nicht (nur überschreiben).

1. https://github.com/Sasurb/tt-turnier öffnen → **Settings** → links **Secrets and variables → Actions**.
2. Für jede Zeile: **New repository secret**, Name exakt so schreiben (Großbuchstaben), Wert einfügen, **Add secret**.

| Name | Wert |
|---|---|
| `SFTP_HOST` | aus Schritt 2 |
| `SFTP_USER` | aus Schritt 2 |
| `SFTP_PASSWORT` | aus Schritt 2 |
| `SFTP_ZIEL` | `tt-turnier-server` (Server-Code und Zugangsdaten, außerhalb jedes Webroots) |
| `SFTP_ZIEL_WEB` | `saschaurban/tt-turnier` (öffentlicher Ordner der App im Webroot der Hauptdomain) |
| `DB_HOST` | aus Schritt 1 |
| `DB_NAME` | aus Schritt 1 |
| `DB_USER` | aus Schritt 1 |
| `DB_PASSWORT` | aus Schritt 1 |
| `SETUP_CODE` | aus Schritt 3 |

3. Optional, für eine automatische Prüfung nach jedem Hochladen: Reiter **Variables** →
   **New repository variable**, Name `WEBSPACE_URL`, Wert `https://saschaurban.de/tt-turnier`.

## Schritt 4b – Demo auf GitHub Pages einschalten (einmalig)

Die öffentliche Demo (nur Einzelgerät-Modus) unter https://sasurb.github.io/tt-turnier/ braucht einen Schalter:

1. https://github.com/Sasurb/tt-turnier → **Settings** → links **Pages**.
2. Unter **Build and deployment → Source** die Auswahl **GitHub Actions** treffen. Mehr ist nicht nötig.

## Schritt 5 – Erstes Hochladen auslösen

1. Auf GitHub **Actions** → links **Veröffentlichen** → rechts **Run workflow** → **Run workflow**.
2. Nach 2–3 Minuten sollten alle Schritte grün sein. Der Schritt **Webspace (SFTP)** hat dann
   auf deinem Webspace angelegt:

```
/saschaurban/            ← Webroot der Hauptdomain saschaurban.de
   tt-turnier/           ← App und Schnittstelle (öffentlich)
/tt-turnier-server/      ← außerhalb jedes Webroots, von außen nicht erreichbar
   src/                  ← Programmcode des Servers
   config.php            ← Datenbank-Zugang und Einrichtungscode
```

Zum Schutz lädt der Deploy nur in einen öffentlichen Ordner hoch, der leer ist oder erkennbar zur App gehört.
Liegen dort fremde Dateien, bricht er mit einer Meldung ab und löscht nichts.

Wenn der Schritt rot ist: siehe [Probleme lösen](#probleme-lösen).

## Schritt 6 – Hauptdomain auf den Ordner `saschaurban` zeigen lassen

1. Im Strato-Kundenlogin **Domains → Domainverwaltung**.
2. Bei `saschaurban.de` die **Umleitung** öffnen → **intern** → Verzeichnis **`/saschaurban`** wählen → speichern.
3. Was bisher unter `saschaurban.de` lag, muss mit in den Ordner `/saschaurban`, sonst ist es nicht mehr
   erreichbar. Beispiel: `/spieltimer` nach `/saschaurban/spieltimer` verschieben, dann ist er unter
   `https://saschaurban.de/spieltimer/` erreichbar.
4. **PHP-Version prüfen:** unter **Datenbanken und Webspace → PHP-Version** mindestens **PHP 8.1** einstellen.
5. Falls eine Subdomain `tt-turnier.saschaurban.de` aus einem früheren Versuch existiert:
   **Domainverwaltung → Subdomains anzeigen → tt-turnier → Subdomain löschen**. Sonst bleibt eine
   unverschlüsselte Adresse erreichbar.
6. Test im Browser: `https://saschaurban.de/tt-turnier/api/index.php?r=info` zeigt eine Zeile mit
   `"app":"tt-turnier"` und `"eingerichtet":false`.

> **Alternative mit eigener Subdomain:** Secret `SFTP_ZIEL_WEB` leer lassen; dann landet die App in
> `/<SFTP_ZIEL>/public`. Subdomain anlegen, intern auf diesen Ordner zeigen lassen und ihr ein **eigenes
> SSL-Zertifikat** zuweisen (das enthaltene Zertifikat der Hauptdomain deckt keine Subdomains ab).

## Schritt 7 – Administrator anlegen

1. https://saschaurban.de/tt-turnier/ öffnen. Oben erscheint „Der Server ist noch nicht eingerichtet“.
2. **Server einrichten** antippen, den **Einrichtungscode** aus Schritt 3, deinen Namen,
   deine E-Mail-Adresse und ein Passwort eingeben → **Administrator anlegen**.
3. **Anmelden**. Über dein Namensfeld oben rechts → **Verwaltung** siehst du alle Konten und kannst sie
   bei Missbrauch sperren. Jeder kann sich selbst ein Konto anlegen; du bekommst dazu jeweils eine Info-Mail.

## Schritt 8 – Abgleich mit zwei Geräten testen

1. Startseite → **Neues Turnier**: Name eingeben, „Mehrere Geräte (online)“ ist vorausgewählt, der
   → **Turnier anlegen**. Unter *Zugänge* stehen die Turnierkennung und deine Leitungskennung.
2. Unter **Teilen** den Link auf ein zweites Gerät schicken (z. B. per Messenger).
3. Auf dem zweiten Gerät **Turnier beitreten** → Turnierkennung, dann eine Leitungskennung eingeben (unter *Zugänge* eine weitere Person anlegen).
4. Auf einem Gerät einen **Testeintrag** machen: Er erscheint nach wenigen Sekunden auf dem anderen.
5. Gegenprobe: Auf dem zweiten Gerät WLAN und mobile Daten ausschalten, etwas eintragen
   („wird gesendet“), wieder einschalten: Der Eintrag kommt beim ersten Gerät an.

Fertig. Ab jetzt landet jede neue Version auf `main` automatisch auf dem Webspace.

## Schritt 9 – Mails und Impressum (ab Version 0.3)

Für Willkommensmails, „Passwort vergessen“, Sicherungen per Mail und das Kontaktformular braucht der
Server einen Absender, die Adresse der App und deine Adresse für Info-Mails. Impressum und
Datenschutzhinweis zeigen deine Betreiberangaben.

**a) Postfach** `tt-turnier@saschaurban.de` im Strato-Kundenlogin unter **E-Mail** anlegen (erledigt).
Strato stellt Mails von PHP zuverlässiger zu, wenn der Absender als Postfach existiert.

**b) Secret** (Settings → Secrets and variables → Actions → Reiter **Secrets** → **New repository secret**):

| Name | Wert |
|---|---|
| `ADMIN_MAIL` | `sascha.urban@gmail.com` – bekommt die Info über neue Konten und Rückmeldungen; Antworten auf alle System-Mails gehen hierhin |

**c) Variablen** (gleiche Seite, Reiter **Variables** → **New repository variable**). Variablen sind nicht
geheim – diese Angaben stehen ohnehin öffentlich im Impressum.

| Name | Wert |
|---|---|
| `WEBSPACE_URL` | `https://saschaurban.de/tt-turnier` (falls noch nicht vorhanden) |
| `BETREIBER_NAME` | `Sascha Urban` |
| `BETREIBER_ANSCHRIFT` | `Klappholzer Weg 11, 24890 Stolk` (Komma trennt die Zeilen) |
| `BETREIBER_MAIL` | `tt-turnier@saschaurban.de` (auch Absender der Mails) |
| `BETREIBER_TELEFON` | optional, leer lassen oder Nummer eintragen |

**d) Veröffentlichen:** Actions → **Veröffentlichen** → **Run workflow**. Fehlt etwas, erscheint im Lauf
eine gelbe Warnung, der Rest wird trotzdem hochgeladen.

**e) Prüfen:**
1. `https://saschaurban.de/tt-turnier/api/index.php?r=info` zeigt `"mail":true`.
2. Mit einer zweiten E-Mail-Adresse ein Konto anlegen: Willkommensmail kommt an, du bekommst die Info-Mail.
3. Abmelden → **Passwort vergessen?** → Mail mit Link kommt an (ggf. im Spam-Ordner nachsehen).
4. In einem Online-Turnier unter **Einstellungen → Jetzt per Mail sichern**: Mail mit Anhang kommt an.
5. Fußzeile → **Impressum**: deine Angaben stehen dort.

**f) Auftragsverarbeitung:** Für personenbezogene Daten Dritter auf dem Webspace braucht es einen
Vertrag zur Auftragsverarbeitung (AVV) mit Strato. Er lässt sich im Kundenlogin abschließen
(Suchbegriff „Auftragsverarbeitung“).

---

## Schritt 10 – Mailversand über SMTP (ab Version 0.18, empfohlen)

Rundmails, Ergebnis-Mails und Ankündigungen gehen über eine gedrosselte Warteschlange raus. Zuverlässiger als die
PHP-Funktion `mail()` ist der Versand über das Postfach, das schon als Absender eingetragen ist (`BETREIBER_MAIL`).

1. Im Strato-Kundenlogin → **E-Mail** → **Verwaltung** prüfen, dass das Postfach von `BETREIBER_MAIL` existiert, und
   sein Passwort bereithalten (bei Bedarf dort neu setzen).
2. GitHub → Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - `SMTP_HOST` = `smtp.strato.de`
   - `SMTP_PORT` = `465`
   - `SMTP_USER` = die vollständige Adresse des Postfachs (z. B. `tt-turnier@saschaurban.de`)
   - `SMTP_PASSWORT` = das Passwort des Postfachs
3. Optional unter **Variables**: `MAIL_JE_MINUTE` (Standard 20) – so viele Mails gehen höchstens je Minute raus.
4. **Actions** → **Veröffentlichen** → **Run workflow** (nicht „Re-run“ eines alten Laufs).
5. Testen: In einem Turnier unter „Teilnehmer“ → „Nachricht an Teilnehmer“ eine Nachricht mit Häkchen „per E-Mail“
   schicken (vorher eine eigene Online-Anmeldung anlegen) und prüfen, ob sie ankommt.

Ohne `SMTP_HOST` bleibt alles wie bisher (`mail()`). Die Warteschlange läuft ohne Cronjob: Nach jeder Antwort des
Servers gehen einige Mails raus. Nicht zustellbare Mails werden bis zu sechsmal wiederholt und nach drei Tagen gelöscht.

## Probleme lösen

| Anzeichen | Ursache und Abhilfe |
|---|---|
| Actions: „Webspace-Deploy übersprungen, es fehlen Secrets“ | Ein Secret fehlt oder ist falsch geschrieben (Schritt 4). Namen genau vergleichen. |
| Actions: `Login failed` / `Access failed` beim SFTP | `SFTP_HOST`, `SFTP_USER` oder `SFTP_PASSWORT` falsch. Im Kundenlogin das Passwort des Zugangs neu setzen und das Secret überschreiben. |
| Actions: „Der Ordner … enthält fremde Dateien“ | Im Ordner aus `SFTP_ZIEL_WEB` liegen Dateien, die nicht zur App gehören. Sie sichern oder verschieben, Ordner leeren, erneut starten. |
| `saschaurban.de` zeigt „Verzeichnis nicht gefunden“ | Umleitung aus Schritt 6 prüfen (genau `/saschaurban`, alles klein). |
| Browser meldet `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` | Die aufgerufene Adresse hat kein Zertifikat (typisch bei Subdomains). Die App über `https://saschaurban.de/tt-turnier/` aufrufen. |
| App zeigt „Kein Server erreichbar“ | `https://saschaurban.de/tt-turnier/api/index.php?r=info` im Browser öffnen. Kommt eine Fehlermeldung zu PHP, die PHP-Version prüfen (Schritt 6.4). |
| `…?r=info` meldet „Keine Verbindung zur Datenbank“ | Datenbank-Secrets prüfen (Schritt 1/4), danach **Run workflow** erneut ausführen. Neue Strato-Datenbanken sind manchmal erst nach einigen Minuten erreichbar. |
| „Der Einrichtungscode ist falsch“ | Code exakt wie im Secret `SETUP_CODE` eingeben (Groß-/Kleinschreibung). Nach 10 Fehlversuchen 15 Minuten warten. |
| Mails kommen nicht an | `…?r=info` muss `"mail":true` zeigen; sonst Variable `BETREIBER_MAIL`/`WEBSPACE_URL` prüfen (Schritt 9). Spam-Ordner prüfen. Das Postfach `tt-turnier@saschaurban.de` muss existieren. |
| Passwort des Administrators vergessen | Auf der Anmeldeseite **Passwort vergessen?** (ab Version 0.3). Ohne Mailversand: In phpMyAdmin (Datenbankverwaltung) in der Tabelle `konten` die Zeile des Admins löschen; dann ist die Einrichtungsseite wieder offen. |

## Sicherheit in Kürze

- Zugangsdaten liegen nur als GitHub-Secrets und in `config.php` außerhalb jedes Webroots (`/tt-turnier-server`).
- Passwörter und Zugangscodes speichert der Server nur als Prüfwert (Hash), nie im Klartext.
- Fehlversuche bei Anmeldung, Einrichtung und Leitungspasswort werden nach 10 Versuchen für 15 Minuten gebremst.
- Der GitHub-Zugang nutzt einen eigenen SFTP-Benutzer; bei Bedarf im Kundenlogin löschen.
