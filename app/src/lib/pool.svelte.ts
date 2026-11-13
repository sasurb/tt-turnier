import type { PoolSpieler } from '@shared/protokoll';
import { app } from './app.svelte';
import { api } from './dienste';
import { kurzId } from './engine/ids';
import { ablageLesen, ablageSchreiben } from './einstellungen';

/**
 * Spielerpool über Turniere hinweg.
 * - Mit Konto: liegt im Veranstalter-Konto auf dem Server; dieses Gerät hält eine Kopie zum Lesen ohne Netz.
 * - Ohne Konto: nur auf diesem Gerät.
 */
export const pool = $state<{ liste: PoolSpieler[]; quelle: 'konto' | 'geraet'; laedt: boolean; fehler: string | null }>({
  liste: [],
  quelle: 'geraet',
  laedt: false,
  fehler: null,
});

const GERAET = 'tt.pool.geraet';
const kontoSchluessel = (id: number) => `tt.pool.konto.${id}`;

function sortieren(l: PoolSpieler[]) {
  return [...l].sort((a, b) => a.nachname.localeCompare(b.nachname, 'de') || a.vorname.localeCompare(b.vorname, 'de'));
}

function onlineKonto() {
  return app.server.art === 'bereit' && app.sitzung ? app.sitzung : null;
}

export function geraetePool(): PoolSpieler[] {
  return ablageLesen<PoolSpieler[]>(GERAET, []);
}

/** Pool laden: mit Konto vom Server (bei Fehler die Kopie), sonst vom Gerät */
export async function poolLaden(): Promise<void> {
  const s = onlineKonto();
  if (!s) {
    pool.quelle = 'geraet';
    pool.liste = sortieren(geraetePool());
    return;
  }
  pool.quelle = 'konto';
  pool.liste = sortieren(ablageLesen<PoolSpieler[]>(kontoSchluessel(s.konto.id), []));
  pool.laedt = true;
  pool.fehler = null;
  try {
    const a = await api.pool(s.token);
    pool.liste = sortieren(a.spieler);
    ablageSchreiben(kontoSchluessel(s.konto.id), a.spieler);
  } catch (x) {
    pool.fehler = x instanceof Error ? x.message : String(x);
  } finally {
    pool.laedt = false;
  }
}

/** Spieler anlegen oder ändern (je ID). Gibt die gespeicherten Einträge zurück. */
export async function poolSpeichern(liste: PoolSpieler[]): Promise<PoolSpieler[]> {
  const mitId = liste.map((p) => ({ ...p, id: p.id || kurzId() }));
  const s = onlineKonto();
  if (!s) {
    const alt = geraetePool().filter((p) => !mitId.some((n) => n.id === p.id));
    const neu = [...alt, ...mitId];
    ablageSchreiben(GERAET, neu);
    pool.liste = sortieren(neu);
    return mitId;
  }
  let antwort = pool.liste;
  for (let i = 0; i < mitId.length; i += 500) {
    antwort = (await api.poolSpeichern(s.token, mitId.slice(i, i + 500))).spieler;
  }
  pool.liste = sortieren(antwort);
  ablageSchreiben(kontoSchluessel(s.konto.id), antwort);
  return mitId;
}

export async function poolLoeschen(ids: string[]): Promise<void> {
  const s = onlineKonto();
  if (!s) {
    const neu = geraetePool().filter((p) => !ids.includes(p.id));
    ablageSchreiben(GERAET, neu);
    pool.liste = sortieren(neu);
    return;
  }
  await api.poolLoeschen(s.token, ids);
  pool.liste = pool.liste.filter((p) => !ids.includes(p.id));
  ablageSchreiben(kontoSchluessel(s.konto.id), pool.liste);
}

/** Pool dieses Geräts ins Konto übernehmen (danach auf dem Gerät leeren) */
export async function geraetInsKonto(): Promise<number> {
  const l = geraetePool();
  if (!l.length || !onlineKonto()) return 0;
  await poolSpeichern(l);
  ablageSchreiben(GERAET, []);
  return l.length;
}

/* ---------------- CSV ---------------- */

const SPALTEN: Record<string, keyof PoolSpieler | 'name'> = {
  vorname: 'vorname',
  nachname: 'nachname',
  name: 'name',
  verein: 'verein',
  ttr: 'ttr',
  qttr: 'ttr',
  'ttr-punkte': 'ttr',
  punkte: 'ttr',
  klasse: 'klasse',
  leistungsklasse: 'klasse',
  geschlecht: 'geschlecht',
  jahrgang: 'jahrgang',
  geburtsjahr: 'jahrgang',
};

