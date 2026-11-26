import { describe, expect, it } from 'vitest';
import { ART, type Autor } from '@shared/protokoll';
import { Baukasten, LEITUNG, saetze } from './test/baukasten';
import { auswahlFolgen, auswahlPruefen, angeboten, modiFuerArt, ohneKonkurrenz } from './auswahl';
import { automatischeAufrufe, endstand, gesamtPlatzierung, platzierungen, rundeVon, tabelle, tische } from './abfragen';
import { braunschweigFolge, standardMannschaft, SYSTEME, teileVon, teilId } from './mannschaft';
import { appWertungen } from './appwertung';
import { einstFuer, gruppeTitel, standardEinstellungen, type KonkurrenzEinstellungen } from './modell';
import { platzGruppenBilden, rueckzugZuruecknehmenPruefen, zurueckgezogen } from './zustand';
import { zeitplan } from './zeitplan';

const sieg = saetze(5, 5, 5);
const niederlage = saetze(-5, -5, -5);

/** Alle offenen Spiele: der in `ids` weiter vorn Stehende gewinnt */
function allesSpielen(t: Baukasten, k: string, ids: string[], saetzeZumSieg = 3) {
  const w = saetze(...Array.from({ length: saetzeZumSieg }, () => 5));
  const l = saetze(...Array.from({ length: saetzeZumSieg }, () => -5));
  for (const s of Object.values(t.z.konkurrenzen[k]!.spiele)) {
    if (s.status !== 'offen') continue;
    t.ergebnis(k, s.id, ids.indexOf(s.a!) < ids.indexOf(s.b!) ? w : l);
  }
}

describe('0.16: Konkurrenzarten und Spielsysteme des Turniers', () => {
  it('turnier.daten speichert Auswahl und Klassen-Vorgabe; Ungültiges bleibt ohne Wirkung', () => {
    const t = new Baukasten();
    expect(angeboten(t.z).arten).toEqual(['einzel', 'doppel', 'mixed', 'mannschaft']);
    t.e(ART.turnierDaten, { konkurrenzarten: { arten: ['doppel', 'einzel', 'quatsch'], modi: ['ko', 'gruppen_platz'] }, klassenVorgabe: { nach: 'ttr', grenzen: [1500, 1200, 1200, 99999] } });
    expect(t.z.konkurrenzarten).toEqual({ arten: ['einzel', 'doppel'], modi: ['gruppen_platz', 'ko'] });
    expect(t.z.klassenVorgabe).toEqual({ nach: 'ttr', grenzen: [1200, 1500] });
    t.e(ART.turnierDaten, { konkurrenzarten: { arten: [], modi: ['ko'] } });
    expect(t.z.konkurrenzarten!.arten).toEqual(['einzel', 'doppel']);
    t.e(ART.turnierDaten, { konkurrenzarten: { arten: ['einzel'], modi: ['ko'] } }, { rolle: 'spieler', name: 'X', spieler: 'x' });
    expect(t.z.konkurrenzarten!.modi).toEqual(['gruppen_platz', 'ko']);
    t.e(ART.turnierDaten, { konkurrenzarten: null });
    expect(t.z.konkurrenzarten).toBeNull();
  });

  it('Prüfung: Mannschaft braucht ein passendes Spielsystem', () => {
    expect(auswahlPruefen({ arten: [], modi: ['ko'] })).toMatch(/Konkurrenzart/);
    expect(auswahlPruefen({ arten: ['einzel'], modi: [] })).toMatch(/Spielsystem/);
    expect(auswahlPruefen({ arten: ['mannschaft'], modi: ['schweizer'] })).toMatch(/Mannschaften/);
    expect(auswahlPruefen({ arten: ['mannschaft'], modi: ['gruppen_platz'] })).toBeNull();
    expect(modiFuerArt({ modi: ['schweizer', 'ko', 'gruppen_platz'] }, 'mannschaft')).toEqual(['gruppen_platz', 'ko']);
  });

  it('Abwählen: Konkurrenzen der Art werden gelöscht, Spieler ohne Konkurrenz erkannt, laufende gesperrt', () => {
    const t = new Baukasten();
    for (const id of ['a', 'b', 'c', 'd']) t.spieler(id, 1500);
    t.konkurrenz('e', { modus: 'jgj' }, ['a', 'b']);
    t.e(ART.konkurrenzAngelegt, { id: 'd', einst: { ...standardEinstellungen('Doppel'), art: 'doppel', modus: 'ko' } });
    t.e(ART.paarGemeldet, { konkurrenz: 'd', id: 'p-cdcd', spieler: ['c', 'd'] });
    t.e(ART.paarGemeldet, { konkurrenz: 'd', id: 'p-abab', spieler: ['a', 'b'] });
    expect(ohneKonkurrenz(t.z)).toEqual([]);
    const f = auswahlFolgen(t.z, { arten: ['einzel'], modi: ['ko', 'jgj'] });
    expect(f.entfernen).toEqual(['d']);
    expect(f.ohneKonkurrenz).toEqual(['c', 'd']);
    expect(f.gesperrt).toEqual([]);
    // Spielsystem abgewählt: noch nicht gestartete Konkurrenz wird umgestellt
    const g = auswahlFolgen(t.z, { arten: ['einzel', 'doppel'], modi: ['ko'] });
    expect(g.umstellen).toEqual([{ id: 'e', nach: 'ko' }]);
    // Gestartet mit Ergebnis: weder Art noch System abwählbar
    t.auslosen('e');
    t.starten('e', 'gruppen');
    t.ergebnis('e', Object.keys(t.z.konkurrenzen.e!.spiele)[0]!, sieg);
    expect(auswahlFolgen(t.z, { arten: ['doppel'], modi: ['ko', 'jgj'] }).gesperrt).toHaveLength(1);
    expect(auswahlFolgen(t.z, { arten: ['einzel', 'doppel'], modi: ['ko'] }).gesperrt).toHaveLength(1);
    // Löschen wie die Oberfläche: danach stehen c und d in keiner Konkurrenz
    t.e(ART.konkurrenzEntfernt, { id: 'd' });
    expect(ohneKonkurrenz(t.z)).toEqual(['c', 'd']);
  });
});

