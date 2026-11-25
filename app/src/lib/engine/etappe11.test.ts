import { standardMannschaft } from './mannschaft';
import { describe, expect, it } from 'vitest';
import { ART, type Autor } from '@shared/protokoll';
import { Baukasten, LEITUNG, saetze } from './test/baukasten';
import { begegnungAuswerten, bisSiege, folgeLesen, folgeText, SYSTEME, teileVon, teilId, zwischenstand } from './mannschaft';
import { tabelle } from './abfragen';
import { ergebnisText } from './ergebnis';
import { kassenListe } from './kasse';
import type { KonkurrenzEinstellungen } from './modell';

const spieler = (id: string, name = id): Autor => ({ rolle: 'spieler', name, spieler: id });

/** Turnier mit Mannschaften aus je `n` Spielern: m-aaaa (a1…), m-bbbb (b1…), … */
function turnier(teams: string[], n: number, einst: Partial<KonkurrenzEinstellungen>) {
  const t = new Baukasten();
  for (const x of teams) for (let i = 1; i <= n; i++) t.spieler(`${x}${i}`, 1500 - i * 10, `TTC ${x.toUpperCase()}`);
  t.e(ART.konkurrenzAngelegt, { id: 'm', einst: { name: 'Mannschaft', art: 'mannschaft', modus: 'jgj', bestOf: 5, startgeld: 500, ...einst } });
  for (const x of teams) {
    const sp = Array.from({ length: n }, (_, i) => `${x}${i + 1}`);
    t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: `m-${x}${x}${x}${x}`, name: `Team ${x.toUpperCase()}`, verein: `TTC ${x.toUpperCase()}`, spieler: sp, fuehrer: sp[0] });
  }
  return t;
}

function aufstellen(t: Baukasten, spiel: string, team: string, einzel: (string | null)[], doppel: ([string, string] | null)[], autor: Autor = LEITUNG) {
  const s = t.z.konkurrenzen.m!.spiele[spiel]!;
  return t.e(ART.mannschaftAufgestellt, { konkurrenz: 'm', spiel, mannschaft: team, gegner: s.a === team ? s.b : s.a, einzel, doppel }, autor);
}

function teilErgebnis(t: Baukasten, spiel: string, nr: number, e: ReturnType<typeof saetze>, autor: Autor = LEITUNG) {
  const s = t.z.konkurrenzen.m!.spiele[spiel]!;
  return t.e(ART.spielErgebnis, { konkurrenz: 'm', spiel: teilId(spiel, nr), a: s.a, b: s.b, ergebnis: e }, autor);
}

