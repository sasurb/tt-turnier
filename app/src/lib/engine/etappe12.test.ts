import { describe, expect, it } from 'vitest';
import { ART } from '@shared/protokoll';
import { meldbareEinzel, teilnahmen } from './abfragen';
import { Baukasten } from './test/baukasten';

/** Etappe 12: Reiter „Teilnehmer“ – Melden je Konkurrenz und Übersicht, wer wo mitspielt */
describe('Teilnehmer je Konkurrenz', () => {
  function turnier() {
    const b = new Baukasten();
    for (const s of ['a', 'b', 'c', 'd', 'e']) b.spieler(s);
    b.konkurrenz('herren', { name: 'Herren', modus: 'jgj' }, ['a', 'b', 'c']);
    b.konkurrenz('damen', { name: 'Damen', modus: 'jgj' }, ['d']);
    b.konkurrenz('doppel', { name: 'Doppel', art: 'doppel', modus: 'ko' }, []);
    b.e(ART.paarGemeldet, { konkurrenz: 'doppel', id: 'p-paar1', spieler: ['a', 'd'] });
    return b;
  }

  it('„Gleich melden für“ bietet nur Einzel an, die noch nicht begonnen haben', () => {
    const b = turnier();
    expect(meldbareEinzel(b.z)).toEqual(['herren', 'damen']);
    b.auslosen('herren');
    b.starten('herren', 'gruppen');
    expect(meldbareEinzel(b.z)).toEqual(['damen']);
  });

  it('zeigt je Spieler, wo er mitspielt – auch im Paar; Abmelden und Rückzug zählen nicht', () => {
    const b = turnier();
    expect(teilnahmen(b.z, 'a')).toEqual(['herren', 'doppel']);
    expect(teilnahmen(b.z, 'd')).toEqual(['damen', 'doppel']);
    expect(teilnahmen(b.z, 'e')).toEqual([]);
    b.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'damen', id: 'd' });
    expect(teilnahmen(b.z, 'd')).toEqual(['doppel']);
    b.auslosen('herren');
    b.starten('herren', 'gruppen');
    b.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'herren', id: 'c' });
    expect(teilnahmen(b.z, 'c')).toEqual([]);
    expect(teilnahmen(b.z, 'b')).toEqual(['herren']);
  });

  it('Melden in Doppel per Einzelmeldung bleibt wirkungslos (Warnung statt Meldung)', () => {
    const b = turnier();
    b.e(ART.teilnehmerGemeldet, { konkurrenz: 'doppel', id: 'e' });
    expect(b.z.konkurrenzen.doppel!.meldungen).toEqual(['p-paar1']);
    expect(b.z.warnungen.at(-1)?.text).toMatch(/Paare/);
  });
});
