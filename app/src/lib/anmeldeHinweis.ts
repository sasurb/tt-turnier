import type { AnmeldungEintrag } from '@shared/protokoll';
import { ablageLesen, ablageSchreiben } from './einstellungen';

/**
 * Hinweis in der App auf neue Online-Anmeldungen (je Gerät abschaltbar). „Neu“ ist eine bestätigte
 * Anmeldung, die noch nicht ins Turnier übernommen und auf diesem Gerät noch nicht angesehen wurde.
 * Gemerkt werden nur die Kennungen der Anmeldungen, keine Namen.
 */
const MAX = 1000;

export function appHinweisAn(turnier: string): boolean {
  return ablageLesen<boolean>(`tt.anmhinweis.${turnier}`, true) !== false;
}
export function setzeAppHinweis(turnier: string, an: boolean) {
  ablageSchreiben(`tt.anmhinweis.${turnier}`, an);
}

function gesehen(turnier: string): Set<string> {
  const v = ablageLesen<unknown>(`tt.anmgesehen.${turnier}`, []);
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
}

/** Neue Anmeldungen (bestätigt, nicht im Turnier, auf diesem Gerät nicht angesehen) */
export function neueAnmeldungen(turnier: string, liste: Pick<AnmeldungEintrag, 'id' | 'bestaetigt'>[], imTurnier: (id: string) => boolean): string[] {
  const g = gesehen(turnier);
  return liste.filter((a) => a.bestaetigt && !imTurnier(a.id) && !g.has(a.id)).map((a) => a.id);
}

/** Alle aktuell sichtbaren Anmeldungen als angesehen merken */
export function alleGesehen(turnier: string, liste: Pick<AnmeldungEintrag, 'id'>[]) {
  const ids = [...new Set([...liste.map((a) => a.id), ...gesehen(turnier)])].slice(0, MAX);
  ablageSchreiben(`tt.anmgesehen.${turnier}`, ids);
}
