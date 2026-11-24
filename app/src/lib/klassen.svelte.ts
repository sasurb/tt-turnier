import { MAX_KLASSEN } from '@shared/protokoll';
import { app } from './app.svelte';
import { api } from './dienste';
import { geraetKlassen, setzeGeraetKlassen } from './einstellungen';
import { aktiveSparteId } from './sparte.svelte';

/**
 * Begriffe für Leistungsklassen (z. B. „Anfänger“, „Fortgeschritten“, „A“, „B“).
 * Mit Konto liegen sie in der Sparte auf dem Server (ab 0.17; auf allen Geräten gleich), sonst nur auf dem Gerät.
 * Jeder neu eingetippte Begriff wird gemerkt und beim nächsten Tippen vorgeschlagen.
 */
export const klassen = $state<{ liste: string[]; geladen: boolean }>({
  liste: geraetKlassen(),
  geladen: false,
});

function onlineKonto() {
  return app.server.art === 'bereit' && app.sitzung && app.server.info.kennungen ? app.sitzung : null;
}

export async function klassenLaden(): Promise<void> {
  const s = onlineKonto();
  if (!s) {
    klassen.liste = geraetKlassen();
    klassen.geladen = true;
    return;
  }
  try {
    klassen.liste = (await api.kontoEinstellungen(s.token, aktiveSparteId())).klassen;
    setzeGeraetKlassen(klassen.liste); // Kopie für den Betrieb ohne Netz
  } catch {
    klassen.liste = geraetKlassen();
  } finally {
    klassen.geladen = true;
  }
}

/** Liste ersetzen (Bearbeitung in den Konto-Einstellungen) */
export async function klassenSpeichern(liste: string[]): Promise<void> {
  const sauber = [...new Set(liste.map((k) => k.trim().slice(0, 40)).filter(Boolean))].slice(0, MAX_KLASSEN);
  klassen.liste = sauber;
  setzeGeraetKlassen(sauber);
  const s = onlineKonto();
  if (s) await api.kontoEinstellungenSetzen(s.token, { klassen: sauber }, aktiveSparteId());
}

/** Begriffe merken, die gerade eingetippt wurden (nur neue; still, Fehler ignoriert) */
export function klassenMerken(...begriffe: (string | null | undefined)[]): void {
  const neu = begriffe.map((b) => (b ?? '').trim()).filter((b) => b && !klassen.liste.some((k) => k.toLowerCase() === b.toLowerCase()));
  if (!neu.length) return;
  void klassenSpeichern([...klassen.liste, ...neu]).catch(() => undefined);
}
