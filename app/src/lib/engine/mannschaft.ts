import type { Autor } from '@shared/protokoll';
import { kampflosErgebnis } from './wertung';
import type { Ergebnis, ErgebnisEintrag, ErgebnisStand, KonkurrenzEinstellungen, KonkurrenzZustand, Seite, Spiel } from './modell';

/**
 * Mannschaftsturniere (ab 0.13, docs/erweiterungen.md). Eine Begegnung ist ein normales Spiel zwischen zwei
 * Mannschaften (Teilnehmer-ID „m-…“); ihr Ergebnis ergibt sich aus den Teilspielen (Einzel und Doppel) des
 * Spielsystems. Spielfolgen nach DTTB-Wettspielordnung E 6 (Stand 01.06.2024) bzw. ITTF (Olympisches System).
 */

export type SystemId = 'paarkreuz6' | 'bundes4' | 'scheffler4' | 'swaythling3' | 'swaythling_mod' | 'olympisch3' | 'corbillon2' | 'eigen';

/** Ein Teilspiel der Spielfolge: Einzel (Positionen 1…n) oder Doppel (Doppel 1…d) */
export interface TeilDef {
  art: 'einzel' | 'doppel';
  a: number;
  b: number;
}

export interface SpielSystem {
  id: SystemId;
  name: string;
  /** Einzelpositionen je Mannschaft */
  einzel: number;
  /** Doppel je Mannschaft */
  doppel: number;
  folge: TeilDef[];
}

const E = (a: number, b: number): TeilDef => ({ art: 'einzel', a, b });
const D = (a: number, b: number): TeilDef => ({ art: 'doppel', a, b });

export const SYSTEME: Record<Exclude<SystemId, 'eigen'>, SpielSystem> = {
  paarkreuz6: {
    id: 'paarkreuz6',
    name: 'Sechser-Paarkreuz-System (6er, bis 9 Siege)',
    einzel: 6,
    doppel: 3,
    folge: [D(1, 2), D(2, 1), D(3, 3), E(1, 2), E(2, 1), E(3, 4), E(4, 3), E(5, 6), E(6, 5), E(1, 1), E(2, 2), E(3, 3), E(4, 4), E(5, 5), E(6, 6), D(1, 1)],
  },
  bundes4: {
    id: 'bundes4',
    name: 'Bundessystem (4er, bis 6 Siege)',
    einzel: 4,
    doppel: 2,
    folge: [D(1, 1), D(2, 2), E(1, 2), E(2, 1), E(3, 4), E(4, 3), E(1, 1), E(2, 2), E(3, 3), E(4, 4)],
  },
  scheffler4: {
    id: 'scheffler4',
    name: 'Werner-Scheffler-System (4er, bis 8 Siege)',
    einzel: 4,
    doppel: 2,
    folge: [D(1, 1), D(2, 2), E(1, 2), E(2, 1), E(3, 4), E(4, 3), E(1, 1), E(2, 2), E(3, 3), E(4, 4), E(3, 1), E(1, 3), E(2, 4), E(4, 2)],
  },
  swaythling3: {
    id: 'swaythling3',
    name: 'Swaythling-Cup (3er, 9 Einzel, bis 5 Siege)',
    einzel: 3,
    doppel: 0,
    // A–X, B–Y, C–Z, B–X, A–Z, C–Y, B–Z, C–X, A–Y
    folge: [E(1, 1), E(2, 2), E(3, 3), E(2, 1), E(1, 3), E(3, 2), E(2, 3), E(3, 1), E(1, 2)],
  },
  swaythling_mod: {
    id: 'swaythling_mod',
    name: 'Modifiziertes Swaythling-Cup-System (3 Einzel + Doppel, bis 4 Siege)',
    einzel: 3,
    doppel: 1,
    folge: [E(1, 2), E(2, 1), E(3, 3), D(1, 1), E(1, 1), E(3, 2), E(2, 3)],
  },
  olympisch3: {
    id: 'olympisch3',
    name: 'Olympisches System (3er, bis 3 Siege)',
    einzel: 3,
    doppel: 1,
    // Doppel B/C–Y/Z, A–X, C–Z, A–Y, B–X
    folge: [D(1, 1), E(1, 1), E(3, 3), E(1, 2), E(2, 1)],
  },
  corbillon2: {
    id: 'corbillon2',
    name: 'Corbillon-Cup (2er, bis 3 Siege)',
    einzel: 2,
    doppel: 1,
    folge: [E(1, 1), E(2, 2), D(1, 1), E(1, 2), E(2, 1)],
  },
};

