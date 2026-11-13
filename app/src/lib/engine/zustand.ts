import { ART } from '@shared/protokoll';
import type { LokalesEreignis } from './typen';

/**
 * Aktueller Stand eines Turniers, berechnet aus den Ereignissen.
 * Etappe 2: nur Name/Datum und Testnotizen; ab Etappe 3 kommen Spieler, Konkurrenzen, Spiele dazu.
 */
export interface TurnierZustand {
  name: string;
  datum: string | null;
  notizen: { id: string; text: string; von: string; zeit: string; bestaetigt: boolean }[];
  anzahlEreignisse: number;
}

export function leererZustand(): TurnierZustand {
  return { name: '', datum: null, notizen: [], anzahlEreignisse: 0 };
}

export function anwenden(z: TurnierZustand, e: LokalesEreignis): TurnierZustand {
  z.anzahlEreignisse++;
  switch (e.art) {
    case ART.turnierAngelegt:
    case ART.turnierUmbenannt: {
      const d = e.daten as { name?: unknown; datum?: unknown };
      if (typeof d.name === 'string') z.name = d.name;
      if (typeof d.datum === 'string' || d.datum === null) z.datum = d.datum as string | null;
      break;
    }
    case ART.testNotiz: {
      const d = e.daten as { text?: unknown };
      if (typeof d.text === 'string') {
        z.notizen.push({
          id: e.id,
          text: d.text,
          von: e.autor?.name ?? '',
          zeit: e.zeit,
          bestaetigt: e.status !== 'ausstehend',
        });
      }
      break;
    }
    default:
      // Unbekannte Arten (z. B. von einer neueren App-Version) werden übersprungen, nicht verworfen.
      break;
  }
  return z;
}

export function berechnen(ereignisse: LokalesEreignis[]): TurnierZustand {
  return ereignisse.reduce(anwenden, leererZustand());
}
