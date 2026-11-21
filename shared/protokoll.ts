/**
 * Schnittstellen-Vertrag zwischen App und Server (PHP auf dem Webspace und
 * Android-Zentrale). Beide Server müssen genau dieses Verhalten liefern.
 * Änderungen hier immer zusammen mit docs/schnittstelle.md,
 * server-php/src/Api.php und zentrale/kern/…/Zentrale.java vornehmen.
 */

export const PROTOKOLL_VERSION = 1;
/** Server-Version, ab der 8-stellige Kennungen gelten (InfoAntwort.kennungen) */
export const KENNUNGEN_AB = '0.6.0';

/** Höchstzahl Ereignisse je Sende-Aufruf und je Abhol-Antwort. */
export const MAX_EREIGNISSE_JE_AUFRUF = 200;

/** Höchstgröße des Inhalts (`daten`) eines Ereignisses in Bytes (JSON). */
export const MAX_DATEN_BYTES = 16_384;

/**
 * Rollen (ab 0.6):
 * - admin: Administrator des Servers
 * - veranstalter: Konto einer Turnierleitung (in der Oberfläche „Turnierleitung“); legt Turniere an
 * - leitung: mit Leitungskennung in einem Turnier angemeldet (oder Eigentümer-Konto)
 * - helfer: trägt alle Ergebnisse ein
 * - spieler: trägt eigene Ergebnisse ein (mit Helfer-Recht auch alle)
 * - zuschauer: ohne Kennung, nur lesen
 */
export type Rolle = 'admin' | 'veranstalter' | 'leitung' | 'helfer' | 'spieler' | 'zuschauer';

/** Wer ein Ereignis erzeugt hat. Setzt immer der Server anhand der Anmeldung. */
export interface Autor {
  rolle: Rolle;
  name: string;
  /** Bei Rolle „spieler“: ID des Spielers im Turnier (setzt der Server anhand der Spielerkennung). */
  spieler?: string;
  /** Spieler, der zusätzlich Helfer ist: darf alle Ergebnisse eintragen (fremde gelten amtlich, eigene wie bei Spielern). */
  helfer?: boolean;
  /** Ab 0.11, nur Rolle „helfer“: Aufgaben dieser Helferkennung (fehlt = HELFER_STANDARD) */
  aufgaben?: Aufgabe[];
}

/**
 * Aufgaben einer Helferkennung (ab 0.11, „feinere Rechte“):
 * - ergebnisse: Ergebnisse eintragen (amtlich)
 * - aufruf: Spiele an Tische aufrufen, Aufruf zurücknehmen (Sprecher)
 * - kasse: Check-in und Startgeld (Kasse)
 * - oberschiri: Ergebnisse eintragen, Anfechtungen/Konflikte entscheiden, Ergebnisse zurücksetzen (Oberschiedsrichter)
 * Spielerkennungen mit Helfer-Recht haben immer HELFER_STANDARD.
 */
export type Aufgabe = 'ergebnisse' | 'aufruf' | 'kasse' | 'oberschiri';
export const ALLE_AUFGABEN: readonly Aufgabe[] = ['ergebnisse', 'aufruf', 'kasse', 'oberschiri'];
export const HELFER_STANDARD: readonly Aufgabe[] = ['ergebnisse', 'aufruf'];
/** Ereignis-Arten je Aufgabe (Server-Whitelist und Prüfung in der Engine) */
export const ARTEN_JE_AUFGABE: Record<Aufgabe, readonly string[]> = {
  ergebnisse: ['spiel.ergebnis'],
  aufruf: ['spiel.aufgerufen', 'spiel.aufruf_zurueck'],
  kasse: ['startgeld.gebucht', 'startgeld.storniert', 'teilnehmer.eingecheckt'],
  oberschiri: ['spiel.ergebnis', 'spiel.entschieden', 'spiel.zurueckgesetzt'],
};
/**
 * Diese Arten liefern die Server nur in der vollen Sicht (Leitung, Helfer): Zahlungen und Anwesenheit
 * sind personenbezogen und für Zuschauer und Spieler nicht nötig. Die Engine darf sie deshalb für nichts
 * benutzen, was alle Geräte gleich berechnen müssen (Tabellen, Auslosung, Spiele).
 */
