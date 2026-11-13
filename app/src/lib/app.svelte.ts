import type { LoginAntwort, TurnierInfo } from '@shared/protokoll';
import { api, serverPruefen, type ServerZustand } from './dienste';
import { ApiFehler } from './engine/api';
import { gehe } from './router.svelte';
import {
  gemerktesTurnier,
  kontoSitzung,
  setzeAnzeigeName,
  setzeKontoSitzung,
  turnierMerken,
  anzeigeName,
  type KontoSitzung,
} from './einstellungen';

/**
 * Zustand, den mehrere Seiten teilen: Server erreichbar? Wer ist angemeldet?
 * Die Anmeldung gilt je Gerät (im Browser gespeichert).
 */
export const app = $state<{
  server: ServerZustand;
  sitzung: KontoSitzung | null;
  /** Kurze Rückmeldung für die nächste Seite, z. B. „Willkommen!“ */
  hinweis: string | null;
}>({
  server: { art: 'pruefe' },
  sitzung: kontoSitzung(),
  hinweis: null,
});

export async function serverLaden(neu = false) {
  app.server = await serverPruefen(neu);
  if (app.server.art === 'bereit' && app.sitzung) void kontoPruefen();
}

/** Prüft beim Start, ob die gespeicherte Anmeldung noch gilt, und holt aktuelle Kontodaten. */
async function kontoPruefen() {
  const s = app.sitzung;
  if (!s) return;
  try {
    const ich = await api.ich(s.token);
    if (ich.konto) setzeSitzung({ token: s.token, konto: ich.konto });
  } catch (x) {
    if (x instanceof ApiFehler && (x.code === 'nicht_angemeldet' || x.code === 'gesperrt')) setzeSitzung(null);
  }
}

export function setzeSitzung(s: KontoSitzung | null) {
  setzeKontoSitzung(s);
  app.sitzung = s;
}

export function angemeldet(a: LoginAntwort, hinweis: string | null = null, ziel = '') {
  setzeSitzung({ token: a.token, konto: a.konto });
  if (!anzeigeName()) setzeAnzeigeName(a.konto.name);
  app.hinweis = hinweis;
  gehe(ziel);
}

export async function abmelden() {
  const s = app.sitzung;
  if (s) await api.logout(s.token).catch(() => undefined);
  setzeSitzung(null);
  gehe('');
}

/** Bei abgelaufener oder gesperrter Anmeldung: abmelden und zur Anmeldung. true = behandelt. */
export function anmeldungAbgelaufen(x: unknown): boolean {
  if (x instanceof ApiFehler && (x.code === 'nicht_angemeldet' || x.code === 'gesperrt')) {
    setzeSitzung(null);
    gehe('anmelden');
    return true;
  }
  return false;
}

export function fehlerText(x: unknown, standard: string): string {
  return x instanceof Error ? x.message : standard;
}

/** Ein Turnier aus der Konto-Liste öffnen. Eigene Turniere darf das Konto beschreiben, fremde (Admin) nur ansehen. */
export function kontoTurnierOeffnen(t: TurnierInfo, eigenes: boolean) {
  const g = gemerktesTurnier(t.id);
  const token = g?.token ?? (eigenes && app.sitzung ? app.sitzung.token : null);
  turnierMerken({ id: t.id, name: t.name, datum: t.datum, modus: 'online', rolle: token ? 'leitung' : 'zuschauer', token });
  gehe('t/' + t.id);
}
