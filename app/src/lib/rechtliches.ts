/**
 * Betreiberangaben für Impressum und Datenschutzhinweis. Sie stehen nicht im Code,
 * sondern kommen beim Bauen aus GitHub-Variablen (BETREIBER_NAME, BETREIBER_ANSCHRIFT,
 * BETREIBER_MAIL, optional BETREIBER_TELEFON). Wer die App selbst betreibt, trägt dort
 * seine eigenen Angaben ein.
 */
export interface Betreiber {
  name: string;
  anschrift: string;
  mail: string;
  telefon: string;
  /** Adresse der Online-App (für das Kontaktformular aus der Demo heraus) */
  kontaktUrl: string;
}

const env = import.meta.env as Record<string, string | undefined>;

export const BETREIBER: Betreiber = {
  name: (env.VITE_BETREIBER_NAME ?? '').trim(),
  anschrift: (env.VITE_BETREIBER_ANSCHRIFT ?? '').trim(),
  mail: (env.VITE_BETREIBER_MAIL ?? '').trim(),
  telefon: (env.VITE_BETREIBER_TELEFON ?? '').trim(),
  kontaktUrl: (env.VITE_KONTAKT_URL ?? '').trim(),
};

export const BETREIBER_VOLLSTAENDIG = BETREIBER.name !== '' && BETREIBER.anschrift !== '' && BETREIBER.mail !== '';

/** Stand des Datenschutzhinweises – bei Änderungen am Text anpassen. */
export const DATENSCHUTZ_STAND = '25.11.2026';

export interface Abschnitt {
  titel: string;
  absaetze: string[];
}

/**
 * Datenschutzhinweis nach Art. 13 DSGVO – Entwurf, vom Betreiber zu prüfen.
 * Bewusst knapp und konkret: Es werden nur die Daten genannt, die die App wirklich verarbeitet.
 */
