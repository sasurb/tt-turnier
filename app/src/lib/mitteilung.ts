import { gong } from './ansage';
import { ablageLesen, ablageSchreiben } from './einstellungen';

/**
 * Mitteilung aufs Handy, wenn das eigene Spiel aufgerufen wird (oder man pfeifen soll) – nur solange
 * die App bzw. der Tab geöffnet ist (Entscheidung 16.11.2026: keine Push-Dienste von Google/Apple/Mozilla,
 * funktioniert auch an der Zentrale ohne Internet). Mittel: Ton, Vibration, Hinweis in der App,
 * blinkender Tab-Titel und – wenn erlaubt und die Seite im Hintergrund ist – eine Systemmitteilung
 * über den eigenen Service Worker (nur über https).
 */

export interface MitteilungEinstellung {
  /** Spieler-ID, für die dieses Gerät benachrichtigt (eigene oder „folgen“); null = aus */
  spieler: string | null;
  ton: boolean;
  vibration: boolean;
  /** Systemmitteilung, wenn die Seite im Hintergrund ist (fragt einmal nach Erlaubnis) */
  system: boolean;
  /** Bildschirm wach halten (Wake Lock), damit Aufrufe ankommen */
  wach: boolean;
}

const STANDARD: Omit<MitteilungEinstellung, 'spieler'> = { ton: true, vibration: true, system: false, wach: false };

export function mitteilungEinstellung(turnier: string, eigener: string | null): MitteilungEinstellung {
  const g = ablageLesen<Partial<MitteilungEinstellung> | null>(`tt.mitteilung.${turnier}`, null);
  return { ...STANDARD, spieler: eigener, ...(g ?? {}), ...(eigener && g?.spieler === undefined ? { spieler: eigener } : {}) };
}

export function setzeMitteilungEinstellung(turnier: string, e: MitteilungEinstellung) {
  ablageSchreiben(`tt.mitteilung.${turnier}`, e);
}

/** Was das Gerät kann (für die Oberfläche) */
export function faehigkeiten() {
  const w = globalThis as unknown as {
    navigator?: Navigator & { wakeLock?: unknown };
    Notification?: { permission: string };
    isSecureContext?: boolean;
  };
  return {
    vibration: typeof w.navigator?.vibrate === 'function',
    system: !!w.Notification && !!w.isSecureContext && !!w.navigator && 'serviceWorker' in w.navigator,
    wach: !!w.navigator?.wakeLock && !!w.isSecureContext,
    erlaubt: w.Notification?.permission ?? 'denied',
  };
}

let registrierung: Promise<ServiceWorkerRegistration | null> | null = null;
function serviceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!faehigkeiten().system) return Promise.resolve(null);
  registrierung ??= navigator.serviceWorker.register('./sw.js').then(
    () => navigator.serviceWorker.ready,
    () => null,
  );
  return registrierung;
}

/** Erlaubnis für Systemmitteilungen erfragen (aus einem Tipp heraus aufrufen) */
export async function systemErlauben(): Promise<boolean> {
  if (!faehigkeiten().system) return false;
  const N = (globalThis as unknown as { Notification: { requestPermission: () => Promise<string>; permission: string } }).Notification;
  const p = N.permission === 'default' ? await N.requestPermission() : N.permission;
  if (p === 'granted') await serviceWorker();
  return p === 'granted';
}

let titelTimer: ReturnType<typeof setInterval> | null = null;
let titelAlt = '';
function titelBlinken(text: string) {
  if (typeof document === 'undefined') return;
  if (titelTimer) clearInterval(titelTimer);
  titelAlt = titelAlt || document.title;
  let an = false;
  titelTimer = setInterval(() => {
    an = !an;
    document.title = an ? `🔔 ${text}` : titelAlt;
  }, 1000);
  const stopp = () => {
    if (document.visibilityState !== 'visible') return;
    if (titelTimer) clearInterval(titelTimer);
    titelTimer = null;
    document.title = titelAlt;
    titelAlt = '';
    document.removeEventListener('visibilitychange', stopp);
  };
  document.addEventListener('visibilitychange', stopp);
  setTimeout(stopp, 50);
}

/** Mitteilung auslösen (Ton/Vibration/Titel/System je nach Einstellung) */
export async function benachrichtigen(e: MitteilungEinstellung, titel: string, text: string, schluessel: string): Promise<void> {
  if (e.vibration && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([400, 200, 400, 200, 400]);
    } catch {
      /* nicht erlaubt */
    }
  }
  if (e.ton) void gong();
  const hinten = typeof document !== 'undefined' && document.visibilityState !== 'visible';
  if (hinten) titelBlinken(text);
  if (e.system && hinten && faehigkeiten().erlaubt === 'granted') {
    const r = await serviceWorker();
    try {
      await r?.showNotification(titel, { body: text, tag: schluessel, requireInteraction: true, icon: './favicon.svg' } as NotificationOptions);
    } catch {
      /* Mitteilung nicht möglich */
    }
  }
}

/** Bildschirm wach halten, solange die Seite sichtbar ist */
let sperre: { release: () => Promise<void> } | null = null;
export async function wachHalten(an: boolean): Promise<void> {
  const nav = (globalThis as unknown as { navigator?: { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } } }).navigator;
  if (!an) {
    await sperre?.release().catch(() => undefined);
    sperre = null;
    return;
  }
  if (!nav?.wakeLock || sperre || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return;
  try {
    sperre = await nav.wakeLock.request('screen');
  } catch {
    sperre = null;
  }
}
/** Nach dem Zurückkehren in die App die Sperre erneuern (Browser geben sie beim Wegwechseln frei) */
export function wachHaltenErneuern(an: boolean) {
  sperre = null;
  void wachHalten(an);
}
