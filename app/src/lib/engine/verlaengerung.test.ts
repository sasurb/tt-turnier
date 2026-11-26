import { it, expect } from 'vitest';
import { ergebnisText, ergebnisWerten, satzFehler, satzAusVerliererpunkten } from './ergebnis';

it.each([99, 100, 150])('F-001: gültige Verlängerung bei %i Verliererpunkten', (punkte) => {
  const satz = satzAusVerliererpunkten('b', punkte);
  expect(satz).toEqual([punkte, punkte + 2]);
  expect(satzFehler(...satz)).toBeNull();
  expect(satzFehler(punkte, punkte + 3)).toContain('genau 2');
});

it.each([null, 4])('F-002: beendeten Satz bei Aufgabe schützen, echte Verlängerung werten', (fest) => {
  const a = ergebnisWerten({ aufgabe: 'a', laufend: [12, 10] }, 5, 'punkte', fest);
  expect(a.ok).toBe(false);
  const b = ergebnisWerten({ aufgabe: 'a', laufend: [13, 12] }, 5, 'punkte', fest);
  expect(b).toMatchObject({ ok: true, ergebnis: { gewinner: 'b' } });
  if (b.ok) expect(b.ergebnis.saetze?.[0]).toEqual([13, 15]);
});

it('F-003: 3:1 Sätze für A, aber Spielsieg bei Aufgabe für B', () => {
  const w = ergebnisWerten({ saetze: [[11, 6], [11, 7], [11, 8]], laufend: [8, 3], aufgabe: 'a' }, 5, 'punkte', 4);
  expect(w).toMatchObject({ ok: true, ergebnis: { satzA: 3, satzB: 1, gewinner: 'b', art: 'aufgabe', saetze: [[11, 6], [11, 7], [11, 8], [8, 11]] } });
  if (w.ok) {
    expect(ergebnisText(w.ergebnis)).toContain('Aufgabe, zweite Seite gewinnt');
    expect(ergebnisText(w.ergebnis, 'a', 'Ben Schulz')).toContain('Aufgabe, Ben Schulz gewinnt');
  }
});
