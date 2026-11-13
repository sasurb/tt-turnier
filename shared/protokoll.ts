/**
 * Schnittstellen-Vertrag zwischen App und Server (PHP auf dem Webspace,
 * später auch die Android-Zentrale). Beide Server müssen genau dieses
 * Verhalten liefern. Änderungen hier immer zusammen mit
 * docs/schnittstelle.md und server-php/src/Api.php vornehmen.
 */

export const PROTOKOLL_VERSION = 1;

/** Höchstzahl Ereignisse je Sende-Aufruf und je Abhol-Antwort. */
export const MAX_EREIGNISSE_JE_AUFRUF = 200;

/** Höchstgröße des Inhalts (`daten`) eines Ereignisses in Bytes (JSON). */
export const MAX_DATEN_BYTES = 16_384;

export type Rolle = 'admin' | 'veranstalter' | 'leitung' | 'helfer' | 'spieler' | 'zuschauer';

/** Wer ein Ereignis erzeugt hat. Setzt immer der Server anhand der Anmeldung. */
export interface Autor {
  rolle: Rolle;
  name: string;
}

/** Ereignis, wie die App es erzeugt und an den Server schickt. */
export interface NeuesEreignis {
  /** Vom Gerät erzeugte, weltweit eindeutige ID (UUID). Dient dem Schutz vor Doppelsendungen. */
  id: string;
  /** Art des Ereignisses, z. B. "turnier.angelegt", "test.notiz". */
  art: string;
  /** Inhalt, abhängig von der Art. */
  daten: Record<string, unknown>;
  /** Zeitpunkt auf dem Gerät (ISO 8601). */
  zeit: string;
  /** Kennung des Geräts. */
  geraet: string;
}

/** Ereignis, wie der Server es gespeichert hat und ausliefert. */
export interface Ereignis extends NeuesEreignis {
  /** Laufnummer: vom Server vergeben, streng steigend, nicht lückenlos. */
  seq: number;
  /** Zeitpunkt des Eingangs auf dem Server (ISO 8601). */
  empfangen: string;
  autor: Autor;
}

export interface Konto {
  id: number;
  name: string;
  email: string;
  rolle: 'admin' | 'veranstalter';
  gesperrt: boolean;
  angelegt: string;
  letzteAnmeldung: string | null;
  /** Letzte Nutzung (Anmeldung oder Aufruf mit Konto-Token); Grundlage der Löschung nach 12 Monaten. */
  zuletztAktiv: string | null;
  turniere?: number;
}

/** Konten ohne Nutzung werden nach so vielen Tagen gelöscht (Administrator ausgenommen). */
export const KONTO_LOESCHEN_NACH_TAGEN = 365;
/** So viele Tage vorher geht eine Erinnerungsmail an das Konto. */
export const KONTO_ERINNERUNG_TAGE_VORHER = 30;

export interface TurnierInfo {
  id: string;
  name: string;
  datum: string | null;
  angelegt: string;
  veranstalter: string;
}

/* ---------- Anfragen und Antworten je Endpunkt ----------
 * Aufruf: <basis>/index.php?r=<route>
 * Anmeldung: Kopfzeile "Authorization: Bearer <token>"
 * Fehler: HTTP-Status >= 400 und Rumpf { fehler: FehlerCode, meldung: string }
 */

export type FehlerCode =
  | 'ungueltig'          // 400 Anfrage fehlerhaft
  | 'nicht_angemeldet'   // 401 Token fehlt oder abgelaufen
  | 'falsche_zugangsdaten' // 401
  | 'gesperrt'           // 403 Konto gesperrt
  | 'keine_berechtigung' // 403
  | 'nicht_gefunden'     // 404
  | 'konflikt'           // 409 z. B. E-Mail schon vergeben
  | 'zu_viele_versuche'  // 429
  | 'nicht_eingerichtet' // 503 Einrichtung fehlt
  | 'serverfehler';      // 500