/** (ab 0.11: volle Sicht = Leitung und Helfer mit Aufgabe „kasse“) */
export const NUR_VOLLE_SICHT: readonly string[] = ['startgeld.gebucht', 'startgeld.storniert', 'teilnehmer.eingecheckt'];
/** Spieler- und Konkurrenz-IDs: Kleinbuchstaben und Ziffern (ab 0.11, auch in Spiel-IDs wie g0-<a>-<b> eindeutig) */
export const ID_MUSTER = /^[a-z0-9]{1,16}$/;

/**
 * Kennungen (ab 0.6): Turnier, Leitung, Helfer und Spieler haben 8-stellige Ziffernkennungen,
 * geschrieben als zwei Viererblöcke („4839 2017“). Turnierkennungen vergibt der Server beim Anlegen,
 * alle anderen Kennungen gelten nur innerhalb ihres Turniers. Weder Leitungs- noch Spielerkennungen
 * stehen in den öffentlich lesbaren Ereignissen.
 */
export const KENNUNG_MUSTER = /^[0-9]{8}$/;
/** Turnierkennung: 8 Ziffern (ältere Turniere: 10 Zeichen a–z/0–9; Links darauf gelten weiter). */
export const TURNIER_KENNUNG_MUSTER = /^([0-9]{8}|[a-z0-9]{6,16})$/;
/** Lokale Turniere (nur dieses Gerät) beginnen mit „l“ und liegen nie auf einem Server. */
export const LOKALE_KENNUNG_MUSTER = /^l[a-z0-9]{6,16}$/;

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
  /**
   * Ab 0.12: Online-Anmeldung für dieses Konto – auto (ab ANMELDUNG_NACH_TAGEN Tagen Kontoalter),
   * frei (vom Admin früher freigeschaltet) oder gesperrt (vom Admin gesperrt). Schutz vor Missbrauch als Mail-Versand.
   */
  anmeldung?: 'auto' | 'frei' | 'gesperrt';
}
export const ANMELDUNG_NACH_TAGEN = 7;
/** POST konto.anmeldung { id, anmeldung } – nur Admin (ab 0.12) */

/** Konten ohne Nutzung werden nach so vielen Tagen gelöscht (Administrator ausgenommen). */
export const KONTO_LOESCHEN_NACH_TAGEN = 365;
/** So viele Tage vorher geht eine Erinnerungsmail an das Konto. */
export const KONTO_ERINNERUNG_TAGE_VORHER = 30;

export interface TurnierInfo {
  /** Turnierkennung (8 Ziffern) */
  id: string;
  name: string;
  datum: string | null;
  angelegt: string;
  /** Name des Kontos, dem das Turnier gehört (Turnierleitung) */
  veranstalter: string;
  /** Mit Anmeldung abgefragt (ab 0.6): Rechte dieser Anmeldung für das Turnier; null = nur lesen */
  rechte?: 'leitung' | 'helfer' | 'spieler' | null;
  /** Ab 0.11, mit Anmeldung als Helfer: Aufgaben dieser Kennung */
  aufgaben?: Aufgabe[];
  /** Online-Server (ab 0.5): Name der Zentrale, auf der das Turnier gerade läuft – dann online nur lesbar */
  zentrale?: string | null;
  zentraleId?: string | null;
  /** Zentrale: „zentrale“ = dort angelegt, „online“ = vom Online-Server übernommen */
  herkunft?: 'zentrale' | 'online';
  /** Zentrale: an den Online-Server zurückgegeben, hier nur noch lesbar */
  abgegeben?: boolean;
}

/* ---------- Anfragen und Antworten je Endpunkt ----------
 * Aufruf: <basis>/index.php?r=<route>
 * Anmeldung: Kopfzeile "Authorization: Bearer <token>"
 * Fehler: HTTP-Status >= 400 und Rumpf { fehler: FehlerCode, meldung: string }
 */

