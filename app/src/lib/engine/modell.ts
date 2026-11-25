import type { PraemieEinstellungen } from './praemie';
import type { Autor } from '@shared/protokoll';
import type { BegegnungDaten, Mannschaft, MannschaftEinstellungen } from './mannschaft';
import { vorlageErkennen } from './stufen';

/**
 * Datenmodell der Turnier-Engine. Alles hier wird aus den Ereignissen berechnet
 * (siehe zustand.ts); nichts davon wird direkt gespeichert.
 */

/**
 * Spielsystem: jeder gegen jeden, Gruppen + K.-o., K.-o. (einfach), Doppel-K.-o.
 * (zweite Chance: Verlierer spielen im Verliererbaum weiter, Endspiel Sieger gegen Sieger),
 * Schweizer System oder Kaiserturnier (beide Runde für Runde ausgelost, siehe runden.ts).
 */
export type Modus = 'jgj' | 'gruppen_ko' | 'gruppen_platz' | 'ko' | 'doppel_ko' | 'schweizer' | 'cup' | 'kaiser';
export const MODI: readonly Modus[] = ['gruppen_ko', 'gruppen_platz', 'jgj', 'ko', 'doppel_ko', 'schweizer', 'cup', 'kaiser'];
/**
 * Gruppen + Platzierungsgruppen (ab 0.16): Vorrunde in Gruppen (jeder gegen jeden), danach spielen die Gleichplatzierten
 * aller Gruppen in Platzierungsgruppen neu jeder gegen jeden (z. B. 1. und 2. beider Gruppen um Platz 1–4, 3. und 4. um
 * Platz 5–8). Ergebnisse der Vorrunde werden nicht mitgenommen. Ergibt eine vollständige Gesamtplatzierung.
 */
export function istPlatzModus(m: Modus): boolean {
  return m === 'gruppen_platz';
}
/** Schweizer System oder Cup-System (wie bei den HTTV-Turnierserien mit MKTT): Rangliste mit Buchholz */
export function istSchweizerArt(m: Modus): boolean {
  return m === 'schweizer' || m === 'cup';
}
/** Einzel, Doppel (zwei Spieler je Teilnehmer), Mixed (Doppel aus Frau und Mann) oder Mannschaft (ab 0.13) */
export type KonkurrenzArt = 'einzel' | 'doppel' | 'mixed' | 'mannschaft';
/** Spielsysteme, die Mannschafts-Konkurrenzen erlauben */
export const MODI_MANNSCHAFT: readonly Modus[] = ['gruppen_ko', 'gruppen_platz', 'jgj', 'ko'];
export const ALLE_ARTEN: readonly KonkurrenzArt[] = ['einzel', 'doppel', 'mixed', 'mannschaft'];

/**
 * Welche Konkurrenzarten und Spielsysteme das Turnier anbietet (ab 0.16, Startassistent bzw. Einstellungen).
 * Unter „Konkurrenzen“ stehen nur diese zur Wahl. null im Turnier = alle.
 */
export interface KonkurrenzAuswahl {
  arten: KonkurrenzArt[];
  modi: Modus[];
}
export const ALLES_AUSWAEHLBAR: KonkurrenzAuswahl = { arten: [...ALLE_ARTEN], modi: [...MODI] };

/** Leistungsklassen des Turniers aus dem Startassistenten (Vorgabe für den Klassen-Assistenten) */
export interface KlassenVorgabe {
  nach: 'keine' | 'klasse' | 'ttr';
  /** TTR-Grenzen (nur bei „ttr“), aufsteigend */
  grenzen: number[];
}

/**
 * Abweichende Einstellungen für die zweite Stufe (K.-o.-Endrunde bzw. Platzierungsgruppen, ab 0.16):
 * eigene Gewinnsätze und – bei Mannschaften – eigenes Spielsystem. null = wie die Vorrunde.
 */
