import type { Autor } from '@shared/protokoll';

/**
 * Datenmodell der Turnier-Engine. Alles hier wird aus den Ereignissen berechnet
 * (siehe zustand.ts); nichts davon wird direkt gespeichert.
 */

export type Modus = 'jgj' | 'gruppen_ko' | 'ko';
/** Rangfolge in Gruppen: DTTB-Wettspielordnung D 7.5 oder ITTF-Regel 3.7.5 */
export type Wertung = 'dttb' | 'ittf';
/** Rückzug während der Gruppe: nach WO D 7.9 (Spiele streichen) oder „Hobby“ (gespielte bleiben, Rest kampflos) */
export type Rueckzug = 'wo' | 'hobby';
/** Ergebniseingabe: Satzpunkte (z. B. 11:7) oder nur Satzstand (z. B. 3:1) */
export type Eingabe = 'punkte' | 'saetze';
export type Setzung = 'ttr' | 'manuell' | 'keine';
/**
 * Gruppen nur aus gleicher Leistungsklasse bilden: nach eigenem Klassenbegriff, nach TTR-Bereichen
 * (Grenzen in `ttrGrenzen`) oder gemischt (keine).
 */
export type KlassenTrennung = 'keine' | 'klasse' | 'ttr';

/**
 * Welche Stände öffentlich zu sehen sind. Einzelne Spielergebnisse sieht man immer; Tabellen,
 * Platzierungen und der K.-o.-Baum lassen sich bis zum Schluss verdecken („Spannung bis zum Schluss“).
 */
export interface Veroeffentlichung {
  tabellen: boolean;
  ko: boolean;
}
export const ALLES_OEFFENTLICH: Veroeffentlichung = {
  tabellen: true,
  ko: true,
};
export type BestOf = 3 | 5 | 7;
export type Geschlecht = 'm' | 'w' | 'd';
/** Angaben, die die Turnierleitung zusätzlich zu Name und Verein im Turnier führen kann */
export type Angabe = 'ttr' | 'klasse' | 'geschlecht' | 'jahrgang';
export const ALLE_ANGABEN: readonly Angabe[] = ['ttr', 'klasse', 'geschlecht', 'jahrgang'];
export const STANDARD_ANGABEN: readonly Angabe[] = ['ttr', 'klasse'];

export interface SpielerDaten {
  vorname: string;
  nachname: string;
  verein: string;
  ttr?: number | null;
  klasse?: string | null;
  geschlecht?: Geschlecht | null;
  jahrgang?: number | null;
  /** ID im Spielerpool des Kontos bzw. Geräts (zum Wiederfinden) */
  pool?: string | null;
}

export interface TurnierSpieler extends SpielerDaten {
  id: string;
}

export interface Zulassung {
  ttrMin: number | null;
  ttrMax: number | null;
  klassen: string[];
  geschlecht: Geschlecht[];
  jahrgangVon: number | null;
  jahrgangBis: number | null;
}

export interface KonkurrenzEinstellungen {
  name: string;
  modus: Modus;
  bestOf: BestOf;
  eingabe: Eingabe;
  wertung: Wertung;
  rueckzug: Rueckzug;
  setzung: Setzung;
  /** Anzahl Gesetzte; null = automatisch (Gruppen: Anzahl Gruppen, K.-o.: ein Viertel des Feldes) */
  gesetzte: number | null;
  vereinstrennung: boolean;
  /** Höchstzahl Spieler je Gruppe (die App schlägt die Gruppenzahl daraus vor) */
  gruppenGroesse: number;
  /** So viele kommen je Gruppe in die Endrunde (Gruppen + K.-o.) */
  aufsteiger: number;
  platz3: boolean;
  zulassung: Zulassung;
  /** Gruppen nur aus gleicher Leistungsklasse (Erläuterung in der App) */
  klassenTrennung: KlassenTrennung;
  /** TTR-Grenzen für die Trennung nach TTR, aufsteigend, z. B. [1200, 1500] → bis 1199, 1200–1499, ab 1500 */
  ttrGrenzen: number[];
  /** Abweichend vom Turnier: null = wie das Turnier */
  veroeffentlichung: Veroeffentlichung | null;
}

