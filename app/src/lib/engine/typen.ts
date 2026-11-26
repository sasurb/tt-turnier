import type { Autor, Ereignis, NeuesEreignis } from '@shared/protokoll';

/**
 * Ein Ereignis, wie es auf dem Gerät liegt.
 * - ausstehend: online-Turnier, noch nicht vom Server bestätigt
 * - bestaetigt: vom Server mit Laufnummer zurückgekommen
 * - lokal: Einzelgerät-Turnier, es gibt keinen Server
 * - abgelehnt: vom Server einzeln abgelehnt (ab 0.11) – zählt nicht, wird nicht erneut gesendet
 */
export type EreignisStatus = 'ausstehend' | 'bestaetigt' | 'lokal' | 'abgelehnt';

export interface LokalesEreignis extends NeuesEreignis {
  turnier: string;
  status: EreignisStatus;
  seq: number | null;
  empfangen: string | null;
  autor: Autor | null;
  /** Reihenfolge eigener Einträge auf diesem Gerät (siehe naechsteReihe); fehlt bei Server-Ereignissen. */
  reihe?: number;
  /** Bindung einer noch nicht bestätigten Online-Aktion. */
  sitzung?: string | null;
  /** Grund der Ablehnung durch den Server (Status „abgelehnt“) */
  fehler?: string;
}

export function ausServer(turnier: string, e: Ereignis): LokalesEreignis {
  return {
    id: e.id,
    art: e.art,
    daten: e.daten,
    zeit: e.zeit,
    geraet: e.geraet,
    turnier,
    status: 'bestaetigt',
    seq: e.seq,
    empfangen: e.empfangen,
    autor: e.autor,
  };
}

/**
 * Reihenfolge, in der Ereignisse angewendet werden:
 * erst alles mit Laufnummer (Server- bzw. Gerätereihenfolge), dann Ausstehendes nach Gerätezeit.
 */
export function sortieren(liste: LokalesEreignis[]): LokalesEreignis[] {
  return [...liste].sort((a, b) => {
    if (a.seq !== null && b.seq !== null) return a.seq - b.seq;
    if (a.seq !== null) return -1;
    if (b.seq !== null) return 1;
    const ra = a.reihe ?? 0;
    const rb = b.reihe ?? 0;
    if (ra !== rb) return ra - rb;
    return a.zeit < b.zeit ? -1 : a.zeit > b.zeit ? 1 : a.id.localeCompare(b.id);
  });
}