export interface EndrundeEinstellungen {
  bestOf: BestOf | null;
  mannschaft: MannschaftEinstellungen | null;
}
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
/** Best of 1 = ein Gewinnsatz (z. B. beim Kaiserturnier) */
export type BestOf = 1 | 3 | 5 | 7;
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
  /**
   * TTR ist ein geschätzter Wert für Hobbyspieler (Einstufung mit 4 Fragen, siehe stufen.ts) statt des
   * amtlichen Q-TTR (ab 0.15). Fehlt = amtlich.
   */
  ttrGeschaetzt?: boolean;
  klasse?: string | null;
  geschlecht?: Geschlecht | null;
  jahrgang?: number | null;
  /** ID im Spielerpool des Kontos bzw. Geräts (zum Wiederfinden) */
  pool?: string | null;
  /**
   * Vorbereitung click-TT (ab 0.12, noch ohne Oberfläche): Spieler-ID bzw. Lizenznummer aus click-TT für
   * Import und Ergebnismeldung (docs/erweiterungen.md). Wie Jahrgang nur in der vollen Sicht.
   */
  lizenz?: string | null;
  /** Begleitperson (ab 0.18): z. B. Mannschaftsleitung, die nicht selbst spielt – keine Meldung, kein Startgeld */
  begleitung?: boolean;
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
  /** Reines Hobby-Turnier: nur Spieler ohne amtlichen TTR (ab 0.15; fehlt = aus) */
  nurHobby?: boolean;
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
  /** Einzel, Doppel oder Mixed (ab Etappe 5) */
  art: KonkurrenzArt;
  /**
   * Trostrunde: Wer in der ersten K.-o.-Runde verliert, spielt in einem eigenen Baum weiter
   * (eigener Trostrunden-Sieger). Nur bei K.-o. und Gruppen + K.-o.
   */
  trostrunde: boolean;
  /**
   * Doppel-K.-o.: Gewinnt im Endspiel der Sieger des Verliererbaums, hat jeder eine Niederlage –
   * dann entscheidet ein zweites Endspiel. Aus = ein Endspiel entscheidet.
   */
  finaleWiederholung: boolean;
  /** Schweizer System und Kaiserturnier: Anzahl Runden; null = automatisch */
  runden: number | null;
  /**
   * Vorgabeturnier: Der schwächere Teilnehmer beginnt jeden Satz mit Vorgabepunkten –
   * je so vielen TTR-Punkten Unterschied ein Punkt (null = ohne Vorgabe), höchstens vorgabeMax.
   */
  vorgabe: number | null;
  vorgabeMax: number;
  /**
   * Schweizer System und Cup-System: Jedes Spiel hat genau so viele Sätze (2 oder 4), alle werden
   * gespielt – Unentschieden ist möglich (Sieg 1, Unentschieden ½, Niederlage 0 Punkte). null = normal (Best of).
   */
  festeSaetze: 2 | 4 | null;
  /** Beschleunigtes Schweizer System: in den ersten beiden Runden zählt die obere Hälfte der Startliste einen Punkt mehr */
  beschleunigt: boolean;
  /** Frühester Beginn dieser Konkurrenz („HH:MM“, für Zeitplan und Spielaufruf); null = sofort */
  beginn: string | null;
  /** Startgeld je Spieler in Cent (ab 0.11, für Kasse und Online-Anmeldung); null = keins */
  startgeld: number | null;
  /** Höchstzahl Teilnehmer für die Online-Anmeldung (danach Warteliste); null = unbegrenzt */
  maxTeilnehmer: number | null;
  /** Siegprämie aus dem bezahlten Startgeld (ab 0.18); null = keine */
  praemie: PraemieEinstellungen | null;
  /** Mannschafts-Konkurrenz: Spielsystem (ab 0.13); null bei Einzel/Doppel */
  mannschaft: MannschaftEinstellungen | null;
  /** Zweite Stufe (Endrunde/Platzierungsgruppen) mit eigenen Gewinnsätzen bzw. eigenem Spielsystem; null = wie Vorrunde */
  endrunde: EndrundeEinstellungen | null;
  /**
   * Mannschaften: Eine Begegnung belegt zwei Tische (ab 0.16) – Teilspiele laufen parallel, z. B. die beiden
   * Eingangsdoppel oder Einzel 1 und 2.
   */
  zweiTische: boolean;
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
      nurHobby: false,
    },
    klassenTrennung: 'keine',
    ttrGrenzen: [],
    veroeffentlichung: null,
    art: 'einzel',
    trostrunde: false,
    finaleWiederholung: false,
    runden: null,
    vorgabe: null,
    vorgabeMax: 8,
    festeSaetze: null,
    beschleunigt: false,
    beginn: null,
    startgeld: null,
    praemie: null,
    maxTeilnehmer: null,
    mannschaft: null,
    endrunde: null,
    zweiTische: false,
  };
}

/** Teilnehmer einer Doppel-/Mixed-Konkurrenz: zwei Spieler, Teilnehmer-ID „p-…“ */
export interface Paar {
  id: string;
  spieler: [string, string];
}

/** Hat die Konkurrenz einen K.-o.-Teil? */
/**
 * Einstellungen, die für ein Spiel gelten: in der zweiten Stufe (K.-o.-Endrunde nach Gruppen, Platzierungsgruppen)
 * ggf. mit eigenen Gewinnsätzen und eigenem Mannschafts-Spielsystem.
 */
