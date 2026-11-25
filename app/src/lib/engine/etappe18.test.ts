import { describe, expect, it } from 'vitest';
import { ART, type AnmeldungEintrag, type Autor } from '@shared/protokoll';
import { Baukasten, HELFER, LEITUNG } from './test/baukasten';
import { staerkeVon, teileVon } from './mannschaft';
import { teilnehmerDaten } from './abfragen';
import { auslosungWartetAufCheckin, checkinStand, mannschaftAnwesend } from './kasse';
import { uebernahmePlanen } from './anmeldung';

const sp = (id: string): Autor => ({ rolle: 'spieler', name: id, spieler: id });

function turnier(mannschaft: Record<string, unknown>) {
  const t = new Baukasten();
  for (const [id, ttr] of [['a1', 1600], ['a2', 1500], ['a3', 1900], ['b1', 1400]] as const) t.spieler(id, ttr);
  t.e(ART.spielerAngelegt, { id: 'bl', vorname: 'Be', nachname: 'Gleitung', verein: '', begleitung: true });
  t.e(ART.konkurrenzAngelegt, { id: 'm', einst: { name: 'Mannschaft', art: 'mannschaft', modus: 'jgj', bestOf: 3, mannschaft: { system: 'corbillon2', ...mannschaft } } });
  t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: 'm-aaaa', name: 'A', verein: '', spieler: ['a1', 'a2', 'a3'], fuehrer: 'bl', wechsler: ['a3'] });
  t.e(ART.mannschaftGemeldet, { konkurrenz: 'm', id: 'm-bbbb', name: 'B', verein: '', spieler: ['b1'], fuehrer: 'b1' });
  return t;
}
function begegnung(t: Baukasten) {
  t.auslosen('m');
  t.starten('m', 'gruppen');
  return Object.keys(t.z.konkurrenzen.m!.spiele)[0]!;
}
function aufstellen(t: Baukasten, spiel: string, team: string, einzel: (string | null)[], autor: Autor, extra: Record<string, unknown> = {}) {
  const s = t.z.konkurrenzen.m!.spiele[spiel]!;
  return t.e(ART.mannschaftAufgestellt, { konkurrenz: 'm', spiel, mannschaft: team, gegner: s.a === team ? s.b : s.a, einzel, doppel: [], ...extra }, autor);
}
const warnungen = (t: Baukasten) => t.z.warnungen.map((w) => w.text);