export const SYSTEM_REIHE: SystemId[] = ['bundes4', 'scheffler4', 'paarkreuz6', 'corbillon2', 'olympisch3', 'swaythling3', 'swaythling_mod', 'eigen'];

export interface MannschaftEinstellungen {
  system: SystemId;
  /** Alle Teilspiele austragen, auch wenn die Begegnung schon entschieden ist */
  durchspielen: boolean;
  /** Eigenes Spielsystem (nur bei system = 'eigen') */
  eigen: Omit<SpielSystem, 'id' | 'name'> | null;
}

export function standardMannschaft(): MannschaftEinstellungen {
  return { system: 'bundes4', durchspielen: false, eigen: null };
}

const MAX_POS = 8;
const MAX_TEILE = 30;

/** Spielfolge aus Text lesen: „D1-D2, 1-2, 2-1, …“ (Doppel mit D, Einzel als Position:Position) */
export function folgeLesen(text: string): { folge: TeilDef[]; einzel: number; doppel: number } | string {
  const teile = text
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!teile.length) return 'Bitte die Spielfolge eingeben, z. B. „D1-D1, 1-2, 2-1, 1-1, 2-2“.';
  if (teile.length > MAX_TEILE) return `Höchstens ${MAX_TEILE} Spiele.`;
  const folge: TeilDef[] = [];
  for (const t of teile) {
    const d = /^D\s*(\d)\s*[-–:]\s*D?\s*(\d)$/i.exec(t);
    const e = /^(\d)\s*[-–:]\s*(\d)$/.exec(t);
    const m = d ?? e;
    if (!m) return `„${t}“ verstehe ich nicht. Einzel: „1-2“, Doppel: „D1-D2“.`;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a < 1 || b < 1 || a > MAX_POS || b > MAX_POS) return `Positionen 1 bis ${MAX_POS}.`;
    folge.push(d ? D(a, b) : E(a, b));
  }
  const einzel = Math.max(0, ...folge.filter((f) => f.art === 'einzel').flatMap((f) => [f.a, f.b]));
  const doppel = Math.max(0, ...folge.filter((f) => f.art === 'doppel').flatMap((f) => [f.a, f.b]));
  return { folge, einzel, doppel };
}

export function folgeText(folge: TeilDef[]): string {
  return folge.map((f) => (f.art === 'doppel' ? `D${f.a}-D${f.b}` : `${f.a}-${f.b}`)).join(', ');
}

export function mannschaftEinstLesen(v: unknown, alt: MannschaftEinstellungen | null): MannschaftEinstellungen | null {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return alt;
  const x = v as Record<string, unknown>;
  const e: MannschaftEinstellungen = { ...(alt ?? standardMannschaft()) };
  if (typeof x.system === 'string' && (SYSTEM_REIHE as string[]).includes(x.system)) e.system = x.system as SystemId;
  if (typeof x.durchspielen === 'boolean') e.durchspielen = x.durchspielen;
  if (x.eigen === null) e.eigen = null;
  else if (x.eigen && typeof x.eigen === 'object') {
    const g = x.eigen as Record<string, unknown>;
    const folge = Array.isArray(g.folge)
      ? g.folge
          .slice(0, MAX_TEILE)
          .filter((f): f is TeilDef => !!f && typeof f === 'object' && ((f as TeilDef).art === 'einzel' || (f as TeilDef).art === 'doppel'))
          .map((f) => ({ art: f.art, a: Math.trunc(Number(f.a)), b: Math.trunc(Number(f.b)) }))
          .filter((f) => f.a >= 1 && f.b >= 1 && f.a <= MAX_POS && f.b <= MAX_POS)
      : [];
    if (folge.length) {
      e.eigen = {
        folge,
        einzel: Math.max(0, ...folge.filter((f) => f.art === 'einzel').flatMap((f) => [f.a, f.b])),
        doppel: Math.max(0, ...folge.filter((f) => f.art === 'doppel').flatMap((f) => [f.a, f.b])),
      };
    }
  }
  if (e.system === 'eigen' && !e.eigen) e.system = 'bundes4';
  return e;
}

/** Spielsystem einer Mannschafts-Konkurrenz */
export function systemVon(einst: Pick<KonkurrenzEinstellungen, 'mannschaft'>): SpielSystem {
  const m = einst.mannschaft ?? standardMannschaft();
  if (m.system === 'eigen' && m.eigen) return { id: 'eigen', name: 'Eigenes Spielsystem', ...m.eigen };
  return SYSTEME[m.system === 'eigen' ? 'bundes4' : m.system];
}

