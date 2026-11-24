import type { SparteKurz } from '@shared/protokoll';
import { app } from './app.svelte';
import { ablageLesen, ablageSchreiben } from './einstellungen';

/**
 * Sparten des angemeldeten Kontos (ab 0.17). Pool, Klassen und Kasse-Vorlagen gehören der Sparte; mit mehreren
 * Sparten gilt die zuletzt gewählte (bzw. die des gerade geöffneten Turniers). Die Zentrale kennt keine Sparten.
 */
const SCHLUESSEL = 'tt.sparte';

export const spartenWahl = $state<{ id: number | null }>({ id: ablageLesen<number | null>(SCHLUESSEL, null) });

/** Server mit Sparten und angemeldetes Konto */
export function spartenMoeglich(): boolean {
  return app.server.art === 'bereit' && !!app.server.info.sparten && !!app.sitzung;
}

export function meineSparten(): SparteKurz[] {
  return spartenMoeglich() ? (app.sitzung?.konto.sparten ?? []) : [];
}

/** Gewählte Sparte (oder die erste); null ohne Sparten (Zentrale, Einzelgerät, Konto nur in Ausschüssen) */
export function aktiveSparte(): SparteKurz | null {
  const l = meineSparten();
  return l.find((s) => s.id === spartenWahl.id) ?? l[0] ?? null;
}

export function aktiveSparteId(): number | null {
  return aktiveSparte()?.id ?? null;
}

export function setzeAktiveSparte(id: number | null | undefined) {
  if (!id || !meineSparten().some((s) => s.id === id) || spartenWahl.id === id) return;
  spartenWahl.id = id;
  ablageSchreiben(SCHLUESSEL, id);
}

/** Sparten, in denen das Konto Turniere anlegen darf */
export function spartenZumAnlegen(): SparteKurz[] {
  return meineSparten().filter((s) => s.anlegen);
}

/** Darf das Konto (irgendwo) Turniere anlegen? Ohne Sparten-Server (Zentrale) wie bisher: ja */
export function darfAnlegen(): boolean {
  if (!app.sitzung) return false;
  if (app.server.art !== 'bereit' || !app.server.info.sparten) return true;
  return spartenZumAnlegen().length > 0;
}

export function spartenName(s: { verein: string; name: string }): string {
  return `${s.verein} – ${s.name}`;
}
