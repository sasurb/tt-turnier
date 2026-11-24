import { KENNUNG_MUSTER, LOKALE_KENNUNG_MUSTER, TURNIER_KENNUNG_MUSTER } from '@shared/protokoll';

/**
 * Persönliche Kennungen (Leitung, Helfer, Spieler): 8 Ziffern, geschrieben als zwei Viererblöcke („4839 2017“).
 * Gleiche Regel wie auf dem Server: nicht alle gleich, keine Ziffernfolge (12345678, 87654321).
 */
export function codeGueltig(code: string): boolean {
  if (!KENNUNG_MUSTER.test(code)) return false;
  if (new Set(code).size === 1) return false;
  let auf = true;
  let ab = true;
  for (let i = 1; i < code.length; i++) {
    const vor = Number(code[i - 1]);
    const jetzt = Number(code[i]);
    auf &&= jetzt === (vor + 1) % 10;
    ab &&= jetzt === (vor + 9) % 10;
  }
  return !auf && !ab;
}

/**
 * Zum Vorlesen und Abschreiben: 8 Zeichen als zwei Viererblöcke („4839 2017“, „K7QM 3XRP“).
 * Wunschkennungen mit anderer Länge oder mit Bindestrich bleiben, wie sie sind.
 */
export function codeAnzeige(code: string): string {
  return code.length === 8 && /^[0-9A-Z]+$/.test(code) ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/** Eingabe säubern: nur Ziffern, höchstens 8 */
export function codeEingabe(text: string): string {
  return text.replace(/\D/g, '').slice(0, 8);
}

/** Turnierkennung normalisieren: Server-Kennungen ohne Groß/klein (Großbuchstaben); lokale bleiben, wie sie sind */
export function turnierIdNorm(id: string): string {
  const t = id.trim();
  return LOKALE_KENNUNG_MUSTER.test(t) ? t : t.replace(/\s+/g, '').toUpperCase();
}

/** Eingabe einer Turnierkennung säubern: Großbuchstaben, Ziffern, Bindestrich (Leerzeichen raus), höchstens 12 */
export function turnierKennungEingabe(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 12);
}

/** Wunschkennung gültig? (4–12 Zeichen A–Z, 0–9, Bindestrich, nicht am Rand, kein doppelter Bindestrich) */
export function wunschKennungGueltig(text: string): boolean {
  const t = text.replace(/\s+/g, '').toUpperCase();
  return TURNIER_KENNUNG_MUSTER.test(t) && !t.includes('--');
}

/** Turnierkennung aus freier Eingabe (Kennung mit/ohne Leerzeichen, Link …/#/t/<id> oder …/#/c/<id>/<code>) */
export function turnierKennungLesen(text: string): { turnier: string; code: string | null } | null {
  const t = text.trim();
  const mitCode = t.match(/#\/c\/([0-9A-Za-z-]{4,16})\/([0-9]{8})/);
  if (mitCode) return { turnier: turnierIdNorm(mitCode[1]!), code: mitCode[2]! };
  const ausLink = t.match(/#\/t\/([0-9A-Za-z-]{4,16})/);
  if (ausLink) return { turnier: turnierIdNorm(ausLink[1]!), code: null };
  const roh = t.replace(/\s/g, '');
  if (LOKALE_KENNUNG_MUSTER.test(roh)) return null;
  const id = roh.toUpperCase();
  if (TURNIER_KENNUNG_MUSTER.test(id)) return { turnier: id, code: null };
  return null;
}
