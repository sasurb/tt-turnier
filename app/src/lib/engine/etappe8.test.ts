import { describe, expect, it } from 'vitest';
import { ART } from '@shared/protokoll';
import { anstehendeSpiele, automatischeAufrufe, endrundeErstellen, platzierungen } from './abfragen';
import { ergebnisWerten } from './ergebnis';
import { punkteText } from './modell';
import { schweizerTabelle } from './runden';
import { Baukasten, HELFER, saetze } from './test/baukasten';
import { rueckgaengigPruefen } from './verlauf';
import { gelernteSatzMinuten, zeitplan } from './zeitplan';
import { berechnen, gruppenAenderungPruefen, koPlaetzePruefen, nachmeldePlaetzeKo, zurueckgezogen } from './zustand';

const sieg = saetze(5, 6, 7);
const niederlage = saetze(-5, -6, -7);

function paarungen(t: Baukasten, k: string, runde: number): string[] {
  return Object.values(t.z.konkurrenzen[k]!.spiele)
    .filter((s) => s.runde === runde)
    .sort((x, y) => x.index - y.index)
    .map((s) => `${s.a}-${s.b ?? 'frei'}`);
}
/** Alle offenen Spiele: wer in `staerke` vorn steht, gewinnt */
function offeneSpielen(t: Baukasten, k: string, staerke: string[]) {
  for (const s of Object.values(t.z.konkurrenzen[k]!.spiele).filter((x) => x.status === 'offen')) {
    t.ergebnis(k, s.id, staerke.indexOf(s.a!) < staerke.indexOf(s.b!) ? sieg : niederlage);
  }
}
const buchstaben = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));

function aufbau(modus: 'jgj' | 'gruppen_ko' | 'ko' | 'schweizer' | 'cup' | 'kaiser', n: number, einst: Record<string, unknown> = {}) {
  const t = new Baukasten();
  const ids = buchstaben(n);
  ids.forEach((id, i) => t.spieler(id, 2000 - i * 10));
  t.konkurrenz('k', { modus, ...einst }, ids);
  t.auslosen('k');
  t.starten('k', modus === 'ko' ? 'ko' : 'gruppen');
  return { t, ids };
}

