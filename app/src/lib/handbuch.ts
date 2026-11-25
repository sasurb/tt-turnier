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
          'Auf der Startseite „Turnier beitreten“ wählen, die Turnierkennung eingeben und danach die eigene Kennung (Spieler-, Helfer- oder Leitungskennung). Ohne eigene Kennung bist du Zuschauer.',
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
    titel: 'Konto, Verein und Sparte',
    fuer: ['leitung'],
    einleitung:
      'Turniere, Spielerpool, Leistungsklassen und Kasse-Vorgaben gehören eurer Sparte (z. B. „TTC Musterstadt – Tischtennis“). Mit einem Konto gehörst du zur Sparte – als Spartenleitung oder als Turnierleitung.',
    abschnitte: [
      {
        titel: 'Konto anlegen',
        text: [
          '„Anmelden“ → „Konto anlegen“: dein Name, E-Mail, Passwort, Verein und Sparte. Konten gibt es ab 18; du stimmst den Nutzungsbedingungen mit der Vereinbarung zur Auftragsverarbeitung für deinen Verein zu. Damit bist du Spartenleitung.',
          'Wurdest du eingeladen, öffne den Link aus der Mail und lege dort ein Konto mit genau dieser Adresse an – oder melde dich an, wenn du schon eines hast.',
        ],
      },
      {
        titel: 'Rollen in der Sparte',
        text: [
          '• Spartenleitung: leitet alle Turniere der Sparte, lädt Personen ein (Spartenleitung oder Turnierleitung), gibt Turnierleitungen das Recht „Turniere anlegen“, verwaltet Ausschüsse und Veranstaltungen. Es kann mehrere Spartenleitungen geben.',
          '• Turnierleitung: leitet die Turniere, zu denen sie eingeladen wurde (unter „Zugänge“ → „Turnierleitung mit Konto“); mit dem Recht „Turniere anlegen“ legt sie selbst welche an. Sie arbeitet mit dem Spielerpool der Sparte.',
          '• Ohne Konto geht es weiter mit Kennungen: Leitungs-, Helfer- und Spielerkennungen gelten nur für ein Turnier.',
          'Mehrere Sparten (z. B. eigene Jugendabteilung): unter „Sparte“ → „Weitere Sparte anlegen“. Welche Sparte gerade gilt, wählst du dort; öffnest du ein Turnier, gilt seine Sparte.',
        ],
      },
      {
        titel: 'Ausschüsse und Veranstaltungen',
        text: [
          'Für Aufgaben außerhalb der Turniere (Sommerfest, Weihnachtsfeier, Fahrradtour) legt die Spartenleitung Ausschüsse an. Mitglieder laden weitere ein, können Mitglieder sperren und schreiben sich Nachrichten (werden nach 12 Monaten gelöscht). Ausschussmitglieder sehen keine Turniere und keinen Pool.',
          'Veranstaltungen sind vorerst nur eine Liste (Name, Datum, zuständiger Ausschuss); Planung und Anmeldung folgen später.',
        ],
      },
      {
        titel: 'Löschen',
        text: [
          'Ein Konto, das 12 Monate nicht genutzt wird, wird gelöscht – 30 Tage vorher kommt eine Erinnerung. Ist es die einzige Spartenleitung, wird die Sparte mit allen Turnieren mitgelöscht; alle Mitglieder bekommen 30 Tage vorher eine Mail. Ladet deshalb besser zwei Spartenleitungen ein.',
          'Selbst löschen: Konto unter „Konto“, Sparte unter „Sparte“ → „Sparte löschen“ (beides mit Passwort).',
        ],
      },
      {
        titel: 'Grenzen zum Schutz vor Missbrauch',
        text: [
          '• Höchstens 20 neue Turniere am Tag je Konto und 300 Turniere je Sparte – lösche alte Testturniere unter „Meine Turniere“ → Turnier → „Einstellungen“.',
          '• Die Online-Anmeldung steht neuen Sparten nach 7 Tagen zur Verfügung. Der Administrator kann sie früher freischalten – schreib ihm über das Kontaktformular.',
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
        titel: 'Schnelles Spiel und Favoriten',
        text: [
          'Schnelles Spiel (Startseite): ohne Anmeldung Spielsystem wählen, Namen eintippen, los – nur auf diesem Gerät. Mit Konto lässt es sich später unter „Einstellungen“ in ein Turnier deiner Sparte übernehmen.',
          'Favoriten: Beim Anlegen einer Konkurrenz speichert „☆ Als Favorit speichern“ alle Vorgaben (Spielsystem, Gewinnsätze, Startgeld, Mannschaft …). Beim nächsten Turnier wählst du den Favoriten oben aus. Mit Konto gehören Favoriten der Sparte, ohne Konto dem Gerät.',
        ],
      },
      {
        titel: 'Schritt für Schritt',
        text: [
          '1. Angemeldet „Neues Turnier“ wählen, Name und Datum eintragen. „Weiter: Turnier einrichten“ führt in 8 Schritten durch alles Wesentliche (siehe unten); „Turnier anlegen“ legt sofort an und lässt alles offen.',
          '2. Unter „Konkurrenzen“ ganz oben festlegen, welche Angaben du führst (TTR, Klasse, Geschlecht, Jahrgang) und wie viele Tische es gibt; darunter die Konkurrenzen mit Modus, Gewinnsätzen und Wertung anlegen.',
          '3. Unter „Teilnehmer“ alle Teilnehmenden anlegen – aus dem Spielerpool, über die Online-Anmeldung oder von Hand. Mit „Gleich melden für“ landen sie direkt in den angehakten Konkurrenzen.',
          '4. Darunter, unter „Teilnehmer je Konkurrenz“, für jede Konkurrenz festlegen, wer mitspielt – nicht jeder spielt überall mit. Im Doppel bildest du dort die Paare, bei Mannschaften die Teams.',
          '5. Unter „Konkurrenzen“ auslosen, Vorschau prüfen, starten. Was Spieler und Zuschauer sehen, stellst du unter „Einstellungen“ ein.',
          '6. Deinen Spielerpool für alle Turniere pflegst du im Reiter „Spielerpool“ (auch CSV-Import und -Export).',
        ],
      },
      {
        titel: 'Startassistent',
        text: [
          'Der Assistent fragt nacheinander: Angaben (Name, Datum, Ort, Tische, Betriebsart), Konkurrenzarten (Einzel, Doppel, Mixed, Mannschaft), Spielsysteme, Leistungsklassen (keine, eigene Begriffe, TTR mit Vorlage), Online-Anmeldung und Kasse, was Spieler und Zuschauer sehen (Tabellen, K.-o.-Baum, Namen voll oder „Max M.“) und wer mit einträgt. Zum Schluss steht alles in einer Zusammenfassung. Jeder Schritt hat ein ⓘ mit Erklärung.',
          'Unter „Konkurrenzen“ stehen danach nur die gewählten Arten und Spielsysteme zur Wahl. Das hält die Formulare kurz.',
        ],
      },
      {
        titel: 'Konkurrenzarten und Spielsysteme ändern',
        text: [
          'Unter „Einstellungen“ → „Konkurrenzarten und Spielsysteme“ stehen alle Arten und Systeme zum Anhaken; die gewählten sind angehakt. Bevor etwas übernommen wird, zeigt die App, was passiert:',
          '• Eine abgewählte Art löscht ihre Konkurrenzen mit Meldungen und Auslosung – nur solange es dort keine Ergebnisse gibt. „Rückgängig“ holt sie zurück.',
          '• Ein abgewähltes Spielsystem stellt noch nicht gestartete Konkurrenzen auf ein gewähltes um. Laufende Konkurrenzen behalten ihr System; dann lässt es sich nicht abwählen.',
          '• Die Spieler bleiben im Turnier. Wer danach in keiner Konkurrenz mehr steht, ist unter „Teilnehmer“ markiert und lässt sich dort gesammelt in eine Einzel-Konkurrenz melden.',
        ],
      },
      {
        titel: 'Leistungsklassen',
        text: [
          'Spielen nur Gleichstarke gegeneinander, legt der Klassen-Assistent je Klasse oder TTR-Bereich eine eigene Konkurrenz an. Alternativ bildet die Auslosung Gruppen innerhalb einer Konkurrenz nur aus gleicher Klasse.',
          'Für TTR-Bereiche gibt es Vorlagen: DTTB-Klassen E–A, Hobby-Stufen H1–H4 oder beides auf einer Skala (H3 entspricht der E-Klasse bis 1250, H4 der D-Klasse bis 1450). Klassen haben nur eine Obergrenze – wer darunter liegt, darf auch höher starten. Für Damen-Konkurrenzen lassen sich die Grenzen der Klassen D bis B um 150 oder 200 Punkte senken.',
        ],
      },
      {
        titel: 'Hobbyspieler ohne TTR',
        text: [
          'Wer keinen Q-TTR-Wert hat, wird mit 4 Fragen eingestuft („Kein TTR? Einstufen“ beim Anlegen, in der Online-Anmeldung automatisch). Gefragt wird nach Spielpraxis, Aufschlag und Rückschlag, Schlagtechnik und Taktik; jede Antwort zählt 0 bis 3 Punkte. Daraus ergibt sich ein geschätzter Startwert: H1 900 (0–2 Punkte), H2 1025 (3–5), H3 1175 (6–9), H4 1350 (10–12), dazu ein kurzer Text, was die Stufe bedeutet. Gespeichert wird nur der Wert.',
          'Geschätzte Werte passen sich nach jedem gespielten Einzel an (auch nach den Einzeln einer Mannschaftsbegegnung, nicht nach Doppeln), wie beim TTR (in den ersten 5 App-Spielen doppelt so schnell). Im laufenden Turnier zählen weiter die Startwerte. Unter „Teilnehmer“ → „App-Wertung der Hobbyspieler“ übernimmst du die neuen Werte nach dem Turnier in deinen Spielerpool. Amtliche TTR-Werte ändert die App nie.',
          'Ein reines Hobby-Turnier stellst du je Konkurrenz unter „Weitere Einstellungen“ → „Nur Hobbyspieler“ ein. Ohne dieses Häkchen spielen Hobby- und Vereinsspieler gemischt, getrennt nur über die Obergrenze „TTR bis“.',
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
          '• Gruppen + Platzierungsgruppen: Vorrunde in Gruppen, danach spielen die Gleichplatzierten aller Gruppen neu jeder gegen jeden (bei 2 Gruppen à 4: Erste und Zweite um Platz 1–4, Dritte und Vierte um Platz 5–8). Vorrunden-Ergebnisse zählen nicht mit. Ergibt eine vollständige Gesamtplatzierung für Ergebnisliste, Urkunden und Siegerehrung. Gestartet wird die Platzierungsrunde unter „Konkurrenzen“, sobald alle Vorrundentabellen fertig sind.',
          '• Zweite Stufe: Bei „Gruppen und K.-o.“ und „Gruppen + Platzierungsgruppen“ lassen sich für die Endrunde eigene Gewinnsätze (und bei Mannschaften ein eigenes Spielsystem) einstellen.',
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
          'Zieht jemand zurück, werden nach der Wettspielordnung seine Spiele gestrichen (umschaltbar: gespielte bleiben, der Rest gilt als kampflos verloren). Bei Gruppen + Platzierungsgruppen gilt das je Stufe: Ein Rückzug in der Platzierungsrunde ändert die Vorrundentabellen nicht.',
          'War der Rückzug ein Versehen, nimmt „Spielt wieder mit“ ihn zurück – solange dadurch kein Spiel mit Ergebnis anders ausginge (im K.-o. also nicht mehr, wenn der Gegner schon weitergespielt hat).',
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
        titel: 'Sollstärke, Ersatzregel, Wechsel',
        text: [
          'Sollstärke: wie viele Spieler eine Mannschaft melden muss bzw. darf (leer = aus dem Spielsystem). Gilt für Meldung, Online-Anmeldung und Check-in.',
          'Ersatzregel bei Unterbesetzung: Statt fehlende Positionen kampflos abzugeben (Wettspielordnung), dürfen Anwesende bis zu der eingestellten Zahl von Positionen zusätzlich übernehmen – in der Aufstellung steht ein Spieler dann auf zwei Positionen.',
          'Wechsel in der Begegnung: In der Aufstellung kann die Mannschaftsführung für einzelne Einzel einen anderen Spieler der Mannschaft einsetzen. Wechselspieler zählen nicht für die Setzung (TTR-Durchschnitt der Stammspieler).',
        ],
      },
      {
        titel: 'Anlegen',
        text: [
          '1. Unter „Konkurrenzen“ eine neue Konkurrenz mit „Mannschaft“ anlegen und das Spielsystem wählen: Bundessystem, Werner-Scheffler-System, Sechser-Paarkreuz-System, Braunschweiger System, Corbillon-Cup, Zweier-System (2 Einzel + Doppel), Olympisches System, Swaythling-Cup oder eine eigene Spielfolge. Möglich sind Gruppen + K.-o., Gruppen + Platzierungsgruppen, Jeder gegen jeden und K.-o.',
          '2. Bei der Konkurrenz „Mannschaft melden“: Name, Verein, Spieler (mehr als nötig ist erlaubt) und die Mannschaftsführung wählen.',
          '3. Auslosen und starten wie bei Einzeln. Eine Begegnung belegt einen Tisch – mit „Eine Begegnung spielt an zwei Tischen“ zwei; beim Aufruf (auch automatisch) kommt der zweite Tisch dazu.',
          'Braunschweiger System: Jede Mannschaft tritt als Dreier- oder Vierermannschaft an (Einzelposition 4 leer = Dreier). Die Spielfolge richtet sich danach, zwei Doppel gibt es nur bei Vierer gegen Vierer. Es werden immer alle 10 Spiele gespielt, 5:5 ist ein Unentschieden.',
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
        titel: 'Gruppen- und Mannschaftsanmeldung',
        text: [
          'Neben der Einzelanmeldung kann eine volljährige Mannschaftsleitung (z. B. Jugendwart) mehrere Personen gesammelt melden – auch Minderjährige, ohne deren E-Mail-Adressen. Sie bestätigt, dass die Erziehungsberechtigten einverstanden sind; alle Mails (Bestätigung, Nachrichten, Ergebnisse) gehen an sie. Bei Jugendturnieren ist das der einzige Weg online.',
          'Je Doppel- bzw. Mannschafts-Konkurrenz legst du die Anmeldeform fest: nur Paare bzw. ganze Mannschaften, nur Einzelne (du bildest Paare und Mannschaften selbst) oder beides.',
          'Eine Mannschaft braucht Namen und Verein, Spieler innerhalb der Sollstärke und eine Mannschaftsführung – eine Spielerin bzw. ein Spieler oder die Mannschaftsleitung selbst als Begleitperson. Wechselspieler werden gekennzeichnet.',
          '„Übernehmen“ legt die Personen als Spieler an (die Begleitperson ohne Meldung und Startgeld), meldet Einzel und bildet Paare und Mannschaften.',
        ],
      },
      {
        titel: 'Für die Turnierleitung',
        text: [
          'Reiter „Anmeldungen“ (nur online): Konkurrenzen auswählen, Meldeschluss und Hinweis eintragen, öffnen. Höchstzahl und Startgeld stellst du je Konkurrenz ein. Den Link bzw. QR-Code gibst du weiter, etwa in der Turnierausschreibung.',
          'Mit „Übernehmen“ kommen bestätigte Anmeldungen ins Turnier. Doppel bildest du selbst, der Partnerwunsch steht in der Liste – mit dem Hinweis, ob die Partnerin bzw. der Partner per Mail bestätigt hat.',
          'Neue Sparten können die Anmeldung erst nach 7 Tagen öffnen (Schutz vor Missbrauch), außer der Administrator schaltet sie früher frei.',
          'Online anmelden können sich nur Volljährige. Bei Jugendturnieren (Schalter unter „Einstellungen“) gibt es keine Einzelanmeldung online – Minderjährige meldet der Verein bzw. eine Mannschaftsleitung.',
          'Für eure Ausschreibung gibt es unter „Online-Anmeldungen“ und „Einstellungen“ einen Textbaustein zum Datenschutz.',
        ],
      },
      {
        titel: 'Für Spieler',
        text: [
          'Formular ausfüllen, dann den Link in der Mail öffnen und „Anmeldung jetzt bestätigen“ tippen – erst dann gibt es einen Platz. Über denselben Link siehst du deinen Stand (Platz oder Warteliste), das Startgeld mit GiroCode für die Banking-App und kannst dich bis zum Vortag abmelden.',
          'Online anmelden kannst du dich ab 18. Bist du jünger, meldet dich dein Verein bzw. deine Mannschaftsleitung an.',
          'Meldest du dich mit Partner/in für ein Doppel, gib auch deren E-Mail an: Sie bekommt nach deiner Bestätigung eine Mail und bestätigt selbst.',
          'Anmeldungen werden 30 Tage nach dem Turniertag gelöscht, unbestätigte nach 24 Stunden.',
        ],
      },
    ],
  },
  {
    id: 'nachrichten',
    titel: 'Nachrichten, Posteingang und Verteiler',
    fuer: ['leitung', 'helfer', 'spieler'],
    einleitung:
      'Die Turnierleitung erreicht alle Beteiligten direkt in der App: Jede Kennung hat einen Posteingang (Glocke oben im Turnier). Wer sich online angemeldet hat, bekommt Nachrichten zusätzlich per E-Mail.',
    abschnitte: [
      {
        titel: 'Posteingang',
        text: [
          'Mit deiner Kennung angemeldet, zeigt die Glocke 🔔 neben dem Turniernamen, wie viele Nachrichten neu sind. Antippen öffnet den Posteingang; dabei gelten die Nachrichten als gelesen.',
          'Kommt eine neue Nachricht, während das Turnier offen ist, erscheint oben ein Hinweis. Die App fragt alle zwei Minuten nach.',
          'Mit einem Konto (ohne Kennung) siehst du statt des Posteingangs ✉ die gesendeten Nachrichten des Turniers und wie viele E-Mails noch in der Warteschlange sind.',
        ],
      },
      {
        titel: 'Nachricht an Teilnehmer (Turnierleitung)',
        text: [
          'Unter „Teilnehmer“ → „Nachricht an Teilnehmer“ wählst du die Empfänger – auch mehrere Gruppen zugleich:',
          '• alle Teilnehmer oder die einer Konkurrenz',
          '• eingecheckt bzw. noch nicht eingecheckt (z. B. „Bitte bis 9:45 an der Kasse melden“)',
          '• Mannschaftsführung, Helfer, weitere Turnierleitungen',
          '• Warteliste der Online-Anmeldung (nur per E-Mail, weil sie noch keine Kennung haben)',
          'Mit dem Häkchen „zusätzlich per E-Mail“ bekommen Online-Angemeldete die Nachricht auch als Mail, bei Gruppenanmeldungen die Mannschaftsleitung. Die Mails gehen gedrosselt raus; bei vielen Empfängern dauert es einige Minuten. Auf der Zentrale gibt es nur den Posteingang.',
          'Höchstens 10 Nachrichten je Turnier und Tag.',
        ],
      },
      {
        titel: 'Ergebnisse verschicken',
        text: [
          'Nach „Turnier abschließen“ (Einstellungen) erscheint „Ergebnisse verschicken“. Jede Person mit Kennung bekommt ihre Platzierung und die Ergebnisliste in den Posteingang, Online-Angemeldete zusätzlich per E-Mail.',
          'Die Liste folgt euren Einstellungen: Namen in Kurzform, wenn so eingestellt (bei Jugendturnieren immer), verdeckte Konkurrenzen ohne Stand. Vorher unter „Sichtbarkeit“ veröffentlichen.',
          'Das geht höchstens dreimal je Turnier – z. B. nach einer Korrektur und erneutem Abschluss.',
        ],
      },
      {
        titel: 'Verteiler für künftige Turniere',
        text: [
          'Wer Einladungen zu euren nächsten Turnieren möchte, setzt bei der Online-Anmeldung ein Häkchen oder trägt sich über den Link aus den Einstellungen des Turniers ein. Jede Person bestätigt per Mail (Double-Opt-In); unter 18 nur mit Einverständnis der Erziehungsberechtigten.',
          'Die Spartenleitung sieht den Verteiler unter „Sparte“ und schickt dort Ankündigungen (höchstens drei am Tag). In jeder Mail steht ein Link zum Abbestellen; dann ist der Eintrag sofort gelöscht.',
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
        titel: 'Siegprämien',
        text: [
          'Unter „Kasse & Check-in“ → „Siegprämien“ richtet die Turnierleitung je Konkurrenz mit Startgeld eine Prämie ein: Einbehalt des Vereins (Prozent oder fester Betrag) und Verteilung (Prozent-Vorlage wie 50/30/20 oder feste Beträge je Platz).',
          'Grundlage ist nur das tatsächlich bezahlte Startgeld (Erlassenes zählt nicht). Beträge werden auf volle Euro abgerundet, der Rest bleibt beim Verein. Geteilte Plätze teilen sich die Prämien, je Paar bzw. Mannschaft gibt es eine. Bis zum Ende der Konkurrenz steht „voraussichtlich“.',
          'Ausgezahlt wird an der Kasse mit Beleg (Unterschrift der Empfängerin bzw. des Empfängers); eine falsche Auszahlung storniert die Turnierleitung. Bitte vor dem ersten Einsatz den Hinweis zur Gemeinnützigkeit (§ 67a AO) mit eurer Steuerberatung klären.',
        ],
      },
      {
        titel: 'Check-in vor der Auslosung, Mannschaften',
        text: [
          'Mit „Auslosung erst nach abgeschlossenem Check-in“ (Kasse & Check-in) lässt sich jede Konkurrenz erst auslosen, wenn ihr Check-in abgeschlossen ist. „Alle anwesend“ checkt den Rest ein; bei „Check-in abschließen“ kann die Turnierleitung Fehlende streichen.',
          'Mannschaften checkt die Mannschaftsführung auf einmal ein: „Mannschaft da“ vermerkt alle Spieler und kassiert ihr Startgeld bar. Wer fehlt, wird danach einzeln auf „Nicht da“ gesetzt; unter der Sollstärke erscheint ein Hinweis (Nachbesetzen unter „Teilnehmer“ bis zur Höchstzahl).',
        ],
      },
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
    id: 'datenschutz',
    titel: 'Jugendturnier, Löschfristen, Kennungen',
    fuer: ['leitung'],
    einleitung: 'Was die App für den Datenschutz tut – und was ihr als Verein dazu einstellt.',
    abschnitte: [
      {
        titel: 'Jugendturnier',
        text: [
          'Schalter beim Anlegen bzw. unter „Einstellungen“: Zuschauer sehen Namen nur in Kurzform („Max M.“), die Online-Einzelanmeldung ist zu, die App-Wertung ist aus (lässt sich einschalten). Spielen laut Jahrgang Minderjährige mit und der Schalter ist aus, weist die App darauf hin.',
        ],
      },
      {
        titel: 'Automatische Löschung',
        text: [
          'Jedes Online-Turnier wird 12 oder 24 Monate (wählbar) nach dem Turniertag automatisch gelöscht, ohne Datum nach der letzten Änderung. 30 Tage vorher bekommt die Turnierleitung eine Mail mit einer Sicherungsdatei.',
          'Sicherungen per Mail enthalten keine E-Mail-Adressen und keine Bankverbindung. Neue Empfänger außerhalb der Turnierleitung bekommen sie erst, nachdem sie ihre Adresse über einen Link bestätigt haben.',
        ],
      },
      {
        titel: 'Turnierkennung',
        text: [
          'Die App vergibt eine zufällige Kennung aus 8 Zeichen ohne verwechselbare Zeichen (z. B. „K7QM 3XRP“). Du kannst auch eine Wunschkennung wählen (4–12 Zeichen, z. B. „VM-2027“) – leichter anzusagen, aber auch leichter zu erraten; bei Jugendturnieren besser die Zufallskennung. Groß/klein ist egal. Gelöschte Kennungen sind 180 Tage gesperrt.',
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