describe('0.16: Gruppen + Platzierungsgruppen', () => {
  const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  function vorrunde(einst: Partial<KonkurrenzEinstellungen> = {}) {
    const t = new Baukasten();
    ids.forEach((id, i) => t.spieler(id, 2000 - i * 50, `V${i}`));
    t.konkurrenz('k', { modus: 'gruppen_platz', gruppenGroesse: 4, aufsteiger: 2, bestOf: 3, endrunde: { bestOf: 5, mannschaft: null }, ...einst }, ids);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    return t;
  }

  it('F-017: Vakanz behält die Qualifikationsgrenze bei und erhält den Rückzug beim Zurücknehmen', () => {
    const t = vorrunde();
    allesSpielen(t, 'k', ids, 2);
    const vorher = platzGruppenBilden(t.z.konkurrenzen.k!);
    if (!vorher.ok) throw new Error(vorher.grund);
    const id = vorher.gruppen[0]!.mitglieder[0]!;
    t.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'k', id });
    const k = t.z.konkurrenzen.k!;
    const vakanz = platzGruppenBilden(k, true);
    if (!vakanz.ok) throw new Error(vakanz.grund);
    expect(vakanz.gruppen.map((g) => g.mitglieder)).toEqual(vorher.gruppen.map((g) => g.mitglieder.filter((x) => x !== id)));
    expect(platzGruppenBilden(k)).not.toEqual(vakanz);
    t.e(ART.phaseGestartet, { konkurrenz: 'k', phase: 'ko', rueckzugUebergang: 'vakanz', gruppen: vakanz.gruppen.map((g) => g.mitglieder) });
    expect(t.z.konkurrenzen.k!.gestartet.ko).toBe(true);
    t.e(ART.phaseZurueck, { konkurrenz: 'k', phase: 'ko' });
    expect(zurueckgezogen(t.z.konkurrenzen.k!)).toContain(id);
  });

  it('Vorrunde 2 Gruppen à 4, dann Plätze 1–4 und 5–8 neu jeder gegen jeden, Gesamtplatzierung 1–8', () => {
    const t = vorrunde();
    let k = t.z.konkurrenzen.k!;
    expect(k.gruppen).toHaveLength(2);
    expect(Object.keys(k.spiele)).toHaveLength(12);
    expect(platzGruppenBilden(k)).toMatchObject({ ok: false });
    allesSpielen(t, 'k', ids, 2);
    k = t.z.konkurrenzen.k!;
    const plan = platzGruppenBilden(k);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.gruppen.map((g) => [g.platzAb, g.mitglieder.length])).toEqual([[1, 4], [5, 4]]);
    // Erste und Zweite beider Gruppen spielen um Platz 1–4
    const gA = tabelle(k, 0).zeilen.map((r) => r.id);
    const gB = tabelle(k, 1).zeilen.map((r) => r.id);
    expect(plan.gruppen[0]!.mitglieder).toEqual([gA[0], gB[0], gA[1], gB[1]]);
    expect(plan.gruppen[1]!.mitglieder).toEqual([gA[2], gB[2], gA[3], gB[3]]);
    // Falsche Einteilung im Ereignis wird verworfen
    t.e(ART.phaseGestartet, { konkurrenz: 'k', phase: 'ko', gruppen: [[gA[0]], [gB[0]]] });
    expect(t.z.konkurrenzen.k!.gestartet.ko).toBe(false);
    expect(t.z.warnungen.at(-1)!.text).toMatch(/passen nicht/);
    t.e(ART.phaseGestartet, { konkurrenz: 'k', phase: 'ko', gruppen: plan.gruppen.map((g) => g.mitglieder) });
    k = t.z.konkurrenzen.k!;
    expect(k.gestartet.ko).toBe(true);
    expect(k.status).toBe('ko');
    expect(k.gruppen.map((g) => gruppeTitel(k, g.nr))).toEqual(['Gruppe A', 'Gruppe B', 'Plätze 1–4', 'Plätze 5–8']);
    const haupt = Object.values(k.spiele).filter((s) => (s.gruppe ?? 0) >= 2);
    expect(haupt).toHaveLength(12);
    expect(rundeVon(k, haupt[0]!)).toMatch(/^Plätze (1–4|5–8) · Runde 1$/);
    // Zweite Stufe mit 3 Gewinnsätzen: 3:0 nötig, 2:0 ungültig
    expect(einstFuer(k, haupt[0]!).bestOf).toBe(5);
    expect(einstFuer(k, k.spiele[Object.keys(k.spiele)[0]!]!).bestOf).toBe(3);
    t.ergebnis('k', haupt[0]!.id, saetze(5, 5));
    expect(t.z.warnungen.at(-1)!.text).toMatch(/ungültig/);
    // Wiedersehen aus der Vorrunde ist ein neues Spiel (eigene ID), Vorrunden-Ergebnis zählt nicht mit
    expect(haupt.some((s) => s.a === gA[0] && s.b === gA[1])).toBe(true);
    expect(gesamtPlatzierung(k)).toEqual([]);
    for (const s of haupt) t.ergebnis('k', s.id, ids.indexOf(s.a!) < ids.indexOf(s.b!) ? saetze(5, 5, 5) : saetze(-5, -5, -5));
    k = t.z.konkurrenzen.k!;
    expect(k.status).toBe('beendet');
    const gesamt = gesamtPlatzierung(k);
    expect(gesamt.map((x) => x.platz)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(gesamt[0]!.id).toBe('s1');
    expect(endstand(k).map((x) => x.bezeichnung)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(platzierungen(k)[4]!.bezeichnung).toBe('5.');
    expect(t.z.warnungen.filter((w) => !/ungültig|passen nicht/.test(w.text))).toEqual([]);
  });

  it('Start der Platzierungsrunde lässt sich zurücknehmen, solange dort nichts gespielt ist; Rückzug dort ändert die Vorrunde nicht', () => {
    const t = vorrunde({ endrunde: null });
    allesSpielen(t, 'k', ids, 2);
    const plan = platzGruppenBilden(t.z.konkurrenzen.k!);
    if (!plan.ok) throw new Error('kein Plan');
    t.e(ART.phaseGestartet, { konkurrenz: 'k', phase: 'ko', gruppen: plan.gruppen.map((g) => g.mitglieder) });
    t.e(ART.phaseZurueck, { konkurrenz: 'k', phase: 'ko' });
    let k = t.z.konkurrenzen.k!;
    expect(k.gestartet.ko).toBe(false);
    expect(k.gruppen).toHaveLength(2);
    expect(Object.keys(k.spiele)).toHaveLength(12);
    t.e(ART.phaseGestartet, { konkurrenz: 'k', phase: 'ko', gruppen: plan.gruppen.map((g) => g.mitglieder) });
    const vorher = tabelle(t.z.konkurrenzen.k!, 0).zeilen.map((r) => [r.id, r.siege]);
    const wer = plan.gruppen[0]!.mitglieder[0]!;
    t.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'k', id: wer });
    k = t.z.konkurrenzen.k!;
    expect(zurueckgezogen(k)).toContain(wer);
    expect(zurueckgezogen(k, true)).not.toContain(wer);
    expect(tabelle(k, 0).zeilen.map((r) => [r.id, r.siege])).toEqual(vorher);
    expect(Object.values(k.spiele).filter((s) => s.gruppe === 2 && (s.a === wer || s.b === wer)).every((s) => s.gestrichen)).toBe(true);
  });

  it('Rückzug aus der Vorrunde lässt sich nicht mehr zurücknehmen, wenn die Platzierungsrunde läuft', () => {
    const t = vorrunde({ endrunde: null });
    t.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'k', id: 's8' });
    allesSpielen(t, 'k', ids, 2);
    expect(rueckzugZuruecknehmenPruefen(t.z.konkurrenzen.k!, 's8')).toBeNull();
    const plan = platzGruppenBilden(t.z.konkurrenzen.k!);
    if (!plan.ok) throw new Error('kein Plan');
    expect(plan.gruppen.flatMap((g) => g.mitglieder)).not.toContain('s8');
    t.e(ART.phaseGestartet, { konkurrenz: 'k', phase: 'ko', gruppen: plan.gruppen.map((g) => g.mitglieder) });
    expect(rueckzugZuruecknehmenPruefen(t.z.konkurrenzen.k!, 's8')).toMatch(/Vorrunde/);
  });

  it('SIM-TTT-001 T-06 / F-017: C12-Rückzug lässt C11 und C21 unten gegeneinander spielen', () => {
    const t = new Baukasten();
    const teamId = (name: string) => `m-${name.toLowerCase()}x`;
    const gruppen = [['C11', 'C12', 'C13'], ['C21', 'C22', 'C23']];
    const name = (id: string) => id.slice(2, -1).toUpperCase();
    const kader = (id: string) => [name(id).toLowerCase() + 'a', name(id).toLowerCase() + 'b'];
    t.konkurrenz('c', {
      art: 'mannschaft', modus: 'gruppen_platz', gruppenGroesse: 3, aufsteiger: 2,
      mannschaft: { ...standardMannschaft(), system: 'zweier3', durchspielen: false, eigen: null },
      endrunde: { bestOf: null, mannschaft: { ...standardMannschaft(), system: 'corbillon2', durchspielen: false, eigen: null } },
    }, []);
    for (const n of gruppen.flat()) {
      const id = teamId(n);
      const spieler = kader(id);
      for (const p of spieler) t.spieler(p);
      t.e(ART.mannschaftGemeldet, { konkurrenz: 'c', id, name: n, spieler, fuehrer: spieler[0] });
    }
    t.e(ART.auslosung, { konkurrenz: 'c', phase: 'gruppen', zufall: 1, gruppen: gruppen.map((g) => g.map(teamId)) });
    t.starten('c', 'gruppen');
    expect(t.z.warnungen.map((w) => w.text)).toEqual([]);
    // Begegnungsergebnisse aus SIM-TTT-001, S. 11. Satzpunkte je Teilspiel sind Testwerte.
    const ergebnisse: Record<string, number[]> = {
      'C11-C12': [1, 2], 'C11-C13': [1, 2], 'C12-C13': [1, 2],
      'C21-C22': [0, 2], 'C21-C23': [1, 2], 'C22-C23': [0, 2],
    };
    for (const s of Object.values(t.z.konkurrenzen.c!.spiele)) {
      const a = s.a!;
      const b = s.b!;
      for (const [mannschaft, gegner] of [[a, b], [b, a]] as const) {
        const einzel = kader(mannschaft);
        t.e(ART.mannschaftAufgestellt, { konkurrenz: 'c', spiel: s.id, mannschaft, gegner, einzel, doppel: [einzel] });
      }
      const paarung = [name(a), name(b)].sort();
      const [links, rechts] = ergebnisse[paarung.join('-')]!;
      const linkeSiege = [...Array(links).fill(true), ...Array(rechts).fill(false)];
      for (const [i, linksSiegt] of linkeSiege.entries()) {
        const ergebnis = linksSiegt === (name(a) === paarung[0]) ? sieg : niederlage;
        t.e(ART.spielErgebnis, { konkurrenz: 'c', spiel: teilId(s.id, i + 1), a, b, ergebnis });
      }
      expect(t.z.konkurrenzen.c!.spiele[s.id]?.status).toBe('gespielt');
    }
    expect(Object.values(t.z.konkurrenzen.c!.spiele)).toHaveLength(6);
    t.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'c', id: teamId('C12') });
    const plan = platzGruppenBilden(t.z.konkurrenzen.c!, true);
    if (!plan.ok) throw new Error(plan.grund);
    expect(plan.gruppen.map((g) => g.mitglieder.map(name).sort())).toEqual([['C13', 'C22', 'C23'], ['C11', 'C21']]);
    t.e(ART.phaseGestartet, { konkurrenz: 'c', phase: 'ko', rueckzugUebergang: 'vakanz', gruppen: plan.gruppen.map((g) => g.mitglieder) });
    const unterePaarung = Object.values(t.z.konkurrenzen.c!.spiele).find((s) =>
      s.a && s.b && !s.gestrichen && [name(s.a), name(s.b)].sort().join('-') === 'C11-C21'
    );
    expect(unterePaarung?.status).toBe('offen');
  });

  it('Mannschaften wie beim TTT: Vorrunde Zweier-System, Platzierungsrunde Corbillon-Cup', () => {
    const t = new Baukasten();
    const teams = ['a', 'b', 'c', 'd'];
    for (const x of teams) for (let i = 1; i <= 2; i++) t.spieler(`${x}${i}`, 1500);
    t.e(ART.konkurrenzAngelegt, {
      id: 'm',
      einst: { ...standardEinstellungen('TTT'), art: 'mannschaft', modus: 'gruppen_platz', gruppenGroesse: 4, aufsteiger: 2, mannschaft: { system: 'zweier3', durchspielen: false, eigen: null }, endrunde: { bestOf: null, mannschaft: { system: 'corbillon2', durchspielen: false, eigen: null } } },
    });
    for (const x of teams) t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: `m-${x}${x}${x}${x}`, name: x.toUpperCase(), spieler: [`${x}1`, `${x}2`], fuehrer: `${x}1` });
    t.e(ART.auslosung, { konkurrenz: 'm', phase: 'gruppen', zufall: 1, gruppen: [['m-aaaa', 'm-bbbb'], ['m-cccc', 'm-dddd']] });
    t.starten('m', 'gruppen');
    const k = t.z.konkurrenzen.m!;
    const s = Object.values(k.spiele)[0]!;
    expect(teileVon(k, s)).toHaveLength(3);
    expect(einstFuer(k, s).mannschaft!.system).toBe('zweier3');
    expect(einstFuer(k, { phase: 'gruppen', gruppe: 2 }).mannschaft!.system).toBe('zweier3'); // Gruppe 2 gibt es noch nicht
  });
});