describe('Etappe 8: Nachmeldung im laufenden Turnier', () => {
  it('Gruppe: neue Spiele gegen alle der Gruppe, Endrunde muss neu ausgelost werden', () => {
    const { t } = aufbau('gruppen_ko', 8, { gruppenGroesse: 4 });
    const vorher = Object.keys(t.z.konkurrenzen.k!.spiele).length;
    t.spieler('x', 1500);
    t.e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: 'x', gruppe: 1 });
    const k = t.z.konkurrenzen.k!;
    expect(t.z.warnungen).toEqual([]);
    expect(k.meldungen).toContain('x');
    expect(k.gruppen[1]!.mitglieder).toContain('x');
    expect(Object.keys(k.spiele).length).toBe(vorher + 4);
    const neu = Object.values(k.spiele).filter((s) => s.b === 'x' || s.a === 'x');
    expect(neu).toHaveLength(4);
    expect(neu.every((s) => s.gruppe === 1 && s.status === 'offen')).toBe(true);
  });
  it('ohne Gruppe oder in der Endrunde abgelehnt', () => {
    const { t } = aufbau('gruppen_ko', 4, { gruppenGroesse: 4, aufsteiger: 2 });
    t.spieler('x');
    t.e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: 'x' });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Gruppe/);
    offeneSpielen(t, 'k', buchstaben(4));
    t.e(ART.auslosung, endrundeErstellen(t.z, t.z.konkurrenzen.k!, 1)!);
    t.starten('k', 'ko');
    t.e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: 'x', gruppe: 0 });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Endrunde läuft/);
    expect(t.z.konkurrenzen.k!.meldungen).not.toContain('x');
  });
  it('K.-o.: auf einen Freilos-Platz, solange das betroffene Spiel noch nicht gespielt ist', () => {
    const { t } = aufbau('ko', 6);
    const k0 = t.z.konkurrenzen.k!;
    const frei = nachmeldePlaetzeKo(k0);
    expect(frei.length).toBe(2);
    t.spieler('x');
    t.e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: 'x', platz: frei[0] });
    const k = t.z.konkurrenzen.k!;
    expect(t.z.warnungen).toEqual([]);
    expect(k.auslosungKo!.plaetze[frei[0]!]).toBe('x');
    const r1 = Object.values(k.spiele).find((s) => s.runde === 1 && (s.a === 'x' || s.b === 'x'))!;
    expect(r1.status).toBe('offen');
    // Ist das Folgespiel des zweiten Freiloses schon gespielt, geht der Platz nicht mehr
    const anderes = Object.values(k.spiele).find((s) => s.runde === 1 && s.status === 'freilos')!;
    const folge = k.spiele[anderes.weiter!.spiel]!;
    const geschwister = Object.values(k.spiele).find((s) => s.runde === 1 && s.id !== anderes.id && s.weiter?.spiel === folge.id)!;
    t.ergebnis('k', geschwister.id, sieg);
    expect(t.z.konkurrenzen.k!.spiele[folge.id]!.status).toBe('offen');
    t.ergebnis('k', folge.id, sieg);
    expect(nachmeldePlaetzeKo(t.z.konkurrenzen.k!)).toEqual([]);
    t.spieler('y');
    t.e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: 'y', platz: frei[1] });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Ergebnis/);
  });
  it('Schweizer System: spielt ab der nächsten Runde mit (0 Punkte)', () => {
    const { t, ids } = aufbau('schweizer', 6, { runden: 3 });
    t.spieler('x');
    t.e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: 'x' });
    expect(paarungen(t, 'k', 1).join(' ')).not.toContain('x');
    offeneSpielen(t, 'k', [...ids, 'x']);
    const r2 = paarungen(t, 'k', 2);
    expect(r2.join(' ')).toContain('x');
    expect(r2).toHaveLength(4); // 7 Teilnehmer: 3 Spiele + Freilos
  });
  it('Doppel: Paar nachmelden', () => {
    const t = new Baukasten();
    buchstaben(10).forEach((id) => t.spieler(id));
    t.konkurrenz('d', { modus: 'jgj', art: 'doppel' }, []);
    for (const [i, p] of [['a', 'b'], ['c', 'd'], ['e', 'f']].entries()) t.e(ART.paarGemeldet, { konkurrenz: 'd', id: `p-000${i}`, spieler: p });
    t.auslosen('d');
    t.starten('d', 'gruppen');
    t.e(ART.paarGemeldet, { konkurrenz: 'd', id: 'p-0009', spieler: ['g', 'h'], gruppe: 0 });
    const k = t.z.konkurrenzen.d!;
    expect(t.z.warnungen).toEqual([]);
    expect(k.paare['p-0009']).toBeTruthy();
    expect(Object.values(k.spiele)).toHaveLength(6);
    // Spieler, die schon gemeldet sind, gehen nicht doppelt
    t.e(ART.paarGemeldet, { konkurrenz: 'd', id: 'p-0010', spieler: ['g', 'i'], gruppe: 0 });
    expect(t.z.konkurrenzen.d!.paare['p-0010']).toBeUndefined();
  });
});