export function einstFuer(k: Pick<KonkurrenzZustand, 'einst' | 'gruppen'>, s: Pick<Spiel, 'phase' | 'gruppe'> | null | undefined): KonkurrenzEinstellungen {
  const er = k.einst.endrunde;
  if (!er || !s || !inEndrunde(k, s)) return k.einst;
  return { ...k.einst, bestOf: er.bestOf ?? k.einst.bestOf, mannschaft: k.einst.art === 'mannschaft' && er.mannschaft ? er.mannschaft : k.einst.mannschaft };
}

/** Gehört das Spiel zur zweiten Stufe (K.-o. nach Gruppen oder Platzierungsgruppe)? */
export function inEndrunde(k: Pick<KonkurrenzZustand, 'einst' | 'gruppen'>, s: Pick<Spiel, 'phase' | 'gruppe'>): boolean {
  if (k.einst.modus === 'gruppen_ko') return s.phase === 'ko';
  if (k.einst.modus === 'gruppen_platz') return s.phase === 'gruppen' && s.gruppe !== null && (k.gruppen[s.gruppe]?.platzAb ?? null) !== null;
  return false;
}

export function mitKo(modus: Modus): boolean {
  return modus === 'gruppen_ko' || modus === 'ko' || modus === 'doppel_ko';
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

/** Lesbarer Name eines TTR-Bereichs (Stufe aus klasseVon); Grenzen einer Klassen-Vorlage bekommen deren Namen */
export function ttrBereichName(stufe: number, grenzen: number[]): string {
  const g = [...grenzen].sort((a, b) => a - b);
  if (g.length === 0) return 'alle';
  const bereich = stufe === 0 ? `bis ${g[0]! - 1}` : stufe >= g.length ? `ab ${g[g.length - 1]}` : `${g[stufe - 1]}–${g[stufe]! - 1}`;
  const name = vorlageErkennen(g)?.namen[Math.min(stufe, g.length)];
  return name ? `${name} (${stufe === 0 || stufe >= g.length ? bereich : `bis ${g[stufe]! - 1}`})` : bereich;
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
  'art',
  'festeSaetze',
  'beschleunigt',
  'mannschaft',
];

/** Feste Satzzahl, soweit sie für das Spielsystem gilt (nur Schweizer System und Cup-System) */
export function festeSaetzeVon(e: Pick<KonkurrenzEinstellungen, 'modus' | 'festeSaetze'>): 2 | 4 | null {
  return istSchweizerArt(e.modus) ? e.festeSaetze : null;
}

export type PhaseArt = 'gruppen' | 'ko';
export type Seite = 'a' | 'b';
/** Welcher Baum im K.-o.-Teil: Hauptrunde, Trostrunde, Verliererbaum (Doppel-K.-o.), Endspiele des Doppel-K.-o. */
export type Baum = 'haupt' | 'trost' | 'verlierer' | 'finale';
/** Woher ein Teilnehmer in ein K.-o.-Spiel kommt */
export type Quelle = { spiel: string; wer: 'sieger' | 'verlierer' } | { platz: number };
export interface Schiedsrichter {
  name: string;
  /** Spieler-ID, wenn ein Spieler pfeift (für „Du pfeifst Tisch 3“) */
  spieler: string | null;
}

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
  /** null = unentschieden (nur bei fester Satzzahl, siehe festeSaetze) */
  gewinner: Seite | null;
  art: 'normal' | 'kampflos' | 'aufgabe';
  /** Mannschafts-Begegnung: gewonnene Teilspiele A:B (Sätze und Bälle sind dann Summen aller Teilspiele) */
  spiele?: [number, number];
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
  /** K.-o.: Baum, zu dem das Spiel gehört (Gruppen: haupt) */
  baum: Baum;
  /** K.-o.: Herkunft der Teilnehmer; Gruppen: null */
  quelleA: Quelle | null;
  quelleB: Quelle | null;
  /** Nur Doppel-K.-o., zweites Endspiel: findet nur statt, wenn im ersten Endspiel Seite b gewinnt */
  nurWennBGewinnt: boolean;
  /** Spielaufruf: Tisch, Zeit des Aufrufs, Schiedsrichter */
  tisch: number | null;
  /** Mannschaften mit zwei Tischen je Begegnung: zweiter Tisch (ab 0.16) */
  tisch2?: number | null;
  aufgerufen: string | null;
  schiri: Schiedsrichter | null;
  /** Vorplanung der Leitung (Ereignis spiel.geplant): Tisch und/oder Uhrzeit „HH:MM“ */
  plan: SpielPlan | null;
}

export interface SpielPlan {
  tisch: number | null;
  zeit: string | null;
}

