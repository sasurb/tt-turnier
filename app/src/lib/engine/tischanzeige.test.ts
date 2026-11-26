import { describe, expect, it } from 'vitest';
import { ART, type Autor } from '@shared/protokoll';
import { Baukasten, LEITUNG, saetze } from './test/baukasten';
import { tische } from './abfragen';
import { standardMannschaft, teilId } from './mannschaft';
import { tischAnzeige, ZULETZT_MINUTEN } from './tischanzeige';

const START = Date.UTC(2026, 10, 14, 9, 0, 0);
const MIN = 60_000;
const spieler = (id: string): Autor => ({ rolle: 'spieler', name: id, spieler: id });

/** Einzel-Turnier mit 4 Tischen, Spiel Anna–Berta läuft ab Minute 10 an Tisch 1 */
function einzel() {
  const t = new Baukasten(START);
  t.e(ART.turnierDaten, { tische: 4 });
  t.spieler('anna');
  t.spieler('berta');
  t.konkurrenz('k', { modus: 'jgj', name: 'Damen' }, ['anna', 'berta']);
  t.auslosen('k');
  t.starten('k', 'gruppen');
  const s = Object.values(t.z.konkurrenzen.k!.spiele)[0]!;
  t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: s.id, tisch: 1 }, LEITUNG, START + 10 * MIN);
  return { t, s };
}
const anzeige = (t: Baukasten, nr: number, jetzt: number) => tischAnzeige(t.z, tische(t.z).find((x) => x.nr === nr)!, jetzt);