export function datenschutz(b: Betreiber): Abschnitt[] {
  return [
    {
      titel: 'Wer ist verantwortlich?',
      absaetze: [
        `Für den Betrieb der App, die Konten und das Kontaktformular: ${b.name || '[Name des Betreibers]'}, ${b.anschrift || '[Anschrift]'}, E-Mail: ${b.mail || '[E-Mail]'} („Betreiber“).`,
        'Für die Daten der Turniere, des Spielerpools, der Online-Anmeldungen und der Ausschüsse ist der jeweilige Verein bzw. seine Sparte verantwortlich, der die App nutzt (steht bei jedem Turnier als Veranstalter). Der Betreiber verarbeitet diese Daten in dessen Auftrag nach Art. 28 DSGVO; die Vereinbarung dazu ist Teil der Nutzungsbedingungen. Fragen und Anträge zu diesen Daten richtet ihr am besten direkt an den Verein; der Betreiber leitet sie andernfalls weiter.',
        'Die App ist ein privates, nicht-kommerzielles Angebot. Es gibt keine Werbung, kein Tracking und keine Auswertung des Nutzungsverhaltens.',
      ],
    },
    {
      titel: 'Welche Daten, wofür?',
      absaetze: [
        'Konto: Name, E-Mail-Adresse und Passwort (nur als nicht umkehrbarer Hash gespeichert), die Bestätigung, mindestens 18 Jahre alt zu sein, die Zustimmung zu den Nutzungsbedingungen (Fassung und Zeitpunkt) sowie die Zeitpunkte der Anlage und der letzten Nutzung. Die Daten dienen der Anmeldung und den Mails zum Konto. Rechtsgrundlage ist die Bereitstellung des Kontos auf deinen Wunsch (Art. 6 Abs. 1 lit. b DSGVO).',
        'Verein, Sparte und Rollen: Name des Vereins und der Sparte, welche Konten zur Sparte gehören (Spartenleitung oder Turnierleitung, Recht zum Anlegen von Turnieren, Zugänge zu einzelnen Turnieren), Zeitpunkt der Zustimmung zur Auftragsverarbeitung. Die Spartenleitung sieht Namen und E-Mail-Adressen der Mitglieder ihrer Sparte, um sie zu verwalten. Einladungen speichern Name und E-Mail-Adresse der eingeladenen Person, wer eingeladen hat und wofür; sie verfallen nach 14 Tagen bzw. mit der Annahme.',
        'Ausschüsse: Mitglieder (Konten), ob jemand gesperrt ist, und die Nachrichten mit Name der schreibenden Person und Zeitpunkt. Sichtbar nur für die Mitglieder des Ausschusses (ohne deren E-Mail-Adressen) und die Spartenleitung. Nachrichten werden nach 12 Monaten gelöscht; die Nachrichten eines gelöschten Kontos bleiben ohne Namen stehen.',
        'Mails: Willkommensmail, Link zum Zurücksetzen des Passworts, Sicherungen deiner Turniere (nur wenn eingeschaltet; ohne E-Mail-Adressen und Bankverbindung; Empfänger außerhalb der Turnierleitung bekommen sie erst, nachdem sie ihre Adresse über einen Link bestätigt haben), Einladungen in eine Sparte, ein Turnier oder einen Ausschuss, eine Mail 30 Tage vor der automatischen Löschung eines Turniers, eine Erinnerung vor der Löschung wegen Nichtnutzung sowie Hinweise, wenn jemand mit einer Leitungskennung die Bankverbindung ändert oder neue Empfänger für Sicherungen einträgt (mit Name dieser Person und den neuen Adressen bzw. der neuen IBAN). Der Betreiber erhält bei jedem neuen Konto eine kurze Info mit Name und E-Mail-Adresse, damit er Missbrauch erkennen und Konten sperren kann. Es gibt keinen Newsletter und keine Werbung.',
        'Turnierdaten: Was die Turnierleitung und ihre Helfer eintragen (Turniername, Datum, Ort, Namen und Vereine von Spielerinnen und Spielern, je nach Einstellung TTR-Punkte, Leistungsklasse, Geschlecht oder Jahrgang, Auslosung, Ergebnisse und Tischaufrufe mit dem Namen der Schiedsrichterin oder des Schiedsrichters – die Oberfläche zeigt diesen Namen nur angemeldeten Teilnehmenden) samt Zeitpunkt und Name der eintragenden Person. Wer den Link des Turniers kennt, sieht ohne Kennung (als Zuschauer, auch in der Live-Anzeige am Beamer) Namen, Vereine, TTR-Punkte, Leistungsklassen, Auslosung und Ergebnisse – der Server gibt an Zuschauer keine Jahrgänge, kein Geschlecht, keine Namen von Eintragenden und keine frei eingetippten Schiedsrichter-Namen heraus. Die Turnierleitung kann einstellen, dass Zuschauer nur die Kurzform der Namen sehen (z. B. „Max M.“). Die Turnierleitung und Helfer mit der Aufgabe „Kasse“ sehen alle Turnierdaten; andere Helfer sehen keine Jahrgänge und kein Geschlecht; Spielerinnen und Spieler mit Kennung sehen zusätzlich die Namen von Eintragenden und Schiedsrichtern, aber ebenfalls keine Jahrgänge und kein Geschlecht. Die Kurzform gilt nicht für Ausdrucke, Urkunden und CSV-Dateien, die die Turnierleitung erstellt. Live-Anzeige am Beamer und Sprachausgabe machen Namen in der Halle für alle Anwesenden sichtbar bzw. hörbar. Jede Änderung steht mit Zeit und Person im Protokoll des Turniers; auch Einträge, die die Turnierleitung rückgängig macht oder entfernt (z. B. einen Spieler), bleiben dort gespeichert, bis das Turnier gelöscht wird. Spielerinnen, Spieler und Zuschauer sehen von einer entfernten Person (oder einer, deren Anlegen rückgängig gemacht wurde) nur noch den Platzhalter „Entfernt“ – Name, Verein und weitere Angaben gibt der Server nur noch an Turnierleitung und Helfer heraus. Für die Turnierdaten ist die jeweilige Turnierleitung verantwortlich; sie sorgt dafür, dass die Teilnehmenden mit der Eintragung einverstanden sind.',
        'Spielerpool: Die Sparte kann ihre Spielerinnen und Spieler (Name, Verein, TTR-Punkte bzw. geschätzter Wert, Leistungsklasse, Geschlecht, Jahrgang, ggf. click-TT-Lizenznummer) für spätere Turniere speichern. Der Pool ist nur für die Spartenleitung und die Turnierleitungen der Sparte sichtbar und wird mit der Sparte gelöscht. Ohne Konto bleibt er nur auf dem eigenen Gerät.',
        'Geschätzte Werte für Hobbyspieler: Wer keinen amtlichen TTR-Wert hat, kann über 4 Fragen eingestuft werden. Gespeichert wird nur der daraus berechnete Wert und dass er geschätzt ist, nicht die Antworten. Der geschätzte Wert passt sich nach jedem gespielten Einzel automatisch an (ähnlich dem TTR-System). Nach einem Turnier kann die Turnierleitung die angepassten Werte in ihren Spielerpool übernehmen; dazu merkt sich der Pool je Person nur die Zahl der gewerteten Spiele, das Turnier selbst vermerkt die Übernahme (damit es nicht doppelt zählt). Zweck: ausgeglichene Klassen, Setzungen und Paarungen (Art. 6 Abs. 1 lit. b DSGVO). Diese Bewertung der Spielstärke ist eine Form von Profiling (Art. 4 Nr. 4 DSGVO), es werden damit aber keine Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung automatisch getroffen (Art. 22 DSGVO); die Turnierleitung kann jeden Wert ändern. Bei Jugendturnieren ist die App-Wertung standardmäßig ausgeschaltet. Ob jemand einen geschätzten Wert hat, sehen nur die Turnierleitung und Kassenhelfer, nicht Zuschauer und Spieler. Amtliche TTR-Werte verändert die App nicht.',
        'Kennungen: Jedes Turnier hat eine Turnierkennung (zufällig oder von der Turnierleitung gewählt); wer sie kennt, kann zuschauen. Gelöschte Turnierkennungen werden 180 Tage lang nicht neu vergeben. Für jedes Online-Turnier erzeugt der Server außerdem je Person (Turnierleitung, Helfer, Spielerin, Spieler) eine 8-stellige Kennung mit dem Namen der Person. Kennungen sind nur für die Turnierleitung sichtbar, dienen nur der Anmeldung zum Eintragen und werden mit dem Turnier gelöscht. Persönliche Links und QR-Codes enthalten die Kennung – wer sie weitergibt, gibt den Zugang weiter. Die Turnierleitung kann ein Turnier jederzeit samt allen Daten vom Server löschen. Turnierkennungen (8 Ziffern) sind nicht öffentlich auffindbar; der Server bremst das Durchprobieren von Kennungen.',
        'Online-Anmeldung: Öffnet die Turnierleitung die Anmeldung, können sich Spielerinnen und Spieler über einen Link selbst anmelden. Gespeichert werden Vor- und Nachname, Verein, E-Mail-Adresse, die gewählten Konkurrenzen (bei Doppel optional Name und E-Mail-Adresse der Partnerin oder des Partners), die Angaben, die die Turnierleitung verlangt (TTR-Punkte bzw. ein über 4 Fragen geschätzter Wert – ohne die Antworten –, Leistungsklasse, Geschlecht oder Jahrgang), die Bestätigung, mindestens 18 Jahre alt zu sein (Minderjährige meldet der Verein bzw. eine Mannschaftsleitung; bei Jugendturnieren gibt es keine Einzelanmeldung online), sowie die Zeitpunkte von Anmeldung und Bestätigung. Zweck: Teilnahme am Turnier, Vergabe der Plätze und der Warteliste, Mails zu Bestätigung, Nachrücken und Änderungen (Art. 6 Abs. 1 lit. b DSGVO). Erst wenn die Person über den Link in der Mail ausdrücklich bestätigt, zählt eine Anmeldung („Double-Opt-in“); unbestätigte Anmeldungen gelten 24 Stunden und werden bei der nächsten täglichen Wartung, spätestens nach 48 Stunden, gelöscht. Die Liste mit E-Mail-Adressen sieht nur die Turnierleitung; öffentlich sichtbar ist nur, wie viele Plätze vergeben sind. Die Bankverbindung für das Startgeld sehen nur Personen mit bestätigter Anmeldung. Antworten auf die Mails gehen an die Turnierleitung. Name und E-Mail-Adresse einer Doppelpartnerin oder eines Doppelpartners gibt die anmeldende Person an; die Partnerin bzw. der Partner bekommt nach der Bestätigung der Anmeldung eine Mail und bestätigt die Meldung selbst (ebenfalls ab 18) oder lehnt sie ab. Die Turnierleitung sieht nur den Namen und ob bestätigt wurde, nie diese E-Mail-Adresse; sie wird mit der Anmeldung gelöscht. In das Turnier (und damit in Spielpläne und Ergebnislisten) kommen die Angaben erst, wenn die Turnierleitung die Anmeldung übernimmt – die E-Mail-Adresse nie. Alle Anmeldungen eines Turniers werden 30 Tage nach dem Turniertag automatisch gelöscht, spätestens aber 180 Tage nach der Anmeldung. Wer sich angemeldet hat, kann sich über den Link in der Mail bis zum Vortag selbst wieder abmelden.',
        'Hinweis auf neue Anmeldungen: Auf Wunsch (abschaltbar) erhält das Konto der Turnierleitung bei jeder bestätigten Online-Anmeldung eine kurze Mail – ohne Namen und E-Mail-Adressen, nur mit Konkurrenz und Anzahl. In der App merkt sich das Gerät der Turnierleitung nur die Kennungen bereits angesehener Anmeldungen, um neue hervorzuheben.',
        'Mannschaften: Bei Mannschaftsturnieren speichert die App Name und Verein der Mannschaft, ihre Spieler, die Mannschaftsführung sowie die Aufstellungen je Begegnung. Bis beide Mannschaften ihre Aufstellung abgegeben haben, gibt der Server eine Aufstellung nur an die Turnierleitung, Helfer mit der Aufgabe „Kasse“ und die Spielerinnen und Spieler der eigenen Mannschaft heraus; danach sieht sie jeder, der das Turnier sieht.',
        'Check-in und Startgeld: Die Turnierleitung und von ihr bestimmte Helfer („Kasse“) können am Turniertag vermerken, wer anwesend ist und wer welches Startgeld bar oder per Überweisung bezahlt hat; daraus entstehen Quittungen. Diese Angaben sowie die Bankverbindung und die Angaben für die Quittung sieht nur die Turnierleitung und wer als Helfer die Aufgabe „Kasse“ hat – nicht andere Helfer, nicht Zuschauer und nicht Spielerinnen und Spieler. Ändert jemand die Bankverbindung, erhält das Konto der Turnierleitung eine Mail. Sie werden mit dem Turnier gelöscht. Eine Online-Bezahlung gibt es nicht; der Überweisungs-QR-Code („GiroCode“) entsteht auf dem Gerät und enthält nur Empfänger, IBAN, Betrag und Verwendungszweck.',
        'Nachrichten und Posteingang: Die Turnierleitung kann Nachrichten an Gruppen von Teilnehmenden, Helfern und weiteren Turnierleitungen schicken und nach dem Abschluss die Ergebnisse mit der eigenen Platzierung verteilen. Sie landen im Posteingang der jeweiligen Kennung (sichtbar nur mit dieser Kennung) und werden mit dem Turnier gelöscht, beim Entfernen einer Kennung schon vorher. Wer sich online angemeldet hat (bzw. bei einer Gruppenanmeldung die Mannschaftsleitung), bekommt sie zusätzlich per E-Mail an die Adresse aus der Anmeldung; die Turnierleitung sieht diese Adresse dabei nicht. Mails gehen über eine Warteschlange auf dem Server raus, die nicht zustellbare Mails nach höchstens drei Tagen löscht.',
        'Verteiler für Ankündigungen: Wer möchte, trägt sich bei der Online-Anmeldung oder über den Link eines Turniers ein, um Einladungen zu künftigen Turnieren der Sparte zu bekommen (Einwilligung, Art. 6 Abs. 1 lit. a DSGVO; unter 18 nur mit Einverständnis der Erziehungsberechtigten). Gespeichert werden Name, E-Mail-Adresse, Zeitpunkt der Bestätigung und das Turnier, über das eingetragen wurde. Erst die Bestätigung per Link aus der Mail macht den Eintrag gültig (Double-Opt-In); unbestätigte Einträge werden nach 24 Stunden gelöscht. Jede Ankündigung enthält einen Link zum Abbestellen, der den Eintrag sofort löscht; die Einwilligung lässt sich jederzeit widerrufen. Die Liste sieht nur die Spartenleitung.',
        'Aufgaben der Helfer: Die Turnierleitung legt fest, welche Aufgaben eine Helferkennung hat (Ergebnisse, Spielaufruf, Kasse, Oberschiedsrichter). Diese Aufgaben stehen bei den Einträgen im Protokoll.',
        'Leistungsklassen: Begriffe für Leistungsklassen, die eine Turnierleitung eintippt, werden in der Sparte gespeichert, um sie später vorzuschlagen. Sie werden mit der Sparte gelöscht.',
        'Kontaktformular und Rückmeldungen: Name, E-Mail-Adresse und Nachricht, nur um zu antworten.',
        'Schutz vor Missbrauch: Bei Anmelde- und Kennungsversuchen, Aufrufen unbekannter Turnierkennungen, Registrierungen, Online-Anmeldungen und Nachrichten wird die IP-Adresse (bei IPv6 das Netz) bzw. bei Online-Anmeldungen eine Prüfsumme der E-Mail-Adresse gespeichert und bei der nächsten täglichen Wartung, spätestens nach 48 Stunden, gelöscht, um automatisierte Angriffe zu bremsen (berechtigtes Interesse, Art. 6 Abs. 1 lit. f DSGVO).',
        'Auf deinem Gerät speichert die App die Anmeldung und die Turnierdaten im Browser-Speicher (localStorage, IndexedDB), damit sie auch ohne Internet funktioniert. Die Programmdateien der App legt ein Service Worker im Zwischenspeicher des Browsers ab, damit sie sich auch ohne Netz öffnet; darin stehen keine personenbezogenen Daten. Ohne Netz gemachte Einträge (z. B. Startgeld) bleiben auf dem Gerät, bis sie an den Server übertragen sind. Vereinsnamen, die du eintippst, merkt sich das Gerät für Vorschläge. Ebenfalls nur auf dem Gerät bleiben Einstellungen der Live-Anzeige und der Druckvorlagen, auch ein für Urkunden gewähltes Logo. Es werden keine Cookies zu Werbe- oder Analysezwecken gesetzt.',
        'Spenden: Die Links unter „Unterstützen“ führen zu externen Zahlungsanbietern (z. B. PayPal, GitHub, Ko-fi). Erst wenn du einen Link antippst, verlässt du die App; welche Daten der Anbieter erhebt, regelt dessen Datenschutzerklärung. Die App überträgt dabei keine Daten.',
        'Mitteilung bei Spielaufruf: Wer möchte, lässt sich auf dem eigenen Gerät mit Ton, Vibration und – über https und nur nach Erlaubnis – mit einer Systemmitteilung benachrichtigen, wenn das eigene Spiel aufgerufen wird. Das funktioniert nur, solange die App geöffnet ist; es werden keine Push-Dienste (z. B. von Google oder Apple) genutzt und keine Daten dafür an den Server oder Dritte übertragen. Die Einstellung bleibt auf dem Gerät.',
        'Sprachausgabe (Ansage der Spielaufrufe): Die App nutzt dafür nur Stimmen, die nach Angabe des Browsers auf dem Gerät selbst arbeiten; so werden Namen an keinen Online-Dienst übertragen. Druck und PDF entstehen ebenfalls auf dem Gerät.',
        'Android-Zentrale: Bei Turnieren in Hallen ohne Internet speichert die Android-App der Turnierleitung die Turnierdaten und Kennungen nur auf diesem Handy; andere Geräte verbinden sich direkt über dessen WLAN. Erst wenn die Leitung ihr Online-Konto verbindet, gehen Turnierdaten an diesen Server (Übernahme, Rückgabe, Sicherungsmails). Für die Daten auf dem Handy ist die Turnierleitung verantwortlich.',
      ],
    },
    {
      titel: 'Wer bekommt die Daten?',
      absaetze: [
        'Niemand außer dem Betreiber. Die Daten liegen beim Webhoster STRATO AG (Berlin) auf Servern in Deutschland; STRATO verarbeitet sie nur im Auftrag. Der Hoster protokolliert technische Zugriffsdaten (z. B. IP-Adresse, Zeitpunkt) für den sicheren Betrieb. Eine Weitergabe an Dritte oder in Länder außerhalb der EU findet nicht statt.',
      ],
    },
    {
      titel: 'Wie lange?',
      absaetze: [
        'Online-Anmeldungen: unbestätigt 24 Stunden, sonst bis 30 Tage nach dem Turniertag (siehe oben). Verteiler: bis zum Abbestellen bzw. bis die Sparte gelöscht wird. Nachrichten im Posteingang: mit dem Turnier. Turniere: automatisch 12 oder 24 Monate (wählt die Turnierleitung) nach dem Turniertag bzw. ohne Datum nach der letzten Änderung, 30 Tage vorher bekommt die Turnierleitung eine Mail mit Sicherungsdatei; früher, wenn die Turnierleitung das Turnier löscht. Bis dahin sehen Zuschauer mit dem Link die Namen (bei Jugendturnieren nur in Kurzform). Konto: bis du es löschst (Mein Konto → „Konto löschen“). Wird ein Konto 12 Monate nicht genutzt, wird es automatisch gelöscht; 30 Tage vorher kommt eine Erinnerungsmail. Ist es die einzige Spartenleitung, wird die Sparte mit Turnieren, Spielerpool, Ausschüssen und Nachrichten gelöscht; 30 Tage vorher bekommen alle Mitglieder der Sparte eine Mail. Ausschuss-Nachrichten: 12 Monate. Einladungen: 14 Tage. Nicht bestätigte Sicherungsempfänger: 30 Tage. Versendete Mails liegen danach nur noch in den Postfächern der Empfänger.',
      ],
    },
    {
      titel: 'Deine Rechte',
      absaetze: [
        'Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Schreib dazu einfach eine Mail an die oben genannte Adresse oder nutze das Kontaktformular. Löschen kannst du dein Konto jederzeit selbst.',
        'Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel beim Unabhängigen Landeszentrum für Datenschutz Schleswig-Holstein (ULD).',
      ],
    },
  ];
}

