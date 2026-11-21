import type { InfoAntwort } from '@shared/protokoll';
import { PROTOKOLL_VERSION } from '@shared/protokoll';
import { Api, ApiFehler } from './engine/api';
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

/**
 * bereit mit offline = true: Der Server war auf diesem Gerät schon erreichbar, gerade gibt es aber kein Netz.
 * Die App arbeitet dann mit den gespeicherten Turnieren weiter und trägt Einträge später nach.
 */
export type ServerZustand =
  | { art: 'pruefe' }
  | { art: 'keiner' }
  | { art: 'bereit'; info: InfoAntwort; offline?: boolean }
  | { art: 'nicht_eingerichtet'; info: InfoAntwort };

const INFO_SCHLUESSEL = 'tt-server-info';
function gemerkteInfo(): InfoAntwort | null {
  try {
    const t = localStorage.getItem(INFO_SCHLUESSEL);
    const i = t ? (JSON.parse(t) as InfoAntwort) : null;
    return i && i.app === 'tt-turnier' && i.protokoll === PROTOKOLL_VERSION && i.eingerichtet ? i : null;
  } catch {
    return null;
  }
}
function infoMerken(i: InfoAntwort) {
  try {
    localStorage.setItem(INFO_SCHLUESSEL, JSON.stringify(i));
  } catch {
    /* Speicher voll oder gesperrt */
  }
}

let pruefung: Promise<ServerZustand> | null = null;

/** Prüft einmal je Seitenaufruf, ob ein passender Server erreichbar ist (auf GitHub Pages: nein). */
export function serverPruefen(neu = false): Promise<ServerZustand> {
  if (!pruefung || neu) {
    pruefung = api
      .info()
      .then((info): ServerZustand => {
        if (info.app !== 'tt-turnier' || info.protokoll !== PROTOKOLL_VERSION) return { art: 'keiner' };
        if (info.eingerichtet) infoMerken(info);
        return info.eingerichtet ? { art: 'bereit', info } : { art: 'nicht_eingerichtet', info };
      })
      .catch((x: unknown): ServerZustand => {
        // Kein Netz, aber der Server ist bekannt: offline weiterarbeiten
        const gemerkt = x instanceof ApiFehler && x.istNetzwerk ? gemerkteInfo() : null;
        return gemerkt ? { art: 'bereit', info: gemerkt, offline: true } : { art: 'keiner' };
      });
  }
  return pruefung;
}