/** Siege, mit denen eine Begegnung entschieden ist (mehr als die Hälfte der Teilspiele) */
export function bisSiege(sys: SpielSystem): number {
  return Math.floor(sys.folge.length / 2) + 1;
}

/** Spieler, die je Mannschaft mindestens gebraucht werden */
export function mindestSpieler(sys: SpielSystem): number {
  return Math.max(sys.einzel, sys.doppel > 0 ? 2 : 0, 1);
}

/* ---------------- Zustand ---------------- */

/** Teilnehmer einer Mannschafts-Konkurrenz (Teilnehmer-ID „m-…“) */
export interface Mannschaft {
  id: string;
  name: string;
  verein: string;
  /** Gemeldete Spieler (Reihenfolge = Meldung) */
  spieler: string[];
  /** Mannschaftsführung: darf die Aufstellung abgeben und Teilspiele der eigenen Begegnungen eintragen */
  fuehrer: string | null;
}

export interface Aufstellung {
  /** Einzelpositionen 1…n (null = nicht besetzt) */
  einzel: (string | null)[];
  /** Doppel 1…d (null = nicht besetzt) */
  doppel: ([string, string] | null)[];
  ereignis: string;
  von: string;
  zeit: string;
}

/** Ergebnis-Stand eines Teilspiels (wie bei einem Spiel) */
export interface TeilZustand {
  eintrag: ErgebnisEintrag | null;
  stand: ErgebnisStand | null;
  alternativen: ErgebnisEintrag[];
  angefochtenVon: Autor | null;
  /** Mannschaft, die beim Eintragen Seite A war (Ergebnisse gelten aus ihrer Sicht) */
  aTeam: string;
}

export interface BegegnungDaten {
  /** Aufstellung je Mannschafts-ID */
  aufstellung: Record<string, Aufstellung>;
  /** Teilspiel-Nummer (1…) → Stand */
  teile: Record<string, TeilZustand>;
  /** Losentscheid der Leitung bei völligem Gleichstand im K.-o. (Mannschafts-ID des Siegers) */
  los: string | null;
}

export type TeilStatus = 'wartet' | 'offen' | 'gespielt' | 'kampflos' | 'entfallen';

/** Teilspiel zur Anzeige und zum Eintragen */
export interface TeilSpiel {
  /** „<Begegnung>~<n>“ */
  id: string;
  nr: number;
  art: 'einzel' | 'doppel';
  posA: number;
  posB: number;
  /** Spieler der Seite A bzw. B (Einzel 1, Doppel 2); leer = Aufstellung fehlt oder Platz nicht besetzt */
  a: string[];
  b: string[];
  status: TeilStatus;
  ergebnis: Ergebnis | null;
  stand: ErgebnisStand | null;
  eintrag: ErgebnisEintrag | null;
  alternativen: ErgebnisEintrag[];
  angefochtenVon: Autor | null;
  gewinner: Seite | null;
}

export const TEIL_TRENNER = '~';
export function teilId(spiel: string, nr: number): string {
  return `${spiel}${TEIL_TRENNER}${nr}`;
}
export function teilAus(id: string): { spiel: string; nr: number } | null {
  const i = id.lastIndexOf(TEIL_TRENNER);
  if (i < 1) return null;
  const nr = Number(id.slice(i + 1));
  return Number.isInteger(nr) && nr >= 1 && nr <= MAX_TEILE ? { spiel: id.slice(0, i), nr } : null;
}

export function istMannschaft(k: Pick<KonkurrenzZustand, 'einst'>): boolean {
  return k.einst.art === 'mannschaft';
}

export function begegnungDaten(k: KonkurrenzZustand, spiel: string): BegegnungDaten {
  const b = k.begegnungen[spiel];
  if (b) return b;
  const neu: BegegnungDaten = { aufstellung: Object.create(null) as Record<string, Aufstellung>, teile: Object.create(null) as Record<string, TeilZustand>, los: null };
  k.begegnungen[spiel] = neu;
  return neu;
}

/** Spieler der Aufstellung an einer Position */
function besetzung(auf: Aufstellung | undefined, art: 'einzel' | 'doppel', pos: number): string[] {
  if (!auf) return [];
  if (art === 'einzel') {
    const s = auf.einzel[pos - 1];
    return s ? [s] : [];
  }
  const d = auf.doppel[pos - 1];
  return d ? [...d] : [];
}

/** Beide Aufstellungen abgegeben? (Erst dann sehen Spieler und Zuschauer die des Gegners.) */
export function aufstellungenKomplett(k: KonkurrenzZustand, s: Spiel): boolean {
  const b = k.begegnungen[s.id];
  return !!b && !!s.a && !!s.b && !!b.aufstellung[s.a] && !!b.aufstellung[s.b];
}

