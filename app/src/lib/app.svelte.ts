import type { LoginAntwort, Rolle, TurnierInfo } from '@shared/protokoll';
import { api, serverPruefen, type ServerZustand } from './dienste';
import { ApiFehler } from './engine/api';
import { gehe } from './router.svelte';
import { gemerktesTurnier, kontoSitzung, setzeAnzeigeName, setzeKontoSitzung, turnierMerken, anzeigeName, type KontoSitzung } from './einstellungen';

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
  if (app.server.art !== 'bereit') return;
  if (app.sitzung) {
    void kontoPruefen();
  } else if (app.server.info.zentrale && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    // Gerät der Android-Zentrale: deren Konto ist ohne Passwort angemeldet
    await zentraleAnmelden();
  }
}

/** Auf dem Gerät der Zentrale deren Konto anmelden (kein Passwort: nur dieses Gerät darf das). */
export async function zentraleAnmelden() {
  try {
    const a = await api.zentraleAnmelden();
    setzeSitzung({ token: a.token, konto: a.konto });
    if (!anzeigeName()) setzeAnzeigeName(a.konto.name);
  } catch {
    /* Zentrale nicht erreichbar – dann eben ohne Konto */
  }
}

/** Prüft beim Start, ob die gespeicherte Anmeldung noch gilt, und holt aktuelle Kontodaten. */
async function kontoPruefen() {
  const s = app.sitzung;
  if (!s) return;
  try {
    const ich = await api.ich(s.token);
    if (ich.konto) setzeSitzung({ token: s.token, konto: ich.konto });
  } catch (x) {
    if (x instanceof ApiFehler && (x.code === 'nicht_angemeldet' || x.code === 'gesperrt')) {
      setzeSitzung(null);
      if (app.server.art === 'bereit' && app.server.info.zentrale) await zentraleAnmelden();
    }
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

/**
 * Ein Turnier aus der Konto-Liste öffnen. Die Rechte kommen vom Konto (der Server prüft sie beim Öffnen);
 * das Konto-Token wird nie am Turnier gespeichert, damit „Abmelden“ sauber wirkt.
 */
export function kontoTurnierOeffnen(t: TurnierInfo) {
  const g = gemerktesTurnier(t.id);
  turnierMerken({
    id: t.id,
    name: t.name,
    datum: t.datum,
    modus: 'online',
    rolle: g?.rolle ?? 'zuschauer',
    token: g?.token ?? null,
    konto: true,
  });
  gehe('t/' + t.id);
}

/**
 * Mit welchem Token ein Gerät ein Turnier abholt und welche Rolle es dort hat – dieselbe Regel für
 * Turnieransicht, Live-Anzeige und Druck, damit sich zwei Fenster nicht gegenseitig den Bestand neu laden:
 * zuerst die Kennung des Turniers, sonst das Konto, aber nur, wenn der Server ihm Rechte bestätigt.
 */
export async function turnierZugangErmitteln(id: string): Promise<{ token: string | null; rolle: Rolle | null }> {
  if (id.startsWith('l')) return { token: null, rolle: 'leitung' };
  const g = gemerktesTurnier(id);
  if (g?.token) return { token: g.token, rolle: g.rolle };
  const s = app.sitzung;
  if (!s) return { token: null, rolle: null };
  try {
    const r = (await api.turnier(id, s.token)).turnier.rechte ?? null;
    return r ? { token: s.token, rolle: r } : { token: null, rolle: null };
  } catch {
    return { token: null, rolle: null };
  }
}
