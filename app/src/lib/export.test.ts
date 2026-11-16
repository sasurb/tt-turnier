import { describe, expect, it } from 'vitest';
import { ART, type Autor } from '@shared/protokoll';
import { csv, csvFeld, endstandCsv, spieleCsv, teilnehmerCsv } from './export';
import { auslosungErstellen, endstand, platzText } from './engine/abfragen';
import { standardEinstellungen } from './engine/modell';
import type { LokalesEreignis } from './engine/typen';
import { berechnen } from './engine/zustand';
import { DRUCK_STANDARD, druckEinstellungen, setzeDruckEinstellungen } from './druck';

const L: Autor = { rolle: 'leitung', name: 'L' };

function turnier() {
  const l: LokalesEreignis[] = [];
  let n = 0;
  const e = (art: string, d: Record<string, unknown>) =>
    l.push({ id: `e${++n}`, art, daten: d, zeit: new Date(Date.UTC(2026, 10, 16, 10, 0, n)).toISOString(), geraet: 'g', turnier: 't', status: 'lokal', seq: n, empfangen: null, autor: L });
  e(ART.turnierAngelegt, { name: 'Vereinsmeisterschaft 2026', datum: '2026-11-21' });
  e(ART.turnierDaten, { angaben: ['ttr', 'jahrgang'] });
  e(ART.spielerAngelegt, { id: 'a', vorname: 'Anna', nachname: '=HYPERLINK("x")', verein: 'TSV; Nord', ttr: 1500, jahrgang: 2010 });
  e(ART.spielerAngelegt, { id: 'b', vorname: 'Ben', nachname: 'Berg', verein: '"Die Füchse"', ttr: 1400 });
  e(ART.spielerAngelegt, { id: 'c', vorname: 'Cem', nachname: 'Can', verein: '', ttr: null });
  e(ART.konkurrenzAngelegt, { id: 'k', einst: { ...standardEinstellungen('Herren'), modus: 'jgj', bestOf: 3 } });
  for (const s of ['a', 'b', 'c']) e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: s });
  let z = berechnen(l);
  e(ART.auslosung, auslosungErstellen(z, z.konkurrenzen.k!, 7));
  e(ART.phaseGestartet, { konkurrenz: 'k', phase: 'gruppen' });
  z = berechnen(l);
  return { l, e, z };
}

describe('CSV-Export', () => {
  it('maskiert Formeln, Trenner und Anführungszeichen', () => {
    expect(csvFeld('=1+1')).toBe("'=1+1");
    expect(csvFeld('+49 123')).toBe("'+49 123");
    expect(csvFeld('-x')).toBe("'-x");
    expect(csvFeld('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvFeld('a;b')).toBe('"a;b"');
    expect(csvFeld('TTC,=1+1')).toBe('"TTC,=1+1"');
    expect(csvFeld('Er sagte "Hallo"')).toBe('"Er sagte ""Hallo"""');
    expect(csvFeld('Zeile\r\nzwei')).toBe('"Zeile\nzwei"');
    expect(csvFeld(-5)).toBe('-5');
    expect(csvFeld(null)).toBe('');
    expect(csv([['a', 1]])).toBe('﻿a;1\r\n');
  });

  it('Teilnehmer nur mit den geführten Angaben', () => {
    const { z } = turnier();
    const t = teilnehmerCsv(z).replace('﻿', '').split('\r\n');
    expect(t[0]).toBe('Vorname;Nachname;Verein;TTR;Jahrgang;Konkurrenzen');
    expect(t[1]).toBe(`Anna;"'=HYPERLINK(""x"")";"TSV; Nord";1500;2010;Herren`);
    expect(t[2]).toBe('Ben;Berg;"""Die Füchse""";1400;;Herren');
  });

  it('Spiele, Endstand und Urkunden-Platzierung', () => {
    const { l, e } = turnier();
    let z = berechnen(l);
    const spiele = z.konkurrenzen.k!.reihenfolge.map((id) => z.konkurrenzen.k!.spiele[id]!);
    expect(endstand(z.konkurrenzen.k!)).toEqual([]); // noch nicht fertig
    for (const s of spiele) e(ART.spielErgebnis, { konkurrenz: 'k', spiel: s.id, a: s.a, b: s.b, ergebnis: { saetze: s.a === 'a' || (s.a === 'b' && s.b === 'c') ? [[11, 5], [11, 7]] : [[5, 11], [7, 11]] } });
    z = berechnen(l);
    const es = endstand(z.konkurrenzen.k!);
    expect(es.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(platzText(es[0]!.bezeichnung)).toBe('1. Platz');
    expect(platzText('5–8')).toBe('Platz 5–8');
    const sp = spieleCsv(z).split('\r\n');
    expect(sp[0]).toContain('Konkurrenz;Runde;Spieler A');
    expect(sp).toHaveLength(5); // Kopf, 3 Spiele, leere letzte Zeile
    expect(sp[1]).toMatch(/;2;0;11:5 11:7;|;0;2;5:11 7:11;/);
    const en = endstandCsv(z).replace('﻿', '').split('\r\n');
    expect(en[1]).toBe('Herren;1;"Anna =HYPERLINK(""x"")";"TSV; Nord"');
  });
});

describe('Druckeinstellungen', () => {
  it('speichert je Turnier und lässt nur Bilder als Logo zu', () => {
    const daten = new Map<string, string>();
    Object.assign(globalThis, { localStorage: { getItem: (k: string) => daten.get(k) ?? null, setItem: (k: string, v: string) => void daten.set(k, v) } });
    expect(druckEinstellungen('t1')).toEqual(DRUCK_STANDARD);
    setzeDruckEinstellungen('t1', { ...DRUCK_STANDARD, urkundePlaetze: 8, logo: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(druckEinstellungen('t1').urkundePlaetze).toBe(8);
    expect(druckEinstellungen('t1').logo).toMatch(/^data:image\/png/);
    setzeDruckEinstellungen('t1', { ...DRUCK_STANDARD, logo: 'javascript:alert(1)' });
    expect(druckEinstellungen('t1').logo).toBe('');
    setzeDruckEinstellungen('t1', { ...DRUCK_STANDARD, logo: 'data:image/svg+xml;base64,PHN2Zz4=' });
    expect(druckEinstellungen('t1').logo).toBe('');
  });
});
