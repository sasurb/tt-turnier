# Einrichtung auf Strato – Schritt für Schritt

Ziel: Die App läuft unter **https://tt-turnier.saschaurban.de** mit eigener Datenbank. Danach
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
| `SFTP_ZIEL` | `tt-turnier` |
| `DB_HOST` | aus Schritt 1 |
| `DB_NAME` | aus Schritt 1 |
| `DB_USER` | aus Schritt 1 |
| `DB_PASSWORT` | aus Schritt 1 |
| `SETUP_CODE` | aus Schritt 3 |

3. Optional, für eine automatische Prüfung nach jedem Hochladen: Reiter **Variables** →
   **New repository variable**, Name `WEBSPACE_URL`, Wert `https://tt-turnier.saschaurban.de`.

## Schritt 5 – Erstes Hochladen auslösen

1. Auf GitHub **Actions** → links **Veröffentlichen** → rechts **Run workflow** → **Run workflow**.
2. Nach 2–3 Minuten sollten alle Schritte grün sein. Der Schritt **Webspace (SFTP)** hat dann
   auf deinem Webspace angelegt:

```
/tt-turnier/
   public/      ← App und Schnittstelle (hierauf zeigt gleich die Subdomain)
   src/         ← Programmcode des Servers (von außen nicht erreichbar)
   config.php   ← Datenbank-Zugang und Einrichtungscode (von außen nicht erreichbar)
```

Wenn der Schritt rot ist: siehe [Probleme lösen](#probleme-lösen).

## Schritt 6 – Subdomain anlegen und auf den Ordner zeigen lassen

1. Im Strato-Kundenlogin **Domains → Domainverwaltung**.
2. Bei `saschaurban.de` **Subdomain anlegen**, Name `tt-turnier`, bestätigen.
3. Die neue Subdomain öffnen (**Subdomains anzeigen** → `tt-turnier.saschaurban.de`) →
   **Umleitung / Ziel** → **intern** → Verzeichnis **`/tt-turnier/public`** wählen → speichern.
4. **SSL** für die Subdomain einschalten (in der Domainverwaltung bei der Subdomain,
   „SSL-Schutz“ bzw. „SSL verwalten“). Das kann einige Minuten dauern.
5. **PHP-Version prüfen:** unter **Datenbanken und Webspace → PHP-Version** mindestens **PHP 8.1** einstellen
   (empfohlen: die neueste angebotene 8.x-Version).

> Wichtig: Ziel ist **`/tt-turnier/public`**, nicht `/tt-turnier`. Nur so bleiben `config.php`
> und der Programmcode von außen unerreichbar.

## Schritt 7 – Administrator anlegen

1. https://tt-turnier.saschaurban.de öffnen. Oben erscheint „Der Server ist noch nicht eingerichtet“.
2. **Server einrichten** antippen, den **Einrichtungscode** aus Schritt 3, deinen Namen,
   deine E-Mail-Adresse und ein Passwort eingeben → **Administrator anlegen**.
3. **Anmelden**. Unter **Mein Konto** siehst du die Verwaltung: Hier legst du Veranstalter-Konten an
   und siehst, wer die App nutzt.

## Schritt 8 – Abgleich mit zwei Geräten testen

1. Unter **Mein Konto → Neues Turnier**: Name, Datum und Leitungspasswort eingeben → **Turnier anlegen**.
2. **Teilen** öffnen und den Link auf ein zweites Gerät schicken (z. B. per Messenger).
3. Auf dem zweiten Gerät den Link öffnen → **Als Leitung anmelden** mit dem Leitungspasswort.
4. Auf einem Gerät einen **Testeintrag** machen: Er erscheint nach wenigen Sekunden auf dem anderen.
5. Gegenprobe: Auf dem zweiten Gerät WLAN und mobile Daten ausschalten, etwas eintragen
   („wird gesendet“), wieder einschalten: Der Eintrag kommt beim ersten Gerät an.

Fertig. Ab jetzt landet jede neue Version auf `main` automatisch auf dem Webspace.

---

## Probleme lösen

| Anzeichen | Ursache und Abhilfe |
|---|---|
| Actions: „Webspace-Deploy übersprungen, es fehlen Secrets“ | Ein Secret fehlt oder ist falsch geschrieben (Schritt 4). Namen genau vergleichen. |
| Actions: `Login failed` / `Access failed` beim SFTP | `SFTP_HOST`, `SFTP_USER` oder `SFTP_PASSWORT` falsch. Im Kundenlogin das Passwort des Zugangs neu setzen und das Secret überschreiben. |
| Subdomain zeigt „Verzeichnis nicht gefunden“ | Schritt 5 lief noch nicht erfolgreich, oder das Ziel ist falsch geschrieben (genau `/tt-turnier/public`, alles klein). |
| App zeigt „Kein Server erreichbar“ | `https://tt-turnier.saschaurban.de/api/index.php?r=info` im Browser öffnen. Kommt eine Fehlermeldung zu PHP, die PHP-Version prüfen (Schritt 6.5). |
| `…?r=info` meldet „Keine Verbindung zur Datenbank“ | Datenbank-Secrets prüfen (Schritt 1/4), danach **Run workflow** erneut ausführen. Neue Strato-Datenbanken sind manchmal erst nach einigen Minuten erreichbar. |
| „Der Einrichtungscode ist falsch“ | Code exakt wie im Secret `SETUP_CODE` eingeben (Groß-/Kleinschreibung). Nach 10 Fehlversuchen 15 Minuten warten. |
| Passwort des Administrators vergessen | In phpMyAdmin (Datenbankverwaltung) in der Tabelle `konten` die Zeile des Admins löschen; dann ist die Einrichtungsseite wieder offen. |

## Sicherheit in Kürze

- Zugangsdaten liegen nur als GitHub-Secrets und in `config.php` außerhalb des öffentlichen Ordners.
- Passwörter und Zugangscodes speichert der Server nur als Prüfwert (Hash), nie im Klartext.
- Fehlversuche bei Anmeldung, Einrichtung und Leitungspasswort werden nach 10 Versuchen für 15 Minuten gebremst.
- Der GitHub-Zugang nutzt einen eigenen SFTP-Benutzer; bei Bedarf im Kundenlogin löschen.
