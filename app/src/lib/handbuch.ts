/**
 * Handbuch (Seite #/hilfe[/<kapitel>]): kurze Anleitungen je Aufgabe, nach Rollen filterbar und durchsuchbar.
 * Reiner Text (keine HTML-Auszeichnung) – die Seite stellt ihn als Absätze und Listen dar.
 */

export type HandbuchRolle = 'leitung' | 'helfer' | 'spieler' | 'zuschauer';

export interface HandbuchAbschnitt {
  titel: string;
  /** Absätze; ein Eintrag, der mit „• “ beginnt, wird als Listenpunkt dargestellt */
  text: string[];
}

export interface HandbuchKapitel {
  id: string;
  titel: string;
  /** Für wen das Kapitel gedacht ist */
  fuer: HandbuchRolle[];
  einleitung: string;
  abschnitte: HandbuchAbschnitt[];
}

export const ROLLEN_NAMEN: Record<HandbuchRolle, string> = {
  leitung: 'Turnierleitung',
  helfer: 'Helfer',
  spieler: 'Spieler',
  zuschauer: 'Zuschauer',
};

export const HANDBUCH: HandbuchKapitel[] = [
  {
    id: 'start',
    titel: 'Erste Schritte',
    fuer: ['leitung', 'helfer', 'spieler', 'zuschauer'],
    einleitung: 'Die App läuft im Browser auf Handy, Tablet und PC – ohne Installation. Wer welche Rechte hat, entscheidet die Kennung, mit der man ein Turnier öffnet.',
    abschnitte: [
      {
        titel: 'Rollen',
        text: [
          '• Turnierleitung: legt Turniere, Spieler und Konkurrenzen an, lost aus, trägt alles ein und verteilt Kennungen. Dafür braucht es ein Konto („Turnierleitung“) oder eine Leitungskennung.',
          '• Helfer: tragen je nach Aufgabe Ergebnisse ein, rufen Spiele auf, kassieren das Startgeld oder entscheiden als Oberschiedsrichter.',
          '• Spieler: sehen ihre Spiele unter „Meine Spiele“ und tragen ihre eigenen Ergebnisse ein.',
          '• Zuschauer: öffnen das Turnier nur mit der Turnierkennung und sehen Spiele, Tabellen und Ergebnisse – ohne etwas zu ändern.',
        ],
      },
      {
        titel: 'Einem Turnier beitreten',
        text: [
          'Auf der Startseite „Turnier beitreten“ wählen, die 8-stellige Turnierkennung eingeben und danach die eigene Kennung (Spieler-, Helfer- oder Leitungskennung). Ohne eigene Kennung bist du Zuschauer.',
          'Schneller geht es mit dem persönlichen Link oder QR-Code, den die Turnierleitung verteilt: einmal öffnen, fertig. Das Gerät merkt sich den Zugang.',
        ],
      },
      {
        titel: 'Ohne Internet',
        text: [
          'Eingetragenes gilt sofort auf dem Gerät und wird gesendet, sobald wieder Verbindung besteht. Oben steht, ob das Gerät verbunden ist und wie viele Einträge noch warten.',
          'In Hallen ohne Netz übernimmt ein Android-Handy oder -Tablet als „Zentrale“ die Rolle des Servers (Kapitel „Zentrale ohne Internet“).',
        ],
      },
    ],
  },
  {
    id: 'konto',
    titel: 'Konto der Turnierleitung',
    fuer: ['leitung'],
    einleitung: 'Mit einem Konto legst du Turniere an, führst einen Spielerpool und bekommst Sicherungen per Mail.',
    abschnitte: [
      {
        titel: 'Konto anlegen und verwalten',
        text: [
          '„Anmelden“ → „Konto anlegen“: Name, E-Mail und Passwort. Unter „Konto“ änderst du Passwort und Mail, pflegst deine Begriffe für Leistungsklassen und die Vorgaben für Kasse und Quittung.',
          'Ein Konto, das 12 Monate nicht genutzt wird, wird gelöscht – 30 Tage vorher kommt eine Erinnerung. Du kannst es unter „Konto“ jederzeit selbst löschen; dabei werden auch deine Turniere gelöscht.',
        ],
      },
      {
        titel: 'Grenzen zum Schutz vor Missbrauch',
        text: [
          '• Höchstens 20 neue Turniere am Tag und 300 Turniere je Konto – lösche alte Testturniere unter „Meine Turniere“ → Turnier → „Einstellungen“.',
          '• Die Online-Anmeldung steht neuen Konten nach 7 Tagen zur Verfügung. Der Administrator kann sie früher freischalten – schreib ihm über das Kontaktformular.',
          '• Höchstens 150 Sicherungsmails am Tag; die Sicherungsdatei kannst du jederzeit herunterladen.',
        ],
      },
    ],
  },
  {
    id: 'turnier',
    titel: 'Turnier anlegen',
    fuer: ['leitung'],
    einleitung: 'Ein Turnier hat einen Namen, ein Datum und beliebig viele Konkurrenzen (z. B. „Herren A“, „Damen“, „Doppel“).',
    abschnitte: [
      {
        titel: 'Schritt für Schritt',
        text: [
          '1. Angemeldet „Neues Turnier“ wählen, Name und Datum eintragen.',
          '2. Unter „Einstellungen“ festlegen, welche Angaben du führst (TTR, Klasse, Geschlecht, Jahrgang), wie viele Tische es gibt und was Spieler und Zuschauer sehen.',
          '3. Unter „Spieler“ alle Teilnehmenden anlegen – aus dem Spielerpool, per CSV-Import, über die Online-Anmeldung oder von Hand.',
          '4. Unter „Konkurrenzen“ je Konkurrenz Modus, Gewinnsätze und Wertung wählen und die Spieler melden.',
          '5. Auslosen, Vorschau prüfen, starten.',
        ],
      },
      {
        titel: 'Leistungsklassen',
        text: [
          'Spielen nur Gleichstarke gegeneinander, legt der Klassen-Assistent je Klasse oder TTR-Bereich eine eigene Konkurrenz an. Alternativ bildet die Auslosung Gruppen innerhalb einer Konkurrenz nur aus gleicher Klasse.',
        ],
      },
      {
        titel: 'Zugänge verteilen',
        text: [
          'Unter „Zugänge“ gibt es drei Bereiche: weitere Turnierleiter, Helfer und Spieler. Jede Person bekommt eine eigene 8-stellige Kennung – als Link, QR-Code oder auf dem Druckbogen. Kennungen lassen sich einzeln sperren und neu ausgeben.',
          'Einem Spieler kannst du zusätzlich Helfer-Rechte geben; er braucht dann nur eine Kennung.',
        ],
      },
    ],
  },
  {
    id: 'modi',
    titel: 'Turniermodi',
    fuer: ['leitung', 'helfer', 'spieler', 'zuschauer'],
    einleitung: 'Die üblichen Tischtennis-Turnierarten sind eingebaut. Gewertet wird nach der Wettspielordnung des DTTB (D 7.5), wahlweise nach ITTF.',
    abschnitte: [
      {
        titel: 'Übersicht',
        text: [
          '• Jeder gegen jeden: eine Gruppe, alle spielen gegeneinander.',
          '• Gruppen und K.-o.: Gruppenphase, die Besten jeder Gruppe kommen ins K.-o.; Gruppensieger sind gesetzt, Spieler aus derselben Gruppe treffen erst spät aufeinander.',
          '• K.-o.: einfaches Ausscheiden, wahlweise mit Spiel um Platz 3 und Trostrunde für die Verlierer der ersten Runde.',
          '• Doppel-K.-o.: wer zweimal verliert, scheidet aus (Gewinner- und Verliererrunde, Finale ggf. mit Wiederholung).',
          '• Schweizer System: feste Rundenzahl, Gegner mit gleicher Punktzahl, niemand spielt zweimal gegen denselben.',
          '• Kaiserturnier: Sieger steigen einen Tisch auf, Verlierer ab; am Ende zählt der Tisch.',
          '• Cup-System: Runden mit wechselnden Gegnern nach festem Plan.',
          '• Vorgabe: Schwächere bekommen Punkte vor, berechnet aus dem TTR-Unterschied.',
        ],
      },
      {
        titel: 'Gleichstand in der Tabelle (DTTB D 7.5)',
        text: [
          'Bei Gleichstand entscheiden der Reihe nach: mehr Pluspunkte, weniger Minuspunkte, Satzdifferenz und Balldifferenz aller Gruppenspiele, dann die Spiele der Gleichstehenden untereinander, zuletzt das Los. Nach ITTF zählt der direkte Vergleich zuerst.',
          'Zieht jemand zurück, werden nach der Wettspielordnung seine Spiele gestrichen (umschaltbar: gespielte bleiben, der Rest gilt als kampflos verloren).',
        ],
      },
    ],
  },
  {
    id: 'auslosung',
    titel: 'Auslosung und Änderungen',
    fuer: ['leitung'],
    einleitung: 'Gelost wird per Zufall oder von Hand. Die Auslosung wird mit dem Ergebnis gespeichert, damit alle Geräte genau dasselbe sehen.',
    abschnitte: [
      {
        titel: 'Auslosen',
        text: [
          'Unter „Konkurrenzen“ → Konkurrenz → „Auslosen“: Die App schlägt Gruppengröße und Setzung (nach TTR) vor. In der Vorschau kannst du Spieler tauschen, bevor du startest.',
          'Freilose gehen zuerst an Gesetzte, Setzpositionen 1 oben, 2 unten, 3 und 4 gelost.',
        ],
      },
      {
        titel: 'Nach dem Start',
        text: [
          '• Nachmelden: Wer zu spät kommt, kommt in eine Gruppe oder auf ein Freilos im K.-o.',
          '• Auslosung ändern: Spieler tauschen, die noch nicht gespielt haben (Gespieltes ist mit 🔒 markiert).',
          '• Rückgängig: Fast jeder Eintrag lässt sich im Hinweis unten oder im Protokoll zurücknehmen und wiederherstellen. Die App prüft vorher, dass dabei keine Ergebnisse verloren gehen.',
          '• Konkurrenzen zusammenlegen, wenn zu wenige gemeldet haben.',
        ],
      },
    ],
  },
  {
    id: 'ergebnisse',
    titel: 'Ergebnisse eintragen',
    fuer: ['leitung', 'helfer', 'spieler'],
    einleitung: 'Ergebnisse gelten sofort. Eingetragen werden die Satzgewinner und die Punkte des Verlierers – „11:7“ ist mit zwei Tipps erledigt.',
    abschnitte: [
      {
        titel: 'So geht es',
        text: [
          'Spiel antippen, je Satz den Gewinner wählen und die Punkte des Verlierers eintragen. Bei Verlängerung (z. B. 13:11) die höheren Punkte eingeben. Je Konkurrenz kann die Leitung „nur Satzstand“ einstellen.',
          'Auf dem Spielzettel steht ein QR-Code: scannen, und das Spiel öffnet sich zum Eintragen.',
        ],
      },
      {
        titel: 'Spieler tragen selbst ein',
        text: [
          'Spieler tragen nur ihre eigenen Spiele ein. Der Gegner kann bestätigen oder anfechten. Bei einer Anfechtung entscheidet die Turnierleitung bzw. der Oberschiedsrichter; das nächste K.-o.-Spiel bleibt so lange gesperrt.',
          'Im Protokoll steht, wer was wann eingetragen hat.',
        ],
      },
      {
        titel: 'Aufgabe, Nichtantreten',
        text: [
          'Bei Aufgabe wird der laufende Satz mit X:11 gewertet und die restlichen Sätze mit 0:11; ein kampfloses Spiel zählt 0:11 je Satz (DTTB D 7.10).',
        ],
      },
    ],
  },
  {
    id: 'tische',
    titel: 'Tische, Spielaufruf und Zeitplan',
    fuer: ['leitung', 'helfer', 'spieler'],
    einleitung: 'Im Reiter „Tische“ siehst du, was wo gespielt wird und welche Spiele als Nächstes dran sind.',
    abschnitte: [
      {
        titel: 'Aufrufen',
        text: [
          'Ein Spiel auf einen freien Tisch ziehen (Griff ⠿) oder unter „Nächste Spiele“ antippen. Auf Wunsch belegt das Gerät freie Tische automatisch, berücksichtigt die Mindestpause und sagt den Aufruf an.',
          'Wer gerade an einem Tisch spielt, wird nicht ein zweites Mal aufgerufen. Gesperrte Tische (nur Leitung) bleiben frei.',
        ],
      },
      {
        titel: 'Aufruf aufs Handy',
        text: [
          'Spieler mit geöffneter App (Reiter „Meine Spiele“) bekommen beim Aufruf Ton, Vibration und einen Hinweis. Zuschauer können unter „Spiele“ einem Spieler folgen. Das klappt nur, solange die App geöffnet ist – ein Dienst von Google oder Apple wird bewusst nicht benutzt.',
        ],
      },
      {
        titel: 'Zeitplan',
        text: [
          'Die App schätzt das Turnierende aus der Zahl der Tische und der Spieldauer (2 Minuten Einspielen plus erwartete Sätze) und lernt aus den bisherigen Spielen. Die Leitung kann Spiele fest für Tisch und Uhrzeit planen.',
        ],
      },
    ],
  },
  {
    id: 'helfer',
    titel: 'Helfer und ihre Aufgaben',
    fuer: ['leitung', 'helfer'],
    einleitung: 'Jede Helferkennung hat eine oder mehrere Aufgaben. Die Turnierleitung stellt sie unter „Zugänge“ ein; Änderungen gelten sofort.',
    abschnitte: [
      {
        titel: 'Aufgaben',
        text: [
          '• Ergebnisse: alle Ergebnisse eintragen (gelten amtlich, ohne Bestätigung).',
          '• Spielaufruf (Sprecher): Spiele an Tische aufrufen und Aufrufe zurücknehmen.',
          '• Kasse: Check-in und Startgeld; nur die Kasse sieht Zahlungen und die Bankverbindung.',
          '• Oberschiedsrichter: Ergebnisse eintragen, Anfechtungen entscheiden und Ergebnisse löschen.',
        ],
      },
    ],
  },
  {
    id: 'mannschaft',
    titel: 'Mannschaftsturniere',
    fuer: ['leitung', 'helfer', 'spieler'],
    einleitung: 'Mannschaften aus den Spielern des Turniers, Begegnungen mit Einzeln und Doppeln nach einem Spielsystem der Wettspielordnung.',
    abschnitte: [
      {
        titel: 'Anlegen',
        text: [
          '1. Unter „Konkurrenzen“ eine neue Konkurrenz mit „Mannschaft“ anlegen und das Spielsystem wählen: Bundessystem, Werner-Scheffler-System, Sechser-Paarkreuz-System, Corbillon-Cup, Olympisches System, Swaythling-Cup oder eine eigene Spielfolge. Möglich sind Gruppen + K.-o., Jeder gegen jeden und K.-o.',
          '2. Bei der Konkurrenz „Mannschaft melden“: Name, Verein, Spieler (mehr als nötig ist erlaubt) und die Mannschaftsführung wählen.',
          '3. Auslosen und starten wie bei Einzeln. Jede Begegnung belegt einen Tisch.',
        ],
      },
      {
        titel: 'Aufstellung und Ergebnisse',
        text: [
          'Ein Tipp auf die Begegnung öffnet die Aufstellungen und die Spiele. Die Mannschaftsführung gibt mit ihrer Spielerkennung die Aufstellung ab – die des Gegners sieht sie erst, wenn beide abgegeben haben. Leere Positionen gehen kampflos an den Gegner.',
          'Spieler tragen ihre eigenen Spiele ein, die Mannschaftsführung alle Spiele ihrer Begegnung; der Gegner bestätigt wie gewohnt. Leitung und Helfer tragen amtlich ein.',
          'Ist die Begegnung entschieden, entfallen die übrigen Spiele (außer bei „Alle Spiele austragen“). Sieg 2:0, Unentschieden 1:1 Punkte. Tabelle nach Punkten, Spiel-, Satz- und Balldifferenz, dann direkter Vergleich. Im K.-o. entscheiden bei Gleichstand Sätze, dann Bälle, dann das Los der Turnierleitung.',
          'Unter „Drucken“ gibt es den Spielbericht je Begegnung mit Aufstellungen, Satzergebnissen und Unterschriftenfeldern.',
        ],
      },
      {
        titel: 'Startgeld',
        text: ['Das Startgeld einer Mannschafts-Konkurrenz gilt je Spieler der Mannschaft. Mannschaften meldet die Turnierleitung von Hand – über die Online-Anmeldung werden sie nicht angeboten.'],
      },
    ],
  },
  {
    id: 'anmeldung',
    titel: 'Online-Anmeldung',
    fuer: ['leitung', 'spieler'],
    einleitung: 'Spieler melden sich über einen Link selbst an. Ist eine Konkurrenz voll, kommen sie auf die Warteliste und rücken automatisch nach.',
    abschnitte: [
      {
        titel: 'Für die Turnierleitung',
        text: [
          'Reiter „Anmeldungen“ (nur online): Konkurrenzen auswählen, Meldeschluss und Hinweis eintragen, öffnen. Höchstzahl und Startgeld stellst du je Konkurrenz ein. Den Link bzw. QR-Code gibst du weiter, etwa in der Turnierausschreibung.',
          'Mit „Übernehmen“ kommen bestätigte Anmeldungen ins Turnier. Doppel bildest du selbst, der Partnerwunsch steht in der Liste.',
          'Neue Konten können die Anmeldung erst nach 7 Tagen öffnen (Schutz vor Missbrauch), außer der Administrator schaltet sie früher frei.',
        ],
      },
      {
        titel: 'Für Spieler',
        text: [
          'Formular ausfüllen, dann den Link in der Mail öffnen und „Anmeldung jetzt bestätigen“ tippen – erst dann gibt es einen Platz. Über denselben Link siehst du deinen Stand (Platz oder Warteliste), das Startgeld mit GiroCode für die Banking-App und kannst dich bis zum Vortag abmelden.',
          'Bist du unter 18, müssen deine Erziehungsberechtigten einverstanden sein.',
          'Anmeldungen werden 30 Tage nach dem Turniertag gelöscht, unbestätigte nach 24 Stunden.',
        ],
      },
    ],
  },
  {
    id: 'kasse',
    titel: 'Kasse, Check-in und Quittungen',
    fuer: ['leitung', 'helfer'],
    einleitung: 'Im Reiter „Kasse & Check-in“ checkst du Spieler am Turniertag ein und buchst das Startgeld.',
    abschnitte: [
      {
        titel: 'Ablauf',
        text: [
          '1. Unter „Einstellungen“ → „Kasse und Quittung“ Verein, Anschrift und – für Überweisungen – die IBAN eintragen. Vorgaben fürs nächste Turnier stehen im Konto.',
          '2. Je Konkurrenz das Startgeld festlegen.',
          '3. Am Turniertag: Spieler suchen, „Da“ tippen, Betrag als bar, Überweisung oder erlassen buchen. Die Quittung lässt sich sofort drucken oder als PDF speichern.',
          '4. Vor der Auslosung räumt „Nicht Eingecheckte streichen“ die Meldelisten auf.',
        ],
      },
      {
        titel: 'Wichtig',
        text: [
          'Buchungen lassen sich nur stornieren, nicht rückgängig machen – so bleiben ausgegebene Quittungen gültig. Ob ein Umsatzsteuer-Hinweis auf die Quittung gehört, entscheidet ihr als Verein (im Zweifel steuerlich beraten lassen).',
          'Ändert jemand anderes als dein Konto die IBAN, bekommst du eine Mail.',
        ],
      },
      {
        titel: 'Ohne Netz kassieren',
        text: [
          'Jemand zahlt vorab, z. B. beim Training in der Halle ohne Netz? Kein Problem: Öffne das Turnier einmal mit Netz auf deinem Handy (als Leitung oder mit einer Helferkennung mit Aufgabe Kasse). Danach öffnen sich App und Turnier auch offline. Buchungen und Check-ins werden auf dem Handy gespeichert und automatisch nachgetragen, sobald wieder Netz da ist. Oben steht so lange „Kein Netz“ und die Zahl der wartenden Einträge.',
        ],
      },
    ],
  },
  {
    id: 'anzeige',
    titel: 'Live-Anzeige, Druck und Export',
    fuer: ['leitung', 'helfer', 'zuschauer'],
    einleitung: 'Für Beamer, Aushang und Siegerehrung.',
    abschnitte: [
      {
        titel: 'Live-Anzeige',
        text: [
          'Unter „Drucken“ → „Live-Anzeige“ (oder #/live/<Turnierkennung>) am Laptop mit Beamer oder Fernseher öffnen und auf Vollbild stellen. Die Seiten wechseln von selbst, neue Aufrufe erscheinen groß, auf Wunsch mit Ansage.',
        ],
      },
      {
        titel: 'Drucken und Export',
        text: [
          'Spielzettel mit QR-Code, Gruppenübersichten, K.-o.-Baum, Ergebnisliste, Teilnehmerliste, Aushang, Urkunden, Kassenliste und Quittungen. Am Handy und in der Zentrale öffnet sich der Druckdialog – dort gibt es auch „Als PDF speichern“.',
          'CSV-Export für Excel: Spieler, Ergebnisse und Endstand.',
        ],
      },
    ],
  },
  {
    id: 'sichtbarkeit',
    titel: 'Was sehen Spieler und Zuschauer?',
    fuer: ['leitung', 'spieler', 'zuschauer'],
    einleitung: 'Zuschauer brauchen nur die Turnierkennung. Sie sehen so wenig persönliche Angaben wie möglich.',
    abschnitte: [
      {
        titel: 'Datenschutz',
        text: [
          '• Jahrgang, Geschlecht, Startgeld, Check-in und Bankverbindung sehen nur Turnierleitung und Kasse.',
          '• Zuschauer sehen nicht, wer etwas eingetragen hat, und keine frei eingetippten Schiedsrichter-Namen.',
          '• Die Leitung kann Nachnamen für Zuschauer abkürzen („Max M.“) – bei Jugendturnieren empfohlen.',
          '• Entfernte Spieler erscheinen für Spieler und Zuschauer nur noch als „Entfernt“, auch im Protokoll.',
        ],
      },
      {
        titel: 'Verdeckte Stände',
        text: [
          'Tabellen, Platzierungen und den K.-o.-Baum kann die Leitung bis zur Siegerehrung verdecken und dann mit „Ergebnisse veröffentlichen“ aufdecken. Einzelne Ergebnisse bleiben sichtbar, damit jeder weiß, wann er spielt – wer alle mitschreibt, könnte den Stand also selbst ausrechnen. Verdecken sorgt für Spannung, ist aber kein Geheimnis.',
        ],
      },
    ],
  },
  {
    id: 'sicherung',
    titel: 'Sicherung und Abschluss',
    fuer: ['leitung'],
    einleitung: 'Online-Turniere werden regelmäßig per Mail gesichert, Turniere auf einem einzelnen Gerät als Datei.',
    abschnitte: [
      {
        titel: 'Sicherung',
        text: [
          'Unter „Einstellungen“ stellst du bis zu 3 Empfänger und den Takt ein (Standard: alle 30 Minuten, nur bei Änderungen). Die Mail enthält eine lesbare Übersicht und die Sicherungsdatei. Fügt jemand mit einer Leitungskennung Empfänger hinzu, bekommt dein Konto eine Mail.',
          '„Wiederherstellen“ (Startseite) legt aus einer Sicherungsdatei ein neues Turnier an.',
        ],
      },
      {
        titel: 'Abschließen und löschen',
        text: [
          '„Turnier abschließen“ verschickt eine letzte Sicherung. Danach bleibt das Turnier lesbar, bis du es unter „Einstellungen“ löschst oder das Konto gelöscht wird.',
        ],
      },
    ],
  },
  {
    id: 'zentrale',
    titel: 'Zentrale ohne Internet',
    fuer: ['leitung'],
    einleitung: 'In Hallen ohne Netz wird ein Android-Gerät zur Zentrale: Es spannt ein WLAN auf, alle anderen Geräte (auch iPads) treten per QR-Code bei.',
    abschnitte: [
      {
        titel: 'So geht es',
        text: [
          '1. Die App „TT-Zentrale“ (APK aus dem GitHub-Release „zentrale“) auf dem Android-Gerät installieren.',
          '2. Handy-Hotspot einschalten (oder Hallen-WLAN nutzen), Name und Passwort in der App eintragen – daraus entsteht ein QR-Code zum Verbinden.',
          '3. Ein Online-Turnier mit „Übernehmen“ auf die Zentrale holen (online ist es dann gesperrt) und nach dem Turnier zurückgeben – oder direkt auf der Zentrale ein Turnier anlegen.',
          '4. Gerät am Strom lassen; die Zentrale hält den Bildschirm-Schlaf vom Server fern.',
        ],
      },
      {
        titel: 'Einzelgerät',
        text: [
          'Ganz ohne Server läuft ein Turnier auf einem einzigen Gerät (Demo oder Zentrale). Denk an die Sicherungsdatei – die App erinnert dich daran.',
        ],
      },
    ],
  },
  {
    id: 'probleme',
    titel: 'Wenn etwas nicht klappt',
    fuer: ['leitung', 'helfer', 'spieler', 'zuschauer'],
    einleitung: 'Die häufigsten Fragen.',
    abschnitte: [
      {
        titel: 'Häufige Fragen',
        text: [
          '• „Nicht angemeldet – Einträge werden nicht gesendet“: Die Kennung wurde gesperrt oder neu ausgegeben. Neuen Link von der Turnierleitung holen.',
          '• „Eintrag abgelehnt“: Der Server hat einen Eintrag nicht angenommen, etwa weil deine Kennung diese Aufgabe nicht hat. Mit „Verwerfen“ entfernen.',
          '• Einträge warten: Das Gerät ist offline. Einfach weitermachen – gesendet wird automatisch.',
          '• Zu viele Versuche: Nach mehreren falschen Kennungen bremst der Server. Ein paar Minuten warten.',
          '• Fehler gefunden oder Wunsch? Über „Kontakt“ unten auf jeder Seite.',
        ],
      },
    ],
  },
];

/** Suchtext eines Kapitels (klein geschrieben) */
function suchtext(k: HandbuchKapitel): string {
  return [k.titel, k.einleitung, ...k.abschnitte.flatMap((a) => [a.titel, ...a.text])].join(' ').toLocaleLowerCase('de');
}

/** Kapitel für Rolle (null = alle) und Suchbegriffe (alle Wörter müssen vorkommen) */
export function handbuchFiltern(rolle: HandbuchRolle | null, suche: string): HandbuchKapitel[] {
  const woerter = suche.toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
  return HANDBUCH.filter((k) => (rolle === null || k.fuer.includes(rolle)) && woerter.every((w) => suchtext(k).includes(w)));
}
