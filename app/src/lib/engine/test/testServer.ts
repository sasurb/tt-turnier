import type { Ereignis, NeuesEreignis } from '@shared/protokoll';
import { MAX_EREIGNISSE_JE_AUFRUF } from '@shared/protokoll';
import type { Abruf } from '../api';

/**
 * Minimaler Server im Arbeitsspeicher nach shared/protokoll.ts (nur events),
 * für Tests des Abgleichs. Kann „offline“ geschaltet werden.
 */
export class TestServer {
  ereignisse: Ereignis[] = [];
  offline = false;
  private seq = 0;
  /** Token → Name */
  tokens = new Map<string, string>([['tok-a', 'Gerät A'], ['tok-b', 'Gerät B']]);
  aufrufe = 0;
  /** Wie Server ab 0.9: ohne gültiges Token nur die Zuschauer-Sicht (ohne Jahrgang, ohne Autor-Namen) */
  mitSicht = false;

  abruf: Abruf = async (url, init) => {
    this.aufrufe++;
    if (this.offline) throw new TypeError('Failed to fetch');
    const u = new URL(url, 'http://test.invalid/');
    const route = u.searchParams.get('r');
    const turnier = u.searchParams.get('turnier') ?? '';
    const json = (status: number, daten: unknown) =>
      new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });

    if (route === 'events' && init.method === 'GET') {
      const ab = Number(u.searchParams.get('ab') ?? 0);
      const alle = this.ereignisse.filter((e) => e.seq > ab);
      const teil = alle.slice(0, MAX_EREIGNISSE_JE_AUFRUF);
      if (!this.mitSicht) return json(200, { ereignisse: teil, hoechsteSeq: this.seq, mehr: alle.length > teil.length });
      const token = (init.headers as Record<string, string>)['X-TT-Token'];
      const voll = !!token && this.tokens.has(token);
      const liste = voll
        ? teil
        : teil.map((e) => {
            const daten = { ...(e.daten as Record<string, unknown>) };
            delete daten.jahrgang;
            return { ...e, daten, autor: { ...e.autor, name: '' } };
          });
      return json(200, { ereignisse: liste, hoechsteSeq: this.seq, mehr: alle.length > teil.length, sicht: voll ? 'voll' : 'zuschauer' });
    }
    if (route === 'events' && init.method === 'POST') {
      const token = (init.headers as Record<string, string>)['X-TT-Token'];
      const name = token ? this.tokens.get(token) : undefined;
      if (!name) return json(401, { fehler: 'nicht_angemeldet', meldung: 'Bitte anmelden.' });
      const { ereignisse } = JSON.parse(String(init.body)) as { ereignisse: NeuesEreignis[] };
      if (ereignisse.length > MAX_EREIGNISSE_JE_AUFRUF) return json(400, { fehler: 'ungueltig', meldung: 'zu viele' });
      const angenommen = ereignisse.map((n) => {
        const da = this.ereignisse.find((e) => e.id === n.id);
        if (da) return { id: n.id, seq: da.seq };
        const e: Ereignis = { ...n, seq: ++this.seq, empfangen: new Date().toISOString(), autor: { rolle: 'leitung', name } };
        this.ereignisse.push(e);
        return { id: n.id, seq: e.seq };
      });
      void turnier;
      return json(200, { angenommen, hoechsteSeq: this.seq });
    }
    return json(404, { fehler: 'nicht_gefunden', meldung: 'unbekannt' });
  };
}