describe('0.16: Mannschafts-Spielsysteme', () => {
  it('Braunschweiger System: Spielfolge je nach 3er/4er, immer 10 Spiele, durchgespielt, 5:5 möglich', () => {
    expect(SYSTEME.braunschweig.folge).toHaveLength(10);
    for (const [a, b] of [[false, false], [true, false], [false, true], [true, true]] as const) expect(braunschweigFolge(a, b)).toHaveLength(10);
    expect(braunschweigFolge(true, true).filter((f) => f.art === 'doppel')).toHaveLength(2);
    expect(braunschweigFolge(true, false).filter((f) => f.art === 'doppel')).toHaveLength(1);
    expect(braunschweigFolge(true, false)[4]).toEqual({ art: 'einzel', a: 4, b: 2 });
    const t = new Baukasten();
    for (const x of ['a', 'b']) for (let i = 1; i <= 4; i++) t.spieler(`${x}${i}`, 1500);
    t.e(ART.konkurrenzAngelegt, { id: 'm', einst: { ...standardEinstellungen('Liga'), art: 'mannschaft', modus: 'jgj', mannschaft: { system: 'braunschweig', durchspielen: false, eigen: null } } });
    for (const x of ['a', 'b']) t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: `m-${x}${x}${x}${x}`, name: x, spieler: [1, 2, 3, 4].map((i) => `${x}${i}`), fuehrer: `${x}1` });
    t.auslosen('m');
    t.starten('m', 'gruppen');
    const s = Object.values(t.z.konkurrenzen.m!.spiele)[0]!;
    const auf = (team: string, x: string, vier: boolean) =>
      t.e(ART.mannschaftAufgestellt, { konkurrenz: 'm', spiel: s.id, mannschaft: team, gegner: team === s.a ? s.b : s.a, einzel: [`${x}1`, `${x}2`, `${x}3`, vier ? `${x}4` : null], doppel: [[`${x}1`, `${x}2`], vier ? [`${x}3`, `${x}4`] : null] });
    const xa = s.a === 'm-aaaa' ? 'a' : 'b';
    const xb = xa === 'a' ? 'b' : 'a';
    auf(s.a!, xa, true);
    auf(s.b!, xb, false);
    let teile = teileVon(t.z.konkurrenzen.m!, t.z.konkurrenzen.m!.spiele[s.id]!);
    expect(teile.map((x) => `${x.art[0]}${x.posA}-${x.posB}`)).toEqual(['d1-1', 'e3-3', 'e1-2', 'e2-1', 'e4-2', 'e1-1', 'e4-3', 'e2-2', 'e1-3', 'e3-1']);
    expect(teile.every((x) => x.status === 'offen')).toBe(true);
    // Sechs Siege für A: Begegnung läuft trotzdem weiter (immer 10 Spiele)
    for (let nr = 1; nr <= 6; nr++) t.e(ART.spielErgebnis, { konkurrenz: 'm', spiel: teilId(s.id, nr), a: s.a, b: s.b, ergebnis: saetze(5, 5, 5) });
    teile = teileVon(t.z.konkurrenzen.m!, t.z.konkurrenzen.m!.spiele[s.id]!);
    expect(teile.slice(6).every((x) => x.status === 'offen')).toBe(true);
    // 3er/4er lässt sich nach dem ersten Spiel nicht mehr ändern
    t.e(ART.mannschaftAufgestellt, { konkurrenz: 'm', spiel: s.id, mannschaft: s.b, gegner: s.a, einzel: [`${xb}1`, `${xb}2`, `${xb}3`, `${xb}4`], doppel: [[`${xb}1`, `${xb}2`], null] });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Dreier- oder Vierermannschaft/);
    for (let nr = 7; nr <= 10; nr++) t.e(ART.spielErgebnis, { konkurrenz: 'm', spiel: teilId(s.id, nr), a: s.a, b: s.b, ergebnis: saetze(-5, -5, -5) });
    const b = t.z.konkurrenzen.m!.spiele[s.id]!;
    expect(b.status).toBe('gespielt');
    expect(b.ergebnis!.spiele).toEqual([6, 4]);
  });
});

