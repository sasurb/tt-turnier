import { LEITUNGSCODE_MUSTER } from '@shared/protokoll';

/** Gleiche Regel wie auf dem Server: 6 Ziffern, nicht alle gleich, keine Ziffernfolge (123456, 654321). */
export function codeGueltig(code: string): boolean {
  if (!LEITUNGSCODE_MUSTER.test(code)) return false;
  if (new Set(code).size === 1) return false;
  let auf = true;
  let ab = true;
  for (let i = 1; i < 6; i++) {
    const vor = Number(code[i - 1]);
    const jetzt = Number(code[i]);
    auf &&= jetzt === (vor + 1) % 10;
    ab &&= jetzt === (vor + 9) % 10;
  }
  return !auf && !ab;
}

/** Zufälliger gültiger Leitungscode. */
export function neuerCode(): string {
  for (;;) {
    const b = new Uint32Array(1);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
    else b[0] = Math.floor(Math.random() * 2 ** 32);
    const code = String(b[0]! % 1_000_000).padStart(6, '0');
    if (codeGueltig(code)) return code;
  }
}

/** Zum Vorlesen und Abschreiben: „907 315“ */
export function codeAnzeige(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** Eingabe säubern: nur Ziffern, höchstens 6 */
export function codeEingabe(text: string): string {
  return text.replace(/\D/g, '').slice(0, 6);
}
