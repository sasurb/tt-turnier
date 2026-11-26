import { alleSpiele, name, rundeVon, spielErgebnisText, type TischStand } from './abfragen';
import { teileVon, zwischenstand, type TeilSpiel } from './mannschaft';
import { spielerName, type ErgebnisEintrag, type ErgebnisStand, type Spiel } from './modell';
import { type TurnierZustand } from './zustand';

/**
 * Was die grafische Tischübersicht (V-010) je Tisch zeigt. Reine Abfrage, ändert nichts – wird im Reiter
 * „Tische“ und in der Live-Anzeige benutzt, damit beide dasselbe zeigen.
 */

/** Hinweis am Tisch: Ergebnis wartet auf Bestätigung oder ist strittig (Konflikt/Anfechtung) */
export type TischHinweis = 'zu_bestaetigen' | 'strittig' | null;

export interface TischSeite {
  name: string;
  /** Große Zahl auf der Seite: gewonnene Sätze (Einzel/Doppel) bzw. Teilspiele (Mannschaft); null = noch nichts */
  zahl: number | null;
  /** Satzpunkte dieser Seite, z. B. [11, 8, 11] – leer, wenn nicht bekannt */
  saetze: number[];
}

export interface TischAnzeige {
  nr: number;
  zustand: 'frei' | 'laeuft' | 'gesperrt';
  hinweis: TischHinweis;
  /** Laufendes Spiel (bzw. Begegnung) an diesem Tisch */
  spiel: Spiel | null;
  /** Konkurrenz · Runde des laufenden Spiels */
  ort: string | null;
  a: TischSeite | null;
  b: TischSeite | null;
  /** Mannschaft: das gerade ausgetragene Teilspiel */
  teilspiel: { nr: number; art: 'einzel' | 'doppel'; a: string; b: string } | null;
  /** Mannschaft: Aufstellung noch nicht vollständig (Teilspiele unbekannt) */
  aufstellungFehlt: boolean;
  /** Minuten seit dem Aufruf (laufend) bzw. seit dem letzten Ergebnis (frei mit zuletzt) */
  minuten: number | null;
  /** Freier Tisch: zuletzt hier beendetes Spiel der letzten 30 Minuten (mit Satzergebnissen) */
  zuletzt: Spiel | null;
  /** Begegnung auf zwei Tischen: der andere Tisch */
  andererTisch: number | null;
}

/** So lange zeigt ein freier Tisch noch das zuletzt dort gespielte Ergebnis */
export const ZULETZT_MINUTEN = 30;

function hinweisVon(stand: ErgebnisStand | null, eintrag: ErgebnisEintrag | null): TischHinweis {
  if (stand === 'konflikt' || stand === 'angefochten') return 'strittig';
  if (stand === 'eingetragen' && eintrag && !eintrag.amtlich) return 'zu_bestaetigen';
  return null;
}

function seitenAusErgebnis(z: TurnierZustand, s: Spiel): [TischSeite, TischSeite] {
  const k = z.konkurrenzen[s.konkurrenz];
  const e = s.ergebnis;
  const saetze = e?.saetze ?? [];
  return [
    { name: name(z, s.a, k), zahl: e ? e.satzA : null, saetze: saetze.map((x) => x[0]) },
    { name: name(z, s.b, k), zahl: e ? e.satzB : null, saetze: saetze.map((x) => x[1]) },
  ];
}

function personen(z: TurnierZustand, ids: string[]): string {
  return ids.length ? ids.map((id) => spielerName(z.spieler[id])).join(' / ') : '?';
}

/** Das gerade ausgetragene Teilspiel: das erste ohne Ergebnis, dessen Aufstellung steht */
export function laufendesTeilspiel(teile: TeilSpiel[]): TeilSpiel | null {
  return teile.find((t) => t.status === 'offen') ?? null;
}

