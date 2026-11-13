import type { KonkurrenzEinstellungen, TurnierSpieler } from './modell';
import { mischen, zufallAus, type Zufall } from './zufall';

/**
 * Setzliste und Auslosung (Gruppen und K.-o.-Baum) nach DTTB-WO D 5 und D 7.2:
 * - Gruppen: Gesetzte in Schlangenreihenfolge, danach Zufall, Vereine möglichst getrennt
 * - K.-o.: Nr. 1 oben, Nr. 2 unten, 3/4 in die Mitte gelost, 5–8 je ein Viertel usw.;
 *   Freilose zuerst an die Gesetzten; Vereine (bzw. Spieler derselben Gruppe) möglichst spät gegeneinander
 * Alles ist reproduzierbar: gleicher Zufallswert → gleiche Auslosung.
 */

export function naechsteZweierpotenz(n: number): number {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

export function anzahlGruppen(n: number, groesse: number): number {
  return Math.max(1, Math.ceil(n / Math.max(2, groesse)));
}

/** Gruppengrößen, z. B. 10 Spieler in 3 Gruppen → [4, 3, 3] */
export function gruppenGroessen(n: number, g: number): number[] {
  const basis = Math.floor(n / g);
  const rest = n % g;
  return Array.from({ length: g }, (_, i) => basis + (i < rest ? 1 : 0));
}

function ttrVon(s: TurnierSpieler | undefined): number {
  return typeof s?.ttr === 'number' ? s.ttr : -1;
}

/**
 * Setzreihenfolge aller Gemeldeten: nach TTR (absteigend), manuell (Setzliste zuerst) oder
 * ohne Setzung (Meldereihenfolge – die Auslosung ist dann ganz zufällig).
 */
export function setzreihe(
  meldungen: string[],
  spieler: Record<string, TurnierSpieler>,
  einst: KonkurrenzEinstellungen,
  manuell: string[] | null,
): string[] {
  if (einst.setzung === 'manuell' && manuell) {
    const vorn = manuell.filter((id) => meldungen.includes(id));
    return [...vorn, ...meldungen.filter((id) => !vorn.includes(id))];
  }
  if (einst.setzung === 'ttr') {
    return [...meldungen].sort((x, y) => ttrVon(spieler[y]) - ttrVon(spieler[x]) || meldungen.indexOf(x) - meldungen.indexOf(y));
  }
  return [...meldungen];
}

/** Anzahl Gesetzte: eingestellt oder automatisch (Gruppen: so viele wie Gruppen; K.-o.: ein Viertel des Baums) */
export function anzahlGesetzte(einst: KonkurrenzEinstellungen, n: number, fuerGruppen: boolean): number {
  if (einst.setzung === 'keine' || n < 2) return 0;
  if (einst.gesetzte !== null) return Math.max(0, Math.min(einst.gesetzte, n));
  if (fuerGruppen) return Math.min(n, anzahlGruppen(n, einst.gruppenGroesse));
  return Math.min(n, Math.max(1, naechsteZweierpotenz(n) / 4));
}

function vereinVon(spieler: Record<string, TurnierSpieler>, id: string): string {
  return (spieler[id]?.verein ?? '').trim().toLowerCase();
}

/**
 * Gruppen auslosen. Ergebnis: je Gruppe die Mitglieder in Positionsreihenfolge
 * (Gesetzte zuerst nach Setzplatz, dann die übrigen nach Setzreihe).
 */
export function gruppenAuslosen(
  reihe: string[],
  g: number,
  gesetzte: number,
  spieler: Record<string, TurnierSpieler>,
  vereinstrennung: boolean,
  zufall: number,
): string[][] {
  const z = zufallAus(zufall);
  const groessen = gruppenGroessen(reihe.length, g);
  const gruppen: string[][] = Array.from({ length: g }, () => []);
  const frei = (i: number) => gruppen[i]!.length < groessen[i]!;

  // Gesetzte in Schlangenreihenfolge: 1→A, 2→B, …, dann zurück
  for (let i = 0; i < gesetzte; i++) {
    const runde = Math.floor(i / g);
    let ziel = runde % 2 === 0 ? i % g : g - 1 - (i % g);
    // falls die Gruppe schon voll ist (kleinere Gruppen hinten): nächste freie in Laufrichtung
    for (let n = 0; n < g && !frei(ziel); n++) ziel = (ziel + (runde % 2 === 0 ? 1 : g - 1)) % g;
    gruppen[ziel]!.push(reihe[i]!);
  }

  // Übrige zufällig; Spieler häufiger Vereine zuerst, damit die Trennung aufgeht
  let rest = mischen(reihe.slice(gesetzte), z);
  if (vereinstrennung) {
    const haeufigkeit = new Map<string, number>();
    for (const id of reihe) haeufigkeit.set(vereinVon(spieler, id), (haeufigkeit.get(vereinVon(spieler, id)) ?? 0) + 1);
    rest = rest
      .map((id, i) => ({ id, i, h: vereinVon(spieler, id) ? haeufigkeit.get(vereinVon(spieler, id))! : 0 }))
      .sort((x, y) => y.h - x.h || x.i - y.i)
      .map((x) => x.id);
  }
  for (const id of rest) {
    const kandidaten = gruppen.map((_, i) => i).filter(frei);
    let beste = kandidaten;
    if (vereinstrennung && vereinVon(spieler, id)) {
      const gleich = (i: number) => gruppen[i]!.filter((x) => vereinVon(spieler, x) === vereinVon(spieler, id)).length;
      const min = Math.min(...kandidaten.map(gleich));
      beste = kandidaten.filter((i) => gleich(i) === min);
    }
    // bevorzugt Gruppen mit den meisten freien Plätzen, damit alle gleichmäßig voll werden
    const platz = (i: number) => groessen[i]! - gruppen[i]!.length;
    const maxPlatz = Math.max(...beste.map(platz));
    beste = beste.filter((i) => platz(i) === maxPlatz);
    gruppen[beste[Math.floor(z() * beste.length)]!]!.push(id);
  }

  // Positionen: nach Setzreihe
  return gruppen.map((m) => [...m].sort((x, y) => reihe.indexOf(x) - reihe.indexOf(y)));
}

/** In welcher Runde treffen sich die Plätze p und q (1-basiert) frühestens? 1 = erste Runde */
export function treffRunde(p: number, q: number): number {
  const x = (p - 1) ^ (q - 1);
  return x === 0 ? 0 : Math.floor(Math.log2(x)) + 1;
}

function gegner(p: number): number {
  return p % 2 === 1 ? p + 1 : p - 1;
}

/**
 * Plätze der Gesetzten im Baum der Größe P (1-basiert), Rang 0…P/2-1:
 * Rang 0 → 1, Rang 1 → P, Ränge 2–3 → P/2 und P/2+1 (gelost), 4–7 → P/4, P/4+1, 3P/4, 3P/4+1 (gelost) …
 */
export function setzplaetze(P: number, z: Zufall): number[] {
  const plaetze = [1, P];
  for (let stufe = 1; 2 ** stufe < P; stufe++) {
    const schritt = P / 2 ** stufe;
    const reihe: number[] = [];
    for (let m = 1; m < 2 ** stufe; m += 2) reihe.push(m * schritt, m * schritt + 1);
    plaetze.push(...mischen(reihe, z));
  }
  return plaetze.slice(0, P / 2);
}

export interface KoAuslosungEingabe {
  /** Gesetzte in Setzreihenfolge */
  gesetzte: string[];
  /** Übrige, in Stufen: die erste Stufe wird zuerst verteilt (z. B. alle Gruppenzweiten) */
  stufen: string[][];
  spieler: Record<string, TurnierSpieler>;
  vereinstrennung: boolean;
  /** Herkunftsgruppe (Gruppen + K.-o.): Spieler derselben Gruppe möglichst spät gegeneinander */
  gruppeVon?: Record<string, number>;
  zufall: number;
}

/** K.-o.-Baum auslosen. Ergebnis: Plätze von oben nach unten, null = Freilos. */
export function koAuslosen(e: KoAuslosungEingabe): (string | null)[] {
  const z = zufallAus(e.zufall);
  const alle = [...e.gesetzte, ...e.stufen.flat()];
  const n = alle.length;
  const P = naechsteZweierpotenz(n);
  // Höchstens P/2 Gesetzte haben feste Plätze; weitere werden wie Ungesetzte verteilt
  if (e.gesetzte.length > P / 2) {
    e = { ...e, gesetzte: e.gesetzte.slice(0, P / 2), stufen: [e.gesetzte.slice(P / 2), ...e.stufen] };
  }
  const sp = setzplaetze(P, z);
  const plaetze: (string | null | undefined)[] = Array.from({ length: P + 1 }, () => undefined); // Index 1…P
  const freilose = P - n;

  e.gesetzte.forEach((id, rang) => (plaetze[sp[rang]!] = id));
  // Freilose zuerst an die Gesetzten (bzw. die Plätze der virtuellen Gesetzten), in Setzreihenfolge
  for (let rang = 0; rang < freilose; rang++) plaetze[gegner(sp[rang]!)] = null;

  const verein = (id: string) => vereinVon(e.spieler, id);
  const belegt = () => {
    const l: { platz: number; id: string }[] = [];
    for (let p = 1; p <= P; p++) {
      const id = plaetze[p];
      if (id) l.push({ platz: p, id });
    }
    return l;
  };

  for (const stufe of e.stufen) {
    let reihe = mischen(stufe, z);
    if (e.vereinstrennung) {
      const h = new Map<string, number>();
      for (const id of alle) if (verein(id)) h.set(verein(id), (h.get(verein(id)) ?? 0) + 1);
      reihe = reihe.map((id, i) => ({ id, i, h: h.get(verein(id)) ?? 0 })).sort((x, y) => y.h - x.h || x.i - y.i).map((x) => x.id);
    }
    for (const id of reihe) {
      const frei: number[] = [];
      for (let p = 1; p <= P; p++) if (plaetze[p] === undefined) frei.push(p);
      const schon = belegt();
      const bewertung = (p: number): [number, number] => {
        let g = 99;
        let v = 99;
        for (const b of schon) {
          const r = treffRunde(p, b.platz);
          if (e.gruppeVon && e.gruppeVon[b.id] !== undefined && e.gruppeVon[b.id] === e.gruppeVon[id]) g = Math.min(g, r);
          if (e.vereinstrennung && verein(id) && verein(b.id) === verein(id)) v = Math.min(v, r);
        }
        return [g, v];
      };
      let beste = frei;
      for (const k of [0, 1] as const) {
        const max = Math.max(...beste.map((p) => bewertung(p)[k]));
        beste = beste.filter((p) => bewertung(p)[k] === max);
      }
      plaetze[beste[Math.floor(z() * beste.length)]!] = id;
    }
  }
  return plaetze.slice(1).map((x) => x ?? null);
}