function zeileTeilen(z: string, trenner: string): string[] {
  const aus: string[] = [];
  let feld = '';
  let inAnf = false;
  for (let i = 0; i < z.length; i++) {
    const c = z[i]!;
    if (inAnf) {
      if (c === '"' && z[i + 1] === '"') {
        feld += '"';
        i++;
      } else if (c === '"') inAnf = false;
      else feld += c;
    } else if (c === '"') inAnf = true;
    else if (c === trenner) {
      aus.push(feld.trim());
      feld = '';
    } else feld += c;
  }
  aus.push(feld.trim());
  return aus;
}

function geschlechtLesen(t: string): PoolSpieler['geschlecht'] {
  const g = t.trim().toLowerCase();
  if (['m', 'männlich', 'maennlich', 'herr', 'herren'].includes(g)) return 'm';
  if (['w', 'weiblich', 'frau', 'damen', 'f'].includes(g)) return 'w';
  if (['d', 'divers'].includes(g)) return 'd';
  return null;
}

/**
 * Liest eine Tabelle (CSV aus Excel/click-TT, Trenner ; , oder Tab).
 * Mit Kopfzeile werden die Spalten am Namen erkannt, sonst: Vorname; Nachname; Verein; TTR.
 */
export function csvLesen(text: string): { spieler: PoolSpieler[]; uebersprungen: number } {
  const zeilen = text.replace(/^﻿/, '').split(/\r?\n/).filter((z) => z.trim());
  if (!zeilen.length) return { spieler: [], uebersprungen: 0 };
  const erste = zeilen[0]!;
  const trenner = erste.includes('\t') ? '\t' : erste.split(';').length >= erste.split(',').length ? ';' : ',';
  let kopf = zeileTeilen(erste, trenner).map((k) => SPALTEN[k.toLowerCase().replace(/\s+/g, '')]);
  let start = 1;
  if (!kopf.some(Boolean)) {
    kopf = ['vorname', 'nachname', 'verein', 'ttr'];
    start = 0;
  }
  const spieler: PoolSpieler[] = [];
  let uebersprungen = 0;
  for (const z of zeilen.slice(start)) {
    const w = zeileTeilen(z, trenner);
    const p: PoolSpieler = { id: kurzId(), vorname: '', nachname: '', verein: '' };
    kopf.forEach((k, i) => {
      const v = (w[i] ?? '').trim();
      if (!k || !v) return;
      if (k === 'name') {
        // „Nachname, Vorname“ oder „Vorname Nachname“
        if (v.includes(',')) {
          const [n, ...r] = v.split(',');
          p.nachname = n!.trim();
          p.vorname = r.join(',').trim();
        } else {
          const t = v.split(/\s+/);
          p.nachname = t.pop() ?? '';
          p.vorname = t.join(' ');
        }
      } else if (k === 'ttr' || k === 'jahrgang') {
        const n = parseInt(v.replace(/\D/g, ''), 10);
        if (Number.isFinite(n)) p[k] = n;
      } else if (k === 'geschlecht') p.geschlecht = geschlechtLesen(v);
      else if (k === 'vorname' || k === 'nachname' || k === 'verein' || k === 'klasse') p[k] = v;
    });
    if (!p.vorname && !p.nachname) uebersprungen++;
    else spieler.push(p);
  }
  return { spieler, uebersprungen };
}

export function csvAusgeben(liste: PoolSpieler[]): string {
  const f = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const kopf = 'Vorname;Nachname;Verein;TTR;Klasse;Geschlecht;Jahrgang';
  return [kopf, ...liste.map((p) => [p.vorname, p.nachname, p.verein, p.ttr, p.klasse, p.geschlecht, p.jahrgang].map(f).join(';'))].join('\r\n');
}

/** Schon im Pool? (gleicher Name und Verein) */
export function imPool(liste: PoolSpieler[], v: string, n: string, verein: string): PoolSpieler | undefined {
  const k = (s: string) => s.trim().toLowerCase();
  return liste.find((p) => k(p.vorname) === k(v) && k(p.nachname) === k(n) && k(p.verein) === k(verein));
}