/** Uhrzeit „HH:MM“ (00:00–23:59) */
export const UHRZEIT_MUSTER = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Zeitpunkt (ms) der Uhrzeit „HH:MM“ am Tag von `jetzt` (Ortszeit des Geräts) */
export function uhrzeitMs(hhmm: string, jetzt: number): number {
  const d = new Date(jetzt);
  d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)), 0, 0);
  return d.getTime();
}

/** „14:05“ aus einem Zeitpunkt */
export function uhrzeitText(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface Gruppe {
  nr: number;
  /** Teilnehmer in Positionsreihenfolge (1 = Gruppenkopf) */
  mitglieder: string[];
  /** Losentscheide: je Gruppe von Gleichstehenden (Schlüssel = sortierte IDs) die geloste Reihenfolge */
  los: Record<string, string[]>;
  /**
   * Platzierungsgruppe (Modus gruppen_platz, zweite Stufe): erster Platz, um den die Gruppe spielt (z. B. 5 bei
   * „Plätze 5–8“). Fehlt/null = Gruppe der Vorrunde.
   */
  platzAb?: number | null;
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
  /** Gemeldete Teilnehmer (Einzel: Teilnehmer-ID = Spieler-ID; Doppel: Paar-ID), in Meldereihenfolge */
  meldungen: string[];
  /** Paare der Doppel-/Mixed-Konkurrenz */
  paare: Record<string, Paar>;
  /** Mannschaften (ab 0.13), Teilnehmer-ID „m-…“ */
  mannschaften: Record<string, Mannschaft>;
  /** Aufstellungen und Teilspiele je Begegnung (Spiel-ID) */
  begegnungen: Record<string, BegegnungDaten>;
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
  /** Ab 0.18: Check-in dieser Konkurrenz abgeschlossen (Voraussetzung der Auslosung bei checkinPflicht) */
  checkinFertig: boolean;
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

/** Überschrift einer Gruppe: „Gruppe A“ bzw. bei Platzierungsgruppen „Plätze 5–8“ */
export function gruppeTitel(k: Pick<KonkurrenzZustand, 'gruppen'>, nr: number): string {
  const g = k.gruppen[nr];
  if (g && typeof g.platzAb === 'number') {
    const bis = g.platzAb + g.mitglieder.length - 1;
    return bis > g.platzAb ? `Plätze ${g.platzAb}–${bis}` : `Platz ${g.platzAb}`;
  }
  return `Gruppe ${gruppenName(nr)}`;
}

/** Punkte mit halben Punkten: 2.5 → „2½“, 0.5 → „½“ */
export function punkteText(n: number): string {
  const ganz = Math.floor(n);
  const halb = n - ganz >= 0.5;
  return halb ? `${ganz ? ganz : ''}½` : String(ganz);
}

export function spielerName(s: Pick<SpielerDaten, 'vorname' | 'nachname'> | undefined): string {
  if (!s) return '?';
  return `${s.vorname} ${s.nachname}`.trim();
}

/** Kurzform eines Nachnamens für Zuschauer: „Müller“ → „M.“ (wie der Server, Api::kurzname) */
export function kurzname(nachname: string): string {
  const n = nachname.trim();
  if (!n) return '';
  const erstes = [...n][0]!;
  return `${erstes.toLocaleUpperCase('de-DE')}.`;
}

/** Ist der Nachname schon die Kurzform („M.“)? */
export function istKurzname(nachname: string): boolean {
  return /^\p{L}\.$/u.test(nachname.trim());
}

/** Name eines Paares: „Müller/Schmidt“ (Nachnamen; bei gleichem Nachnamen mit Vornamen-Initial; Kurzform: „Max M./Eva S.“) */
export function paarName(a: SpielerDaten | undefined, b: SpielerDaten | undefined): string {
  if (!a || !b) return '?';
  if (istKurzname(a.nachname) || istKurzname(b.nachname)) return `${spielerName(a)}/${spielerName(b)}`;
  const gleich = a.nachname.trim().toLowerCase() === b.nachname.trim().toLowerCase();
  const kurz = (s: SpielerDaten) => (gleich && s.vorname ? `${s.vorname[0]}. ${s.nachname}` : s.nachname || s.vorname);
  return `${kurz(a)}/${kurz(b)}`;
}

/** Betrag in Cent als „12,50 €“ */
export function euro(cent: number): string {
  return `${(cent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Eingabe „12,50“ / „12.5“ / „12“ → Cent; null bei leer, undefined bei ungültig */
export function centAus(text: string): number | null | undefined {
  const t = text.trim().replace(/\s*€$/, '').replace(',', '.');
  if (!t) return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

/** Spiel-ID-Präfix je Baum */
export const BAUM_PRAEFIX: Record<Baum, string> = { haupt: 'ko', trost: 'tr', verlierer: 'vl', finale: 'fi' };
