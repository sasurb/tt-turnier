import type { Konto, Rolle } from '@shared/protokoll';
import { neueId } from './engine/ids';

/**
 * Kleine Einstellungen dieses Geräts (localStorage). Ereignisse liegen in IndexedDB.
 * Alle Zugriffe sind abgesichert: In manchen Browser-Modi ist localStorage gesperrt.
 */

export interface GemerktesTurnier {
  id: string;
  name: string;
  datum: string | null;
  modus: 'online' | 'lokal';
  rolle: Rolle;
  token: string | null;
  zuletzt: string;
}

export interface KontoSitzung {
  token: string;
  konto: Konto;
}

const fluechtig = new Map<string, string>();

function lesen<T>(schluessel: string, standard: T): T {
  try {
    const roh = localStorage.getItem(schluessel) ?? fluechtig.get(schluessel) ?? null;
    return roh === null ? standard : (JSON.parse(roh) as T);
  } catch {
    const roh = fluechtig.get(schluessel);
    return roh === undefined ? standard : (JSON.parse(roh) as T);
  }
}

function schreiben(schluessel: string, wert: unknown) {
  const roh = JSON.stringify(wert);
  fluechtig.set(schluessel, roh);
  try {
    if (wert === null) localStorage.removeItem(schluessel);
    else localStorage.setItem(schluessel, roh);
  } catch {
    /* nur im Arbeitsspeicher */
  }
}

export function geraetId(): string {
  let id = lesen<string | null>('tt.geraet', null);
  if (!id) {
    id = 'g-' + neueId();
    schreiben('tt.geraet', id);
  }
  return id;
}

export function anzeigeName(): string {
  return lesen('tt.name', '');
}
export function setzeAnzeigeName(name: string) {
  schreiben('tt.name', name.trim());
}

export function kontoSitzung(): KontoSitzung | null {
  return lesen<KontoSitzung | null>('tt.konto', null);
}
export function setzeKontoSitzung(s: KontoSitzung | null) {
  schreiben('tt.konto', s);
}

export function gemerkteTurniere(): GemerktesTurnier[] {
  return lesen<GemerktesTurnier[]>('tt.turniere', []).sort((a, b) => (a.zuletzt < b.zuletzt ? 1 : -1));
}

export function gemerktesTurnier(id: string): GemerktesTurnier | undefined {
  return gemerkteTurniere().find((t) => t.id === id);
}

export function turnierMerken(t: Omit<GemerktesTurnier, 'zuletzt'>) {
  const liste = gemerkteTurniere().filter((x) => x.id !== t.id);
  const alt = gemerktesTurnier(t.id);
  liste.push({ ...t, token: t.token ?? alt?.token ?? null, zuletzt: new Date().toISOString() });
  schreiben('tt.turniere', liste);
}

export function turnierVergessen(id: string) {
  schreiben('tt.turniere', gemerkteTurniere().filter((t) => t.id !== id));
}
