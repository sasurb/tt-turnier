/**
 * Brücke zur Android-Hub-App. In der Zentrale läuft die App in einer WebView; dort gibt es
 * kein Herunterladen von Blobs und kein navigator.share. Die Hub-App stellt dafür
 * `window.TTNativ` bereit. In normalen Browsern fehlt das Objekt – dann gelten die
 * üblichen Wege.
 */
interface TTNativ {
  /** Datei über das Android-Teilen-Menü weitergeben (z. B. per Mail an sich selbst). */
  dateiTeilen(name: string, inhalt: string, typ: string): void;
  /** Text oder Link über das Teilen-Menü weitergeben. */
  textTeilen(titel: string, text: string): void;
}

export function nativ(): TTNativ | null {
  const n = (globalThis as { TTNativ?: TTNativ }).TTNativ;
  return n && typeof n.dateiTeilen === 'function' ? n : null;
}