describe('0.16: Rückzug zurücknehmen', () => {
  it('Gruppe: zurückgezogener Spieler spielt wieder mit, offene Spiele sind wieder offen', () => {
    const t = new Baukasten();
    for (const id of ['a', 'b', 'c']) t.spieler(id, 1500);
    t.konkurrenz('k', { modus: 'jgj', rueckzug: 'hobby' }, ['a', 'b', 'c']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    t.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'k', id: 'c' });
    let k = t.z.konkurrenzen.k!;
    expect(Object.values(k.spiele).filter((s) => s.kampflosDurchRueckzug)).toHaveLength(2);
    expect(rueckzugZuruecknehmenPruefen(k, 'c')).toBeNull();
    expect(rueckzugZuruecknehmenPruefen(k, 'a')).toMatch(/nicht zurückgezogen/);
    t.e(ART.teilnehmerZurueck, { konkurrenz: 'k', id: 'c' }, { rolle: 'helfer', name: 'H' } as Autor);
    expect(t.z.konkurrenzen.k!.rueckzuege).toHaveLength(1);
    t.e(ART.teilnehmerZurueck, { konkurrenz: 'k', id: 'c' });
    k = t.z.konkurrenzen.k!;
    expect(k.rueckzuege).toEqual([]);
    expect(Object.values(k.spiele).every((s) => s.status === 'offen' && !s.kampflosDurchRueckzug)).toBe(true);
  });

  it('K.-o.: nicht mehr möglich, wenn der Gegner schon die nächste Runde gespielt hat', () => {
    const t = new Baukasten();
    const ids = ['a', 'b', 'c', 'd'];
    ids.forEach((id, i) => t.spieler(id, 2000 - i * 100));
    t.konkurrenz('k', { modus: 'ko', setzung: 'ttr' }, ids);
    t.auslosen('k');
    t.starten('k', 'ko');
    const r1 = Object.values(t.z.konkurrenzen.k!.spiele).filter((s) => s.runde === 1);
    const opfer = r1[0]!.b!;
    t.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'k', id: opfer });
    expect(rueckzugZuruecknehmenPruefen(t.z.konkurrenzen.k!, opfer)).toBeNull();
    t.ergebnis('k', r1[1]!.id, sieg);
    const fin = Object.values(t.z.konkurrenzen.k!.spiele).find((s) => s.runde === 2)!;
    expect(fin.status).toBe('offen');
    t.ergebnis('k', fin.id, sieg);
    expect(rueckzugZuruecknehmenPruefen(t.z.konkurrenzen.k!, opfer)).toMatch(/beendet|Ergebnis/);
    t.e(ART.teilnehmerZurueck, { konkurrenz: 'k', id: opfer });
    expect(t.z.konkurrenzen.k!.rueckzuege).toHaveLength(1);
  });
});