describe('V-010: Tischanzeige', () => {
  it('laufendes Einzel: Namen, Ort, Spielzeit; andere Tische frei, gesperrter Tisch gesperrt', () => {
    const { t } = einzel();
    t.e(ART.tischGesperrt, { nr: 4, gesperrt: true });
    const a = anzeige(t, 1, START + 34 * MIN);
    expect(a).toMatchObject({ nr: 1, zustand: 'laeuft', hinweis: null, minuten: 24, zuletzt: null, teilspiel: null });
    expect(a.ort).toMatch(/^Damen · /);
    expect([a.a!.name, a.b!.name].sort()).toEqual(['ANNA Test', 'BERTA Test']);
    expect(a.a!.zahl).toBeNull();
    expect(anzeige(t, 2, START + 34 * MIN)).toMatchObject({ zustand: 'frei', spiel: null, zuletzt: null });
    expect(anzeige(t, 4, START + 34 * MIN)).toMatchObject({ zustand: 'gesperrt', spiel: null });
  });

  it('nach dem Ergebnis: Tisch frei, zeigt das letzte Spiel mit Satzergebnissen je Seite – nur 30 Minuten lang', () => {
    const { t, s } = einzel();
    t.ergebnis('k', s.id, saetze(8, -9, 5, 7), LEITUNG, START + 40 * MIN);
    const a = anzeige(t, 1, START + 45 * MIN);
    expect(a.zustand).toBe('frei');
    expect(a.zuletzt?.id).toBe(s.id);
    expect(a.hinweis).toBeNull(); // Leitung trägt amtlich ein
    expect(a.minuten).toBe(5);
    expect(a.a).toMatchObject({ zahl: 3, saetze: [11, 9, 11, 11] });
    expect(a.b).toMatchObject({ zahl: 1, saetze: [8, 11, 5, 7] });
    expect(anzeige(t, 1, START + (40 + ZULETZT_MINUTEN + 1) * MIN).zuletzt).toBeNull();
  });

  it('Spieler-Eintrag wartet auf Bestätigung; widersprüchliche Meldung macht den Tisch „strittig“', () => {
    const { t, s } = einzel();
    t.ergebnis('k', s.id, saetze(5, 5, 5), spieler(s.a!), START + 30 * MIN);
    expect(anzeige(t, 1, START + 31 * MIN)).toMatchObject({ zustand: 'frei', hinweis: 'zu_bestaetigen' });
    t.ergebnis('k', s.id, saetze(-5, -5, -5), spieler(s.b!), START + 32 * MIN);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.stand).toBe('konflikt');
    // Der Tisch ist frei (vorläufig zählt die erste Meldung), das letzte Spiel ist sichtbar als „strittig“ markiert
    expect(anzeige(t, 1, START + 33 * MIN)).toMatchObject({ zustand: 'frei', hinweis: 'strittig' });
  });

  it('Mannschaft: Begegnungsstand, laufendes Teilspiel mit Spielern, fehlende Aufstellung', () => {
    const t = new Baukasten(START);
    t.e(ART.turnierDaten, { tische: 2 });
    for (const x of ['a', 'b']) for (let i = 1; i <= 2; i++) t.spieler(`${x}${i}`, 1500, `TTC ${x}`);
    t.e(ART.konkurrenzAngelegt, { id: 'm', einst: { name: 'Mannschaft', art: 'mannschaft', modus: 'jgj', bestOf: 5, mannschaft: { ...standardMannschaft(), system: 'corbillon2', durchspielen: false, eigen: null } } });
    for (const x of ['a', 'b']) t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: `m-${x}${x}${x}${x}`, name: `Team ${x.toUpperCase()}`, verein: `TTC ${x}`, spieler: [`${x}1`, `${x}2`], fuehrer: `${x}1` });
    t.auslosen('m');
    t.starten('m', 'gruppen');
    const s = Object.values(t.z.konkurrenzen.m!.spiele)[0]!;
    t.e(ART.spielAufgerufen, { konkurrenz: 'm', spiel: s.id, tisch: 2 }, LEITUNG, START + 5 * MIN);
    let a = anzeige(t, 2, START + 6 * MIN);
    expect(a).toMatchObject({ zustand: 'laeuft', aufstellungFehlt: true, teilspiel: null });
    expect(a.a!.zahl).toBe(0);
    const [A, B] = s.a === 'm-aaaa' ? ['a', 'b'] : ['b', 'a'];
    t.e(ART.mannschaftAufgestellt, { konkurrenz: 'm', spiel: s.id, mannschaft: s.a, gegner: s.b, einzel: [`${A}1`, `${A}2`], doppel: [[`${A}1`, `${A}2`]] });
    t.e(ART.mannschaftAufgestellt, { konkurrenz: 'm', spiel: s.id, mannschaft: s.b, gegner: s.a, einzel: [`${B}1`, `${B}2`], doppel: [[`${B}1`, `${B}2`]] });
    t.e(ART.spielErgebnis, { konkurrenz: 'm', spiel: teilId(s.id, 1), a: s.a, b: s.b, ergebnis: saetze(5, 5, 5) });
    t.e(ART.spielErgebnis, { konkurrenz: 'm', spiel: teilId(s.id, 2), a: s.a, b: s.b, ergebnis: saetze(-5, -5, -5) });
    a = anzeige(t, 2, START + 50 * MIN);
    expect(a).toMatchObject({ zustand: 'laeuft', aufstellungFehlt: false, minuten: 45, hinweis: null });
    expect([a.a!.zahl, a.b!.zahl]).toEqual([1, 1]);
    // Corbillon-Cup: Teilspiel 3 ist das Doppel
    expect(a.teilspiel).toEqual({ nr: 3, art: 'doppel', a: `${A.toUpperCase()}1 Test / ${A.toUpperCase()}2 Test`, b: `${B.toUpperCase()}1 Test / ${B.toUpperCase()}2 Test` });
  });
});

describe('V-010: Tischanzeige – Uhrzeit', () => {
  it('ein gerade eingetragenes Ergebnis erscheint sofort, auch wenn die Anzeige-Uhr etwas zurückliegt', () => {
    const { t, s } = einzel();
    t.ergebnis('k', s.id, saetze(5, 5, 5), LEITUNG, START + 40 * MIN);
    const a = anzeige(t, 1, START + 40 * MIN - 10_000);
    expect(a.zuletzt?.id).toBe(s.id);
    expect(a.minuten).toBe(0);
  });
});
