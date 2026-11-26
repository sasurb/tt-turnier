import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { LokalesEreignis } from './typen';

/** Kein Zugangstoken in Ereignissen ablegen. Funktioniert auch auf einer lokalen HTTP-Zentrale. */
export function sitzungsbindung(token: string | null): string | null {
  return token ? bytesToHex(sha256(utf8ToBytes(token))) : null;
}

export function eigeneAktion(e: LokalesEreignis, bindung: string | null): boolean {
  return bindung !== null && e.sitzung === bindung;
}


export function identitaetsbindung(identitaet: string): string {
  return 'i-' + bytesToHex(sha256(utf8ToBytes(identitaet)));
}
