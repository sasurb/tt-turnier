import type { InfoAntwort } from '@shared/protokoll';
import { PROTOKOLL_VERSION } from '@shared/protokoll';
import { Api } from './engine/api';
import { zentraleGeheimnis } from './geheimnis';
import { SpeicherIndexedDb, SpeicherImArbeitsspeicher, type EreignisSpeicher } from './engine/speicher';

/** Adresse der Schnittstelle; Standard: gleicher Server, Ordner api/. */
export const API_BASIS: string = import.meta.env.VITE_API ?? './api/index.php';

export const api = new Api(API_BASIS, undefined, undefined, zentraleGeheimnis);

function speicherErzeugen(): EreignisSpeicher {
  try {
    if (typeof indexedDB !== 'undefined') return new SpeicherIndexedDb();
  } catch {
    /* z. B. privater Modus ohne IndexedDB */
  }
  return new SpeicherImArbeitsspeicher();
}

export const speicher = speicherErzeugen();

export type ServerZustand = { art: 'pruefe' } | { art: 'keiner' } | { art: 'bereit'; info: InfoAntwort } | { art: 'nicht_eingerichtet'; info: InfoAntwort };

let pruefung: Promise<ServerZustand> | null = null;

/** Prüft einmal je Seitenaufruf, ob ein passender Server erreichbar ist (auf GitHub Pages: nein). */
export function serverPruefen(neu = false): Promise<ServerZustand> {
  if (!pruefung || neu) {
    pruefung = api
      .info()
      .then((info): ServerZustand => {
        if (info.app !== 'tt-turnier' || info.protokoll !== PROTOKOLL_VERSION) return { art: 'keiner' };
        return info.eingerichtet ? { art: 'bereit', info } : { art: 'nicht_eingerichtet', info };
      })
      .catch((): ServerZustand => ({ art: 'keiner' }));
  }
  return pruefung;
}