describe('0.16: Begegnung an zwei Tischen', () => {
  function turnier() {
    const t = new Baukasten();
    for (const x of ['a', 'b', 'c', 'd']) for (let i = 1; i <= 2; i++) t.spieler(`${x}${i}`, 1500);
    t.e(ART.konkurrenzAngelegt, { id: 'm', einst: { ...standardEinstellungen('M'), art: 'mannschaft', modus: 'jgj', zweiTische: true, mannschaft: { system: 'corbillon2', durchspielen: false, eigen: null } } });
    for (const x of ['a', 'b', 'c', 'd']) t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: `m-${x}${x}${x}${x}`, name: x, spieler: [`${x}1`, `${x}2`], fuehrer: `${x}1` });
    t.e(ART.turnierDaten, { tische: 4 });
    t.auslosen('m');
    t.starten('m', 'gruppen');
    return t;
  }

  it('Aufruf mit zweitem Tisch belegt beide; belegter zweiter Tisch wird abgelehnt', () => {
    const t = turnier();
    const [s1, s2] = Object.values(t.z.konkurrenzen.m!.spiele).filter((s) => s.runde === 1);
    t.e(ART.spielAufgerufen, { konkurrenz: 'm', spiel: s1!.id, tisch: 1, tisch2: 2 });
    expect(t.z.konkurrenzen.m!.spiele[s1!.id]!.tisch2).toBe(2);
    expect(tische(t.z).filter((x) => x.spiel).map((x) => x.nr)).toEqual([1, 2]);
    t.e(ART.spielAufgerufen, { konkurrenz: 'm', spiel: s2!.id, tisch: 3, tisch2: 1 });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Tisch 1 ist nicht frei/);
    t.e(ART.spielAufgerufen, { konkurrenz: 'm', spiel: s2!.id, tisch: 2 });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Tisch 2 ist belegt/);
    t.e(ART.spielAufrufZurueck, { konkurrenz: 'm', spiel: s1!.id });
    expect(t.z.konkurrenzen.m!.spiele[s1!.id]!.tisch2).toBeNull();
  });

  it('Automatisch belegen nimmt je Begegnung zwei Tische; Zeitplan rechnet halb so lang', () => {
    const t = turnier();
    const a = automatischeAufrufe(t.z, Date.now(), false);
    expect(a).toHaveLength(2);
    expect(a.map((x) => [x.tisch, x.tisch2])).toEqual([[1, 2], [3, 4]]);
    const mit = zeitplan(t.z, Date.UTC(2026, 10, 14, 9, 0)).ende!;
    t.e(ART.konkurrenzGeaendert, { id: 'm', einst: { ...t.z.konkurrenzen.m!.einst, zweiTische: false } });
    const ohne = zeitplan(t.z, Date.UTC(2026, 10, 14, 9, 0)).ende!;
    expect(mit).toBeLessThan(ohne);
  });
});

