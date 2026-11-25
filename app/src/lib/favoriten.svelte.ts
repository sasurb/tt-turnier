/**
 * Favoriten für Konkurrenzen (ab 0.18): gespeicherte Vorgaben (Spielsystem, Gewinnsätze, Startgeld …). Mit Konto
 * gehören sie der Sparte (Server), sonst liegen sie auf diesem Gerät.
 */
import type { KonkurrenzEinstellungen } from './engine/modell';
import { api } from './dienste';
import { app } from './app.svelte';
import { aktiveSparteId } from './sparte.svelte';

export interface Favorit {
  name: string;
  einst: KonkurrenzEinstellungen;
}

const SCHLUESSEL = 'tt-favoriten';
const MAX = 50;

function amGeraet(): Favorit[] {
  try {
    const l = JSON.parse(localStorage.getItem(SCHLUESSEL) ?? '[]');
    return Array.isArray(l) ? l.filter((f) => f && typeof f.name === 'string' && f.einst && typeof f.einst === 'object').slice(0, MAX) : [];
  } catch {
    return [];
  }
}
function geraetSpeichern(l: Favorit[]) {
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify(l.slice(0, MAX)));
  } catch {
    /* Speicher voll oder gesperrt */
  }
}

/** Server-Favoriten nur mit Konto, Sparte und Server ab 0.18 */
function sparteZiel(): { token: string; sparte: number } | null {
  const sp = aktiveSparteId();
  return app.server.art === 'bereit' && app.server.info.nachrichten && !app.server.info.zentrale && app.sitzung && sp ? { token: app.sitzung.token, sparte: sp } : null;
}

export async function favoritenLaden(): Promise<{ liste: Favorit[]; sparte: boolean }> {
  const z = sparteZiel();
  if (z) {
    try {
      const r = await api.favoriten(z.token, z.sparte);
      return { liste: r.favoriten as unknown as Favorit[], sparte: true };
    } catch {
      /* offline: Gerät */
    }
  }
  return { liste: amGeraet(), sparte: false };
}

export async function favoritenSetzen(liste: Favorit[]): Promise<void> {
  const z = sparteZiel();
  if (z) {
    await api.favoritenSpeichern(z.token, z.sparte, liste as unknown as { name: string; einst: Record<string, unknown> }[]);
    return;
  }
  geraetSpeichern(liste);
}

export { alsVorgabe } from './engine/vorgabe';
