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
export const DATENSCHUTZ_STAND = '14.11.2026';

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
        'Mails: Willkommensmail, Link zum Zurücksetzen des Passworts, Sicherungen deiner Turniere (nur wenn eingeschaltet) und eine Erinnerung vor der Löschung wegen Nichtnutzung. Der Betreiber erhält bei jedem neuen Konto eine kurze Info mit Name und E-Mail-Adresse, damit er Missbrauch erkennen und Konten sperren kann. Es gibt keinen Newsletter und keine Werbung.',
        'Turnierdaten: Was Veranstalter und Turnierleitung eintragen (Turniername, Datum, Ort, Namen und Vereine von Spielerinnen und Spielern, je nach Einstellung TTR-Punkte, Leistungsklasse, Geschlecht oder Jahrgang, Auslosung und Ergebnisse) samt Zeitpunkt und Name der eintragenden Person. Diese Daten sind für alle sichtbar, die den Link des Turniers kennen. Für die Turnierdaten ist der jeweilige Veranstalter verantwortlich; er sorgt dafür, dass die Teilnehmenden mit der Eintragung einverstanden sind.',
        'Spielerpool: Veranstalter können ihre Spielerinnen und Spieler (Name, Verein, TTR-Punkte, Leistungsklasse, Geschlecht, Jahrgang) für spätere Turniere in ihrem Konto speichern. Der Pool ist nur für das eigene Konto sichtbar und wird mit dem Konto gelöscht. Ohne Konto bleibt er nur auf dem eigenen Gerät.',
        'Spieler- und Helfer-Codes: Für jedes Online-Turnier erzeugt der Server je Spielerin, Spieler und Helfer einen 6-stelligen Code. Er ist nur für die Turnierleitung sichtbar, dient nur der Anmeldung zum Eintragen von Ergebnissen und wird mit dem Turnier gelöscht.',
        'Kontaktformular und Rückmeldungen: Name, E-Mail-Adresse und Nachricht, nur um zu antworten.',
        'Schutz vor Missbrauch: Bei Anmeldeversuchen, Registrierungen und Nachrichten wird die IP-Adresse höchstens 24 Stunden gespeichert, um automatisierte Angriffe zu bremsen (berechtigtes Interesse, Art. 6 Abs. 1 lit. f DSGVO).',
        'Auf deinem Gerät speichert die App die Anmeldung und die Turnierdaten im Browser-Speicher (localStorage, IndexedDB), damit sie auch ohne Internet funktioniert. Es werden keine Cookies zu Werbe- oder Analysezwecken gesetzt.',
        'Android-Zentrale: Bei Turnieren in Hallen ohne Internet speichert die Android-App der Turnierleitung die Turnierdaten und Codes nur auf diesem Handy; andere Geräte verbinden sich direkt über dessen WLAN. Erst wenn die Leitung ihr Online-Konto verbindet, gehen Turnierdaten an diesen Server (Übernahme, Rückgabe, Sicherungsmails). Für die Daten auf dem Handy ist die Turnierleitung verantwortlich.',
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
        'Bis du dein Konto löschst (Mein Konto → „Konto löschen“). Wird ein Konto 12 Monate nicht genutzt, wird es automatisch samt aller Turniere gelöscht; 30 Tage vorher kommt eine Erinnerungsmail. Versendete Sicherungsmails liegen danach nur noch in den Postfächern der Empfänger.',
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
