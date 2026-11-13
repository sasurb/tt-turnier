/** Eindeutige ID (UUID v4). Nutzt crypto.randomUUID, wo vorhanden (auch über http im lokalen WLAN nicht immer). */
export function neueId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* unsicherer Kontext */
    }
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Kurze lokale Turnier-ID für Einzelgerät-Turniere (Präfix "l" zur Unterscheidung). */
export function lokaleTurnierId(): string {
  return 'l' + neueId().replace(/-/g, '').slice(0, 11);
}

let letzteReihe = 0;
/**
 * Streng steigende Nummer für die Reihenfolge eigener, noch nicht bestätigter Einträge
 * (Gerätezeit in Mikrosekunden-Raster; mehrere Einträge in derselben Millisekunde bleiben geordnet).
 */
export function naechsteReihe(): number {
  letzteReihe = Math.max(letzteReihe + 1, Date.now() * 1000);
  return letzteReihe;
}

/** Kurze ID für Spieler, Konkurrenzen und Helfer innerhalb eines Turniers (10 Zeichen, a–z/0–9). */
export function kurzId(): string {
  const zeichen = 'abcdefghijkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(10);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < 10; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => zeichen[x % zeichen.length]).join('');
}