describe('Paket 0.18: Sollstärke, Ersatzregel, Wechsel, Begleitperson', () => {
  it('Sollstärke: aus dem System oder eingestellt; Einstellungen werden gelesen', () => {
    const t = turnier({ min: 2, max: 4, ersatz: 1, wechsel: true });
    const e = t.z.konkurrenzen.m!.einst;
    expect(e.mannschaft).toMatchObject({ min: 2, max: 4, ersatz: 1, wechsel: true });
    expect(staerkeVon(e)).toEqual({ min: 2, max: 4 });
    expect(staerkeVon(turnier({}).z.konkurrenzen.m!.einst)).toEqual({ min: 2, max: 4 }); // Corbillon: 2 Einzelpositionen
    expect(turnier({ ersatz: 9 }).z.konkurrenzen.m!.einst.mannschaft!.ersatz).toBe(0);
  });

  it('Begleitperson führt die Mannschaft; Wechselspieler zählen nicht für die Setzung', () => {
    const t = turnier({});
    const m = t.z.konkurrenzen.m!.mannschaften['m-aaaa']!;
    expect(m.fuehrer).toBe('bl');
    expect(m.wechsler).toEqual(['a3']);
    // Stammspieler a1 (1600) und a2 (1500) → 1550; a3 (1900) ist Wechselspieler
    expect(teilnehmerDaten(t.z, t.z.konkurrenzen.m!)['m-aaaa']!.ttr).toBe(1550);
  });

  it('Ersatzregel: doppelt besetzte Position nur mit Einstellung', () => {
    const ohne = turnier({});
    const s1 = begegnung(ohne);
    aufstellen(ohne, s1, 'm-bbbb', ['b1', 'b1'], sp('b1'));
    expect(warnungen(ohne).some((w) => w.includes('nur auf einer Position'))).toBe(true);
    const mit = turnier({ ersatz: 1 });
    const s2 = begegnung(mit);
    aufstellen(mit, s2, 'm-bbbb', ['b1', 'b1'], sp('b1'));
    expect(mit.z.warnungen).toEqual([]);
    expect(mit.z.konkurrenzen.m!.begegnungen[s2]!.aufstellung['m-bbbb']!.einzel).toEqual(['b1', 'b1']);
  });

  it('Wechsel in der Begegnung: anderer Spieler für ein Einzel, Aufstellung durch die Begleitperson', () => {
    const t = turnier({ wechsel: true });
    const s = begegnung(t);
    const seiteA = t.z.konkurrenzen.m!.spiele[s]!.a === 'm-aaaa';
    // Corbillon: 1 A-X, 2 B-Y, 3 Doppel, 4 A-Y, 5 B-X → in Spiel 4 spielt a3 statt a1
    aufstellen(t, s, 'm-aaaa', ['a1', 'a2'], sp('bl'), { wechsel: { '4': 'a3' } });
    aufstellen(t, s, 'm-bbbb', ['b1', null], sp('b1'));
    expect(t.z.warnungen).toEqual([]);
    const teile = teileVon(t.z.konkurrenzen.m!, t.z.konkurrenzen.m!.spiele[s]!);
    const meine = (nr: number) => (seiteA ? teile[nr - 1]!.a : teile[nr - 1]!.b);
    expect(meine(1)).toEqual(['a1']);
    expect(meine(4)).toEqual(['a3']);
    // Wechsel auf das Doppel (Spiel 3) ist ungültig
    const t2 = turnier({ wechsel: true });
    const s2 = begegnung(t2);
    aufstellen(t2, s2, 'm-aaaa', ['a1', 'a2'], sp('bl'), { wechsel: { '3': 'a3' } });
    expect(warnungen(t2)).toContain('Wechsel ungültig.');
    // ohne Einstellung kein Wechsel
    const t3 = turnier({});
    const s3 = begegnung(t3);
    aufstellen(t3, s3, 'm-aaaa', ['a1', 'a2'], LEITUNG, { wechsel: { '4': 'a3' } });
    expect(warnungen(t3).some((w) => w.includes('nicht vorgesehen'))).toBe(true);
  });
});

describe('Paket 0.18: Check-in je Konkurrenz', () => {
  it('Stand, Mannschaft nach Sollstärke, Abschluss durch die Kasse, Pflicht vor der Auslosung', () => {
    const t = turnier({ min: 2 });
    t.e(ART.turnierDaten, { checkinPflicht: true });
    const k = () => t.z.konkurrenzen.m!;
    expect(auslosungWartetAufCheckin(t.z, k())).toBe(true);
    expect(checkinStand(t.z, k())).toMatchObject({ teilnehmer: 2, da: 0 });
    t.e(ART.teilnehmerEingecheckt, { spieler: 'a1', da: true });
    t.e(ART.teilnehmerEingecheckt, { spieler: 'a2', da: true });
    t.e(ART.teilnehmerEingecheckt, { spieler: 'b1', da: true });
    const st = checkinStand(t.z, k());
    expect(st.da).toBe(1); // B: 1 Spieler, nötig 2 (keine Ersatzregel)
    expect(st.fehlend).toEqual(['m-bbbb']);
    expect(mannschaftAnwesend(t.z, k(), 'm-bbbb')).toMatchObject({ da: 1, min: 2 });
    expect(st.unterbesetzt.map((u) => u.teilnehmer)).toEqual(['m-bbbb']);
    const kasse: Autor = { ...HELFER, aufgaben: ['kasse'] };
    t.e(ART.konkurrenzCheckin, { konkurrenz: 'm', fertig: true }, { rolle: 'helfer', name: 'Aufruf', aufgaben: ['aufruf'] });
    expect(k().checkinFertig).toBe(false);
    t.e(ART.konkurrenzCheckin, { konkurrenz: 'm', fertig: true }, kasse);
    expect(k().checkinFertig).toBe(true);
    expect(auslosungWartetAufCheckin(t.z, k())).toBe(false);
    // mit Ersatzregel reicht ein Spieler für zwei Positionen
    const t2 = turnier({ min: 2, ersatz: 1 });
    t2.e(ART.teilnehmerEingecheckt, { spieler: 'b1', da: true });
    expect(mannschaftAnwesend(t2.z, t2.z.konkurrenzen.m!, 'm-bbbb').reicht).toBe(true);
  });
});

