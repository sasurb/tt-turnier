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
export const DATENSCHUTZ_STAND = '21.11.2026';

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
        `${b.name || '[Name des Betreibers]'}, ${b.anschrift || '[Anschrift]'}, E-Mail: ${b.mail || '[E-Mail]'}.`,
        'Die App ist ein privates, nicht-kommerzielles Angebot. Es gibt keine Werbung, kein Tracking und keine Auswertung des Nutzungsverhaltens.',
      ],
    },
    {
      titel: 'Welche Daten, wofür?',
      absaetze: [
        'Konto: Name (Verein oder Person), E-Mail-Adresse und Passwort. Das Passwort wird nur verschlüsselt (als nicht umkehrbarer Hash) gespeichert. Dazu kommen die Zeitpunkte der Anlage und der letzten Nutzung. Die Daten dienen ausschließlich der Anmeldung und den Mails zum Konto. Rechtsgrundlage ist die Bereitstellung des Kontos auf deinen Wunsch (Art. 6 Abs. 1 lit. b DSGVO).',
        'Mails: Willkommensmail, Link zum Zurücksetzen des Passworts, Sicherungen deiner Turniere (nur wenn eingeschaltet), eine Erinnerung vor der Löschung wegen Nichtnutzung sowie Hinweise, wenn jemand mit einer Leitungskennung die Bankverbindung ändert oder neue Empfänger für Sicherungen einträgt (mit Name dieser Person und den neuen Adressen bzw. der neuen IBAN). Der Betreiber erhält bei jedem neuen Konto eine kurze Info mit Name und E-Mail-Adresse, damit er Missbrauch erkennen und Konten sperren kann. Es gibt keinen Newsletter und keine Werbung.',
        'Turnierdaten: Was die Turnierleitung und ihre Helfer eintragen (Turniername, Datum, Ort, Namen und Vereine von Spielerinnen und Spielern, je nach Einstellung TTR-Punkte, Leistungsklasse, Geschlecht oder Jahrgang, Auslosung, Ergebnisse und Tischaufrufe mit dem Namen der Schiedsrichterin oder des Schiedsrichters – die Oberfläche zeigt diesen Namen nur angemeldeten Teilnehmenden) samt Zeitpunkt und Name der eintragenden Person. Wer den Link des Turniers kennt, sieht ohne Kennung (als Zuschauer, auch in der Live-Anzeige am Beamer) Namen, Vereine, TTR-Punkte, Leistungsklassen, Auslosung und Ergebnisse – der Server gibt an Zuschauer keine Jahrgänge, kein Geschlecht, keine Namen von Eintragenden und keine frei eingetippten Schiedsrichter-Namen heraus. Die Turnierleitung kann einstellen, dass Zuschauer nur die Kurzform der Namen sehen (z. B. „Max M.“). Die Turnierleitung und Helfer mit der Aufgabe „Kasse“ sehen alle Turnierdaten; andere Helfer sehen keine Jahrgänge und kein Geschlecht; Spielerinnen und Spieler mit Kennung sehen zusätzlich die Namen von Eintragenden und Schiedsrichtern, aber ebenfalls keine Jahrgänge und kein Geschlecht. Die Kurzform gilt nicht für Ausdrucke, Urkunden und CSV-Dateien, die die Turnierleitung erstellt. Live-Anzeige am Beamer und Sprachausgabe machen Namen in der Halle für alle Anwesenden sichtbar bzw. hörbar. Jede Änderung steht mit Zeit und Person im Protokoll des Turniers; auch Einträge, die die Turnierleitung rückgängig macht oder entfernt (z. B. einen Spieler), bleiben dort gespeichert, bis das Turnier gelöscht wird. Spielerinnen, Spieler und Zuschauer sehen von einer entfernten Person (oder einer, deren Anlegen rückgängig gemacht wurde) nur noch den Platzhalter „Entfernt“ – Name, Verein und weitere Angaben gibt der Server nur noch an Turnierleitung und Helfer heraus. Für die Turnierdaten ist die jeweilige Turnierleitung verantwortlich; sie sorgt dafür, dass die Teilnehmenden mit der Eintragung einverstanden sind.',
        'Spielerpool: Die Turnierleitung kann ihre Spielerinnen und Spieler (Name, Verein, TTR-Punkte, Leistungsklasse, Geschlecht, Jahrgang) für spätere Turniere in ihrem Konto speichern. Der Pool ist nur für das eigene Konto sichtbar und wird mit dem Konto gelöscht. Ohne Konto bleibt er nur auf dem eigenen Gerät.',
        'Kennungen: Für jedes Online-Turnier erzeugt der Server je Person (Turnierleitung, Helfer, Spielerin, Spieler) eine 8-stellige Kennung mit dem Namen der Person. Kennungen sind nur für die Turnierleitung sichtbar, dienen nur der Anmeldung zum Eintragen und werden mit dem Turnier gelöscht. Persönliche Links und QR-Codes enthalten die Kennung – wer sie weitergibt, gibt den Zugang weiter. Die Turnierleitung kann ein Turnier jederzeit samt allen Daten vom Server löschen. Turnierkennungen (8 Ziffern) sind nicht öffentlich auffindbar; der Server bremst das Durchprobieren von Kennungen.',
        'Online-Anmeldung: Öffnet die Turnierleitung die Anmeldung, können sich Spielerinnen und Spieler über einen Link selbst anmelden. Gespeichert werden Vor- und Nachname, Verein, E-Mail-Adresse, die gewählten Konkurrenzen (bei Doppel optional der Name der Partnerin oder des Partners), die Angaben, die die Turnierleitung verlangt (TTR-Punkte, Leistungsklasse, Geschlecht oder Jahrgang), ob die Person jünger als 18 Jahre ist samt der Bestätigung, dass die Erziehungsberechtigten einverstanden sind, sowie die Zeitpunkte von Anmeldung und Bestätigung. Zweck: Teilnahme am Turnier, Vergabe der Plätze und der Warteliste, Mails zu Bestätigung, Nachrücken und Änderungen (Art. 6 Abs. 1 lit. b DSGVO). Erst wenn die Person über den Link in der Mail ausdrücklich bestätigt, zählt eine Anmeldung („Double-Opt-in“); unbestätigte Anmeldungen gelten 24 Stunden und werden bei der nächsten täglichen Wartung, spätestens nach 48 Stunden, gelöscht. Die Liste mit E-Mail-Adressen sieht nur die Turnierleitung; öffentlich sichtbar ist nur, wie viele Plätze vergeben sind. Die Bankverbindung für das Startgeld sehen nur Personen mit bestätigter Anmeldung. Antworten auf die Mails gehen an die Turnierleitung. Den Namen einer Doppelpartnerin oder eines Doppelpartners gibt die anmeldende Person freiwillig an; er dient nur der Turnierleitung zum Bilden des Paares. In das Turnier (und damit in Spielpläne und Ergebnislisten) kommen die Angaben erst, wenn die Turnierleitung die Anmeldung übernimmt – die E-Mail-Adresse nie. Alle Anmeldungen eines Turniers werden 30 Tage nach dem Turniertag automatisch gelöscht, spätestens aber 180 Tage nach der Anmeldung. Wer sich angemeldet hat, kann sich über den Link in der Mail bis zum Vortag selbst wieder abmelden.',
        'Hinweis auf neue Anmeldungen: Auf Wunsch (abschaltbar) erhält das Konto der Turnierleitung bei jeder bestätigten Online-Anmeldung eine kurze Mail – ohne Namen und E-Mail-Adressen, nur mit Konkurrenz und Anzahl. In der App merkt sich das Gerät der Turnierleitung nur die Kennungen bereits angesehener Anmeldungen, um neue hervorzuheben.',
        'Mannschaften: Bei Mannschaftsturnieren speichert die App Name und Verein der Mannschaft, ihre Spieler, die Mannschaftsführung sowie die Aufstellungen je Begegnung. Bis beide Mannschaften ihre Aufstellung abgegeben haben, gibt der Server eine Aufstellung nur an die Turnierleitung, Helfer mit der Aufgabe „Kasse“ und die Spielerinnen und Spieler der eigenen Mannschaft heraus; danach sieht sie jeder, der das Turnier sieht.',
        'Check-in und Startgeld: Die Turnierleitung und von ihr bestimmte Helfer („Kasse“) können am Turniertag vermerken, wer anwesend ist und wer welches Startgeld bar oder per Überweisung bezahlt hat; daraus entstehen Quittungen. Diese Angaben sowie die Bankverbindung und die Angaben für die Quittung sieht nur die Turnierleitung und wer als Helfer die Aufgabe „Kasse“ hat – nicht andere Helfer, nicht Zuschauer und nicht Spielerinnen und Spieler. Ändert jemand die Bankverbindung, erhält das Konto der Turnierleitung eine Mail. Sie werden mit dem Turnier gelöscht. Eine Online-Bezahlung gibt es nicht; der Überweisungs-QR-Code („GiroCode“) entsteht auf dem Gerät und enthält nur Empfänger, IBAN, Betrag und Verwendungszweck.',
        'Aufgaben der Helfer: Die Turnierleitung legt fest, welche Aufgaben eine Helferkennung hat (Ergebnisse, Spielaufruf, Kasse, Oberschiedsrichter). Diese Aufgaben stehen bei den Einträgen im Protokoll.',
        'Leistungsklassen: Begriffe für Leistungsklassen, die eine Turnierleitung eintippt, werden in ihrem Konto gespeichert, um sie später vorzuschlagen. Sie werden mit dem Konto gelöscht.',
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
        'Online-Anmeldungen: unbestätigt 24 Stunden, sonst bis 30 Tage nach dem Turniertag (siehe oben). Konto und Turniere: bis du dein Konto löschst (Mein Konto → „Konto löschen“). Wird ein Konto 12 Monate nicht genutzt, wird es automatisch samt aller Turniere gelöscht; 30 Tage vorher kommt eine Erinnerungsmail. Versendete Sicherungsmails liegen danach nur noch in den Postfächern der Empfänger.',
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
