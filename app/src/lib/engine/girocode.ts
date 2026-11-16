/**
 * IBAN-Prüfung und GiroCode (EPC-QR-Code, „SEPA-Überweisung per QR“): Banking-Apps lesen daraus
 * Empfänger, IBAN, Betrag und Verwendungszweck. Format nach EPC069-12, Version 002 (BIC optional).
 */

/** IBAN ohne Leerzeichen, Großbuchstaben */
export function ibanNormal(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/** Prüfziffer nach ISO 13616 (mod 97) und Länge; DE-IBAN müssen 22 Zeichen haben */
export function ibanGueltig(roh: string): boolean {
  const iban = ibanNormal(roh);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('DE') && iban.length !== 22) return false;
  const umgestellt = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const z of umgestellt) {
    const wert = /[A-Z]/.test(z) ? String(z.charCodeAt(0) - 55) : z;
    for (const ziffer of wert) rest = (rest * 10 + Number(ziffer)) % 97;
  }
  return rest === 1;
}

/** „DE89 3704 0044 0532 0130 00“ */
export function ibanAnzeige(roh: string): string {
  return ibanNormal(roh).replace(/(.{4})/g, '$1 ').trim();
}

export function bicGueltig(roh: string): boolean {
  const b = roh.replace(/\s+/g, '').toUpperCase();
  return b === '' || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b);
}

/** Zeichen, die Banking-Apps im GiroCode sicher lesen (Latin-1 ohne Zeilenumbrüche) */
function epcText(s: string, max: number): string {
  return s
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7E -ÿ€]/g, '')
    .trim()
    .slice(0, max);
}

export interface Ueberweisung {
  empfaenger: string;
  iban: string;
  bic?: string;
  /** Cent; 0 = Betrag frei */
  betrag: number;
  zweck: string;
}

/** Inhalt des GiroCodes; null, wenn Empfänger oder IBAN fehlen/ungültig sind */
export function giroCode(u: Ueberweisung): string | null {
  const iban = ibanNormal(u.iban);
  const name = epcText(u.empfaenger, 70);
  if (!name || !ibanGueltig(iban)) return null;
  const bic = (u.bic ?? '').replace(/\s+/g, '').toUpperCase();
  const betrag = u.betrag > 0 && u.betrag <= 99_999_999_999 ? `EUR${(u.betrag / 100).toFixed(2)}` : '';
  return ['BCD', '002', '1', 'SCT', bicGueltig(bic) ? bic : '', name, iban, betrag, '', '', epcText(u.zweck, 140)].join('\n');
}
