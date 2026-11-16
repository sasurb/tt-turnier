import { ART, type Autor } from '@shared/protokoll';
import type { LokalesEreignis } from './typen';
import { berechnen, rueckgaengigErlaubt, type TurnierZustand } from './zustand';

/**
 * Rückgängig machen und Wiederherstellen (Änderungsverlauf). Nichts wird gelöscht: Ein neuer
 * Eintrag „eintrag.zurueckgenommen“ sagt, dass frühere Einträge nicht mehr zählen. Damit bleibt das
 * Protokoll vollständig und alle Geräte rechnen gleich.
 *
 * Vor dem Senden prüft die App, ob das gefahrlos geht: Spätere Einträge dürfen dadurch weder
 * ungültig werden noch Ergebnisse verlieren (z. B. Auslosung zurücknehmen, obwohl schon gespielt wird).
 */

/** Höchstens so viele Einträge je „eintrag.zurueckgenommen“ (Größe des Eintrags bleibt weit unter 16 KB) */
export const MAX_JE_RUECKNAHME = 100;

export function rueckgaengigBar(e: Pick<LokalesEreignis, 'art' | 'daten'>): boolean {
  return rueckgaengigErlaubt(e);
}

export type Pruefung = { ok: true } | { ok: false; grund: string };

function ergebnisse(z: TurnierZustand): Map<string, string> {
  const m = new Map<string, string>();
  for (const k of Object.values(z.konkurrenzen)) for (const s of Object.values(k.spiele)) if (s.eintrag) m.set(`${k.id}/${s.id}`, s.eintrag.ereignis);
  return m;
}

/**
 * Prüft, ob sich die Einträge `ids` zurücknehmen (zurueck = true) bzw. wiederherstellen lassen,
 * ohne dass andere Einträge dadurch ungültig werden oder Ergebnisse verloren gehen.
 */
export function rueckgaengigPruefen(ereignisse: LokalesEreignis[], ids: string[], zurueck: boolean, autor: Autor | null = null): Pruefung {
  if (!ids.length) return { ok: false, grund: 'Nichts ausgewählt.' };
  const ziele = ereignisse.filter((e) => ids.includes(e.id));
  if (ziele.length !== ids.length || !ziele.every(rueckgaengigBar)) return { ok: false, grund: 'Dieser Eintrag lässt sich nicht zurücknehmen.' };
  const vorher = berechnen(ereignisse);
  const probe: LokalesEreignis = {
    id: '~probe',
    art: ART.eintragZurueck,
    daten: { ereignisse: ids, zurueck },
    zeit: new Date().toISOString(),
    geraet: '',
    turnier: ereignisse[0]?.turnier ?? '',
    status: 'ausstehend',
    seq: null,
    empfangen: null,
    autor,
    reihe: Number.MAX_SAFE_INTEGER,
  };
  const nachher = berechnen([...ereignisse, probe]);
  const betroffen = new Set(ids);
  // Ergebnisse anderer Einträge dürfen nicht verschwinden
  const alt = ergebnisse(vorher);
  const neu = ergebnisse(nachher);
  for (const [spiel, ereignis] of alt) {
    if (betroffen.has(ereignis)) continue;
    if (neu.get(spiel) !== ereignis) return { ok: false, grund: 'Danach eingetragene Ergebnisse würden verloren gehen. Bitte zuerst diese zurücknehmen.' };
  }
  // Spätere Einträge dürfen nicht ungültig werden
  const warnAlt = new Set(vorher.warnungen.map((w) => w.ereignis));
  const neueWarnung = nachher.warnungen.find((w) => !warnAlt.has(w.ereignis) && !betroffen.has(w.ereignis));
  if (neueWarnung) return { ok: false, grund: `Spätere Einträge bauen darauf auf („${neueWarnung.text}“). Bitte zuerst diese zurücknehmen.` };
  return { ok: true };
}

/** Ist ein Eintrag zurückgenommen? (aus dem berechneten Stand) */
export function istZurueckgenommen(z: TurnierZustand, id: string): boolean {
  return z.zurueckgenommen.includes(id);
}
