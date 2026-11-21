import type { Aufgabe, Konto, Rolle } from '@shared/protokoll';
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
  /** Rolle der Kennungs-Anmeldung (token); ohne Kennung „zuschauer“ */
  rolle: Rolle;
  /** Token einer Kennungs-Anmeldung (Leitung, Helfer, Spieler). Konto-Tokens werden hier nie abgelegt. */
  token: string | null;
  zuletzt: string;
  /** Mit Spielerkennung angemeldet: eigene Spieler-ID */
  spieler?: string | null;
  /** Spielerkennung mit Helfer-Recht */
  helfer?: boolean | null;
  /** Helferkennung: Aufgaben (ab 0.11; fehlt = Ergebnisse und Spielaufruf) */
  aufgaben?: Aufgabe[] | null;
  /** Name, unter dem dieses Gerät einträgt (von der Kennung) */
  wer?: string | null;
  /** Über das eigene Konto geöffnet: Rechte kommen vom Konto (solange es angemeldet ist) */
  konto?: boolean | null;
  /**
   * Zuletzt vom Server bestätigte Rechte des Kontos (kontoId) für dieses Turnier – nur für den Offline-Betrieb,
   * damit Leitung und Kasse ohne Netz weiterarbeiten. Der Server prüft beim Nachtragen jeden Eintrag erneut.
   */
  kontoRolle?: Rolle | null;
  kontoId?: number | null;
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
  liste.push({
    ...t,
    token: t.token ?? alt?.token ?? null,
    spieler: t.spieler !== undefined ? t.spieler : (alt?.spieler ?? null),
    helfer: t.helfer !== undefined ? t.helfer : (alt?.helfer ?? null),
    aufgaben: t.aufgaben !== undefined ? t.aufgaben : (alt?.aufgaben ?? null),
    wer: t.wer !== undefined ? t.wer : (alt?.wer ?? null),
    konto: t.konto !== undefined ? t.konto : (alt?.konto ?? null),
    kontoRolle: t.kontoRolle !== undefined ? t.kontoRolle : (alt?.kontoRolle ?? null),
    kontoId: t.kontoId !== undefined ? t.kontoId : (alt?.kontoId ?? null),
    zuletzt: new Date().toISOString(),
  });
  schreiben('tt.turniere', liste);
}

export function turnierVergessen(id: string) {
  schreiben(
    'tt.turniere',
    gemerkteTurniere().filter((t) => t.id !== id),
  );
  // Gerätedaten zum Turnier mit vergessen (Hinweis auf Anmeldungen, Mitteilungen)
  for (const k of [`tt.anmgesehen.${id}`, `tt.anmhinweis.${id}`, `tt.mitteilung.${id}`]) schreiben(k, null);
}

/** Kleiner Zwischenspeicher für größere Daten (Spielerpool) */
export function ablageLesen<T>(schluessel: string, standard: T): T {
  return lesen(schluessel, standard);
}
export function ablageSchreiben(schluessel: string, wert: unknown) {
  schreiben(schluessel, wert);
}

/** Mit Kennung angemeldetes Gerät abmelden: wieder Zuschauer (bzw. Rechte nur noch vom Konto) */
export function turnierAbmelden(id: string) {
  const liste = gemerkteTurniere().map((t) =>
    t.id === id
      ? {
          ...t,
          rolle: 'zuschauer' as Rolle,
          token: null,
          spieler: null,
          helfer: null,
          aufgaben: null,
          wer: null,
        }
      : t,
  );
  schreiben('tt.turniere', liste);
}

/** Begriffe für Leistungsklassen auf diesem Gerät (ohne Konto) */
export function geraetKlassen(): string[] {
  return lesen<string[]>('tt.klassen', []);
}
export function setzeGeraetKlassen(l: string[]) {
  schreiben('tt.klassen', l);
}
