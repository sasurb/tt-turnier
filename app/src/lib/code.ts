import { KENNUNG_MUSTER, LOKALE_KENNUNG_MUSTER, TURNIER_KENNUNG_MUSTER } from '@shared/protokoll';

/**
 * Kennungen: 8 Ziffern, geschrieben als zwei Viererblöcke („4839 2017“).
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

/** Zum Vorlesen und Abschreiben: „4839 2017“ (ältere Turnierkennungen bleiben, wie sie sind) */
export function codeAnzeige(code: string): string {
  return code.length === 8 && /^\d+$/.test(code) ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/** Eingabe säubern: nur Ziffern, höchstens 8 */
export function codeEingabe(text: string): string {
  return text.replace(/\D/g, '').slice(0, 8);
}

/** Turnierkennung aus freier Eingabe (Kennung mit/ohne Leerzeichen, Link …/#/t/<id> oder …/#/c/<id>/<code>) */
export function turnierKennungLesen(text: string): { turnier: string; code: string | null } | null {
  const t = text.trim();
  const mitCode = t.match(/#\/c\/([0-9a-z]{6,16})\/([0-9]{8})/i);
  if (mitCode) return { turnier: mitCode[1]!.toLowerCase(), code: mitCode[2]! };
  const ausLink = t.match(/#\/t\/([0-9a-z]{6,16})/i);
  if (ausLink) return { turnier: ausLink[1]!.toLowerCase(), code: null };
  const ziffern = t.replace(/\s/g, '');
  if (KENNUNG_MUSTER.test(ziffern)) return { turnier: ziffern, code: null };
  const alt = t.toLowerCase();
  if (TURNIER_KENNUNG_MUSTER.test(alt) && !LOKALE_KENNUNG_MUSTER.test(alt)) return { turnier: alt, code: null };
  return null;
}