describe('Etappe 8: Auslosung im laufenden Turnier ändern', () => {
  it('Gruppen tauschen: wegfallende Spiele weg, neue Paarungen da; gesperrt, sobald gespielt', () => {
    const { t } = aufbau('gruppen_ko', 8, { gruppenGroesse: 4 });
    const k = t.z.konkurrenzen.k!;
    const [g0, g1] = k.gruppen.map((g) => [...g.mitglieder]);
    const x = g0![3]!;
    const y = g1![3]!;
    const neu = [g0!.map((id) => (id === x ? y : id)), g1!.map((id) => (id === y ? x : id))];
    expect(gruppenAenderungPruefen(k, neu)).toBeNull();
    t.e(ART.auslosungGeaendert, { konkurrenz: 'k', phase: 'gruppen', gruppen: neu });
    const k2 = t.z.konkurrenzen.k!;
    expect(t.z.warnungen).toEqual([]);
    expect(k2.gruppen[0]!.mitglieder).toContain(y);
    expect(Object.values(k2.spiele).filter((s) => s.gruppe === 0 && (s.a === y || s.b === y))).toHaveLength(3);
    expect(Object.values(k2.spiele).some((s) => s.gruppe === 0 && (s.a === x || s.b === x))).toBe(false);
    expect(Object.keys(k2.spiele)).toHaveLength(12);
    // y spielt in Gruppe A → jetzt nicht mehr tauschbar
    const sy = Object.values(k2.spiele).find((s) => s.gruppe === 0 && (s.a === y || s.b === y))!;
    t.ergebnis('k', sy.id, sieg);
    const zurueck = k2.gruppen.map((g) => [...g.mitglieder]);
    [zurueck[0]![3], zurueck[1]![3]] = [zurueck[1]![3]!, zurueck[0]![3]!];
    expect(gruppenAenderungPruefen(t.z.konkurrenzen.k!, zurueck)).toMatch(/schon gespielt/);
    t.e(ART.auslosungGeaendert, { konkurrenz: 'k', phase: 'gruppen', gruppen: zurueck });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/schon gespielt/);
  });
  it('in eine andere Gruppe verschieben (ungleiche Größen) und fremde Teilnehmer abgelehnt', () => {
    const { t } = aufbau('gruppen_ko', 8, { gruppenGroesse: 4 });
    const k = t.z.konkurrenzen.k!;
    const g = k.gruppen.map((x) => [...x.mitglieder]);
    const wer = g[0]!.pop()!;
    g[1]!.push(wer);
    t.e(ART.auslosungGeaendert, { konkurrenz: 'k', phase: 'gruppen', gruppen: g });
    const k2 = t.z.konkurrenzen.k!;
    expect(k2.gruppen[0]!.mitglieder).toHaveLength(3);
    expect(k2.gruppen[1]!.mitglieder).toHaveLength(5);
    expect(Object.keys(k2.spiele)).toHaveLength(3 + 10);
    expect(gruppenAenderungPruefen(k2, [['a', 'b', 'zz'], g[1]!])).toMatch(/dieselben/);
  });
  it('K.-o.-Plan tauschen, solange die Spiele noch nicht gespielt sind', () => {
    const { t } = aufbau('ko', 8);
    const k = t.z.konkurrenzen.k!;
    const p = [...k.auslosungKo!.plaetze];
    [p[0], p[2]] = [p[2]!, p[0]!];
    expect(koPlaetzePruefen(k, p)).toBeNull();
    t.e(ART.auslosungGeaendert, { konkurrenz: 'k', phase: 'ko', plaetze: p });
    expect(t.z.konkurrenzen.k!.spiele['ko-1-0']!.a).toBe(p[0]);
    t.ergebnis('k', 'ko-1-0', sieg);
    const q = [...t.z.konkurrenzen.k!.auslosungKo!.plaetze];
    [q[0], q[2]] = [q[2]!, q[0]!];
    expect(koPlaetzePruefen(t.z.konkurrenzen.k!, q)).toMatch(/Ergebnis/);
    // Spiele, die nicht betroffen sind, lassen sich weiter tauschen
    const r = [...t.z.konkurrenzen.k!.auslosungKo!.plaetze];
    [r[4], r[6]] = [r[6]!, r[4]!];
    expect(koPlaetzePruefen(t.z.konkurrenzen.k!, r)).toBeNull();
    // fremde Teilnehmer nicht
    t.e(ART.auslosungGeaendert, { konkurrenz: 'k', phase: 'ko', plaetze: r.map((x, i) => (i === 7 ? 'zz' : x)) });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/dieselben/);
  });
  it('Konkurrenzen zusammenlegen (vor dem Start, mit vorhandenen Ereignissen)', () => {
    const t = new Baukasten();
    buchstaben(6).forEach((id) => t.spieler(id));
    t.konkurrenz('a', { name: 'Klasse A', zulassung: { ttrMin: null, ttrMax: null, klassen: ['A'], geschlecht: [], jahrgangVon: null, jahrgangBis: null } }, ['a', 'b', 'c']);
    t.konkurrenz('b', { name: 'Klasse B' }, ['c', 'd', 'e']);
    for (const id of t.z.konkurrenzen.b!.meldungen) t.e(ART.teilnehmerGemeldet, { konkurrenz: 'a', id });
    t.e(ART.konkurrenzEntfernt, { id: 'b' });
    expect(t.z.konkurrenzen.a!.meldungen).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(t.z.konkurrenzReihe).toEqual(['a']);
  });
});

