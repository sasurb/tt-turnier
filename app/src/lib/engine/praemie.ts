import type { KonkurrenzZustand } from './modell';
import { endstand } from './abfragen';
import { kassenZeile } from './kasse';
import { spielerVon, type TurnierZustand } from './zustand';

/**
 * Siegprämie aus dem Startgeld (ab 0.18): Grundlage ist das tatsächlich bezahlte Startgeld der Konkurrenz
 * (Erlassenes zählt nicht). Davon behält der Verein einen Anteil bzw. festen Betrag ein; der Rest wird nach
 * Prozent-Vorlage oder festen Beträgen auf die Plätze verteilt, abgerundet auf volle Euro. Was übrig bleibt,
 * geht an den Verein. Geteilte Plätze (z. B. zwei Dritte) teilen sich die Prämien der belegten Plätze.
 * Je Mannschaft bzw. Paar gibt es eine Prämie.
 */
export interface PraemieEinstellungen {
  einbehalt: { art: 'prozent' | 'fest'; wert: number };
  verteilung: { art: 'prozent' | 'fest'; werte: number[] };
}

export const PRAEMIE_VORLAGEN: { name: string; werte: number[] }[] = [
  { name: '100 %', werte: [100] },
  { name: '60 / 40', werte: [60, 40] },
  { name: '50 / 30 / 20', werte: [50, 30, 20] },
  { name: '40 / 30 / 20 / 10', werte: [40, 30, 20, 10] },
  { name: '40 / 25 / 15 / 10 / 10', werte: [40, 25, 15, 10, 10] },
];

export const PRAEMIE_MAX_PLAETZE = 16;

/** Einstellungen prüfen (Reducer); undefined = ungültig, null = keine Prämie */
export function praemieLesen(x: unknown): PraemieEinstellungen | null | undefined {
  if (x === null) return null;
  if (!x || typeof x !== 'object') return undefined;
  const r = x as Record<string, unknown>;
  const eb = r.einbehalt as Record<string, unknown> | undefined;
  const vt = r.verteilung as Record<string, unknown> | undefined;
  if (!eb || !vt || (eb.art !== 'prozent' && eb.art !== 'fest') || (vt.art !== 'prozent' && vt.art !== 'fest')) return undefined;
  const ganz = (n: unknown, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max;
  if (!ganz(eb.wert, eb.art === 'prozent' ? 100 : 10_000_000)) return undefined;
  if (!Array.isArray(vt.werte) || vt.werte.length < 1 || vt.werte.length > PRAEMIE_MAX_PLAETZE) return undefined;
  if (!vt.werte.every((w) => ganz(w, vt.art === 'prozent' ? 100 : 10_000_000))) return undefined;
  if (vt.art === 'prozent' && (vt.werte as number[]).reduce((s, w) => s + w, 0) > 100) return undefined;
  return { einbehalt: { art: eb.art, wert: eb.wert as number }, verteilung: { art: vt.art, werte: [...(vt.werte as number[])] } };
}

export interface Auszahlung {
  id: string;
  konkurrenz: string;
  teilnehmer: string;
  platz: string;
  betrag: number;
  zeit: string;
  von: string;
  storniert: boolean;
}

export interface PraemienRechnung {
  /** bezahltes Startgeld dieser Konkurrenz (Cent) */
  topf: number;
  einbehalt: number;
  /** Prämie je Platz (1., 2., …) vor dem Teilen */
  plaetze: number[];
  /** Rest an den Verein (Einbehalt + Rundung + nicht vergebene Plätze) */
  verein: number;
  /** Endstand vorhanden → je Teilnehmer; sonst leer (Anzeige „voraussichtlich“) */
  empfaenger: { teilnehmer: string; platz: string; betrag: number; ausgezahlt: number }[];
  voraussichtlich: boolean;
}

const euroAb = (cent: number) => Math.floor(cent / 100) * 100;

/** Bezahltes Startgeld eines Spielers, das auf diese Konkurrenz entfällt (anteilig, wenn er mehrere Posten hat) */
function bezahltFuer(z: TurnierZustand, spieler: string, k: KonkurrenzZustand): number {
  const zeile = kassenZeile(z, spieler);
  const posten = zeile.posten.find((p) => p.konkurrenz === k.id);
  if (!posten || !zeile.soll) return 0;
  return Math.floor((Math.min(zeile.bezahlt, zeile.soll) * posten.betrag) / zeile.soll);
}

export function praemienRechnen(z: TurnierZustand, k: KonkurrenzZustand): PraemienRechnung | null {
  const p = k.einst.praemie;
  if (!p || !k.einst.startgeld) return null;
  let topf = 0;
  for (const t of k.meldungen) for (const s of spielerVon(k, t)) topf += bezahltFuer(z, s, k);
  const einbehalt = Math.min(topf, p.einbehalt.art === 'prozent' ? Math.ceil((topf * p.einbehalt.wert) / 100) : p.einbehalt.wert);
  const netto = topf - einbehalt;
  const plaetze: number[] = [];
  let rest = netto;
  for (const w of p.verteilung.werte) {
    const soll = euroAb(p.verteilung.art === 'prozent' ? Math.floor((netto * w) / 100) : w);
    const b = Math.min(euroAb(rest), soll);
    plaetze.push(Math.max(0, b));
    rest -= Math.max(0, b);
  }
  const es = endstand(k);
  const empfaenger: PraemienRechnung['empfaenger'] = [];
  let vergeben = 0;
  if (es.length) {
    // gleiche Bezeichnung = geteilter Platz: Summe der belegten Plätze, je Teilnehmer abgerundet auf volle Euro
    const gruppen = new Map<string, { platz: number; ids: string[] }>();
    for (const x of es) {
      const g = gruppen.get(x.bezeichnung) ?? { platz: x.platz, ids: [] };
      g.ids.push(x.id);
      gruppen.set(x.bezeichnung, g);
    }
    for (const [bez, g] of gruppen) {
      const summe = plaetze.slice(g.platz - 1, g.platz - 1 + g.ids.length).reduce((s, b) => s + b, 0);
      if (!summe) continue;
      const je = euroAb(Math.floor(summe / g.ids.length));
      for (const id of g.ids) {
        const ausgezahlt = z.auszahlungen.filter((a) => !a.storniert && a.konkurrenz === k.id && a.teilnehmer === id).reduce((s, a) => s + a.betrag, 0);
        empfaenger.push({ teilnehmer: id, platz: bez, betrag: je, ausgezahlt });
        vergeben += je;
      }
    }
  } else vergeben = plaetze.reduce((s, b) => s + b, 0);
  return { topf, einbehalt, plaetze, verein: topf - vergeben, empfaenger, voraussichtlich: !es.length };
}
