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
  turniere?: number;
}

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
  leitungsPasswort: string;
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
  passwort: string;
  /** Anzeigename des Leiters im Protokoll */
  name: string;
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

/** Ereignis-Arten der Etappe 2 */
export const ART = {
  turnierAngelegt: 'turnier.angelegt',
  turnierUmbenannt: 'turnier.umbenannt',
  testNotiz: 'test.notiz',
} as const;