export type FehlerCode =
  | 'ungueltig' // 400 Anfrage fehlerhaft
  | 'nicht_angemeldet' // 401 Token fehlt oder abgelaufen
  | 'falsche_zugangsdaten' // 401
  | 'gesperrt' // 403 Konto gesperrt
  | 'keine_berechtigung' // 403
  | 'nicht_gefunden' // 404
  | 'konflikt' // 409 z. B. E-Mail schon vergeben
  | 'zu_gross' // 413 Höchstzahl an Einträgen im Turnier erreicht
  | 'abgelaufen' // 410 Link abgelaufen bzw. Anmeldung geschlossen
  | 'zu_viele_versuche' // 429
  | 'nicht_eingerichtet' // 503 Einrichtung fehlt
  | 'serverfehler'; // 500

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
  /** Spieler-/Helfer-Codes, Spielerpool und Übersicht in der Sicherungsmail (ab Server 0.4) */
  codes?: boolean;
  /** 8-stellige Kennungen, Leitungskennungen je Person, Konto-Einstellungen (ab Server 0.6) */
  kennungen?: boolean;
  /** Aufgaben für Helferkennungen, abgelehnte Einzel-Einträge (ab Server 0.11) */
  aufgaben?: boolean;
  /** Online-Anmeldung mit Warteliste (ab Server 0.11; nur online mit Mailversand) */
  anmeldung?: boolean;
  /** Nur bei der Android-Zentrale (ab 0.5) */
  zentrale?: {
    version: string;
    /** Adresse, unter der andere Geräte im WLAN die App öffnen, z. B. http://192.168.43.1:8080/ */
    adresse: string | null;
    /** Online-Konto verbunden (für Übernahme, Rückgabe, Sicherungsmails) */
    online: boolean;
  };
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
/** POST turnier.anlegen (Turnierleitungs-Konto/Admin). Der Server legt eine Leitungskennung für die anlegende Person an. */
export interface TurnierAnlegenAnfrage {
  name: string;
  datum: string | null;
  /** Empfänger der Sicherungsmails; Standard: E-Mail des Kontos. */
  sicherungAn?: string[];
}
export interface TurnierAnlegenAntwort {
  turnier: TurnierInfo;
  /** Leitungs-Token für dieses Turnier, damit das Konto sofort leiten kann. */
  token: string;
  /** Leitungskennung der anlegenden Person (ab 0.6) */
  leitung: CodeEintrag;
}
/** GET turnier&id=… – öffentlich; mit Token zusätzlich `turnier.rechte` */
export interface TurnierAntwort {
  turnier: TurnierInfo;
}
/** POST turnier.zugang – mit einer Kennung (Leitung, Helfer oder Spieler) anmelden */
export interface TurnierZugangAnfrage {
  turnier: string;
  /** Kennung, 8 Ziffern */
  code: string;
}

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
  sicherungAn: string[];
  sicherungTakt: SicherungTakt;
  letzteSicherung: string | null;
  /** Mailversand auf dem Server eingerichtet (Zentrale: Online-Konto verbunden) */
  mail: boolean;
  /** Zentrale: Sicherung ist vorgemerkt und wartet auf Internet */
  wartend?: boolean;
}
/** POST turnier.einstellungen – nur übergebene Felder werden geändert */
export interface TurnierEinstellungenAnfrage {
  turnier: string;
  sicherungAn?: string[];
  sicherungTakt?: SicherungTakt;
  /** Ab 0.11: Name und Datum des Turniers (dazu Ereignis turnier.umbenannt) */
  name?: string;
  datum?: string | null;
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
  turnier: {
    id: string;
    name: string;
    datum: string | null;
    modus: 'online' | 'lokal';
  };
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
  /** Name, unter dem Einträge erscheinen (steht an der Kennung) */
  name?: string;
  /** Bei Spielerkennungen: ID des Spielers im Turnier */
  spieler?: string;
  /** Spielerkennung mit Helfer-Recht */
  helfer?: boolean;
  /** Helferkennung: Aufgaben (ab 0.11) */
  aufgaben?: Aufgabe[];
}

/* ---------- Kennungen für Leitung, Helfer und Spieler (ab Server 0.4, 8-stellig ab 0.6) ----------
 * Kennungen liegen nur auf dem Server, nie in den öffentlich lesbaren Ereignissen.
 * Mit einer Kennung meldet man sich über POST turnier.zugang an.
 */