/** Zuletzt an diesem Tisch beendetes Spiel (nicht kampflos), wenn es höchstens ZULETZT_MINUTEN her ist */
export function zuletztAmTisch(z: TurnierZustand, nr: number, jetzt: number): Spiel | null {
  let letztes: Spiel | null = null;
  for (const s of alleSpiele(z)) {
    if ((s.tisch !== nr && s.tisch2 !== nr) || s.status !== 'gespielt' || !s.eintrag || s.ergebnis?.art === 'kampflos') continue;
    if (!letztes || letztes.eintrag!.zeit < s.eintrag.zeit) letztes = s;
  }
  if (!letztes) return null;
  // Negativ ist erlaubt: „jetzt“ der Oberfläche läuft im 15-s-Takt, und Geräteuhren gehen leicht unterschiedlich
  const alter = jetzt - Date.parse(letztes.eintrag!.zeit);
  return alter <= ZULETZT_MINUTEN * 60_000 ? letztes : null;
}

function minutenSeit(iso: string | null | undefined, jetzt: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((jetzt - t) / 60_000));
}

export function tischAnzeige(z: TurnierZustand, t: TischStand, jetzt: number): TischAnzeige {
  const leer: TischAnzeige = {
    nr: t.nr, zustand: t.gesperrt ? 'gesperrt' : 'frei', hinweis: null, spiel: null, ort: null, a: null, b: null,
    teilspiel: null, aufstellungFehlt: false, minuten: null, zuletzt: null, andererTisch: null,
  };
  const s = t.spiel;
  if (!s) {
    if (t.gesperrt) return leer;
    const zuletzt = zuletztAmTisch(z, t.nr, jetzt);
    if (!zuletzt) return leer;
    const [a, b] = seitenAusErgebnis(z, zuletzt);
    return { ...leer, zuletzt, a, b, hinweis: hinweisVon(zuletzt.stand, zuletzt.eintrag), minuten: minutenSeit(zuletzt.eintrag?.zeit, jetzt) };
  }
  const k = z.konkurrenzen[s.konkurrenz]!;
  const basis: TischAnzeige = {
    ...leer,
    zustand: 'laeuft',
    spiel: s,
    ort: `${k.einst.name} · ${rundeVon(k, s)}`,
    minuten: minutenSeit(s.aufgerufen, jetzt),
    andererTisch: s.tisch2 ? (s.tisch === t.nr ? s.tisch2 : s.tisch) : null,
    hinweis: hinweisVon(s.stand, s.eintrag),
  };
  if (k.einst.art !== 'mannschaft') {
    return { ...basis, a: { name: name(z, s.a, k), zahl: null, saetze: [] }, b: { name: name(z, s.b, k), zahl: null, saetze: [] } };
  }
  const teile = teileVon(k, s);
  const stand = zwischenstand(teile);
  const lauf = laufendesTeilspiel(teile);
  let hinweis: TischHinweis = basis.hinweis;
  for (const x of teile) {
    const h = hinweisVon(x.stand, x.eintrag);
    if (h === 'strittig') hinweis = 'strittig';
    else if (h && !hinweis) hinweis = h;
  }
  return {
    ...basis,
    hinweis,
    a: { name: name(z, s.a, k), zahl: stand.siegeA, saetze: [] },
    b: { name: name(z, s.b, k), zahl: stand.siegeB, saetze: [] },
    teilspiel: lauf ? { nr: lauf.nr, art: lauf.art, a: personen(z, lauf.a), b: personen(z, lauf.b) } : null,
    aufstellungFehlt: teile.some((x) => x.status === 'wartet'),
  };
}

/** Kurzer Ergebnistext des zuletzt gespielten Spiels (für Vorlesehilfen) */
export function zuletztText(z: TurnierZustand, s: Spiel): string {
  return s.ergebnis ? `${name(z, s.a)} – ${name(z, s.b)} ${spielErgebnisText(z, s, s.ergebnis)}` : '';
}