/** Ergebnis aus Sicht der aktuellen Seite A (Teilspiele speichern die Sicht beim Eintragen) */
function ausSicht(e: Ergebnis, umdrehen: boolean): Ergebnis {
  if (!umdrehen) return e;
  return {
    saetze: e.saetze ? e.saetze.map(([x, y]) => [y, x] as [number, number]) : null,
    satzA: e.satzB,
    satzB: e.satzA,
    ballA: e.ballB,
    ballB: e.ballA,
    gewinner: e.gewinner === 'a' ? 'b' : e.gewinner === 'b' ? 'a' : null,
    art: e.art,
  };
}

/** Teilspiele einer Begegnung mit Spielern, Stand und Ergebnis */
export function teileVon(k: KonkurrenzZustand, s: Spiel): TeilSpiel[] {
  const sys = systemVon(k.einst);
  const b = k.begegnungen[s.id];
  const aufA = s.a ? b?.aufstellung[s.a] : undefined;
  const aufB = s.b ? b?.aufstellung[s.b] : undefined;
  const beide = !!aufA && !!aufB;
  const teile = sys.folge.map((f, i): TeilSpiel => {
    const nr = i + 1;
    const t = b?.teile[String(nr)];
    const gueltig = t && t.eintrag && t.aTeam !== undefined && (t.aTeam === s.a || t.aTeam === s.b) ? t : null;
    const um = !!gueltig && gueltig.aTeam !== s.a;
    const a = besetzung(aufA, f.art, f.a);
    const bb = besetzung(aufB, f.art, f.b);
    const voll = (x: string[]) => x.length === (f.art === 'einzel' ? 1 : 2);
    let status: TeilStatus = 'wartet';
    let ergebnis: Ergebnis | null = null;
    if (gueltig?.eintrag) {
      status = 'gespielt';
      ergebnis = ausSicht(gueltig.eintrag.ergebnis, um);
    } else if (beide && (!voll(a) || !voll(bb))) {
      // Platz nicht besetzt: Teilspiel geht kampflos an den Gegner (WO E 3.1), beide leer → entfällt
      if (!voll(a) && !voll(bb)) status = 'entfallen';
      else {
        status = 'kampflos';
        ergebnis = kampflosErgebnis(voll(a) ? 'b' : 'a', k.einst);
      }
    } else if (beide) status = 'offen';
    return {
      id: teilId(s.id, nr),
      nr,
      art: f.art,
      posA: f.a,
      posB: f.b,
      a,
      b: bb,
      status,
      ergebnis,
      stand: gueltig ? gueltig.stand : null,
      eintrag: gueltig ? gueltig.eintrag : null,
      alternativen: gueltig ? gueltig.alternativen : [],
      angefochtenVon: gueltig ? gueltig.angefochtenVon : null,
      gewinner: ergebnis?.gewinner ?? null,
    };
  });
  // Entschieden und nicht durchspielen: offene Teilspiele entfallen
  const st = zwischenstand(teile);
  const ziel = bisSiege(sys);
  if (!(k.einst.mannschaft?.durchspielen ?? false) && (st.siegeA >= ziel || st.siegeB >= ziel)) {
    for (const t of teile) if (t.status === 'offen' || t.status === 'wartet') t.status = 'entfallen';
  }
  return teile;
}

export interface Zwischenstand {
  siegeA: number;
  siegeB: number;
  satzA: number;
  satzB: number;
  ballA: number;
  ballB: number;
  /** Bälle aller gewerteten Teilspiele bekannt */
  baelleBekannt: boolean;
  gespielt: number;
}

export function zwischenstand(teile: TeilSpiel[]): Zwischenstand {
  const z: Zwischenstand = { siegeA: 0, siegeB: 0, satzA: 0, satzB: 0, ballA: 0, ballB: 0, baelleBekannt: true, gespielt: 0 };
  for (const t of teile) {
    const e = t.ergebnis;
    if (!e) continue;
    z.gespielt++;
    if (e.gewinner === 'a') z.siegeA++;
    else if (e.gewinner === 'b') z.siegeB++;
    z.satzA += e.satzA;
    z.satzB += e.satzB;
    if (e.ballA === null || e.ballB === null) z.baelleBekannt = false;
    else {
      z.ballA += e.ballA;
      z.ballB += e.ballB;
    }
  }
  return z;
}

const STAND_RANG: Record<ErgebnisStand, number> = { bestaetigt: 0, eingetragen: 1, angefochten: 2, konflikt: 3 };

