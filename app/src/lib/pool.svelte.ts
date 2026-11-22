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

export { csvAusgeben, csvLesen } from './pool-csv';

/** Schon im Pool? (gleicher Name und Verein) */
export function imPool(liste: PoolSpieler[], v: string, n: string, verein: string): PoolSpieler | undefined {
  const k = (s: string) => s.trim().toLowerCase();
  return liste.find((p) => k(p.vorname) === k(v) && k(p.nachname) === k(n) && k(p.verein) === k(verein));
}
