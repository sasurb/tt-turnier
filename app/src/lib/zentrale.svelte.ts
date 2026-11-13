import { app } from './app.svelte';

/**
 * Hilfen für den Betrieb mit der Android-Zentrale (lokaler Server im eigenen WLAN).
 * Die Zentrale meldet sich in `info.zentrale`; die App selbst bleibt dieselbe.
 */

/** Läuft die App gerade über eine Zentrale? */
export function istZentrale(): boolean {
  return app.server.art === 'bereit' && !!app.server.info.zentrale;
}

/** Ist dies das Gerät der Zentrale selbst (App in der Hub-App, Adresse 127.0.0.1)? */
export function amGeraetDerZentrale(): boolean {
  if (!istZentrale()) return false;
  const h = location.hostname;
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]';
}

/**
 * Grundadresse der App für Links und QR-Codes, die andere Geräte öffnen.
 * Auf dem Gerät der Zentrale ist location.origin „127.0.0.1“ – das hilft anderen nicht;
 * dann gilt die Adresse im WLAN, die die Zentrale meldet.
 */
export function appBasis(): string {
  if (app.server.art === 'bereit' && app.server.info.zentrale?.adresse && amGeraetDerZentrale()) {
    return app.server.info.zentrale.adresse;
  }
  return `${location.origin}${location.pathname}`;
}

/** WLAN-Zugang als QR-Inhalt (Standardformat, das Handy-Kameras verstehen). */
export function wlanQr(ssid: string, passwort: string | null): string {
  const m = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
  return passwort ? `WIFI:T:WPA;S:${m(ssid)};P:${m(passwort)};;` : `WIFI:T:nopass;S:${m(ssid)};;`;
}