describe('0.16: App-Wertung mit Mannschafts-Einzeln, Zeitplan', () => {
  it('Einzel einer Begegnung ändern den geschätzten Wert, Doppel nicht', () => {
    const t = new Baukasten();
    t.e(ART.spielerAngelegt, { id: 'a1', vorname: 'A', nachname: '1', verein: '', ttr: 1100, ttrGeschaetzt: true });
    t.e(ART.spielerAngelegt, { id: 'a2', vorname: 'A', nachname: '2', verein: '', ttr: 1300 });
    t.e(ART.spielerAngelegt, { id: 'b1', vorname: 'B', nachname: '1', verein: '', ttr: 1100 });
    t.e(ART.spielerAngelegt, { id: 'b2', vorname: 'B', nachname: '2', verein: '', ttr: 1300 });
    t.e(ART.konkurrenzAngelegt, { id: 'm', einst: { ...standardEinstellungen('M'), art: 'mannschaft', modus: 'jgj', mannschaft: { system: 'corbillon2', durchspielen: true, eigen: null } } });
    t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: 'm-aaaa', name: 'A', spieler: ['a1', 'a2'], fuehrer: 'a1' });
    t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: 'm-bbbb', name: 'B', spieler: ['b1', 'b2'], fuehrer: 'b1' });
    t.auslosen('m');
    t.starten('m', 'gruppen');
    const s = Object.values(t.z.konkurrenzen.m!.spiele)[0]!;
    const team = (m: string) => (m === 'm-aaaa' ? 'a' : 'b');
    for (const m of [s.a!, s.b!]) t.e(ART.mannschaftAufgestellt, { konkurrenz: 'm', spiel: s.id, mannschaft: m, gegner: m === s.a ? s.b : s.a, einzel: [`${team(m)}1`, `${team(m)}2`], doppel: [[`${team(m)}1`, `${team(m)}2`]] });
    // Teilspiel 1: Position 1 gegen 1 → a1 gegen b1; a1 gewinnt (Seite je nach Auslosung)
    const aSeite = s.a === 'm-aaaa';
    t.e(ART.spielErgebnis, { konkurrenz: 'm', spiel: teilId(s.id, 1), a: s.a, b: s.b, ergebnis: aSeite ? sieg : niederlage });
    t.e(ART.spielErgebnis, { konkurrenz: 'm', spiel: teilId(s.id, 3), a: s.a, b: s.b, ergebnis: aSeite ? niederlage : sieg }); // Doppel zählt nicht
    const w = appWertungen(t.z);
    expect(w.a1!.spiele).toBe(1);
    expect(w.a1!.aktuell).toBe(1116);
  });

  it('Zeitplan: Platzierungsrunde einer noch nicht gestarteten Konkurrenz wird mitgerechnet; großes Turnier bleibt schnell', () => {
    const t = new Baukasten();
    const ids = Array.from({ length: 16 }, (_, i) => `p${i}`);
    ids.forEach((id) => t.spieler(id, 1500));
    t.konkurrenz('k', { modus: 'gruppen_platz', gruppenGroesse: 4, aufsteiger: 2 }, ids);
    t.e(ART.turnierDaten, { tische: 8 });
    const p = zeitplan(t.z, Date.UTC(2026, 10, 14, 9, 0));
    // Vorrunde 4 × 6 = 24, Platzierungsrunde 2 Gruppen à 8 = 2 × 28 = 56
    expect(p.spiele.size).toBe(80);
    expect(p.nichtPlanbar).toBe(0);
    const g = new Baukasten();
    const viele = Array.from({ length: 160 }, (_, i) => `g${i}`);
    viele.forEach((id) => g.spieler(id, 1500));
    g.konkurrenz('j', { modus: 'jgj' }, viele.slice(0, 120));
    g.konkurrenz('s', { modus: 'schweizer' }, viele);
    g.auslosen('j');
    g.starten('j', 'gruppen');
    g.e(ART.turnierDaten, { tische: 20, pause: 3 });
    const t0 = performance.now();
    const q = zeitplan(g.z, Date.UTC(2026, 10, 14, 9, 0));
    const dauer = performance.now() - t0;
    expect(q.nichtPlanbar).toBe(0);
    expect(q.spiele.size).toBe(7140 + 80 * 9);
    expect(dauer).toBeLessThan(1500);
  });
});