export type CodeRolle = 'leitung' | 'helfer' | 'spieler';
export interface CodeEintrag {
  rolle: CodeRolle;
  /** Spieler-ID im Turnier bzw. vom Gerät vergebene Helfer-/Leitungs-ID */
  bezug: string;
  name: string;
  /** 8 Ziffern */
  code: string;
  gesperrt: boolean;
  /** Nur bei Spielerkennungen: darf zusätzlich alle Ergebnisse eintragen */
  helfer?: boolean;
  /** Nur bei Helferkennungen (ab 0.11): Aufgaben; Standard HELFER_STANDARD */
  aufgaben?: Aufgabe[];
}
/** GET codes&turnier=… – nur Leitung */
export interface CodesAntwort {
  codes: CodeEintrag[];
}
/** POST codes.anlegen – fehlende Kennungen erzeugen, Namen aktualisieren (vorhandene Kennungen bleiben) */
export interface CodesAnlegenAnfrage {
  turnier: string;
  eintraege: { rolle: CodeRolle; bezug: string; name: string; aufgaben?: Aufgabe[] }[];
}
/** POST code.neu – neue Kennung ausgeben; die alte gilt nicht mehr, Anmeldungen damit enden */
export interface CodeNeuAnfrage {
  turnier: string;
  rolle: CodeRolle;
  bezug: string;
}
/** POST code.sperren */
export interface CodeSperrenAnfrage extends CodeNeuAnfrage {
  gesperrt: boolean;
}
/** POST code.entfernen – z. B. Helfer streichen. Die letzte nicht gesperrte Leitungskennung lässt sich nicht entfernen. */
export type CodeEntfernenAnfrage = CodeNeuAnfrage;
/** POST code.helfer – Spielerkennung zusätzlich Helfer-Recht geben oder nehmen (ab 0.6) */
export interface CodeHelferAnfrage {
  turnier: string;
  bezug: string;
  helfer: boolean;
}
/** POST code.aufgaben – Aufgaben einer Helferkennung ändern (ab 0.11). Gilt sofort, ohne neue Anmeldung. */
export interface CodeAufgabenAnfrage {
  turnier: string;
  bezug: string;
  aufgaben: Aufgabe[];
}
export const MAX_CODES_JE_TURNIER = 400;

/**
 * Arten, die mit Spieler- bzw. Helfer-Kennung gesendet werden dürfen. Alles andere nur die Leitung.
 * Eine Spielerkennung mit Helferrecht darf beides. Ab 0.11 richtet sich eine Helferkennung nach ihren
 * Aufgaben (ARTEN_JE_AUFGABE); ARTEN_HELFER entspricht HELFER_STANDARD.
 */
export const ARTEN_SPIELER = ['spiel.ergebnis', 'spiel.bestaetigt', 'spiel.angefochten'] as const;
export const ARTEN_HELFER = ['spiel.ergebnis', 'spiel.aufgerufen', 'spiel.aufruf_zurueck'] as const;

/* ---------- Einstellungen des Kontos (ab 0.6) ---------- */
/** GET konto.einstellungen / POST konto.einstellungen – eigenes Konto */
export interface KontoEinstellungen {
  /** Begriffe für Leistungsklassen, die die App beim Tippen vorschlägt */
  klassen: string[];
  /** Ab 0.11: Vorgaben für Kasse und Quittungen neuer Turniere */
  kasse?: KasseEinstellungen | null;
}

/**
 * Kasse und Quittungen (ab 0.11): steht im Turnier (turnier.daten, Feld kasse) und als Vorgabe im Konto.
 * Die Server liefern das Feld nur in der vollen Sicht. Ob und welcher Umsatzsteuer-Hinweis auf die
 * Quittung gehört, entscheidet die Turnierleitung (steuerlich prüfen lassen).
 */
export interface KasseEinstellungen {
  /** Aussteller der Quittung, z. B. „TTC Musterstadt e. V.“ */
  aussteller: string;
  anschrift: string;
  /** keiner | befreit (§ 4 Nr. 22 b UStG) | enthalten (Satz in ustSatz) */
  ust: 'keiner' | 'befreit' | 'enthalten';
  ustSatz: number;
  fusstext: string;
  /** Bankverbindung für Überweisungen (GiroCode); leer = keine */
  empfaenger: string;
  iban: string;
  bic: string;
}
export const UST_SAETZE = [7, 19] as const;
export const MAX_KLASSEN = 40;

/* ---------- Spielerpool im Konto der Turnierleitung (ab Server 0.4) ---------- */
export interface PoolSpieler {
  /** Vom Gerät vergebene ID */
  id: string;
  vorname: string;
  nachname: string;
  verein: string;
  ttr?: number | null;
  klasse?: string | null;
  geschlecht?: 'm' | 'w' | 'd' | null;
  jahrgang?: number | null;
  /** Letzte Änderung (ISO), setzt der Server */
  geaendert?: string;
}
export const MAX_POOL_SPIELER = 3000;
/** GET pool – eigenes Konto */
export interface PoolAntwort {
  spieler: PoolSpieler[];
}
/** POST pool.speichern – anlegen oder ändern (je ID), höchstens 500 je Aufruf */
export interface PoolSpeichernAnfrage {
  spieler: PoolSpieler[];
}
/** POST pool.loeschen */
export interface PoolLoeschenAnfrage {
  ids: string[];
}

