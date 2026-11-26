import { SICHERUNG_FORMAT, type Sicherung, type SicherungTakt } from '@shared/protokoll';
import type { LokalesEreignis } from './engine/typen';
import { nativ } from './nativ';

/**
 * Sicherungsdatei eines Turniers: gleiches Format wie der Mail-Anhang des Servers
 * (shared/protokoll.ts → Sicherung). Wiederherstellen legt immer ein neues Turnier an.
 */
export function sicherungErstellen(
  turnier: Sicherung['turnier'],
  ereignisse: LokalesEreignis[],
  jetzt = new Date(),
): Sicherung {
  return {
    format: SICHERUNG_FORMAT,
    version: 1,
    erstellt: jetzt.toISOString(),
    turnier,
    ereignisse: ereignisse.map((e) => ({
      id: e.id,
      art: e.art,
      daten: e.daten,
      zeit: e.zeit,
      geraet: e.geraet,
      seq: e.seq,
      empfangen: e.empfangen,
      autor: e.autor,
    })),
  };
}

export class SicherungFehler extends Error {}

function datumGueltig(tag: unknown): boolean {
  if (typeof tag !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(tag)) return false;
  const ms = Date.parse(tag);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(tag + 'T');
}

function zeitGueltig(zeit: unknown): boolean {
  if (typeof zeit !== 'string' || !datumGueltig(zeit.slice(0, 10))) return false;
  return /^.{10}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(zeit) && Number.isFinite(Date.parse(zeit));
}

/** Prüft eine eingelesene Datei. Wirft SicherungFehler mit verständlicher Meldung. */
export function sicherungLesen(text: string): Sicherung {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    throw new SicherungFehler('Die Datei ist keine Sicherungsdatei (kein gültiges JSON).');
  }
  const s = roh as Partial<Sicherung>;
  if (!s || s.format !== SICHERUNG_FORMAT) throw new SicherungFehler('Die Datei ist keine Sicherung dieser App.');
  if (s.version !== 1) throw new SicherungFehler('Diese Sicherung stammt aus einer neueren App-Version. Bitte die App aktualisieren.');
  if (!s.turnier || typeof s.turnier.name !== 'string' || !Array.isArray(s.ereignisse)) {
    throw new SicherungFehler('Die Sicherungsdatei ist unvollständig.');
  }
  for (const e of s.ereignisse) {
    const ok =
      e &&
      typeof e.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(e.id) &&
      typeof e.art === 'string' && /^[a-z][a-z0-9_.]{1,63}$/.test(e.art) &&
      zeitGueltig(e.zeit) && (e.empfangen == null || zeitGueltig(e.empfangen)) &&
      typeof e.geraet === 'string' &&
      e.daten !== null && typeof e.daten === 'object' && !Array.isArray(e.daten);
    if (!ok) throw new SicherungFehler('Die Sicherungsdatei enthält einen beschädigten Eintrag.');
  }
  if (!zeitGueltig(s.erstellt) || typeof s.turnier.id !== 'string' || !s.turnier.id ||
      !['online', 'lokal'].includes(s.turnier.modus) || (s.turnier.datum !== null && !datumGueltig(s.turnier.datum))) {
    throw new SicherungFehler('Die Sicherungsdatei enthält beschädigte Turnierdaten.');
  }
  return s as Sicherung;
}

export function dateiname(s: Sicherung): string {
  const name = s.turnier.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'turnier';
  const stempel = s.erstellt.slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return `sicherung-${name}-${stempel}.json`;
}

/**
 * Datei teilen (Handy: Teilen-Menü, z. B. per Mail an sich selbst) oder herunterladen.
 * Ergebnis: 'geteilt' | 'heruntergeladen' | 'abgebrochen'
 */
export async function sicherungAusgeben(s: Sicherung, teilen: boolean): Promise<'geteilt' | 'heruntergeladen' | 'abgebrochen'> {
  return dateiAusgeben(dateiname(s), JSON.stringify(s, null, 1), 'application/json', teilen, `Sicherung: ${s.turnier.name}`);
}

/** Beliebige Textdatei teilen oder herunterladen (Sicherung, CSV-Export) */
export async function dateiAusgeben(name: string, inhalt: string, typ: string, teilen: boolean, titel = name): Promise<'geteilt' | 'heruntergeladen' | 'abgebrochen'> {
  // Android-Zentrale (WebView): Teilen-Menü des Systems
  const n = nativ();
  if (n) {
    n.dateiTeilen(name, inhalt, typ);
    return 'geteilt';
  }
  const datei = new File([inhalt], name, { type: typ });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (teilen && nav.share && nav.canShare?.({ files: [datei] })) {
    try {
      await nav.share({ files: [datei], title: titel });
      return 'geteilt';
    } catch (x) {
      if (x instanceof DOMException && x.name === 'AbortError') return 'abgebrochen';
      // sonst: herunterladen
    }
  }
  const url = URL.createObjectURL(datei);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'heruntergeladen';
}

export function kannTeilen(): boolean {
  if (nativ()) return true;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    return !!nav.share && !!nav.canShare?.({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] });
  } catch {
    return false;
  }
}

/* ---------- Erinnerung für Turniere „nur auf diesem Gerät“ ---------- */

export interface LokaleSicherung {
  takt: SicherungTakt;
  /** Zeitpunkt der letzten heruntergeladenen/geteilten Sicherung */
  zuletzt: string | null;
  /** Anzahl Einträge zu diesem Zeitpunkt */
  anzahl: number;
}

const schluessel = (id: string) => `tt.sicherung.${id}`;

export function lokaleSicherung(id: string): LokaleSicherung {
  try {
    const roh = localStorage.getItem(schluessel(id));
    if (roh) return { takt: 30, zuletzt: null, anzahl: 0, ...(JSON.parse(roh) as Partial<LokaleSicherung>) };
  } catch {
    /* gesperrt */
  }
  return { takt: 30, zuletzt: null, anzahl: 0 };
}

export function setzeLokaleSicherung(id: string, s: LokaleSicherung) {
  try {
    localStorage.setItem(schluessel(id), JSON.stringify(s));
  } catch {
    /* gesperrt */
  }
}

/** Erinnerung fällig: Abstand erreicht und seitdem etwas geändert. */
export function erinnerungFaellig(s: LokaleSicherung, anzahl: number, beginn: string, jetzt = Date.now()): boolean {
  if (s.takt <= 0 || anzahl <= s.anzahl) return false;
  const seit = Date.parse(s.zuletzt ?? beginn);
  return jetzt - seit >= s.takt * 60_000;
}