describe('Etappe 8: Rückgängig und Änderungsverlauf', () => {
  it('Ergebnis zurücknehmen und wiederherstellen', () => {
    const { t } = aufbau('jgj', 4);
    const s = Object.values(t.z.konkurrenzen.k!.spiele)[0]!;
    const erg = t.ergebnis('k', s.id, sieg);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.status).toBe('gespielt');
    expect(rueckgaengigPruefen(t.liste, [erg], true)).toEqual({ ok: true });
    const r = t.e(ART.eintragZurueck, { ereignisse: [erg], zurueck: true });
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.status).toBe('offen');
    expect(t.z.zurueckgenommen).toEqual([erg]);
    expect(t.z.anzahlEreignisse).toBe(t.liste.length);
    // das Zurücknehmen selbst lässt sich nicht zurücknehmen – nur wiederherstellen
    expect(rueckgaengigPruefen(t.liste, [r], true).ok).toBe(false);
    t.e(ART.eintragZurueck, { ereignisse: [erg], zurueck: false });
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.status).toBe('gespielt');
    expect(t.z.zurueckgenommen).toEqual([]);
  });
  it('blockiert, wenn spätere Einträge darauf aufbauen; Helfer dürfen nicht', () => {
    const { t } = aufbau('jgj', 4);
    const start = t.liste.at(-1)!.id; // phase.gestartet
    const s = Object.values(t.z.konkurrenzen.k!.spiele)[0]!;
    t.ergebnis('k', s.id, sieg);
    const p = rueckgaengigPruefen(t.liste, [start], true);
    expect(p.ok).toBe(false);
    expect(p.ok ? '' : p.grund).toMatch(/Ergebnisse|bauen darauf auf/);
    // Helfer-Eintrag wird nicht beachtet
    const erg = t.liste.at(-1)!.id;
    t.e(ART.eintragZurueck, { ereignisse: [erg] }, HELFER);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.status).toBe('gespielt');
    // spätere oder unbekannte Einträge nicht
    t.e(ART.eintragZurueck, { ereignisse: ['e9999', 'e99999'] });
    expect(t.z.zurueckgenommen).toEqual([]);
    // Spieler, der schon spielt, lässt sich nicht zurücknehmen
    expect(rueckgaengigPruefen(t.liste, ['e1'], true).ok).toBe(false);
  });
  it('K.-o.: Ergebnis mit gespieltem Folgespiel lässt sich nicht still zurücknehmen', () => {
    const { t } = aufbau('ko', 4);
    const e1 = t.ergebnis('k', 'ko-1-0', sieg);
    t.ergebnis('k', 'ko-1-1', sieg);
    t.ergebnis('k', 'ko-2-0', sieg);
    expect(rueckgaengigPruefen(t.liste, [e1], true).ok).toBe(false);
  });
  it('„Namen für Zuschauer“ und Testnotizen lassen sich nicht zurücknehmen (die Server werten das selbst aus)', () => {
    const t = new Baukasten();
    t.e(ART.turnierDaten, { namen: 'kurz' });
    const voll = t.e(ART.turnierDaten, { namen: 'voll' });
    const notiz = t.e(ART.testNotiz, { text: 'x' });
    expect(rueckgaengigPruefen(t.liste, [voll], true).ok).toBe(false);
    t.e(ART.eintragZurueck, { ereignisse: [voll, notiz] });
    expect(t.z.namen).toBe('voll');
    expect(t.z.zurueckgenommen).toEqual([]);
  });
  it('Mehrere Einträge auf einmal (eine Aktion) zurücknehmen', () => {
    const t = new Baukasten();
    const a = t.spieler('a');
    const b = t.spieler('b');
    t.e(ART.eintragZurueck, { ereignisse: [a, b] });
    expect(t.z.spielerReihe).toEqual([]);
  });
});