/** POST turnier.uebersicht – lesbarer Stand (Text), den die App erzeugt; kommt in die Sicherungsmail */
export interface TurnierUebersichtAnfrage {
  turnier: string;
  text: string;
}
export const MAX_UEBERSICHT_ZEICHEN = 60_000;

/** POST events&turnier=… – braucht Token mit Schreibrecht für das Turnier */
export interface SendenAnfrage {
  ereignisse: NeuesEreignis[];
}
export interface SendenAntwort {
  /** Je gesendetem Ereignis die vergebene Laufnummer (auch bei erneutem Senden). */
  angenommen: { id: string; seq: number }[];
  hoechsteSeq: number;
  /**
   * Ab 0.11: Einträge, die der Server einzeln ablehnt (ungültig oder für diese Kennung nicht erlaubt).
   * Alle anderen sind angenommen; die Geräte senden abgelehnte nicht erneut.
   */
  abgelehnt?: { id: string; fehler: FehlerCode; meldung: string }[];
}

/** GET events&turnier=…&ab=<seq> – öffentlich lesbar */
export interface AbholenAntwort {
  ereignisse: Ereignis[];
  hoechsteSeq: number;
  /** true, wenn weitere Ereignisse vorliegen (Antwort war auf MAX_EREIGNISSE_JE_AUFRUF begrenzt) */
  mehr: boolean;
  /**
   * Ab 0.9 (Datenschutz): „voll“ für Leitung, Helfer und Spieler mit Helfer-Recht; „spieler“ für
   * Spielerkennungen (ohne Jahrgang, Geschlecht, Pool-Bezug); sonst „zuschauer“ (zusätzlich ohne Namen
   * von Eintragenden und frei eingetippte Schiedsrichter) bzw. „kurz“ (zusätzlich Nachname als „M.“).
   * Ändert sich die Sicht, holt das Gerät alles neu ab.
   */
  sicht?: Sicht;
  /**
   * Ab 0.12 (Datenschutz, nur Sichten spieler/zuschauer/kurz): Fingerabdruck der Menge entfernter Spieler.
   * Deren Namen ersetzen die Server durch ENTFERNT_NAME (spieler.angelegt/geaendert ohne Angaben zur Person).
   * Ändert er sich, holt das Gerät alles neu ab – wie bei einem Wechsel der Sicht.
   */
  filter?: string;
  /**
   * Ab 0.11: bis zu dieser Laufnummer gelesen. Der Datenschutz-Filter kann Einträge weglassen (z. B.
   * Startgeld für Zuschauer) – das Gerät holt beim nächsten Mal ab hier ab.
   */
  bis?: number;
}
/** „helfer“ (ab 0.11): Helfer ohne Aufgabe „Kasse“ – wie „voll“, aber ohne Zahlungen, Check-in und Bankverbindung */
export type Sicht = 'voll' | 'helfer' | 'spieler' | 'zuschauer' | 'kurz';
/** turnier.daten, Feld namen: Wie Zuschauer Spielernamen sehen (Standard voll) */
export type NamenFuerZuschauer = 'voll' | 'kurz';

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
  /** Ort, Tische, welche Spielerangaben im Turnier stehen, Veröffentlichung der Stände (Daten: TurnierDaten-Felder) */
  turnierDaten: 'turnier.daten',
  spielerAngelegt: 'spieler.angelegt',
  spielerGeaendert: 'spieler.geaendert',
  spielerEntfernt: 'spieler.entfernt',
  konkurrenzAngelegt: 'konkurrenz.angelegt',
  konkurrenzGeaendert: 'konkurrenz.geaendert',
  konkurrenzEntfernt: 'konkurrenz.entfernt',
  /** Meldung eines Spielers zu einer Einzel-Konkurrenz */
  teilnehmerGemeldet: 'teilnehmer.gemeldet',
  /** Meldung eines Paares zu einer Doppel-/Mixed-Konkurrenz (Daten: { konkurrenz, id, spieler: [a, b] }) */
  paarGemeldet: 'paar.gemeldet',
  /** Vor dem Start: Meldung streichen. Nach dem Start: Rückzug. */
  teilnehmerAbgemeldet: 'teilnehmer.abgemeldet',
  /** Manuelle Setzliste */
  setzliste: 'konkurrenz.setzliste',
  /** Ergebnis einer Auslosung (Gruppen oder K.-o.-Baum), mit Zufallswert */
  auslosung: 'auslosung.gesetzt',
  phaseGestartet: 'phase.gestartet',
  phaseZurueck: 'phase.zurueckgenommen',
  /** Losentscheid bei Gleichstand in einer Gruppe */
  gruppeLos: 'gruppe.los',
  spielErgebnis: 'spiel.ergebnis',
  spielBestaetigt: 'spiel.bestaetigt',
  spielAngefochten: 'spiel.angefochten',
  /** Leitung entscheidet einen Konflikt / eine Anfechtung zugunsten eines Eintrags */
  spielEntschieden: 'spiel.entschieden',
  spielZurueckgesetzt: 'spiel.zurueckgesetzt',
  /** Spielaufruf: Tisch und Schiedsrichter (Daten: { konkurrenz, spiel, tisch, schiri?: { name, spieler? } }) – Leitung und Helfer */
  spielAufgerufen: 'spiel.aufgerufen',
  /** Aufruf zurücknehmen (Tisch wieder frei) */
  spielAufrufZurueck: 'spiel.aufruf_zurueck',
  /** Tisch sperren/freigeben (Daten: { nr, gesperrt }) */
  tischGesperrt: 'tisch.gesperrt',
  /**
   * Ab 0.10: Spiel vorplanen – Tisch und/oder Uhrzeit (Daten: { konkurrenz, spiel, tisch: Zahl|null, zeit: "HH:MM"|null }).
   * Nur Leitung. Der Zeitplan und das automatische Belegen halten sich daran.
   */
  spielGeplant: 'spiel.geplant',
  /**
   * Ab 0.10: Auslosung im laufenden Turnier ändern (nur Leitung). Gruppen: { konkurrenz, phase: "gruppen",
   * gruppen: [[ids]] } – dieselben Teilnehmer, neu verteilt; K.-o.: { konkurrenz, phase: "ko", plaetze }.
   * Spiele mit Ergebnis oder Aufruf dürfen sich dadurch nicht ändern.
   */
  auslosungGeaendert: 'auslosung.geaendert',
  /**
   * Ab 0.10: Rückgängig machen bzw. wiederherstellen (nur Leitung). Daten: { ereignisse: [IDs], zurueck: true|false }.
   * Die genannten früheren Einträge zählen nicht mehr (zurueck=true) bzw. wieder (false). Nichts wird gelöscht.
   */
  eintragZurueck: 'eintrag.zurueckgenommen',
  /**
   * Ab 0.11 (Leitung oder Helfer mit Aufgabe „kasse“, nur volle Sicht): Zahlung des Startgelds.
   * Daten: { id: Buchungs-ID, spieler, betrag: Cent (0–100000), art: "bar" | "ueberweisung" | "erlassen" }.
   * Die Quittungsnummer ist die laufende Nummer der Buchung im Turnier.
   */
  startgeldGebucht: 'startgeld.gebucht',
  /** Buchung stornieren (Daten: { buchung }) – Kasse oder Leitung */
  startgeldStorniert: 'startgeld.storniert',
  /** Check-in am Turniertag (Daten: { spieler, da: true|false }) – Kasse oder Leitung, nur volle Sicht */
  teilnehmerEingecheckt: 'teilnehmer.eingecheckt',
} as const;