export function standardEinstellungen(name = ''): KonkurrenzEinstellungen {
  return {
    name,
    modus: 'gruppen_ko',
    bestOf: 5,
    eingabe: 'punkte',
    wertung: 'dttb',
    rueckzug: 'wo',
    setzung: 'ttr',
    gesetzte: null,
    vereinstrennung: true,
    gruppenGroesse: 4,
    aufsteiger: 2,
    platz3: false,
    zulassung: {
      ttrMin: null,
      ttrMax: null,
      klassen: [],
      geschlecht: [],
      jahrgangVon: null,
      jahrgangBis: null,
    },
    klassenTrennung: 'keine',
    ttrGrenzen: [],
    veroeffentlichung: null,
  };
}

/** Leistungsklasse eines Spielers für die Gruppenbildung; '' = ohne Klasse */
export function klasseVon(s: Pick<SpielerDaten, 'ttr' | 'klasse'> | undefined, einst: Pick<KonkurrenzEinstellungen, 'klassenTrennung' | 'ttrGrenzen'>): string {
  if (!s || einst.klassenTrennung === 'keine') return '';
  if (einst.klassenTrennung === 'klasse') return (s.klasse ?? '').trim().toLowerCase();
  if (typeof s.ttr !== 'number') return '';
  const grenzen = [...einst.ttrGrenzen].sort((a, b) => a - b);
  let stufe = 0;
  for (const g of grenzen) if (s.ttr >= g) stufe++;
  return `ttr${stufe}`;
}

/** Lesbarer Name eines TTR-Bereichs (Stufe aus klasseVon) */
export function ttrBereichName(stufe: number, grenzen: number[]): string {
  const g = [...grenzen].sort((a, b) => a - b);
  if (g.length === 0) return 'alle';
  if (stufe === 0) return `bis ${g[0]! - 1}`;
  if (stufe >= g.length) return `ab ${g[g.length - 1]}`;
  return `${g[stufe - 1]}–${g[stufe]! - 1}`;
}

/** Diese Einstellungen lassen sich nach dem Start nicht mehr ändern. */
export const FEST_NACH_START: readonly (keyof KonkurrenzEinstellungen)[] = [
  'modus',
  'bestOf',
  'eingabe',
  'setzung',
  'gesetzte',
  'vereinstrennung',
  'gruppenGroesse',
  'klassenTrennung',
  'ttrGrenzen',
];

export type PhaseArt = 'gruppen' | 'ko';
export type Seite = 'a' | 'b';

/** Ergebnis, wie es eingegeben wird (Ereignis „spiel.ergebnis“, Feld daten.ergebnis) */
export interface ErgebnisEingabe {
  /** Gespielte, beendete Sätze aus Sicht A:B */
  saetze?: [number, number][];
  /** Nur Satzstand A:B (Eingabe „nur Sätze“) */
  stand?: [number, number];
  /** Diese Seite ist nicht angetreten */
  kampflos?: Seite;
  /** Diese Seite hat aufgegeben; laufend = Stand im angefangenen Satz */
  aufgabe?: Seite;
  laufend?: [number, number];
}

/** Gewertetes Ergebnis (nach WO D 7.10 bei Aufgabe und kampflos) */
export interface Ergebnis {
  /** Gewertete Sätze A:B; null bei Eingabe „nur Sätze“ */
  saetze: [number, number][] | null;
  satzA: number;
  satzB: number;
  /** Bälle; null, wenn nicht bekannt */
  ballA: number | null;
  ballB: number | null;
  gewinner: Seite;
  art: 'normal' | 'kampflos' | 'aufgabe';
}

export interface ErgebnisEintrag {
  ereignis: string;
  eingabe: ErgebnisEingabe;
  ergebnis: Ergebnis;
  von: Autor | null;
  /** Eingetragen von einem Spieler dieser Seite */
  seite: Seite | null;
  /** Von Leitung oder Helfer (bzw. auf dem Einzelgerät): gilt ohne Bestätigung */
  amtlich: boolean;
  zeit: string;
}

/**
 * Stand eines Ergebnisses:
 * - eingetragen: von einem Spieler, gilt sofort, Gegner kann bestätigen oder anfechten
 * - bestaetigt: vom Gegner bestätigt oder von Leitung/Helfer eingetragen
 * - angefochten: Gegner hat angefochten → Leitung entscheidet
 * - konflikt: zwei abweichende Einträge → Leitung entscheidet
 */