export interface FehlerAntwort {
  fehler: FehlerCode;
  meldung: string;
}

/** GET info */
export interface InfoAntwort {
  app: 'tt-turnier';
  protokoll: number;
  version: string;
  eingerichtet: boolean;
  zeit: string;
  /** Jeder darf ein Veranstalter-Konto anlegen (ab Server 0.3). */
  registrierung?: boolean;
  /** Der Server kann Mails versenden (Absender und Adresse der App sind eingerichtet). */
  mail?: boolean;
}

/** POST setup – nur solange kein Administrator existiert */
export interface SetupAnfrage {
  code: string;
  name: string;
  email: string;
  passwort: string;
}

/** POST login */
export interface LoginAnfrage {
  email: string;
  passwort: string;
}
export interface LoginAntwort {
  token: string;
  konto: Konto;
}

/** POST registrieren – offen. `website` ist ein Fangfeld für Bots und muss leer bleiben. */
export interface RegistrierenAnfrage {
  name: string;
  email: string;
  passwort: string;
  website?: string;
}
/** Antwort wie LoginAntwort: das neue Konto ist sofort angemeldet. */

/** POST passwort.vergessen – antwortet immer mit ok, auch wenn die Adresse unbekannt ist. */
export interface PasswortVergessenAnfrage {
  email: string;
}
/** POST passwort.zuruecksetzen – Schlüssel aus dem Mail-Link, gültig 1 Stunde, einmalig. */
export interface PasswortZuruecksetzenAnfrage {
  schluessel: string;
  neu: string;
}
/** Antwort wie LoginAntwort; alle bisherigen Sitzungen des Kontos sind beendet. */

/** POST konto.loeschen – eigenes Konto samt Turnieren löschen (nicht für den Administrator). */
export interface KontoLoeschenAnfrage {
  passwort: string;
}

export type RueckmeldungArt = 'fehler' | 'wunsch' | 'frage' | 'kontakt';
/** POST rueckmeldung – an den Administrator. Ohne Anmeldung sind name und email Pflicht. */
export interface RueckmeldungAnfrage {
  art: RueckmeldungArt;
  text: string;
  name?: string;
  email?: string;
  website?: string;
}

/** GET konten (admin) */
export interface KontenAntwort {
  konten: Konto[];
}
/** POST konto.anlegen (admin) */
export interface KontoAnlegenAnfrage {
  name: string;
  email: string;
  passwort: string;
}
/** POST konto.sperren (admin) */
export interface KontoSperrenAnfrage {
  id: number;
  gesperrt: boolean;
}
/** POST passwort.aendern (angemeldetes Konto) */
export interface PasswortAendernAnfrage {
  alt: string;
  neu: string;
}

/** GET turniere – eigene (Veranstalter) bzw. alle (Admin) */
export interface TurniereAntwort {
  turniere: TurnierInfo[];
}
/** POST turnier.anlegen (Veranstalter/Admin) */
export interface TurnierAnlegenAnfrage {
  name: string;
  datum: string | null;
  /** 6 Ziffern. (Ältere Apps senden stattdessen `leitungsPasswort`.) */
  leitungsCode: string;
  /** Empfänger der Sicherungsmails; Standard: E-Mail des Kontos. */
  sicherungAn?: string[];
}
export interface TurnierAnlegenAntwort {
  turnier: TurnierInfo;
  /** Leitungs-Token für dieses Turnier, damit der Veranstalter sofort leiten kann. */
  token: string;
}
/** GET turnier&id=… – öffentlich */
export interface TurnierAntwort {
  turnier: TurnierInfo;
}
/** POST turnier.zugang – mit Leitungspasswort anmelden */
export interface TurnierZugangAnfrage {
  turnier: string;
  /** Leitungscode (6 Ziffern); bei älteren Turnieren das Leitungspasswort. */
  code: string;
  /** Anzeigename des Leiters im Protokoll */
  name: string;
}