/* ---------- Online-Anmeldung mit Warteliste (ab Server 0.11, nur Online-Server mit Mailversand) ----------
 * Die Turnierleitung öffnet die Anmeldung je Turnier; Spieler melden sich über den Link #/meldung/<turnier>
 * an und bestätigen per Mail (Link 24 Stunden gültig). Ist eine Konkurrenz voll, kommen sie auf die
 * Warteliste und rücken nach, wenn jemand absagt (Mail). Die Leitung übernimmt Anmeldungen ins Turnier
 * (Ereignisse spieler.angelegt / teilnehmer.gemeldet mit festen IDs „anm-<id>-…“, damit nichts doppelt
 * entsteht). E-Mail-Adressen stehen nie in den Ereignissen; Anmeldungen werden 30 Tage nach dem
 * Turniertag gelöscht, unbestätigte nach 24 Stunden.
 */
export type AnmeldeStatus = 'platz' | 'warteliste' | 'abgemeldet';
export interface AnmeldungKonkurrenz {
  /** Konkurrenz-ID im Turnier */
  id: string;
  name: string;
  art: 'einzel' | 'doppel' | 'mixed';
  /** Höchstzahl Teilnehmer; null = unbegrenzt */
  max: number | null;
  /** Startgeld in Cent; null = keins */
  startgeld: number | null;
  /** Nur Leitung: Plätze, die schon von Hand im Turnier vergeben sind (zählen gegen die Höchstzahl) */
  vorab?: number;
}
export interface AnmeldungEinstellungen {
  offen: boolean;
  /** Meldeschluss (ISO); null = bis zum Turniertag */
  schluss: string | null;
  konkurrenzen: AnmeldungKonkurrenz[];
  /** Hinweis der Turnierleitung auf der Anmeldeseite */
  hinweis: string;
  /** Zusätzliche Pflichtangaben (wie im Turnier geführt) */
  angaben: ('ttr' | 'klasse' | 'geschlecht' | 'jahrgang')[];
  /** Für Überweisung und GiroCode; null = keine. Öffentlich (GET anmeldung) immer null – nur nach Bestätigung im Stand */
  bank: { empfaenger: string; iban: string; bic: string } | null;
  /** Ort des Turniers (Anzeige) */
  ort: string;
  /**
   * Hinweis-Mail an die Turnierleitung bei jeder bestätigten Anmeldung (ab 0.13, ohne Namen; fehlt = an).
   * Nur in der Fassung für die Leitung, nie öffentlich.
   */
  hinweisMail?: boolean;
}
export const ANMELDUNG_MAX_KONKURRENZEN = 30;
export const ANMELDUNG_MAX_JE_TURNIER = 1000;
/** So viele Tage nach dem Turniertag werden Anmeldungen (mit E-Mail) gelöscht */
export const ANMELDUNG_LOESCHEN_NACH_TAGEN = 30;
/** GET anmeldung&turnier=… – öffentlich (wer die Turnierkennung kennt) */
export interface AnmeldungInfo {
  turnier: { id: string; name: string; datum: string | null; veranstalter: string };
  einstellungen: AnmeldungEinstellungen;
  /** Anmeldung jetzt möglich (offen, vor Meldeschluss und Turniertag) */
  moeglich: boolean;
  /** Je Konkurrenz: vergebene Plätze und Länge der Warteliste (ohne Namen) */
  belegung: Record<string, { plaetze: number; warteliste: number }>;
}
/** POST anmeldung.senden – öffentlich, Fangfeld `website`, Bestätigung per Mail */
export interface AnmeldungSendenAnfrage {
  turnier: string;
  vorname: string;
  nachname: string;
  verein: string;
  email: string;
  ttr?: number | null;
  klasse?: string | null;
  geschlecht?: 'm' | 'w' | 'd' | null;
  jahrgang?: number | null;
  /** Gewünschte Konkurrenzen; bei Doppel/Mixed optional Partner/in (Name, die Leitung bildet das Paar) */
  konkurrenzen: { id: string; partner?: string }[];
  /** Jünger als 18 Jahre: dann muss `einverstanden` (Erziehungsberechtigte) true sein */
  minderjaehrig: boolean;
  einverstanden?: boolean;
  /** Datenschutzhinweis zur Kenntnis genommen */
  datenschutz: boolean;
  website?: string;
}
/** Sicht der angemeldeten Person auf ihre Anmeldung (nach Bestätigung bzw. über den Link aus der Mail) */
export interface AnmeldungStand {
  turnier: { id: string; name: string; datum: string | null };
  vorname: string;
  nachname: string;
  /** status null = noch nicht bestätigt (Plätze werden erst mit der Bestätigung vergeben) */
  konkurrenzen: { id: string; name: string; status: AnmeldeStatus | null; position: number | null }[];
  /** Summe der Startgelder der Konkurrenzen mit Platz (Cent) */
  startgeld: number;
  bank: AnmeldungEinstellungen['bank'];
  /** Verwendungszweck für die Überweisung */
  zweck: string;
  /** Abmelden über den Link noch möglich */
  abmeldbar: boolean;
  /** Per Knopf bestätigt (der Link allein bestätigt nicht – Mail-Scanner öffnen Links) */
  bestaetigt: boolean;
}
/** POST anmeldung.bestaetigen { turnier, schluessel } → AnmeldungStand (Schlüssel aus dem Bestätigungslink) */
/** POST anmeldung.stand { turnier, schluessel } → AnmeldungStand (Schlüssel aus dem Abmeldelink) */
/** POST anmeldung.abmelden { turnier, schluessel, konkurrenz? } → AnmeldungStand (ohne konkurrenz: alle) */
export interface AnmeldungSchluesselAnfrage {
  turnier: string;
  schluessel: string;
  konkurrenz?: string;
}
/** Eintrag in der Liste der Turnierleitung (GET anmeldungen&turnier=…) */
export interface AnmeldungEintrag {
  /** 10 Zeichen; zugleich die Spieler-ID bei der Übernahme */
  id: string;
  vorname: string;
  nachname: string;
  verein: string;
  email: string;
  ttr: number | null;
  klasse: string | null;
  geschlecht: 'm' | 'w' | 'd' | null;
  jahrgang: number | null;
  minderjaehrig: boolean;
  angelegt: string;
  /** null = noch nicht per Mail bestätigt */
  bestaetigt: string | null;
  konkurrenzen: { id: string; status: AnmeldeStatus; position: number | null; partner: string | null }[];
  /** Ins Turnier übernommen (Spieler-ID) */
  spieler: string | null;
}
export interface AnmeldungenAntwort {
  einstellungen: AnmeldungEinstellungen;
  anmeldungen: AnmeldungEintrag[];
  /** Ab 0.12: darf das Konto die Anmeldung öffnen? ab = Tag der automatischen Freigabe (ISO) */
  freigabe?: { erlaubt: boolean; ab: string | null };
}
/** Platzhalter, den die Server Spielern und Zuschauern statt des Namens entfernter Spieler liefern (ab 0.12) */
export const ENTFERNT_NAME = 'Entfernt';
/** POST anmeldung.einstellungen { turnier, ...AnmeldungEinstellungen } – nur Leitung */
/** POST anmeldung.aendern { turnier, id, konkurrenz, status } – Leitung setzt Platz/Warteliste/abgemeldet (Mail an die Person) */
export interface AnmeldungAendernAnfrage {
  turnier: string;
  id: string;
  konkurrenz: string;
  status: AnmeldeStatus;
}
/** POST anmeldung.uebernommen { turnier, ids } – Anmeldungen sind als Spieler im Turnier */
/** POST anmeldung.loeschen { turnier, id } – Anmeldung endgültig löschen */