describe('Etappe 11: Mannschaftsturniere', () => {
  it('Spielsysteme nach WO E 6: Anzahl Spiele und Siegpunkt', () => {
    expect(SYSTEME.paarkreuz6.folge).toHaveLength(16);
    expect(bisSiege(SYSTEME.paarkreuz6)).toBe(9);
    expect(bisSiege(SYSTEME.bundes4)).toBe(6);
    expect(SYSTEME.scheffler4.folge).toHaveLength(14);
    expect(bisSiege(SYSTEME.scheffler4)).toBe(8);
    expect(bisSiege(SYSTEME.corbillon2)).toBe(3);
    expect(bisSiege(SYSTEME.olympisch3)).toBe(3);
    expect(bisSiege(SYSTEME.swaythling3)).toBe(5);
    expect(bisSiege(SYSTEME.swaythling_mod)).toBe(4);
    const f = folgeLesen('D1-D2, 1-2; 2–1\n3:3');
    expect(f).toEqual({ folge: [{ art: 'doppel', a: 1, b: 2 }, { art: 'einzel', a: 1, b: 2 }, { art: 'einzel', a: 2, b: 1 }, { art: 'einzel', a: 3, b: 3 }], einzel: 3, doppel: 2 });
    expect(folgeText(typeof f === 'string' ? [] : f.folge)).toBe('D1-D2, 1-2, 2-1, 3-3');
    expect(typeof folgeLesen('X-1')).toBe('string');
  });

  it('Corbillon-Cup: Aufstellung, Teilspiele, Entscheidung nach 3 Siegen, Tabelle mit Punkten 2:0', () => {
    const t = turnier(['a', 'b', 'c'], 2, { mannschaft: { ...standardMannschaft(), system: 'corbillon2', durchspielen: false, eigen: null } });
    t.auslosen('m');
    t.starten('m', 'gruppen');
    const k = t.z.konkurrenzen.m!;
    expect(k.meldungen).toEqual(['m-aaaa', 'm-bbbb', 'm-cccc']);
    const s = Object.values(k.spiele).find((x) => [x.a, x.b].includes('m-aaaa') && [x.a, x.b].includes('m-bbbb'))!;
    const [A, B] = s.a === 'm-aaaa' ? ['a', 'b'] : ['b', 'a'];
    // Ohne Aufstellung kein Ergebnis
    teilErgebnis(t, s.id, 1, saetze(5, 5, 5));
    expect(t.z.warnungen.at(-1)!.text).toMatch(/beide Aufstellungen/);
    aufstellen(t, s.id, s.a!, [`${A}1`, `${A}2`], [[`${A}1`, `${A}2`]]);
    expect(teileVon(t.z.konkurrenzen.m!, t.z.konkurrenzen.m!.spiele[s.id]!)[0]!.status).toBe('wartet');
    aufstellen(t, s.id, s.b!, [`${B}1`, `${B}2`], [[`${B}1`, `${B}2`]]);
    let teile = teileVon(t.z.konkurrenzen.m!, t.z.konkurrenzen.m!.spiele[s.id]!);
    expect(teile.map((x) => x.status)).toEqual(['offen', 'offen', 'offen', 'offen', 'offen']);
    expect(teile[0]!.a).toEqual([`${A}1`]);
    expect(teile[2]!.b).toEqual([`${B}1`, `${B}2`]);
    teilErgebnis(t, s.id, 1, saetze(5, 5, 5));
    teilErgebnis(t, s.id, 2, saetze(-5, 5, 5, 5));
    expect(t.z.konkurrenzen.m!.spiele[s.id]!.status).toBe('offen');
    teilErgebnis(t, s.id, 3, saetze(9, 9, 9));
    const nach = t.z.konkurrenzen.m!.spiele[s.id]!;
    expect(nach.status).toBe('gespielt');
    expect(nach.ergebnis!.spiele).toEqual([3, 0]);
    expect(nach.ergebnis!.satzA).toBe(9);
    expect(ergebnisText(nach.ergebnis!)).toBe('3:0 (9:1 Sätze)');
    teile = teileVon(t.z.konkurrenzen.m!, nach);
    expect(teile.slice(3).map((x) => x.status)).toEqual(['entfallen', 'entfallen']);
    const tab = tabelle(t.z.konkurrenzen.m!, 0);
    const sieger = tab.zeilen.find((z) => z.id === nach.a)!;
    expect(sieger.punkte).toBe(2);
    expect(sieger.spieleG).toBe(3);
    expect(tab.zeilen.find((z) => z.id === nach.b)!.minuspunkte).toBe(2);
    // Startgeld je Spieler der Mannschaft
    expect(kassenListe(t.z).find((x) => x.spieler === 'a1')!.soll).toBe(500);
  });

  it('Rechte: Mannschaftsführung stellt auf, Aufstellung danach fest, Spieler tragen eigene Spiele ein, Gegner bestätigt', () => {
    const t = turnier(['a', 'b'], 2, { mannschaft: { ...standardMannschaft(), system: 'corbillon2', durchspielen: false, eigen: null } });
    t.auslosen('m');
    t.starten('m', 'gruppen');
    const s = Object.values(t.z.konkurrenzen.m!.spiele)[0]!;
    const A = s.a === 'm-aaaa' ? 'a' : 'b';
    const B = A === 'a' ? 'b' : 'a';
    aufstellen(t, s.id, s.a!, [`${A}1`, `${A}2`], [[`${A}1`, `${A}2`]], spieler(`${A}2`));
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Mannschaftsführung/);
    aufstellen(t, s.id, s.a!, [`${A}1`, `${A}2`], [[`${A}1`, `${A}2`]], spieler(`${A}1`));
    aufstellen(t, s.id, s.b!, [`${B}1`, `${B}2`], [[`${B}1`, `${B}2`]], spieler(`${A}1`));
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Mannschaftsführung|spielt nicht/);
    aufstellen(t, s.id, s.b!, [`${B}2`, `${B}1`], [[`${B}1`, `${B}2`]], spieler(`${B}1`));
    expect(Object.keys(t.z.konkurrenzen.m!.begegnungen[s.id]!.aufstellung)).toHaveLength(2);
    // Nach der Aufdeckung ändert nur noch die Leitung (auch wer vorher nur Ungültiges eingereicht hat)
    aufstellen(t, s.id, s.a!, [`${A}2`, `${A}1`], [[`${A}1`, `${A}2`]], spieler(`${A}1`));
    expect(t.z.warnungen.at(-1)!.text).toMatch(/nur die Turnierleitung/);
    // Spiel 2: A2 gegen B1 (B hat getauscht). A1 spielt dort nicht, ist aber Mannschaftsführer → darf
    teilErgebnis(t, s.id, 2, saetze(5, 5, 5), spieler(`${A}2`));
    let teil = teileVon(t.z.konkurrenzen.m!, t.z.konkurrenzen.m!.spiele[s.id]!)[1]!;
    expect(teil.stand).toBe('eingetragen');
    // B2 spielt Spiel 2 nicht und ist nicht Führer → abgelehnt
    t.e(ART.spielBestaetigt, { konkurrenz: 'm', spiel: teilId(s.id, 2), ereignis: teil.eintrag!.ereignis }, spieler(`${B}2`));
    expect(t.z.warnungen.at(-1)!.text).toMatch(/nur eigene Spiele/);
    t.e(ART.spielBestaetigt, { konkurrenz: 'm', spiel: teilId(s.id, 2), ereignis: teil.eintrag!.ereignis }, spieler(`${B}1`));
    teil = teileVon(t.z.konkurrenzen.m!, t.z.konkurrenzen.m!.spiele[s.id]!)[1]!;
    expect(teil.stand).toBe('bestaetigt');
    // Führer A1 trägt Spiel 4 ein, in dem er nicht spielt (A1–B2 … nein: 4 = A1 gegen Position B2) – erlaubt
    teilErgebnis(t, s.id, 3, saetze(5, 5, 5), spieler(`${A}1`));
    expect(teileVon(t.z.konkurrenzen.m!, t.z.konkurrenzen.m!.spiele[s.id]!)[2]!.stand).toBe('eingetragen');
    // Direktes Ergebnis auf die Begegnung ist nicht erlaubt
    t.e(ART.spielErgebnis, { konkurrenz: 'm', spiel: s.id, a: s.a, b: s.b, ergebnis: saetze(5, 5, 5) });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/einzelnen Spiele/);
  });

  it('Sperre gegen Nachbessern: ungültige erste Abgabe, dann gültige nach der des Gegners → abgelehnt', () => {
    const t = turnier(['a', 'b'], 2, { mannschaft: { ...standardMannschaft(), system: 'corbillon2', durchspielen: false, eigen: null } });
    t.auslosen('m');
    t.starten('m', 'gruppen');
    const s = Object.values(t.z.konkurrenzen.m!.spiele)[0]!;
    const A = s.a === 'm-aaaa' ? 'a' : 'b';
    const B = A === 'a' ? 'b' : 'a';
    aufstellen(t, s.id, s.a!, [], [], spieler(`${A}1`));
    expect(t.z.warnungen.at(-1)!.text).toMatch(/leer/);
    aufstellen(t, s.id, s.b!, [`${B}1`, `${B}2`], [[`${B}1`, `${B}2`]], spieler(`${B}1`));
    aufstellen(t, s.id, s.a!, [`${A}1`, `${A}2`], [[`${A}1`, `${A}2`]], spieler(`${A}1`));
    expect(t.z.warnungen.at(-1)!.text).toMatch(/nur die Turnierleitung/);
    // Spieler mit Helferrecht der Gegenseite darf nicht für A aufstellen
    const t2 = turnier(['a', 'b'], 2, { mannschaft: { ...standardMannschaft(), system: 'corbillon2', durchspielen: false, eigen: null } });
    t2.auslosen('m');
    t2.starten('m', 'gruppen');
    const s2 = Object.values(t2.z.konkurrenzen.m!.spiele)[0]!;
    t2.e(ART.mannschaftAufgestellt, { konkurrenz: 'm', spiel: s2.id, mannschaft: 'm-aaaa', gegner: 'm-bbbb', einzel: ['a1', 'a2'] }, { rolle: 'spieler', name: 'B2', spieler: 'b2', helfer: true });
    expect(t2.z.warnungen.at(-1)!.text).toMatch(/Mannschaftsführung/);
    // Falscher Gegner
    t.e(ART.mannschaftAufgestellt, { konkurrenz: 'm', spiel: s.id, mannschaft: s.a, gegner: 'm-zzzz', einzel: [`${A}1`] }, LEITUNG);
    expect(t.z.warnungen.at(-1)!.text).toMatch(/falschen Gegner/);
    aufstellen(t, s.id, s.a!, [`${A}1`, `${A}2`], [[`${A}1`, `${A}2`]]);
    expect(Object.keys(t.z.konkurrenzen.m!.begegnungen[s.id]!.aufstellung)).toHaveLength(2);
  });

  it('Unbesetzte Position geht kampflos an den Gegner; Unentschieden in der Gruppe 1:1 Punkte', () => {
    const t = turnier(['a', 'b'], 4, { mannschaft: { ...standardMannschaft(), system: 'bundes4', durchspielen: true, eigen: null } });
    t.auslosen('m');
    t.starten('m', 'gruppen');
    const s = Object.values(t.z.konkurrenzen.m!.spiele)[0]!;
    const [A, B] = s.a === 'm-aaaa' ? ['a', 'b'] : ['b', 'a'];
    aufstellen(t, s.id, s.a!, [`${A}1`, `${A}2`, `${A}3`, null], [[`${A}1`, `${A}2`], [`${A}3`, `${A}4`]]);
    aufstellen(t, s.id, s.b!, [`${B}1`, `${B}2`, `${B}3`, `${B}4`], [[`${B}1`, `${B}2`], [`${B}3`, `${B}4`]]);
    const k = t.z.konkurrenzen.m!;
    const teile = teileVon(k, k.spiele[s.id]!);
    // Spiele mit Position A4: Nr. 6 (A4–B3) und Nr. 10 (A4–B4)
    expect(teile[5]!.status).toBe('kampflos');
    expect(teile[5]!.gewinner).toBe('b');
    expect(teile[9]!.status).toBe('kampflos');
    // Restliche 8 Spiele: A gewinnt 5, B gewinnt 3 → 5:5
    const offen = teile.filter((x) => x.status === 'offen').map((x) => x.nr);
    expect(offen).toHaveLength(8);
    offen.forEach((nr, i) => teilErgebnis(t, s.id, nr, i < 5 ? saetze(5, 5, 5) : saetze(-5, -5, -5)));
    const nach = t.z.konkurrenzen.m!.spiele[s.id]!;
    expect(nach.status).toBe('gespielt');
    expect(nach.ergebnis!.spiele).toEqual([5, 5]);
    expect(nach.ergebnis!.gewinner).toBeNull();
    const tab = tabelle(t.z.konkurrenzen.m!, 0);
    expect(tab.zeilen.map((z) => [z.punkte, z.minuspunkte, z.unentschieden])).toEqual([
      [1, 1, 1],
      [1, 1, 1],
    ]);
    expect(zwischenstand(teileVon(t.z.konkurrenzen.m!, nach)).gespielt).toBe(10);
  });

  it('K.-o.: Gleichstand nach Sätzen entschieden, sonst Los der Leitung; Folgespiel sperrt Änderungen', () => {
    const t = turnier(['a', 'b', 'c', 'd'], 2, { modus: 'ko', mannschaft: { ...standardMannschaft(), system: 'eigen', durchspielen: true, eigen: { einzel: 2, doppel: 0, folge: [{ art: 'einzel', a: 1, b: 1 }, { art: 'einzel', a: 2, b: 2 }] } } });
    t.auslosen('m');
    t.starten('m', 'ko');
    const k = t.z.konkurrenzen.m!;
    const erste = Object.values(k.spiele).filter((s) => s.runde === 1 && s.a && s.b);
    expect(erste).toHaveLength(2);
    for (const s of erste) {
      const aufA = k.mannschaften[s.a!]!.spieler;
      const aufB = k.mannschaften[s.b!]!.spieler;
      aufstellen(t, s.id, s.a!, aufA, []);
      aufstellen(t, s.id, s.b!, aufB, []);
    }
    const [s1, s2] = erste;
    // 1:1, A mehr Sätze → A weiter
    teilErgebnis(t, s1!.id, 1, saetze(5, 5, 5));
    teilErgebnis(t, s1!.id, 2, saetze(-5, -5, 5, -5));
    expect(t.z.konkurrenzen.m!.spiele[s1!.id]!.gewinner).toBe('a');
    // 1:1 mit gleichen Sätzen und Bällen → Los nötig
    teilErgebnis(t, s2!.id, 1, saetze(5, 5, 5));
    teilErgebnis(t, s2!.id, 2, saetze(-5, -5, -5));
    const b2 = t.z.konkurrenzen.m!.spiele[s2!.id]!;
    expect(b2.status).toBe('offen');
    expect(begegnungAuswerten(t.z.konkurrenzen.m!, b2).losNoetig).toBe(true);
    t.e(ART.mannschaftLos, { konkurrenz: 'm', spiel: s2!.id, sieger: b2.b });
    expect(t.z.konkurrenzen.m!.spiele[s2!.id]!.gewinner).toBe('b');
    const finale = Object.values(t.z.konkurrenzen.m!.spiele).find((s) => s.runde === 2)!;
    expect(finale.a).toBe(s1!.a);
    expect(finale.b).toBe(b2.b);
    // Finale aufstellen und spielen; danach lässt sich Runde 1 nicht mehr umdrehen
    aufstellen(t, finale.id, finale.a!, k.mannschaften[finale.a!]!.spieler, []);
    aufstellen(t, finale.id, finale.b!, t.z.konkurrenzen.m!.mannschaften[finale.b!]!.spieler, []);
    teilErgebnis(t, finale.id, 1, saetze(5, 5, 5));
    teilErgebnis(t, s1!.id, 1, saetze(-5, -5, -5));
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Folgespiel/);
    expect(t.z.konkurrenzen.m!.spiele[s1!.id]!.gewinner).toBe('a');
  });

  it('Mannschaft ändern: neue Spieler ja, wer schon gespielt hat, bleibt', () => {
    const t = turnier(['a', 'b'], 2, { mannschaft: { ...standardMannschaft(), system: 'corbillon2', durchspielen: false, eigen: null } });
    t.spieler('a3');
    t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: 'm-aaaa', name: 'Team A neu', verein: 'TTC A', spieler: ['a1', 'a2', 'a3'], fuehrer: 'a3' });
    expect(t.z.konkurrenzen.m!.mannschaften['m-aaaa']).toMatchObject({ name: 'Team A neu', fuehrer: 'a3' });
    // Spieler in zwei Mannschaften derselben Konkurrenz: abgelehnt
    t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: 'm-bbbb', name: 'Team B', verein: '', spieler: ['b1', 'a1'], fuehrer: null });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/schon in einer anderen Mannschaft/);
    t.auslosen('m');
    t.starten('m', 'gruppen');
    const s = Object.values(t.z.konkurrenzen.m!.spiele)[0]!;
    aufstellen(t, s.id, 'm-aaaa', ['a1', 'a2'], [['a1', 'a2']]);
    aufstellen(t, s.id, 'm-bbbb', ['b1', 'b2'], [['b1', 'b2']]);
    teilErgebnis(t, s.id, 1, saetze(5, 5, 5));
    t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: 'm-aaaa', name: 'Team A', verein: 'TTC A', spieler: ['a2', 'a3'], fuehrer: 'a3' });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/schon gespielt/);
    // Spieler einer Mannschaft lässt sich nicht entfernen, wenn die Konkurrenz läuft
    t.e(ART.spielerEntfernt, { id: 'a1' });
    expect(t.z.spieler.a1).toBeDefined();
    // Paare melden geht in einer Mannschafts-Konkurrenz nicht
    t.e(ART.paarGemeldet, { konkurrenz: 'm', id: 'p-xxxx', spieler: ['a3', 'b2'] });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Mannschaften gemeldet/);
  });
});
