/**
 * App-Wertung für Hobbyspieler (ab 0.15): Geschätzte Werte (`ttrGeschaetzt`) passen sich nach jedem
 * gespielten Einzel an – wie beim TTR mit Gewinnerwartung E = 1 / (1 + 10^((Gegner − Spieler) / 150))
 * und Änderung K · (S − E), gerundet je Spiel. K = 32 in den ersten 5 App-Spielen, danach 16.
 *
 * Bei Mannschaften zählen die Einzel der Begegnungen mit (ab 0.16), Doppel nicht.
 *
 * Amtliche TTR-Werte bleiben unverändert (sie dienen nur als Maßstab). Gerechnet wird nur zur Anzeige
 * und für die Übernahme in den Spielerpool: Setzung und Klassen im laufenden Turnier nutzen weiter den
 * Startwert, damit alle Geräte gleich rechnen und sich nichts mitten im Turnier verschiebt.
 */
import type { PoolSpieler } from '@shared/protokoll';
import { WERTUNG_MAX, WERTUNG_MIN } from './stufen';
import type { TurnierZustand } from './zustand';
import { teileVon } from './mannschaft';

export const K_NEU = 32;
export const K_STANDARD = 16;
/** So viele App-Spiele gilt K_NEU */
export const SPIELE_NEU = 5;
export function gewinnerwartung(spieler: number, gegner: number): number {
  return 1 / (1 + Math.pow(10, (gegner - spieler) / 150));
}

export interface AppWertung {
  start: number;
  aktuell: number;
  /** Gewertete Spiele in diesem Turnier */
  spiele: number;
}

/**
 * Verlauf der geschätzten Werte über alle gewerteten Einzel des Turniers (Reihenfolge der Eintragung).
 * `bisher(spielerId)` liefert die App-Spiele aus früheren Turnieren (aus dem Pool) für den K-Faktor.
 */
export function appWertungen(z: TurnierZustand, bisher: (spieler: string) => number = () => 0): Record<string, AppWertung> {
  const aus: Record<string, AppWertung> = Object.create(null);
  const wert = (id: string): number | null => {
    if (aus[id]) return aus[id]!.aktuell;
    const t = z.spieler[id]?.ttr;
    return typeof t === 'number' ? t : null;
  };
  for (const id of z.spielerReihe) {
    const s = z.spieler[id]!;
    if (s.ttrGeschaetzt && typeof s.ttr === 'number') aus[id] = { start: s.ttr, aktuell: s.ttr, spiele: 0 };
  }
  if (!Object.keys(aus).length) return aus;

  const spiele: { zeit: string; id: string; a: string; b: string; s: number }[] = [];
  for (const kid of z.konkurrenzReihe) {
    const k = z.konkurrenzen[kid]!;
    // Mannschaften (ab 0.16): die Einzel der Begegnungen zählen wie normale Einzel (Doppel nicht)
    if (k.einst.art === 'mannschaft') {
      for (const sp of Object.values(k.spiele)) {
        if (!sp.a || !sp.b || !k.begegnungen[sp.id]) continue;
        for (const t of teileVon(k, sp)) {
          const e = t.ergebnis;
          if (t.art !== 'einzel' || t.status !== 'gespielt' || !e || e.art === 'kampflos' || t.a.length !== 1 || t.b.length !== 1) continue;
          const a = t.a[0]!;
          const b = t.b[0]!;
          if (!aus[a] && !aus[b]) continue;
          spiele.push({ zeit: t.eintrag?.zeit ?? '', id: `${kid}|${t.id}`, a, b, s: e.gewinner === 'a' ? 1 : e.gewinner === 'b' ? 0 : 0.5 });
        }
      }
      continue;
    }
    if (k.einst.art !== 'einzel') continue;
    for (const sp of Object.values(k.spiele)) {
      const e = sp.ergebnis;
      if (!e || e.art === 'kampflos' || !sp.a || !sp.b || sp.aFrei || sp.bFrei || sp.kampflosDurchRueckzug) continue;
      if (!aus[sp.a] && !aus[sp.b]) continue;
      spiele.push({ zeit: sp.eintrag?.zeit ?? '', id: `${kid}|${sp.id}`, a: sp.a, b: sp.b, s: e.gewinner === 'a' ? 1 : e.gewinner === 'b' ? 0 : 0.5 });
    }
  }
  spiele.sort((x, y) => (x.zeit < y.zeit ? -1 : x.zeit > y.zeit ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  for (const sp of spiele) {
    const ra = wert(sp.a);
    const rb = wert(sp.b);
    if (ra === null || rb === null) continue;
    for (const [id, r, g, s] of [
      [sp.a, ra, rb, sp.s],
      [sp.b, rb, ra, 1 - sp.s],
    ] as const) {
      const w = aus[id];
      if (!w) continue;
      const k = bisher(id) + w.spiele < SPIELE_NEU ? K_NEU : K_STANDARD;
      w.aktuell = Math.max(WERTUNG_MIN, Math.min(WERTUNG_MAX, r + Math.round(k * (s - gewinnerwartung(r, g)))));
      w.spiele++;
    }
  }
  return aus;
}

/**
 * Änderungen für den Spielerpool nach dem Turnier. Leer, wenn das Turnier schon übernommen ist
 * (turnier.daten wertungUebernommen). Pool-Einträge mit amtlichem TTR bleiben unverändert.
 */
export function poolUebernahmePlanen(z: TurnierZustand, pool: readonly PoolSpieler[]): PoolSpieler[] {
  if (z.wertungUebernommen) return [];
  const nachId = new Map(pool.map((p) => [p.id, p]));
  const w = appWertungen(z, (id) => nachId.get(z.spieler[id]?.pool ?? '')?.appSpiele ?? 0);
  const aus: PoolSpieler[] = [];
  for (const [id, x] of Object.entries(w)) {
    const p = nachId.get(z.spieler[id]?.pool ?? '');
    if (!p || x.spiele === 0 || (typeof p.ttr === 'number' && !p.ttrGeschaetzt)) continue;
    aus.push({ ...p, ttr: x.aktuell, ttrGeschaetzt: true, appSpiele: (p.appSpiele ?? 0) + x.spiele });
  }
  return aus;
}
