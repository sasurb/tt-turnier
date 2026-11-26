import { expect, it } from 'vitest';
import { ART } from '@shared/protokoll';
import { Baukasten, HELFER, LEITUNG, saetze } from './test/baukasten';
import { nachTurnierende } from './zustand';

it.each([
  ['2026-12-06', '2026-12-06T22:59:59Z', '2026-12-06T23:00:00Z'],
  ['2026-07-05', '2026-07-05T21:59:59Z', '2026-07-05T22:00:00Z'],
])('V-002: letzter Tag in Europe/Berlin einschließlich %s', (ende, vor, nach) => {
  expect(nachTurnierende(ende, vor)).toBe(false);
  expect(nachTurnierende(ende, nach)).toBe(true);
  expect(nachTurnierende(null, nach)).toBe(false);
});

it('V-002: verspätete Meldung zählt erst nach Übernahme durch die Leitung', () => {
  const t = new Baukasten(Date.parse('2026-12-06T15:00:00Z'));
  t.spieler('anna');
  t.spieler('berta');
  t.konkurrenz('k', { modus: 'jgj' }, ['anna', 'berta']);
  t.auslosen('k');
  t.starten('k', 'gruppen');
  t.e(ART.turnierDaten, { enddatum: '2026-12-06' });
  const [spiel] = Object.values(t.z.konkurrenzen.k!.spiele);
  const nach = Date.parse('2026-12-06T23:05:00Z');
  t.ergebnis('k', spiel!.id, saetze(7, 7, 7), LEITUNG, nach);
  expect(t.z.warnungen.at(-1)?.text).toContain('Enddatum verlängern');
  const id = t.e(ART.spielErgebnisSpaet, { konkurrenz: 'k', spiel: spiel!.id, a: spiel!.a, b: spiel!.b, ergebnis: saetze(7, 7, 7) }, HELFER);
  t.e(ART.spielSpaetGeprueft, { ereignis: id, uebernehmen: true }, HELFER, nach);
  expect(t.z.spaeteErgebnisse).toHaveLength(1);
  expect(t.z.konkurrenzen.k!.spiele[spiel!.id]?.ergebnis).toBeNull();
  t.e(ART.spielSpaetGeprueft, { ereignis: id, uebernehmen: true }, LEITUNG, nach);
  expect(t.z.spaeteErgebnisse).toHaveLength(0);
  expect(t.z.konkurrenzen.k!.spiele[spiel!.id]?.gewinner).toBe('a');
});

it('V-002: bei einem Altturnier bleibt das bisherige Datum erhalten', () => {
  const t = new Baukasten(Date.parse('2026-12-06T15:00:00Z'));
  t.e(ART.turnierAngelegt, { name: 'Altturnier', datum: '2026-12-03' });
  expect(t.z.datum).toBe('2026-12-03');
  expect(t.z.enddatum).toBeNull();
  t.e(ART.turnierAbgeschlossen, {});
  expect(t.z.abgeschlossen).toBe(true);
  expect(t.z.enddatum).toBeNull();
});

it('V-002: Startdatum nach vorhandenem Enddatum wird abgewiesen', () => {
  const t = new Baukasten();
  t.e(ART.turnierAngelegt, { name: 'Turnier', datum: '2026-12-03' });
  t.e(ART.turnierDaten, { enddatum: '2026-12-06' });
  t.e(ART.turnierUmbenannt, { name: 'Turnier', datum: '2026-12-07' });
  expect(t.z.datum).toBe('2026-12-03');
  expect(t.z.enddatum).toBe('2026-12-06');
});
