import { describe, expect, it } from 'vitest';
import { ART } from '@shared/protokoll';
import { Baukasten, saetze } from './engine/test/baukasten';
import { ergebnisNachricht } from './ergebnisnachricht';

function fertigesTurnier() {
  const b = new Baukasten();
  b.e(ART.turnierAngelegt, { name: 'Testcup', datum: null });
  for (const [i, s] of ['anna', 'ben', 'cem'].entries()) b.e(ART.spielerAngelegt, { id: s, vorname: s[0]!.toUpperCase() + s.slice(1), nachname: 'Mustermann', verein: 'TV', ttr: 1500 - i * 100 });
  b.konkurrenz('k', { name: 'Herren', modus: 'jgj', setzung: 'ttr' }, ['anna', 'ben', 'cem']);
  b.auslosen('k');
  b.starten('k', 'gruppen');
  const k = b.z.konkurrenzen.k!;
  const rang = ['anna', 'ben', 'cem'];
  for (const sid of k.reihenfolge) {
    const s = b.z.konkurrenzen.k!.spiele[sid]!;
    const aBesser = rang.indexOf(s.a!) < rang.indexOf(s.b!);
    b.ergebnis('k', sid, aBesser ? saetze(5, 5, 5) : saetze(-5, -5, -5));
  }
  return b;
}

describe('Ergebnis-Nachricht (0.18)', () => {
  it('Liste mit Endstand und eigene Platzierung je Spieler', () => {
    const b = fertigesTurnier();
    const n = ergebnisNachricht(b.z);
    expect(n.mitStand).toBe(1);
    expect(n.liste).toContain('Testcup');
    expect(n.liste).toContain('Herren\n1. Anna Mustermann');
    expect(n.liste).toContain('3. Cem Mustermann');
    expect(n.plaetze).toEqual([
      { spieler: 'anna', text: 'Herren: 1. Platz' },
      { spieler: 'ben', text: 'Herren: 2. Platz' },
      { spieler: 'cem', text: 'Herren: 3. Platz' },
    ]);
  });
  it('Kurzform der Namen bei „kurz“ und bei Jugendturnieren', () => {
    const b = fertigesTurnier();
    b.e(ART.turnierDaten, { jugend: true });
    expect(ergebnisNachricht(b.z).liste).toContain('1. Anna M.');
  });
  it('verdeckte Stände: ohne Platzierung', () => {
    const b = fertigesTurnier();
    b.e(ART.turnierDaten, { veroeffentlichung: { tabellen: false, ko: false } });
    const n = ergebnisNachricht(b.z);
    expect(n.verdeckt).toBe(true);
    expect(n.plaetze).toEqual([]);
    expect(n.liste).not.toContain('Anna');
  });
});