/* ---------- Android-Zentrale (ab 0.5) ----------
 * Routen „zentrale.*“ beantwortet nur die Zentrale, und nur Anfragen vom Gerät der Zentrale selbst.
 * Der Online-Server kennt dafür zentrale.uebernehmen / zentrale.rueckgabe / zentrale.freigeben
 * und sicherung.senden (siehe docs/schnittstelle.md).
 */
export interface ZentraleStatus {
  version: string;
  id: string;
  port: number;
  /** Adressen der App im WLAN, beste zuerst */
  adressen: string[];
  /** Geräte, die in den letzten 3 Minuten zugegriffen haben */
  geraete: number;
  /** Vom Nutzer eingetragene Zugangsdaten des Handy-Hotspots (für den WLAN-QR-Code) */
  wlan: { ssid: string | null; passwort: string | null };
  /** Hotspot, den die App selbst startet (Name und Passwort vergibt Android) */
  hotspot: {
    aktiv: boolean;
    ssid: string | null;
    passwort: string | null;
    moeglich?: boolean;
  };
  akkuAusnahme: boolean;
  internet: boolean;
  online: {
    url: string;
    verbunden: boolean;
    konto: { name: string; email: string } | null;
    mail: boolean;
    fehler: string | null;
  };
  /** Sicherungen, die auf Internet warten */
  warteschlange: {
    turnier: string;
    name: string | null;
    anlass: string;
    seit: string;
    fehler: string | null;
  }[];
  /** Nur nach zentrale.hotspot: Hinweis des Systems */
  meldung?: string | null;
}

/** GET zentrale.online.turniere – Turniere des verbundenen Online-Kontos */
export interface OnlineTurnier extends TurnierInfo {
  /** liegt auf dieser Zentrale (übernommen, nicht zurückgegeben) */
  aufDieserZentrale: boolean;
  vonDieserZentrale: boolean;
}