/** Leitungscode: genau 6 Ziffern. */
export const LEITUNGSCODE_MUSTER = /^[0-9]{6}$/;

/**
 * Sicherung per Mail: Abstand in Minuten. 0 = aus, -1 = nur beim Abschließen des Turniers.
 * Gesendet wird nur, wenn sich seit der letzten Sicherung etwas geändert hat und das Turnier
 * auf mindestens einem Gerät geöffnet ist (der Server prüft bei jedem Abruf).
 */
export const SICHERUNG_TAKTE = [0, 15, 30, 60, -1] as const;
export type SicherungTakt = (typeof SICHERUNG_TAKTE)[number];
export const SICHERUNG_STANDARD_TAKT: SicherungTakt = 30;
export const SICHERUNG_MAX_EMPFAENGER = 3;

/** GET turnier.einstellungen&id=… – nur Leitung, Eigentümer-Konto oder Administrator */
export interface TurnierEinstellungen {
  /** null bei älteren Turnieren, die noch ein Passwort statt eines Codes haben */
  leitungsCode: string | null;
  sicherungAn: string[];
  sicherungTakt: SicherungTakt;
  letzteSicherung: string | null;
  /** Mailversand auf dem Server eingerichtet */
  mail: boolean;
}
/** POST turnier.einstellungen – nur übergebene Felder werden geändert */
export interface TurnierEinstellungenAnfrage {
  turnier: string;
  leitungsCode?: string;
  sicherungAn?: string[];
  sicherungTakt?: SicherungTakt;
}
/** POST turnier.sichern – Sicherung sofort an die eingetragenen Empfänger senden */
export interface TurnierSichernAnfrage {
  turnier: string;
}

/**
 * Sicherungsdatei (JSON). Wird vom Server als Mail-Anhang verschickt und von der App
 * zum Herunterladen erzeugt; beide Wege liefern dasselbe Format.
 */
export const SICHERUNG_FORMAT = 'tt-turnier-sicherung';
export interface Sicherung {
  format: typeof SICHERUNG_FORMAT;
  version: 1;
  erstellt: string;
  turnier: { id: string; name: string; datum: string | null; modus: 'online' | 'lokal' };
  ereignisse: {
    id: string;
    art: string;
    daten: Record<string, unknown>;
    zeit: string;
    geraet: string;
    seq: number | null;
    empfangen: string | null;
    autor: Autor | null;
  }[];
}
export interface TurnierZugangAntwort {
  token: string;
  rolle: Rolle;
}

/** POST events&turnier=… – braucht Token mit Schreibrecht für das Turnier */
export interface SendenAnfrage {
  ereignisse: NeuesEreignis[];
}
export interface SendenAntwort {
  /** Je gesendetem Ereignis die vergebene Laufnummer (auch bei erneutem Senden). */
  angenommen: { id: string; seq: number }[];
  hoechsteSeq: number;
}

/** GET events&turnier=…&ab=<seq> – öffentlich lesbar */
export interface AbholenAntwort {
  ereignisse: Ereignis[];
  hoechsteSeq: number;
  /** true, wenn weitere Ereignisse vorliegen (Antwort war auf MAX_EREIGNISSE_JE_AUFRUF begrenzt) */
  mehr: boolean;
}

/** Ereignis-Arten */
export const ART = {
  turnierAngelegt: 'turnier.angelegt',
  turnierUmbenannt: 'turnier.umbenannt',
  /** Turnier abgeschlossen – löst die letzte Sicherungsmail aus */
  turnierAbgeschlossen: 'turnier.abgeschlossen',
  /** Abschluss zurückgenommen */
  turnierWiedereroeffnet: 'turnier.wiedereroeffnet',
  /** Turnier aus einer Sicherungsdatei übernommen (Daten: { quelle: Turnier-ID, erstellt, anzahl }) */
  turnierWiederhergestellt: 'turnier.wiederhergestellt',
  testNotiz: 'test.notiz',
} as const;
