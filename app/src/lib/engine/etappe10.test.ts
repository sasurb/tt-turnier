import { describe, expect, it } from 'vitest';
import { ART, ENTFERNT_NAME } from '@shared/protokoll';
import { Abgleich } from './abgleich';
import { Api } from './api';
import { SpeicherImArbeitsspeicher } from './speicher';
import { HANDBUCH, handbuchFiltern } from '../handbuch';

describe('Etappe 10: Filter für entfernte Spieler', () => {
  /** Server-Attrappe: liefert zwei Spieler; „filter“ und Name lassen sich umstellen */
  function schein() {
    const lage = { filter: null as string | null, abrufe: [] as number[] };
    const abruf = async (url: string | URL | Request) => {
      const u = new URL(String(url));
      const ab = Number(u.searchParams.get('ab') ?? 0);
      lage.abrufe.push(ab);
      const name = lage.filter ? ENTFERNT_NAME : 'Bert';
      const alle = [
        { seq: 1, id: 'a1', art: ART.spielerAngelegt, daten: { id: 'anna', vorname: 'Anna', nachname: 'A', verein: '' } },
        { seq: 2, id: 'a2', art: ART.spielerAngelegt, daten: { id: 'bert', vorname: name, nachname: lage.filter ? '' : 'B', verein: '' } },
      ].filter((e) => e.seq > ab);
      return new Response(
        JSON.stringify({
          ereignisse: alle.map((e) => ({ ...e, zeit: '2026-11-16T10:00:00Z', geraet: 'g', empfangen: '2026-11-16T10:00:00Z', autor: { rolle: 'leitung', name: '' } })),
          hoechsteSeq: 2,
          mehr: false,
          sicht: 'zuschauer',
          bis: 2,
          ...(lage.filter ? { filter: lage.filter } : {}),
        }),
        { status: 200 },
      );
    };
    return { abruf, lage };
  }

  it('holt alles neu ab, wenn sich die Filter-Kennung ändert – in beide Richtungen', async () => {
    const s = schein();
    const speicher = new SpeicherImArbeitsspeicher();
    const ag = new Abgleich({ speicher, api: new Api('http://test.invalid/api/index.php', s.abruf), turnier: 't1', token: () => null });
    await ag.durchlauf();
    const name = async () => (await speicher.alle('t1')).find((e) => e.id === 'a2')?.daten.vorname;
    expect(await name()).toBe('Bert');
    // Spieler entfernt: neue Kennung → neu abholen, Name ersetzt
    s.lage.filter = 'aaaaaaaaaaaaaaaa';
    s.lage.abrufe = [];
    await ag.durchlauf();
    expect(s.lage.abrufe).toEqual([2, 0]);
    expect(await name()).toBe(ENTFERNT_NAME);
    expect(await speicher.sicht('t1')).toBe('zuschauer|aaaaaaaaaaaaaaaa');
    // Gleiche Kennung: nichts neu
    s.lage.abrufe = [];
    await ag.durchlauf();
    expect(s.lage.abrufe).toEqual([2]);
    // Entfernen rückgängig: Kennung weg → neu abholen, Name wieder da
    s.lage.filter = null;
    s.lage.abrufe = [];
    await ag.durchlauf();
    expect(s.lage.abrufe).toEqual([2, 0]);
    expect(await name()).toBe('Bert');
  });
});

describe('Etappe 10: Handbuch', () => {
  it('hat eindeutige Kapitel, jedes mit Inhalt und Zielgruppe', () => {
    const ids = HANDBUCH.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of HANDBUCH) {
      expect(k.fuer.length).toBeGreaterThan(0);
      expect(k.abschnitte.length).toBeGreaterThan(0);
      for (const a of k.abschnitte) expect(a.text.length).toBeGreaterThan(0);
    }
  });

  it('filtert nach Rolle und Suchwörtern', () => {
    expect(handbuchFiltern(null, '')).toHaveLength(HANDBUCH.length);
    const zuschauer = handbuchFiltern('zuschauer', '');
    expect(zuschauer.every((k) => k.fuer.includes('zuschauer'))).toBe(true);
    expect(zuschauer.some((k) => k.id === 'kasse')).toBe(false);
    expect(handbuchFiltern(null, 'girocode').map((k) => k.id)).toEqual(expect.arrayContaining(['anmeldung']));
    expect(handbuchFiltern(null, 'FREILOS gesetzte').map((k) => k.id)).toEqual(['auslosung']);
    expect(handbuchFiltern(null, 'gibtesnicht')).toEqual([]);
  });
});
