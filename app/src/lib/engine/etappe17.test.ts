import { describe, expect, it } from 'vitest';
import { ART, TURNIER_KENNUNG_MUSTER, TURNIER_KENNUNG_ZEICHEN } from '@shared/protokoll';
import { Baukasten } from './test/baukasten';
import { appWertungAn, minderjaehrigeLautJahrgang, rueckgaengigErlaubt } from './zustand';
import { codeAnzeige, turnierIdNorm, turnierKennungEingabe, wunschKennungGueltig } from '../code';

describe('0.17: Turnierkennungen', () => {
  it('Zufallskennungen ohne Verwechsler, Wunschkennungen 4–12 Zeichen', () => {
    expect(TURNIER_KENNUNG_ZEICHEN).not.toMatch(/[01ILO]/);
    expect(TURNIER_KENNUNG_MUSTER.test('K7QM3XRP')).toBe(true);
    expect(TURNIER_KENNUNG_MUSTER.test('48392017')).toBe(true); // ältere Kennungen
    for (const ok of ['VM-2027', 'ABCD', 'KREIS-CUP-27']) expect(wunschKennungGueltig(ok)).toBe(true);
    for (const falsch of ['ABC', '-ABCD', 'ABCD-', 'A--B', 'SEHR-LANGE-KENNUNG']) expect(wunschKennungGueltig(falsch)).toBe(false);
    expect(turnierKennungEingabe('vm 2027!')).toBe('VM2027');
    expect(turnierIdNorm('k7qm3xrp')).toBe('K7QM3XRP');
    expect(turnierIdNorm('labcdefg12')).toBe('labcdefg12'); // lokale Turniere bleiben, wie sie sind
    expect(codeAnzeige('K7QM3XRP')).toBe('K7QM 3XRP');
  });
});

describe('0.17: Jugendturnier und App-Wertung', () => {
  it('turnier.daten jugend schaltet die App-Wertung standardmäßig aus; Leitung kann sie einschalten', () => {
    const t = new Baukasten();
    expect(t.z.jugend).toBe(false);
    expect(appWertungAn(t.z)).toBe(true);
    t.e(ART.turnierDaten, { jugend: true, namen: 'kurz' });
    expect(t.z.jugend).toBe(true);
    expect(t.z.namen).toBe('kurz');
    expect(appWertungAn(t.z)).toBe(false);
    t.e(ART.turnierDaten, { appWertung: true });
    expect(appWertungAn(t.z)).toBe(true);
    t.e(ART.turnierDaten, { jugend: 'ja' });
    expect(t.z.jugend).toBe(true); // ungültige Werte ändern nichts
  });
  it('Jugend-Schalter lässt sich nicht rückgängig machen (die Server werten ihn aus)', () => {
    expect(rueckgaengigErlaubt({ art: ART.turnierDaten, daten: { jugend: true } })).toBe(false);
    expect(rueckgaengigErlaubt({ art: ART.turnierDaten, daten: { ort: 'Halle' } })).toBe(true);
  });
  it('zählt Minderjährige laut Jahrgang am Turniertag', () => {
    const t = new Baukasten();
    t.e(ART.turnierAngelegt, { name: 'Jugend', datum: '2027-03-01' });
    t.e(ART.spielerAngelegt, { id: 'a', vorname: 'A', nachname: 'A', verein: '', jahrgang: 2010 });
    t.e(ART.spielerAngelegt, { id: 'b', vorname: 'B', nachname: 'B', verein: '', jahrgang: 2008 });
    t.e(ART.spielerAngelegt, { id: 'c', vorname: 'C', nachname: 'C', verein: '' });
    expect(minderjaehrigeLautJahrgang(t.z)).toBe(1);
  });
});