describe('Paket 0.18: Übernahme einer Gruppenanmeldung', () => {
  it('Personen als Spieler, Mannschaftsleitung als Begleitperson, Einzel, Paar, Mannschaft', () => {
    const t = new Baukasten();
    t.e(ART.turnierDaten, { angaben: ['jahrgang'] });
    t.e(ART.konkurrenzAngelegt, { id: 'je', einst: { name: 'Einzel', art: 'einzel', modus: 'jgj' } });
    t.e(ART.konkurrenzAngelegt, { id: 'jd', einst: { name: 'Doppel', art: 'doppel', modus: 'ko' } });
    t.e(ART.konkurrenzAngelegt, { id: 'jm', einst: { name: 'Mannschaft', art: 'mannschaft', modus: 'jgj', mannschaft: { system: 'corbillon2' } } });
    const a: AnmeldungEintrag = {
      id: 'abcdefghij', vorname: 'Mona', nachname: 'Leiterin', verein: 'TSV', email: 'm@x.de', ttr: null, klasse: null, geschlecht: null, jahrgang: null,
      angelegt: '', bestaetigt: '2026-11-25T10:00:00Z', spieler: null, typ: 'gruppe',
      personen: [
        { pid: 'p1', vorname: 'Tim', nachname: 'A', ttr: null, ttrGeschaetzt: false, klasse: null, geschlecht: null, jahrgang: 2013 },
        { pid: 'p2', vorname: 'Tom', nachname: 'B', ttr: null, ttrGeschaetzt: false, klasse: null, geschlecht: null, jahrgang: 2012 },
      ],
      konkurrenzen: [
        { id: 'je', status: 'platz', position: null, partner: null, eintrag: 0, wer: ['p1'], mannschaft: null },
        { id: 'jd', status: 'platz', position: null, partner: null, eintrag: 1, wer: ['p1', 'p2'], mannschaft: null },
        { id: 'jm', status: 'platz', position: null, partner: null, eintrag: 2, wer: ['p1', 'p2'], mannschaft: { name: 'TSV I', fuehrer: 'leitung', wechsler: [] } },
        { id: 'je', status: 'warteliste', position: 1, partner: null, eintrag: 3, wer: ['p2'], mannschaft: null },
      ],
    };
    const plan = uebernahmePlanen(t.z, [a]);
    expect(plan.uebernommen).toEqual(['abcdefghij']);
    for (const s of plan.schritte) t.e(s.art, s.daten);
    expect(t.z.warnungen).toEqual([]);
    expect(t.z.spieler.abcdefghijp1).toMatchObject({ vorname: 'Tim', jahrgang: 2013, verein: 'TSV' });
    expect(t.z.spieler.abcdefghijl).toMatchObject({ vorname: 'Mona', begleitung: true });
    expect(t.z.konkurrenzen.je!.meldungen).toEqual(['abcdefghijp1']);
    expect(Object.values(t.z.konkurrenzen.jd!.paare)[0]!.spieler).toEqual(['abcdefghijp1', 'abcdefghijp2']);
    const m = t.z.konkurrenzen.jm!.mannschaften['m-abcdefghij2']!;
    expect(m).toMatchObject({ name: 'TSV I', fuehrer: 'abcdefghijl', spieler: ['abcdefghijp1', 'abcdefghijp2'] });
    // zweiter Durchlauf: nichts mehr zu tun
    expect(uebernahmePlanen(t.z, [{ ...a, spieler: 'abcdefghij' }]).schritte).toEqual([]);
  });
});