describe('Etappe 8: Vorplanung (Tisch/Uhrzeit)', () => {
  it('Spiel für Tisch 2 geplant: kommt nur dort hin; spätere Uhrzeit: noch nicht bereit', () => {
    const { t } = aufbau('jgj', 4);
    t.e(ART.turnierDaten, { tische: 2 });
    const [s1, s2] = Object.values(t.z.konkurrenzen.k!.spiele).sort((x, y) => x.index - y.index);
    t.e(ART.spielGeplant, { konkurrenz: 'k', spiel: s1!.id, tisch: 2, zeit: null });
    const jetzt = Date.UTC(2026, 10, 14, 10, 0);
    const auf = automatischeAufrufe(t.z, jetzt, false);
    expect(auf.find((a) => a.spiel.id === s1!.id)!.tisch).toBe(2);
    expect(auf.find((a) => a.spiel.id === s2!.id)!.tisch).toBe(1);
    const spaeter = new Date(jetzt + 3600_000);
    const hhmm = `${String(spaeter.getHours()).padStart(2, '0')}:${String(spaeter.getMinutes()).padStart(2, '0')}`;
    t.e(ART.spielGeplant, { konkurrenz: 'k', spiel: s2!.id, tisch: null, zeit: hhmm });
    const a2 = anstehendeSpiele(t.z, jetzt).find((a) => a.spiel.id === s2!.id)!;
    expect(a2.bereit).toBe(false);
    expect(a2.ab).toBe(hhmm);
    // Planung aufheben
    t.e(ART.spielGeplant, { konkurrenz: 'k', spiel: s2!.id, tisch: null, zeit: null });
    expect(t.z.konkurrenzen.k!.spiele[s2!.id]!.plan).toBeNull();
    // nur Leitung, nur offene Spiele
    t.e(ART.spielGeplant, { konkurrenz: 'k', spiel: s2!.id, tisch: 1 }, HELFER);
    expect(t.z.konkurrenzen.k!.spiele[s2!.id]!.plan).toBeNull();
  });
});