export type ErgebnisStand = 'eingetragen' | 'bestaetigt' | 'angefochten' | 'konflikt';

export type SpielStatus =
  /** K.-o.: Gegner noch nicht bekannt */
  | 'wartet'
  | 'offen'
  | 'gespielt'
  /** K.-o.: ein Platz ist ein Freilos */
  | 'freilos'
  /** Fällt weg (Rückzug nach WO D 7.9) */
  | 'entfallen';

export interface Spiel {
  id: string;
  konkurrenz: string;
  phase: PhaseArt;
  /** Gruppennummer (0 = A), nur in Gruppen */
  gruppe: number | null;
  /** Runde: Gruppen 1…n (Spielfolge), K.-o. 1 = erste Runde */
  runde: number;
  /** K.-o.: Nummer in der Runde (0-basiert); Gruppen: laufende Nummer */
  index: number;
  a: string | null;
  b: string | null;
  /** K.-o.: Platz ist ein Freilos */
  aFrei: boolean;
  bFrei: boolean;
  status: SpielStatus;
  ergebnis: Ergebnis | null;
  stand: ErgebnisStand | null;
  /** Gültiger Eintrag (gehört zu ergebnis) */
  eintrag: ErgebnisEintrag | null;
  /** Bei Konflikt: alle Einträge, zwischen denen die Leitung wählt */
  alternativen: ErgebnisEintrag[];
  /** Wer angefochten hat */
  angefochtenVon: Autor | null;
  /** Ohne gespielten Satz entschieden, weil ein Teilnehmer zurückgezogen hat */
  kampflosDurchRueckzug: Seite | null;
  /** Gruppe: zählt nicht für die Tabelle (Rückzug nach WO D 7.9) */
  gestrichen: boolean;
  gewinner: Seite | null;
  /** K.-o.: Folgespiel; Spiel um Platz 3 hat keins */
  weiter: { spiel: string; seite: Seite } | null;
  /** K.-o.: Verlierer geht ins Spiel um Platz 3 */
  verliererWeiter: { spiel: string; seite: Seite } | null;
  platz3: boolean;
  /** K.-o.: wartet auf Klärung eines Vorgängerspiels (Anfechtung/Konflikt) */
  gesperrt: boolean;
}

export interface Gruppe {
  nr: number;
  /** Teilnehmer in Positionsreihenfolge (1 = Gruppenkopf) */
  mitglieder: string[];
  /** Losentscheide: je Gruppe von Gleichstehenden (Schlüssel = sortierte IDs) die geloste Reihenfolge */
  los: Record<string, string[]>;
}

export interface AuslosungGruppen {
  zufall: number;
  gruppen: string[][];
}
export interface AuslosungKo {
  zufall: number;
  /** Plätze im Baum von oben nach unten; null = Freilos */
  plaetze: (string | null)[];
}

export interface Rueckzugseintrag {
  teilnehmer: string;
  phase: PhaseArt | null;
  zeit: string;
  nr: number;
}

export type KonkurrenzStatus = 'meldung' | 'gruppen' | 'ko' | 'beendet';

export interface KonkurrenzZustand {
  id: string;
  einst: KonkurrenzEinstellungen;
  /** Gemeldete Teilnehmer (Einzel: Teilnehmer-ID = Spieler-ID), in Meldereihenfolge */
  meldungen: string[];
  setzliste: string[] | null;
  auslosungGruppen: AuslosungGruppen | null;
  auslosungKo: AuslosungKo | null;
  gestartet: { gruppen: boolean; ko: boolean };
  status: KonkurrenzStatus;
  gruppen: Gruppe[];
  spiele: Record<string, Spiel>;
  /** Spiel-IDs in Spielfolge */
  reihenfolge: string[];
  rueckzuege: Rueckzugseintrag[];
}

export interface Warnung {
  ereignis: string;
  text: string;
  zeit: string;
  von: string;
}

export function gruppenName(nr: number): string {
  let s = '';
  let n = nr;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function spielerName(s: Pick<SpielerDaten, 'vorname' | 'nachname'> | undefined): string {
  if (!s) return '?';
  return `${s.vorname} ${s.nachname}`.trim();
}
