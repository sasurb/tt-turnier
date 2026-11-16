import { describe, expect, it } from 'vitest';
import { ART, type Autor } from '@shared/protokoll';
import { ansageText, aufrufeVon, geraeteStimme, neueAufrufe } from './ansage';
import { auslosungErstellen } from './engine/abfragen';
import { standardEinstellungen } from './engine/modell';
import type { LokalesEreignis } from './engine/typen';
import { berechnen } from './engine/zustand';

const L: Autor = { rolle: 'leitung', name: 'L' };
function ev(n: number, art: string, daten: Record<string, unknown>): LokalesEreignis {
  return { id: `e${n}`, art, daten, zeit: new Date(Date.UTC(2026, 10, 16, 10, 0, n)).toISOString(), geraet: 'g', turnier: 't', status: 'lokal', seq: n, empfangen: null, autor: L };
}

describe('Sprachausgabe', () => {
  it('erkennt neue Aufrufe und formuliert die Ansage', () => {
    const l: LokalesEreignis[] = [];
    let n = 0;
    const e = (art: string, d: Record<string, unknown>) => l.push(ev(++n, art, d));
    e(ART.spielerAngelegt, { id: 'a', vorname: 'Max', nachname: 'Müller', verein: '' });
    e(ART.spielerAngelegt, { id: 'b', vorname: 'Eva', nachname: 'Schmidt', verein: '' });
    e(ART.konkurrenzAngelegt, { id: 'k', einst: { ...standardEinstellungen('Herren A'), modus: 'jgj' } });
    e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: 'a' });
    e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: 'b' });
    let z = berechnen(l);
    e(ART.auslosung, auslosungErstellen(z, z.konkurrenzen.k!, 1));
    e(ART.phaseGestartet, { konkurrenz: 'k', phase: 'gruppen' });
    z = berechnen(l);
    const bekannt = new Set<string>();
    expect(neueAufrufe(bekannt, aufrufeVon(z))).toEqual([]);
    const spiel = Object.values(z.konkurrenzen.k!.spiele)[0]!;
    e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: spiel.id, tisch: 3 });
    z = berechnen(l);
    const neu = neueAufrufe(bekannt, aufrufeVon(z));
    expect(neu).toHaveLength(1);
    expect(ansageText(z, neu[0]!)).toMatch(/^Tisch 3: (Max Müller gegen Eva Schmidt|Eva Schmidt gegen Max Müller)\. Herren A, Runde 1\.$/);
    expect(neueAufrufe(bekannt, aufrufeVon(z))).toEqual([]);
    // erneuter Aufruf (zurück und wieder) wird wieder angesagt
    e(ART.spielAufrufZurueck, { konkurrenz: 'k', spiel: spiel.id });
    e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: spiel.id, tisch: 1 });
    expect(neueAufrufe(bekannt, aufrufeVon(berechnen(l)))).toHaveLength(1);
  });

  it('nimmt nur deutsche Stimmen, die auf dem Gerät laufen', () => {
    const v = (lang: string, localService: boolean, d = false) => ({ lang, localService, name: lang, default: d });
    expect(geraeteStimme([v('de-DE', false), v('en-US', true)])).toBe(-1);
    expect(geraeteStimme([v('de-DE', false), v('de-AT', true), v('de-DE', true)])).toBe(2);
    expect(geraeteStimme([v('de_DE', true)])).toBe(0);
  });
});