describe('Etappe 8: Cup-System, beschleunigtes Schweizer, feste Satzzahl', () => {
  it('Cup: Runde 1 wie Schweizer, Runden 2–4 Erster gegen Letzten der Ergebnisgruppe, 6 Runden, keine Wiederholung', () => {
    const { t, ids } = aufbau('cup', 8);
    expect(paarungen(t, 'k', 1)).toEqual(['a-e', 'b-f', 'c-g', 'd-h']);
    offeneSpielen(t, 'k', ids);
    expect(paarungen(t, 'k', 2)).toEqual(['a-d', 'b-c', 'e-h', 'f-g']);
    for (let r = 2; r <= 6; r++) offeneSpielen(t, 'k', ids);
    const k = t.z.konkurrenzen.k!;
    expect(Math.max(...Object.values(k.spiele).map((s) => s.runde))).toBe(6);
    expect(k.status).toBe('beendet');
    const paare = Object.values(k.spiele).map((s) => [s.a, s.b].sort().join('-'));
    expect(new Set(paare).size).toBe(paare.length);
    expect(platzierungen(k).map((p) => p.id)).toEqual(ids);
    // Runde 5: Nachbarn der Rangliste, soweit noch nicht gespielt – a (4 Siege) trifft einen der nächsten
    const r5 = Object.values(k.spiele).filter((s) => s.runde === 5);
    const a5 = r5.find((s) => s.a === 'a' || s.b === 'a')!;
    expect(['b', 'c', 'd', 'e', 'f'].includes(a5.a === 'a' ? a5.b! : a5.a!)).toBe(true);
  });
  it('Cup: ungerade Zahl – der Mittlere hat in Runde 1 das Freilos, danach von der Mitte abwärts', () => {
    const { t, ids } = aufbau('cup', 5, { runden: 3 });
    expect(paarungen(t, 'k', 1)).toEqual(['a-d', 'b-e', 'c-frei']);
    offeneSpielen(t, 'k', ids);
    const frei2 = Object.values(t.z.konkurrenzen.k!.spiele).find((s) => s.runde === 2 && s.bFrei)!.a;
    expect(frei2).not.toBe('c');
  });
  it('beschleunigt: obere Hälfte unter sich, in Runde 2 mit virtuellem Punkt', () => {
    const { t, ids } = aufbau('schweizer', 16, { beschleunigt: true, runden: 5 });
    expect(paarungen(t, 'k', 1)).toEqual(['a-e', 'b-f', 'c-g', 'd-h', 'i-m', 'j-n', 'k-o', 'l-p']);
    offeneSpielen(t, 'k', ids);
    expect(paarungen(t, 'k', 2)).toEqual(['a-c', 'b-d', 'i-e', 'j-f', 'k-g', 'l-h', 'm-o', 'n-p']);
    // Ab Runde 3 zählen nur echte Punkte; Tabelle ohne virtuelle Punkte
    expect(schweizerTabelle(t.z.konkurrenzen.k!, [])[0]!.punkte).toBe(1);
  });
  it('feste Satzzahl: Unentschieden zählt ½ Punkt', () => {
    expect(ergebnisWerten({ saetze: [[11, 5], [5, 11]] }, 5, 'punkte', 2)).toMatchObject({ ok: true, ergebnis: { satzA: 1, satzB: 1, gewinner: null } });
    expect(ergebnisWerten({ saetze: [[11, 5]] }, 5, 'punkte', 2).ok).toBe(false);
    expect(ergebnisWerten({ stand: [2, 2] }, 5, 'saetze', 4)).toMatchObject({ ok: true, ergebnis: { gewinner: null } });
    expect(ergebnisWerten({ stand: [3, 0] }, 5, 'saetze', 4).ok).toBe(false);
    expect(ergebnisWerten({ kampflos: 'a' }, 5, 'punkte', 4)).toMatchObject({ ok: true, ergebnis: { satzA: 0, satzB: 4, gewinner: 'b' } });
    expect(ergebnisWerten({ aufgabe: 'b', saetze: [[5, 11]], laufend: [3, 2] }, 5, 'punkte', 4)).toMatchObject({ ok: true, ergebnis: { gewinner: 'a', satzA: 3, satzB: 1 } });
    const { t } = aufbau('schweizer', 4, { festeSaetze: 2, runden: 2 });
    const s = Object.values(t.z.konkurrenzen.k!.spiele).find((x) => x.runde === 1)!;
    t.ergebnis('k', s.id, { saetze: [[11, 5], [5, 11]] });
    const tab = schweizerTabelle(t.z.konkurrenzen.k!, []);
    const zeile = tab.find((r) => r.id === s.a)!;
    expect(zeile.punkte).toBe(0.5);
    expect(zeile.unentschieden).toBe(1);
    expect(punkteText(2.5)).toBe('2½');
    expect(punkteText(0.5)).toBe('½');
    expect(punkteText(3)).toBe('3');
    // Kaiserturnier kennt keine feste Satzzahl
    const { t: t2 } = aufbau('kaiser', 4, { festeSaetze: 2, bestOf: 1 });
    const s2 = Object.values(t2.z.konkurrenzen.k!.spiele)[0]!;
    t2.ergebnis('k', s2.id, { saetze: [[11, 5], [5, 11]] });
    expect(t2.z.warnungen.at(-1)!.text).toMatch(/Ergebnis ungültig/);
  });
});