/** Fassung der Nutzungsbedingungen (gleich BEDINGUNGEN_FASSUNG im Protokoll) */
export const BEDINGUNGEN_STAND = '24.11.2026';

/**
 * Nutzungsbedingungen mit Vereinbarung zur Auftragsverarbeitung (Art. 28 DSGVO) – Entwurf, juristisch zu prüfen.
 * Vereine, die die App selbst betreiben, ersetzen die Betreiberangaben (GitHub-Variablen) und passen den Text an.
 */
export function nutzungsbedingungen(b: Betreiber): Abschnitt[] {
  const betreiber = `${b.name || '[Name des Betreibers]'}, ${b.anschrift || '[Anschrift]'}, E-Mail: ${b.mail || '[E-Mail]'}`;
  return [
    {
      titel: '1. Worum es geht',
      absaetze: [
        `Diese Bedingungen gelten für die Nutzung der Turnier-App unter dieser Adresse, betrieben von ${betreiber} („Betreiber“). Sie gelten zwischen dem Betreiber und dem Verein bzw. der Sparte, für die ein Konto angelegt wird („Verein“). Wer ein Konto anlegt, bestätigt, mindestens 18 Jahre alt zu sein und für den Verein handeln zu dürfen.`,
        'Die Nutzung ist kostenlos. Es besteht kein Anspruch auf eine bestimmte Verfügbarkeit oder auf bestimmte Funktionen. Der Betreiber darf die App ändern, einschränken oder einstellen; über eine Einstellung informiert er die Konten mindestens 30 Tage vorher per Mail, damit Sicherungen heruntergeladen werden können.',
      ],
    },
    {
      titel: '2. Pflichten des Vereins',
      absaetze: [
        'Der Verein trägt nur Daten ein, die er für seine Turniere und Veranstaltungen braucht und verarbeiten darf. Er informiert die Teilnehmenden (z. B. mit dem Textbaustein für die Ausschreibung), beachtet bei Minderjährigen die besonderen Anforderungen (Schalter „Jugendturnier“) und bearbeitet Anfragen Betroffener zu seinen Daten.',
        'Kennungen, Passwörter und Einladungslinks sind vertraulich zu behandeln. Missbrauch – etwa das Versenden unerwünschter Mails über Einladungen oder Anmeldungen, rechtswidrige Inhalte oder Angriffe auf die App – ist untersagt. Der Betreiber darf missbräuchlich genutzte Konten sperren oder löschen.',
      ],
    },
    {
      titel: '3. Haftung',
      absaetze: [
        'Der Betreiber haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit sowie bei Verletzung von Leben, Körper oder Gesundheit. Im Übrigen ist die Haftung – soweit gesetzlich zulässig – ausgeschlossen; bei unentgeltlicher Überlassung gelten die gesetzlichen Haftungserleichterungen. Der Verein sichert seine Turniere selbst (Sicherungsdatei, Sicherung per Mail).',
      ],
    },
    {
      titel: '4. Vereinbarung zur Auftragsverarbeitung (Art. 28 DSGVO)',
      absaetze: [
        'Gegenstand und Dauer: Der Betreiber verarbeitet im Auftrag des Vereins die Daten, die der Verein und seine Helfer in der App erfassen, solange der Verein die App nutzt und bis zur Löschung nach Abschnitt „Löschung“.',
        'Art und Zweck: Speichern, Ordnen, Bereitstellen und Übermitteln von Turnier-, Anmelde-, Pool- und Ausschussdaten, damit der Verein Turniere und Veranstaltungen durchführen kann; Versand der Mails, die die App vorsieht. Eine Nutzung für eigene Zwecke des Betreibers findet nicht statt.',
        'Daten und Betroffene: Spielerinnen und Spieler, Helfer, Mitglieder der Sparte und der Ausschüsse; Namen, Vereine, Spielstärke (TTR, Klasse, geschätzte Werte), ggf. Jahrgang und Geschlecht, Ergebnisse, Zahlungen von Startgeldern, E-Mail-Adressen der Online-Anmeldung, Nachrichten in Ausschüssen, Bankverbindung des Vereins.',
        'Weisungen: Der Betreiber verarbeitet die Daten nur nach Weisung des Vereins; die Weisungen sind die Einstellungen und Handlungen des Vereins in der App sowie Weisungen in Textform. Hält der Betreiber eine Weisung für rechtswidrig, sagt er es dem Verein.',
        'Vertraulichkeit und Sicherheit: Personen, die beim Betreiber Zugang haben, sind zur Vertraulichkeit verpflichtet. Technische und organisatorische Maßnahmen: verschlüsselte Übertragung (https), Passwörter nur als Hash, Kennungen mit Schutz gegen Durchprobieren, Rechteprüfung auf dem Server bei jeder Anfrage, Datensparsamkeit für Zuschauer und Spieler, Schutzmaßnahmen gegen gängige Angriffe (OWASP), Zugangsdaten zum Server nur außerhalb des Quellcodes, tägliche automatische Löschung abgelaufener Daten.',
        'Unterauftragnehmer: STRATO AG, Berlin (Webhosting und Mailversand, Server in Deutschland). Weitere Unterauftragnehmer setzt der Betreiber nur nach vorheriger Information des Vereins ein; der Verein kann widersprechen und die Nutzung beenden. Eine Übermittlung in Länder außerhalb der EU findet nicht statt.',
        'Unterstützung: Der Betreiber unterstützt den Verein bei Anfragen Betroffener (Auskunft, Berichtigung, Löschung), bei Meldungen von Datenschutzverletzungen und bei Prüfungen, soweit das mit vertretbarem Aufwand möglich ist. Er meldet dem Verein Verletzungen des Schutzes personenbezogener Daten unverzüglich.',
        'Löschung: Turniere werden nach der vom Verein gewählten Frist (12 oder 24 Monate) automatisch gelöscht, Online-Anmeldungen 30 Tage nach dem Turniertag, Ausschuss-Nachrichten nach 12 Monaten. Löscht der Verein seine Sparte bzw. wird das letzte Konto der Spartenleitung gelöscht, werden alle Daten der Sparte gelöscht. Sicherungsdateien, die der Verein herunterlädt oder per Mail erhält, verantwortet er selbst.',
        'Nachweise und Kontrollen: Der Betreiber gibt dem Verein auf Anfrage die Informationen, die zum Nachweis dieser Pflichten nötig sind. Der Quellcode der App ist öffentlich einsehbar.',
      ],
    },
    {
      titel: '5. Schluss',
      absaetze: [
        'Ändert der Betreiber diese Bedingungen, stimmen die Konten beim nächsten Anmelden der neuen Fassung zu oder hören auf, die App zu nutzen. Es gilt deutsches Recht. Für den Quellcode gilt seine eigene Lizenz (siehe „Über diese App“).',
      ],
    },
  ];
}

export interface Spendenweg {
  id: 'paypal' | 'github' | 'kofi';
  name: string;
  url: string;
}

/** Nur vollständige https-Adressen (sonst wird der Weg nicht angezeigt) */
function spendenUrl(v: string | undefined): string {
  const t = (v ?? '').trim();
  try {
    return t && new URL(t).protocol === 'https:' ? t : '';
  } catch {
    return '';
  }
}

/**
 * Spendenwege des Entwicklers. Die Adressen kommen beim Bauen aus den GitHub-Variablen SPENDEN_PAYPAL,
 * SPENDEN_GITHUB und SPENDEN_KOFI; ohne Variable fehlt der Weg (ganz ohne: kein Spenden-Hinweis).
 */
export const SPENDENWEGE: Spendenweg[] = (
  [
    { id: 'paypal', name: 'PayPal', url: spendenUrl(env.VITE_SPENDEN_PAYPAL) },
    { id: 'github', name: 'GitHub Sponsors', url: spendenUrl(env.VITE_SPENDEN_GITHUB) },
    { id: 'kofi', name: 'Ko-fi', url: spendenUrl(env.VITE_SPENDEN_KOFI) },
  ] as Spendenweg[]
).filter((w) => w.url !== '');