/**
 * Ergebnis der Begegnung aus den Teilspielen (als amtlicher Eintrag am Spiel). Entschieden ist sie, wenn eine
 * Mannschaft die nötigen Siege hat oder alle Teilspiele erledigt sind. Im K.-o. entscheiden bei Gleichstand
 * Sätze, dann Bälle, dann das Los der Leitung (WO E 2.6).
 */
export function begegnungAuswerten(k: KonkurrenzZustand, s: Spiel): { eintrag: ErgebnisEintrag | null; stand: ErgebnisStand | null; losNoetig: boolean } {
  const b = k.begegnungen[s.id];
  if (!b || !s.a || !s.b) return { eintrag: null, stand: null, losNoetig: false };
  const sys = systemVon(k.einst);
  const teile = teileVon(k, s);
  const st = zwischenstand(teile);
  const ziel = bisSiege(sys);
  const durch = k.einst.mannschaft?.durchspielen ?? false;
  const fertig = teile.every((t) => t.status !== 'offen' && t.status !== 'wartet');
  const entschieden = durch ? fertig : st.siegeA >= ziel || st.siegeB >= ziel || fertig;
  if (!entschieden || st.gespielt === 0) return { eintrag: null, stand: null, losNoetig: false };
  let gewinner: Seite | null = st.siegeA > st.siegeB ? 'a' : st.siegeB > st.siegeA ? 'b' : null;
  let losNoetig = false;
  if (gewinner === null && s.phase === 'ko') {
    const sd = st.satzA - st.satzB;
    const bd = st.baelleBekannt ? st.ballA - st.ballB : 0;
    if (sd !== 0) gewinner = sd > 0 ? 'a' : 'b';
    else if (bd !== 0) gewinner = bd > 0 ? 'a' : 'b';
    else if (b.los === s.a) gewinner = 'a';
    else if (b.los === s.b) gewinner = 'b';
    else losNoetig = true;
  }
  if (losNoetig) return { eintrag: null, stand: null, losNoetig };
  const ergebnis: Ergebnis = {
    saetze: null,
    satzA: st.satzA,
    satzB: st.satzB,
    ballA: st.baelleBekannt ? st.ballA : null,
    ballB: st.baelleBekannt ? st.ballB : null,
    gewinner,
    art: 'normal',
    spiele: [st.siegeA, st.siegeB],
  };
  const mitStand = teile.filter((t) => t.stand);
  const stand = mitStand.reduce<ErgebnisStand>((m, t) => (STAND_RANG[t.stand!] > STAND_RANG[m] ? t.stand! : m), 'bestaetigt');
  const zeit = mitStand.map((t) => t.eintrag?.zeit ?? '').sort().pop() ?? '';
  return {
    eintrag: { ereignis: `mannschaft:${s.id}`, eingabe: {}, ergebnis, von: null, seite: null, amtlich: true, zeit },
    stand,
    losNoetig,
  };
}

/** Ergebnis der Begegnung ins Spiel übernehmen (vor der Bewertung durch Gruppe, K.-o. oder Runde) */
export function begegnungUebernehmen(k: KonkurrenzZustand, s: Spiel): void {
  if (!istMannschaft(k) || !k.begegnungen[s.id]) return;
  const r = begegnungAuswerten(k, s);
  s.eintrag = r.eintrag;
  s.stand = r.stand;
  s.alternativen = [];
  s.angefochtenVon = null;
}

/** Kampflos gewonnene Begegnung (Rückzug): alle Teilspiele an den Gegner */
export function kampflosBegegnung(verlierer: Seite, einst: KonkurrenzEinstellungen): Ergebnis {
  const sys = systemVon(einst);
  const e = kampflosErgebnis(verlierer, einst);
  const n = bisSiege(sys);
  const mal = (x: number | null) => (x === null ? null : x * n);
  return {
    ...e,
    saetze: null,
    satzA: e.satzA * n,
    satzB: e.satzB * n,
    ballA: mal(e.ballA),
    ballB: mal(e.ballB),
    spiele: verlierer === 'a' ? [0, n] : [n, 0],
  };
}

/** Name einer Position für die Anzeige: Einzel „A1“/„B2“, Doppel „D1“; Swaythling und Olympisch mit Buchstaben */
export function positionsName(sys: SpielSystem, art: 'einzel' | 'doppel', seite: Seite, pos: number): string {
  if (art === 'doppel') return `D${pos}`;
  if (sys.id === 'swaythling3' || sys.id === 'olympisch3') return seite === 'a' ? 'ABC'[pos - 1]! : 'XYZ'[pos - 1]!;
  return `${seite === 'a' ? 'A' : 'B'}${pos}`;
}