describe('Etappe 8: Zeitplan', () => {
  const jetzt = Date.UTC(2026, 10, 14, 10, 0);
  const min = (n: number) => jetzt + n * 60_000;
  it('ein Tisch, jeder gegen jeden mit 4: 6 × 18 Minuten', () => {
    const { t } = aufbau('jgj', 4);
    t.e(ART.turnierDaten, { tische: 1, satzMinuten: 4 });
    const p = zeitplan(t.z, jetzt);
    expect(p.ende).toBe(min(6 * 18));
    expect(p.spiele.size).toBe(6);
    expect(p.konkurrenzEnde.get('k')).toBe(min(108));
  });
  it('zwei Tische: niemand spielt doppelt, 3 Runden parallel', () => {
    const { t } = aufbau('jgj', 4);
    t.e(ART.turnierDaten, { tische: 2, satzMinuten: 4 });
    const p = zeitplan(t.z, jetzt);
    expect(p.ende).toBe(min(54));
    for (const tisch of p.tische) for (let i = 1; i < tisch.eintraege.length; i++) expect(tisch.eintraege[i]!.start).toBeGreaterThanOrEqual(tisch.eintraege[i - 1]!.ende);
  });
  it('K.-o. mit 8 an 2 Tischen: Folgespiele nach ihren Vorgängern', () => {
    const { t } = aufbau('ko', 8);
    t.e(ART.turnierDaten, { tische: 2, satzMinuten: 4 });
    const p = zeitplan(t.z, jetzt);
    expect(p.ende).toBe(min(72));
    expect(p.spiele.get('k/ko-3-0')!.start).toBe(min(54));
  });
  it('noch nicht gestartete Konkurrenz: Gruppen und Endrunde geschätzt; Beginn und Pause zählen', () => {
    const t = new Baukasten();
    buchstaben(8).forEach((id) => t.spieler(id));
    t.konkurrenz('k', { modus: 'gruppen_ko', gruppenGroesse: 4, aufsteiger: 2 }, buchstaben(8));
    t.e(ART.turnierDaten, { tische: 4, satzMinuten: 4 });
    expect(zeitplan(t.z, jetzt).ende).toBe(min(90));
    // Mindestpause 5 Minuten: Endrunde startet 5 Minuten später, Gruppen haben ohnehin Pausen? nein – Spieler spielen direkt hintereinander
    t.e(ART.turnierDaten, { pause: 5 });
    expect(zeitplan(t.z, jetzt).ende).toBeGreaterThan(min(90));
    const beginn = new Date(min(60));
    t.e(ART.turnierDaten, { pause: 0, beginn: `${String(beginn.getHours()).padStart(2, '0')}:${String(beginn.getMinutes()).padStart(2, '0')}` });
    expect(zeitplan(t.z, jetzt).ende).toBe(min(150));
  });
  it('lernt die Minuten je Satz aus beendeten Spielen', () => {
    const { t } = aufbau('jgj', 6);
    const spiele = Object.values(t.z.konkurrenzen.k!.spiele).filter((s) => s.runde === 1);
    expect(spiele).toHaveLength(3);
    spiele.forEach((s, i) => t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: s.id, tisch: i + 1 }, undefined, min(0)));
    // 20 Minuten für 3 Sätze → (20 − 2) / 3 = 6 Minuten je Satz
    spiele.forEach((s) => t.ergebnis('k', s.id, sieg, undefined, min(20)));
    expect(gelernteSatzMinuten(t.z)).toBe(6);
    const p = zeitplan(t.z, min(20));
    expect(p.gelernt).toBe(true);
    expect(p.satzMinuten).toBe(6);
  });
  it('vorgeplante Uhrzeit wird eingehalten, laufende Spiele belegen den Tisch', () => {
    const { t } = aufbau('jgj', 4);
    t.e(ART.turnierDaten, { tische: 1, satzMinuten: 4 });
    const [s1, s2] = Object.values(t.z.konkurrenzen.k!.spiele).sort((x, y) => x.index - y.index);
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: s1!.id, tisch: 1 }, undefined, min(-10));
    const um = new Date(min(120));
    t.e(ART.spielGeplant, { konkurrenz: 'k', spiel: s2!.id, zeit: `${String(um.getHours()).padStart(2, '0')}:${String(um.getMinutes()).padStart(2, '0')}` });
    const p = zeitplan(t.z, jetzt);
    expect(p.spiele.get(`k/${s1!.id}`)!.laeuft).toBe(true);
    expect(p.spiele.get(`k/${s1!.id}`)!.ende).toBe(min(8));
    expect(p.spiele.get(`k/${s2!.id}`)!.start).toBe(min(120));
  });
});

