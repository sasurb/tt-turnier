import { ART, type Sicherung } from '@shared/protokoll';
import { api, speicher } from './dienste';
import { app } from './app.svelte';
import { aktiveSparteId, spartenZumAnlegen } from './sparte.svelte';
import { TurnierSitzung } from './engine/turnier';
import { anzeigeName, geraetId, turnierMerken } from './einstellungen';

/**
 * Eine Sicherung (z. B. von einem Schnellen Spiel oder einem Turnier auf diesem Gerät) als neues Online-Turnier
 * in die aktive Sparte hochladen (ab 0.18; gleicher Weg wie „Wiederherstellen“). Gibt die neue Turnier-ID zurück.
 */
export async function alsOnlineTurnierHochladen(s: Sicherung): Promise<{ id: string; anzahl: number }> {
  if (!app.sitzung) throw new Error('Bitte zuerst anmelden.');
  const sp = spartenZumAnlegen().find((x) => x.id === aktiveSparteId()) ?? spartenZumAnlegen()[0];
  const konto = app.sitzung;
  const a = await api.turnierAnlegen(konto.token, { name: s.turnier.name, datum: s.turnier.datum, ...(sp ? { sparte: sp.id } : {}) });
  const id = a.turnier.id;
  turnierMerken({ id, name: a.turnier.name, datum: a.turnier.datum, modus: 'online', rolle: 'zuschauer', token: null, konto: true });
  const sitzung = new TurnierSitzung({ speicher, turnier: id, modus: 'online', geraet: geraetId(), autor: { rolle: 'leitung', name: anzeigeName() || konto.konto.name }, api, token: () => konto.token });
  const anzahl = await sitzung.importieren(s.ereignisse);
  await sitzung.eintragen(ART.turnierWiederhergestellt, { quelle: s.turnier.id, erstellt: s.erstellt, anzahl });
  void api.logout(a.token).catch(() => undefined);
  return { id, anzahl };
}
