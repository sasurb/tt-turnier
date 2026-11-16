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
  /** Ab 0.9: Android-Druckdialog für die aktuelle Seite (Drucker oder „Als PDF speichern“). */
  drucken?(titel: string): void;
}

/** Seite drucken bzw. als PDF speichern – im Browser über den Druckdialog, in der Zentrale über Android */
export function seiteDrucken(titel: string) {
  const n = nativ();
  if (n?.drucken) n.drucken(titel);
  else print();
}

export function nativ(): TTNativ | null {
  const n = (globalThis as { TTNativ?: TTNativ }).TTNativ;
  return n && typeof n.dateiTeilen === 'function' ? n : null;
}