describe('Etappe 8: Lasttest 128 Spieler', () => {
  it('Gruppen + K.-o. mit 128 Spielern an 16 Tischen: komplettes Turnier, Berechnung und Zeitplan schnell genug', () => {
    const t = new Baukasten();
    const ids = Array.from({ length: 128 }, (_, i) => `s${String(i).padStart(3, '0')}`);
    ids.forEach((id, i) => t.spieler(id, 2200 - i * 5, `Verein ${i % 20}`));
    t.konkurrenz('k', { modus: 'gruppen_ko', gruppenGroesse: 4, aufsteiger: 2 }, ids);
    t.e(ART.turnierDaten, { tische: 16 });
    t.auslosen('k');
    t.starten('k', 'gruppen');
    let zeit = Date.UTC(2026, 10, 14, 9, 0);
    const runde = () => {
      // je Durchgang: freie Tische automatisch belegen, dann alle laufenden Spiele beenden
      for (const a of automatischeAufrufe(t.z, zeit, true)) t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: a.spiel.id, tisch: a.tisch, ...(a.schiri ? { schiri: { spieler: a.schiri } } : {}) }, undefined, zeit);
      zeit += 18 * 60_000;
      for (const s of Object.values(t.z.konkurrenzen.k!.spiele).filter((x) => x.tisch !== null && x.status === 'offen')) {
        t.ergebnis('k', s.id, ids.indexOf(s.a!) < ids.indexOf(s.b!) ? sieg : niederlage, undefined, zeit);
      }
    };
    let schutz = 0;
    while (Object.values(t.z.konkurrenzen.k!.spiele).some((s) => s.status === 'offen') && schutz++ < 200) runde();
    expect(Object.values(t.z.konkurrenzen.k!.spiele).every((s) => s.status === 'gespielt')).toBe(true);
    // Zeitplan zur Endrunde (noch nicht ausgelost) – darf nicht langsam sein
    let t0 = performance.now();
    const plan = zeitplan(t.z, zeit);
    const dauerPlan = performance.now() - t0;
    expect(plan.nichtPlanbar).toBe(0);
    expect(plan.spiele.size).toBe(63);
    t.e(ART.auslosung, endrundeErstellen(t.z, t.z.konkurrenzen.k!, 7)!);
    t.starten('k', 'ko');
    schutz = 0;
    while (t.z.konkurrenzen.k!.status !== 'beendet' && schutz++ < 200) runde();
    const z = t.z;
    expect(z.konkurrenzen.k!.status).toBe('beendet');
    expect(z.warnungen).toEqual([]);
    expect(platzierungen(z.konkurrenzen.k!)[0]!.id).toBe('s000');
    expect(zurueckgezogen(z.konkurrenzen.k!)).toEqual([]);
    // Ganze Neuberechnung (macht jedes Gerät nach jeder Änderung)
    t0 = performance.now();
    for (let i = 0; i < 5; i++) berechnen(t.liste);
    const dauer = (performance.now() - t0) / 5;
    console.info(`Lasttest 128: ${t.liste.length} Einträge, Berechnung ${dauer.toFixed(1)} ms, Zeitplan ${dauerPlan.toFixed(1)} ms`);
    expect(t.liste.length).toBeLessThan(2000);
    expect(dauer).toBeLessThan(400);
    expect(dauerPlan).toBeLessThan(400);
  }, 120_000);
});
