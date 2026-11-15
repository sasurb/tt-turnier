import { describe, expect, it } from 'vitest';
import { ART, type Autor } from '@shared/protokoll';
import {
  auslosungErstellen,
  endrundeErstellen,
  etwasVerdeckt,
  gruppenKlassen,
  klassenDerMeldungen,
  platzierungen,
  pruefliste,
  qualifikanten,
  sichtbar,
  spieleVon,
  tabelle,
  zulassungsHinweise,
} from './abfragen';
import { gruppenAuslosen, koAuslosen, setzplaetze, treffRunde } from './auslosung';
import { ergebnisText, ergebnisWerten, satzAusVerliererpunkten } from './ergebnis';
import { PLATZ3_ID, koSpielId } from './ko';
import { klasseVon, standardEinstellungen, ttrBereichName, type ErgebnisEingabe, type KonkurrenzEinstellungen, type TurnierSpieler } from './modell';
import { rundenplan } from './rundenplan';
import type { LokalesEreignis } from './typen';
import { uebersichtText } from './uebersicht';
import { zufallAus } from './zufall';
import { berechnen, type TurnierZustand } from './zustand';

const LEITUNG: Autor = { rolle: 'leitung', name: 'Leitung' };
const spielerAutor = (id: string): Autor => ({
  rolle: 'spieler',
  name: id,
  spieler: id,
});

/** Kleiner Turnier-Baukasten: sammelt Ereignisse und rechnet den Stand */
class Turnier {
  liste: LokalesEreignis[] = [];
  private n = 0;
  e(art: string, daten: Record<string, unknown>, autor: Autor = LEITUNG) {
    this.n++;
    this.liste.push({
      id: `e${this.n}`,
      art,
      daten,
      zeit: new Date(Date.UTC(2026, 10, 14, 9, 0, this.n)).toISOString(),
      geraet: 'g1',
      turnier: 't',
      status: 'lokal',
      seq: this.n,
      empfangen: null,
      autor,
    });
    return `e${this.n}`;
  }
  get z(): TurnierZustand {
    return berechnen(this.liste);
  }
  spieler(id: string, ttr: number | null = null, verein = '') {
    this.e(ART.spielerAngelegt, {
      id,
      vorname: id.toUpperCase(),
      nachname: 'Test',
      verein,
      ttr,
    });
  }
  konkurrenz(id: string, einst: Partial<KonkurrenzEinstellungen>, spieler: string[]) {
    this.e(ART.konkurrenzAngelegt, {
      id,
      einst: { ...standardEinstellungen(id), ...einst },
    });
    for (const s of spieler) this.e(ART.teilnehmerGemeldet, { konkurrenz: id, id: s });
  }
  auslosen(k: string, zufall = 42) {
    const z = this.z;
    this.e(ART.auslosung, auslosungErstellen(z, z.konkurrenzen[k]!, zufall));
  }
  starten(k: string, phase: 'gruppen' | 'ko') {
    this.e(ART.phaseGestartet, { konkurrenz: k, phase });
  }
  ergebnis(k: string, spiel: string, ergebnis: ErgebnisEingabe, autor: Autor = LEITUNG) {
    const s = this.z.konkurrenzen[k]!.spiele[spiel]!;
    return this.e(ART.spielErgebnis, { konkurrenz: k, spiel, a: s.a, b: s.b, ergebnis }, autor);
  }
  /** Spiel zwischen x und y in einer Gruppe; Ergebnis aus Sicht von x */
  gruppenspiel(k: string, x: string, y: string, ergebnis: ErgebnisEingabe, autor: Autor = LEITUNG) {
    const ko = this.z.konkurrenzen[k]!;
    const s = Object.values(ko.spiele).find((s) => (s.a === x && s.b === y) || (s.a === y && s.b === x))!;
    return this.e(ART.spielErgebnis, { konkurrenz: k, spiel: s.id, a: x, b: y, ergebnis }, autor);
  }
}

const s3 = (...p: number[]): ErgebnisEingabe => ({
  saetze: p.map((v) => (v >= 0 ? [11, v] : [-v, 11]) as [number, number]),
});

describe('Ergebnisse', () => {
  it('prüft Sätze nach den Regeln', () => {
    expect(
      ergebnisWerten(
        {
          saetze: [
            [11, 7],
            [9, 11],
            [11, 5],
            [12, 10],
          ],
        },
        5,
        'punkte',
      ),
    ).toMatchObject({
      ok: true,
      ergebnis: { satzA: 3, satzB: 1, ballA: 43, ballB: 33, gewinner: 'a' },
    });
    expect(ergebnisWerten({ saetze: [[11, 10]] }, 3, 'punkte').ok).toBe(false);
    expect(
      ergebnisWerten(
        {
          saetze: [
            [12, 9],
            [11, 0],
          ],
        },
        3,
        'punkte',
      ).ok,
    ).toBe(false);
    expect(
      ergebnisWerten(
        {
          saetze: [
            [14, 12],
            [11, 3],
          ],
        },
        3,
        'punkte',
      ).ok,
    ).toBe(true);
    expect(
      ergebnisWerten(
        {
          saetze: [
            [11, 3],
            [11, 3],
            [11, 3],
          ],
        },
        3,
        'punkte',
      ).ok,
    ).toBe(false); // ein Satz zu viel
    expect(ergebnisWerten({ saetze: [[11, 3]] }, 3, 'punkte').ok).toBe(false); // noch offen
    expect(ergebnisWerten({ stand: [3, 2] }, 5, 'saetze')).toMatchObject({
      ok: true,
      ergebnis: { ballA: null, gewinner: 'a' },
    });
    expect(ergebnisWerten({ stand: [3, 3] }, 5, 'saetze').ok).toBe(false);
  });

  it('wertet Aufgabe und kampflos nach WO D 7.10', () => {
    const a = ergebnisWerten({ saetze: [[11, 5]], aufgabe: 'a', laufend: [7, 3] }, 5, 'punkte');
    expect(a.ok && a.ergebnis.saetze).toEqual([
      [11, 5],
      [7, 11],
      [0, 11],
      [0, 11],
    ]);
    const b = ergebnisWerten({ aufgabe: 'b', laufend: [5, 10] }, 3, 'punkte');
    expect(b.ok && b.ergebnis.saetze).toEqual([
      [12, 10],
      [11, 0],
    ]); // Sieger mindestens X+2
    const k = ergebnisWerten({ kampflos: 'b' }, 5, 'punkte');
    expect(k.ok && k.ergebnis).toMatchObject({
      satzA: 3,
      satzB: 0,
      ballA: 33,
      ballB: 0,
      art: 'kampflos',
    });
    expect(k.ok && ergebnisText(k.ergebnis)).toBe('3:0 kampflos');
  });

  it('bildet Sätze aus den Punkten des Verlierers', () => {
    expect(satzAusVerliererpunkten('a', 9)).toEqual([11, 9]);
    expect(satzAusVerliererpunkten('b', 10)).toEqual([10, 12]);
    expect(satzAusVerliererpunkten('a', 15)).toEqual([17, 15]);
  });
});

describe('Spielfolge und Auslosung', () => {
  it('jeder gegen jeden: jede Paarung genau einmal, 1 gegen 2 zuletzt', () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const plan = rundenplan(n);
      const paare = plan.flat().map(([a, b]) => `${a}-${b}`);
      expect(new Set(paare).size).toBe((n * (n - 1)) / 2);
      expect(paare.length).toBe((n * (n - 1)) / 2);
      expect(plan[plan.length - 1]!.some(([a, b]) => a === 0 && b === 1)).toBe(true);
      for (const r of plan) expect(new Set(r.flat()).size).toBe(r.length * 2); // niemand doppelt je Runde
    }
  });

  it('Gruppen: Schlangenreihenfolge, gleich große Gruppen, Vereinstrennung, reproduzierbar', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);
    const spieler: Record<string, TurnierSpieler> = Object.fromEntries(
      ids.map((id, i) => [id, { id, vorname: id, nachname: '', verein: ['TTC', 'TSV', 'SV'][i % 3]! }]),
    );
    const g = gruppenAuslosen(ids, 3, 6, spieler, true, 7);
    expect(g.map((x) => x.length)).toEqual([4, 4, 4]);
    expect(g.map((x) => x[0])).toEqual(['s1', 's2', 's3']);
    expect(g[2]).toContain('s4'); // Schlange: 4 zurück zu C
    expect(g[0]).toContain('s6');
    for (const gr of g) expect(new Set(gr.map((id) => spieler[id]!.verein)).size).toBeGreaterThanOrEqual(3);
    expect(gruppenAuslosen(ids, 3, 6, spieler, true, 7)).toEqual(g);
    expect(gruppenAuslosen(ids, 3, 6, spieler, true, 8)).not.toEqual(g);
  });

  it('K.-o.: Setzplätze nach WO D 5.3, Freilose zuerst an die Gesetzten', () => {
    const sp = setzplaetze(16, zufallAus(1));
    expect(sp.slice(0, 2)).toEqual([1, 16]);
    expect([...sp.slice(2, 4)].sort((a, b) => a - b)).toEqual([8, 9]);
    expect([...sp.slice(4, 8)].sort((a, b) => a - b)).toEqual([4, 5, 12, 13]);
    const ids = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);
    const plaetze = koAuslosen({
      gesetzte: ids.slice(0, 4),
      stufen: [ids.slice(4)],
      spieler: {},
      vereinstrennung: false,
      zufall: 3,
    });
    expect(plaetze.length).toBe(16);
    expect(plaetze[0]).toBe('s1');
    expect(plaetze[15]).toBe('s2');
    expect(plaetze[1]).toBeNull(); // Freilos gegen Nr. 1
    expect(plaetze[14]).toBeNull();
    expect(plaetze.filter((x) => x === null).length).toBe(4);
    expect(treffRunde(1, 16)).toBe(4);
    expect(treffRunde(1, 2)).toBe(1);
  });
});

describe('Gruppenwertung', () => {
  /** A schlägt B, hat aber die schlechtere Satzdifferenz → DTTB und ITTF unterscheiden sich */
  function gruppe(wertung: 'dttb' | 'ittf') {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c', 'd']) t.spieler(id);
    t.konkurrenz('k', { modus: 'jgj', wertung, setzung: 'keine' }, ['a', 'b', 'c', 'd']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    t.gruppenspiel('k', 'a', 'b', s3(5, -5, 5, -5, 5)); // A 3:2 B
    t.gruppenspiel('k', 'a', 'd', s3(5, -5, 5, -5, 5)); // A 3:2 D
    t.gruppenspiel('k', 'c', 'a', s3(5, 5, 5)); // C 3:0 A
    t.gruppenspiel('k', 'b', 'c', s3(5, 5, 5));
    t.gruppenspiel('k', 'b', 'd', s3(5, 5, 5));
    t.gruppenspiel('k', 'd', 'c', s3(5, 5, 5));
    return tabelle(t.z.konkurrenzen.k!, 0);
  }

  it('DTTB-WO D 7.5: Satzdifferenz vor direktem Vergleich', () => {
    const tab = gruppe('dttb');
    expect(tab.zeilen.map((r) => r.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(tab.fertig).toBe(true);
    expect(tab.zeilen[0]).toMatchObject({
      siege: 2,
      niederlagen: 1,
      saetzeG: 8,
      saetzeV: 3,
    });
  });

  it('ITTF 3.7.5: direkter Vergleich der Punktgleichen zuerst', () => {
    const tab = gruppe('ittf');
    expect(tab.zeilen.map((r) => r.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(tab.zeilen[0]!.punkte).toBe(5); // 2 Siege à 2, 1 Niederlage à 1
  });

  it('Gleichstand ohne Entscheidung → Los', () => {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c']) t.spieler(id);
    t.konkurrenz('k', { modus: 'jgj', setzung: 'keine' }, ['a', 'b', 'c']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    t.gruppenspiel('k', 'a', 'b', s3(5, 5, 5));
    t.gruppenspiel('k', 'b', 'c', s3(5, 5, 5));
    t.gruppenspiel('k', 'c', 'a', s3(5, 5, 5));
    let tab = tabelle(t.z.konkurrenzen.k!, 0);
    expect(tab.losGruppen.length).toBe(1);
    expect(tab.zeilen.every((r) => r.losNoetig)).toBe(true);
    t.e(ART.gruppeLos, {
      konkurrenz: 'k',
      gruppe: 0,
      reihenfolge: ['c', 'a', 'b'],
    });
    tab = tabelle(t.z.konkurrenzen.k!, 0);
    expect(tab.losGruppen.length).toBe(0);
    expect(tab.zeilen.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(t.z.konkurrenzen.k!.status).toBe('beendet');
  });
});

describe('Ergebnis eintragen, bestätigen, anfechten', () => {
  function zwei() {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c']) t.spieler(id);
    t.konkurrenz('k', { modus: 'jgj', setzung: 'keine' }, ['a', 'b', 'c']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    const spiel = Object.values(t.z.konkurrenzen.k!.spiele).find((s) => [s.a, s.b].sort().join() === 'a,b')!;
    return { t, spiel: spiel.id };
  }

  it('Spieler trägt ein (gilt sofort), Gegner bestätigt', () => {
    const { t, spiel } = zwei();
    const e = t.gruppenspiel('k', 'a', 'b', s3(5, 5, 5), spielerAutor('a'));
    expect(t.z.konkurrenzen.k!.spiele[spiel]!.stand).toBe('eingetragen');
    expect(tabelle(t.z.konkurrenzen.k!, 0).zeilen[0]!.id).toBe('a');
    t.e(ART.spielBestaetigt, { konkurrenz: 'k', spiel, ereignis: e }, spielerAutor('b'));
    expect(t.z.konkurrenzen.k!.spiele[spiel]!.stand).toBe('bestaetigt');
  });

  it('abweichender Eintrag des Gegners → Konflikt, Leitung entscheidet', () => {
    const { t, spiel } = zwei();
    t.gruppenspiel('k', 'a', 'b', s3(5, 5, 5), spielerAutor('a'));
    const e2 = t.gruppenspiel('k', 'b', 'a', s3(5, 5, 5), spielerAutor('b'));
    expect(t.z.konkurrenzen.k!.spiele[spiel]!.stand).toBe('konflikt');
    expect(pruefliste(t.z).length).toBe(1);
    t.e(ART.spielEntschieden, { konkurrenz: 'k', spiel, ereignis: e2 });
    const s = t.z.konkurrenzen.k!.spiele[spiel]!;
    expect(s.stand).toBe('bestaetigt');
    expect(s.b === 'b' ? s.gewinner : s.gewinner === 'a' ? 'b' : 'a').toBe(s.b === 'b' ? 'b' : 'a');
    expect(pruefliste(t.z).length).toBe(0);
  });

  it('Anfechtung; fremde Spieler und Leitungs-Ergebnisse sind geschützt', () => {
    const { t, spiel } = zwei();
    const e = t.gruppenspiel('k', 'a', 'b', s3(5, 5, 5), spielerAutor('a'));
    t.gruppenspiel('k', 'a', 'b', s3(1, 1, 1), spielerAutor('c')); // c spielt nicht mit
    expect(t.z.warnungen.at(-1)!.text).toMatch(/nur ihre eigenen Spiele/);
    t.e(ART.spielAngefochten, { konkurrenz: 'k', spiel, ereignis: e }, spielerAutor('b'));
    expect(t.z.konkurrenzen.k!.spiele[spiel]!.stand).toBe('angefochten');
    t.gruppenspiel('k', 'a', 'b', s3(5, -5, 5, 5));
    expect(t.z.konkurrenzen.k!.spiele[spiel]!.stand).toBe('bestaetigt');
    t.gruppenspiel('k', 'a', 'b', s3(-5, -5, -5), spielerAutor('b'));
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Turnierleitung eingetragen/);
  });

  it('Spieler darf nur Ergebnisse senden, nichts anderes', () => {
    const { t } = zwei();
    t.e(ART.spielerAngelegt, { id: 'x', vorname: 'X', nachname: 'Y', verein: '' }, spielerAutor('a'));
    expect(t.z.spieler.x).toBeUndefined();
  });
});

describe('K.-o.', () => {
  function baum(n: number, platz3 = false) {
    const t = new Turnier();
    const ids = Array.from({ length: n }, (_, i) => `s${i + 1}`);
    ids.forEach((id, i) => t.spieler(id, 2000 - i * 10));
    t.konkurrenz('k', { modus: 'ko', platz3 }, ids);
    t.auslosen('k');
    t.starten('k', 'ko');
    return t;
  }
  /** Spielt alle offenen Spiele: der Spieler mit kleinerer Nummer gewinnt */
  function allesSpielen(t: Turnier) {
    for (let i = 0; i < 20; i++) {
      const k = t.z.konkurrenzen.k!;
      const offen = k.reihenfolge.map((id) => k.spiele[id]!).filter((s) => s.status === 'offen');
      if (!offen.length) return;
      for (const s of offen) {
        const aBesser = Number(s.a!.slice(1)) < Number(s.b!.slice(1));
        t.ergebnis('k', s.id, aBesser ? s3(5, 5, 5) : s3(-5, -5, -5));
      }
    }
  }

  it('Freilose, Weitergabe, Platzierungen', () => {
    const t = baum(5, true);
    const k = t.z.konkurrenzen.k!;
    expect(k.auslosungKo!.plaetze.length).toBe(8);
    expect(Object.values(k.spiele).filter((s) => s.status === 'freilos').length).toBe(3);
    allesSpielen(t);
    const p = platzierungen(t.z.konkurrenzen.k!);
    expect(p.slice(0, 2).map((x) => x.id)).toEqual(['s1', 's2']);
    expect(p.slice(0, 4).map((x) => x.platz)).toEqual([1, 2, 3, 4]);
    expect(p.length).toBe(5);
    expect(t.z.konkurrenzen.k!.status).toBe('beendet');
    expect(t.z.konkurrenzen.k!.spiele[PLATZ3_ID]!.status).toBe('gespielt');
  });

  it('Folgespiel mit Ergebnis schützt die Vorrunde; Anfechtung sperrt das Folgespiel', () => {
    const t = baum(4);
    const r1 = koSpielId(1, 0);
    const s = t.z.konkurrenzen.k!.spiele[r1]!;
    const e = t.ergebnis('k', r1, s3(5, 5, 5), spielerAutor(s.a!));
    t.e(ART.spielAngefochten, { konkurrenz: 'k', spiel: r1, ereignis: e }, spielerAutor(s.b!));
    expect(t.z.konkurrenzen.k!.spiele[koSpielId(2, 0)]!.gesperrt).toBe(true);
    t.e(ART.spielEntschieden, { konkurrenz: 'k', spiel: r1, ereignis: e });
    expect(t.z.konkurrenzen.k!.spiele[koSpielId(2, 0)]!.gesperrt).toBe(false);
    allesSpielen(t);
    t.ergebnis('k', r1, s3(-5, -5, -5)); // würde den Sieger ändern
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Folgespiel/);
  });

  it('Rückzug im K.-o.: Gegner kommt kampflos weiter', () => {
    const t = baum(4);
    const s = t.z.konkurrenzen.k!.spiele[koSpielId(1, 0)]!;
    t.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'k', id: s.b });
    const neu = t.z.konkurrenzen.k!.spiele[koSpielId(1, 0)]!;
    expect(neu.status).toBe('gespielt');
    expect(neu.kampflosDurchRueckzug).toBe('b');
    expect(t.z.konkurrenzen.k!.spiele[koSpielId(2, 0)]!.a).toBe(s.a);
  });
});

describe('Rückzug in der Gruppe', () => {
  function gruppe(rueckzug: 'wo' | 'hobby') {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c', 'd']) t.spieler(id);
    t.konkurrenz('k', { modus: 'jgj', setzung: 'keine', rueckzug }, ['a', 'b', 'c', 'd']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    t.gruppenspiel('k', 'd', 'a', s3(5, 5, 5)); // d gewinnt einmal
    t.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'k', id: 'd' });
    return t;
  }
  it('WO D 7.9: Spiele werden gestrichen, Platz zuletzt', () => {
    const t = gruppe('wo');
    const k = t.z.konkurrenzen.k!;
    const vonD = Object.values(k.spiele).filter((s) => s.a === 'd' || s.b === 'd');
    expect(vonD.every((s) => s.gestrichen)).toBe(true);
    expect(vonD.filter((s) => s.status === 'entfallen').length).toBe(2);
    const tab = tabelle(k, 0);
    expect(tab.zeilen.at(-1)).toMatchObject({ id: 'd', zurueckgezogen: true });
    expect(tab.zeilen.find((r) => r.id === 'a')!.niederlagen).toBe(0); // Niederlage gegen d gestrichen
  });
  it('Hobby: gespielte bleiben, offene zählen kampflos verloren', () => {
    const t = gruppe('hobby');
    const tab = tabelle(t.z.konkurrenzen.k!, 0);
    const d = tab.zeilen.find((r) => r.id === 'd')!;
    expect(d).toMatchObject({ siege: 1, niederlagen: 2 });
    expect(tab.zeilen.find((r) => r.id === 'a')!.niederlagen).toBe(1);
  });
  it('WO: kampflos in der Gruppe gilt als Rückzug', () => {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c']) t.spieler(id);
    t.konkurrenz('k', { modus: 'jgj', setzung: 'keine' }, ['a', 'b', 'c']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    t.gruppenspiel('k', 'a', 'c', { kampflos: 'b' });
    const tab = tabelle(t.z.konkurrenzen.k!, 0);
    expect(tab.zeilen.at(-1)).toMatchObject({ id: 'c', zurueckgezogen: true });
  });
});

describe('Gruppen + K.-o.', () => {
  it('kompletter Ablauf: Endrunde mit Gruppensiegern gesetzt, gleiche Gruppe in getrennten Hälften', () => {
    const t = new Turnier();
    const ids = Array.from({ length: 16 }, (_, i) => `s${i + 1}`);
    ids.forEach((id, i) => t.spieler(id, 2000 - i, `Verein ${i % 5}`));
    t.konkurrenz('k', { modus: 'gruppen_ko', gruppenGroesse: 4, aufsteiger: 2 }, ids);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    let k = t.z.konkurrenzen.k!;
    expect(k.gruppen.length).toBe(4);
    expect(k.gruppen.map((g) => g.mitglieder[0])).toEqual(['s1', 's2', 's3', 's4']);
    expect(qualifikanten(k).ok).toBe(false);
    for (const id of k.reihenfolge) {
      const s = k.spiele[id]!;
      const aBesser = Number(s.a!.slice(1)) < Number(s.b!.slice(1));
      t.ergebnis('k', id, aBesser ? s3(5, 5, 5) : s3(-5, -5, -5));
    }
    k = t.z.konkurrenzen.k!;
    const q = qualifikanten(k);
    expect(q.ok).toBe(true);
    const end = endrundeErstellen(t.z, k, 9)!;
    t.e(ART.auslosung, end);
    t.starten('k', 'ko');
    k = t.z.konkurrenzen.k!;
    const plaetze = k.auslosungKo!.plaetze;
    expect(plaetze.length).toBe(8);
    if (q.ok) {
      for (const [sieger, zweiter] of q.gruppen) {
        const p1 = plaetze.indexOf(sieger!) + 1;
        const p2 = plaetze.indexOf(zweiter!) + 1;
        expect(treffRunde(p1, p2)).toBe(3); // erst im Endspiel
      }
    }
    expect(plaetze[0]).toBe('s1');
    expect(plaetze[7]).toBe('s2');
    expect(k.status).toBe('ko');
    expect(spieleVon(t.z, 's1').length).toBe(4);
    expect(uebersichtText(t.z)).toContain('Gruppe A');
  });

  it('Nachmelden nach dem Start wird abgelehnt, Auslosung muss zu den Meldungen passen', () => {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c', 'd']) t.spieler(id);
    t.konkurrenz('k', { modus: 'jgj' }, ['a', 'b', 'c']);
    t.auslosen('k');
    t.e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: 'd' });
    t.starten('k', 'gruppen');
    expect(t.z.konkurrenzen.k!.gestartet.gruppen).toBe(false);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    expect(t.z.konkurrenzen.k!.gestartet.gruppen).toBe(true);
    t.e(ART.spielerAngelegt, {
      id: 'e',
      vorname: 'E',
      nachname: 'E',
      verein: '',
    });
    t.e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: 'e' });
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Nachmelden/);
  });

  it('Zulassung warnt nur', () => {
    const z = {
      ...standardEinstellungen().zulassung,
      ttrMax: 1500,
      klassen: ['B'],
    };
    expect(zulassungsHinweise({ ttr: 1600, klasse: 'A' }, z)).toEqual(['TTR 1600 über 1500', 'Klasse „A“']);
    expect(zulassungsHinweise({ ttr: 1400, klasse: 'b' }, z)).toEqual([]);
  });
});

describe('Paket 4b: Leistungsklassen in den Gruppen', () => {
  it('Klasse eines Spielers nach Begriff oder TTR-Bereich', () => {
    expect(klasseVon({ klasse: ' Anfänger ', ttr: 1200 }, { klassenTrennung: 'klasse', ttrGrenzen: [] })).toBe('anfänger');
    expect(klasseVon({ klasse: null, ttr: 1200 }, { klassenTrennung: 'klasse', ttrGrenzen: [] })).toBe('');
    const ttr = { klassenTrennung: 'ttr' as const, ttrGrenzen: [1500, 1200] };
    expect(klasseVon({ ttr: 1199 }, ttr)).toBe('ttr0');
    expect(klasseVon({ ttr: 1200 }, ttr)).toBe('ttr1');
    expect(klasseVon({ ttr: 1700 }, ttr)).toBe('ttr2');
    expect(klasseVon({ ttr: null }, ttr)).toBe('');
    expect(ttrBereichName(0, [1200, 1500])).toBe('bis 1199');
    expect(ttrBereichName(1, [1200, 1500])).toBe('1200–1499');
    expect(ttrBereichName(2, [1200, 1500])).toBe('ab 1500');
  });

  it('Gruppen werden je Klasse getrennt ausgelost, Endrunde mischt alle', () => {
    const t = new Turnier();
    for (const [id, ttr, kl] of [
      ['a', 1800, 'A'],
      ['b', 1700, 'A'],
      ['c', 1600, 'A'],
      ['d', 1500, 'A'],
      ['e', 1100, 'B'],
      ['f', 1000, 'B'],
      ['g', 900, 'B'],
      ['h', 800, 'B'],
    ] as const) {
      t.e(ART.spielerAngelegt, {
        id,
        vorname: id,
        nachname: 'T',
        verein: '',
        ttr,
        klasse: kl,
      });
    }
    t.konkurrenz(
      'k',
      {
        modus: 'gruppen_ko',
        klassenTrennung: 'klasse',
        gruppenGroesse: 4,
        aufsteiger: 2,
        bestOf: 3,
      },
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    );
    let z = t.z;
    const kl = klassenDerMeldungen(z, z.konkurrenzen.k!);
    expect(kl.map((x) => [x.name, x.mitglieder.length])).toEqual([
      ['A', 4],
      ['B', 4],
    ]);
    t.auslosen('k');
    z = t.z;
    const g = z.konkurrenzen.k!.auslosungGruppen!.gruppen;
    expect(g.length).toBe(2);
    expect(g.map((x) => [...x].sort())).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f', 'g', 'h'],
    ]);
    expect(gruppenKlassen(z, z.konkurrenzen.k!, g)).toEqual(['A', 'B']);
    // Klassentrennung ist nach dem Start fest
    t.starten('k', 'gruppen');
    t.e(ART.konkurrenzGeaendert, {
      id: 'k',
      einst: { ...t.z.konkurrenzen.k!.einst, klassenTrennung: 'keine' },
    });
    expect(t.z.konkurrenzen.k!.einst.klassenTrennung).toBe('klasse');
    expect(t.z.warnungen.length).toBe(1);
    // Alle Gruppenspiele: 1 schlägt 2 schlägt 3 …
    for (const grp of g) for (let i = 0; i < grp.length; i++) for (let j = i + 1; j < grp.length; j++) t.gruppenspiel('k', grp[i]!, grp[j]!, s3(5, 5));
    const q = qualifikanten(t.z.konkurrenzen.k!);
    expect(q.ok && q.gruppen.flat().sort()).toEqual(['a', 'b', 'e', 'f']);
    t.e(ART.auslosung, endrundeErstellen(t.z, t.z.konkurrenzen.k!, 7)!);
    const plaetze = t.z.konkurrenzen.k!.auslosungKo!.plaetze;
    expect(plaetze.filter(Boolean).sort()).toEqual(['a', 'b', 'e', 'f']);
  });

  it('TTR-Bereiche: Spieler ohne TTR bilden eine eigene Gruppe', () => {
    const t = new Turnier();
    t.spieler('a', 1800);
    t.spieler('b', 1750);
    t.spieler('c', 1100);
    t.spieler('d', 1050);
    t.spieler('e', null);
    t.spieler('f', null);
    t.konkurrenz(
      'k',
      {
        modus: 'gruppen_ko',
        klassenTrennung: 'ttr',
        ttrGrenzen: [1500],
        gruppenGroesse: 4,
      },
      ['a', 'b', 'c', 'd', 'e', 'f'],
    );
    t.auslosen('k');
    const z = t.z;
    const g = z.konkurrenzen.k!.auslosungGruppen!.gruppen;
    expect(g.map((x) => [...x].sort())).toEqual([
      ['c', 'd'],
      ['a', 'b'],
      ['e', 'f'],
    ]);
    expect(gruppenKlassen(z, z.konkurrenzen.k!, g)).toEqual(['TTR bis 1499', 'TTR ab 1500', 'ohne Angabe']);
  });
});

describe('Paket 4b: Verdeckte Stände', () => {
  it('Turnier- und Konkurrenz-Einstellung, „Ergebnisse veröffentlichen“ hebt alles auf', () => {
    const t = new Turnier();
    t.spieler('a');
    t.spieler('b');
    t.konkurrenz('k1', { modus: 'jgj' }, ['a', 'b']);
    t.konkurrenz('k2', { modus: 'jgj', veroeffentlichung: { tabellen: false, ko: true } }, ['a', 'b']);
    let z = t.z;
    expect(z.veroeffentlichung).toEqual({ tabellen: true, ko: true });
    expect(sichtbar(z, z.konkurrenzen.k1!)).toEqual({
      tabellen: true,
      ko: true,
    });
    expect(sichtbar(z, z.konkurrenzen.k2!)).toEqual({
      tabellen: false,
      ko: true,
    });
    expect(etwasVerdeckt(z)).toBe(true);
    t.e(ART.turnierDaten, {
      veroeffentlichung: { tabellen: false, ko: false },
    });
    z = t.z;
    expect(sichtbar(z, z.konkurrenzen.k1!)).toEqual({
      tabellen: false,
      ko: false,
    });
    // Spieler dürfen das nicht ändern
    t.e(ART.turnierDaten, { veroeffentlichung: { tabellen: true, ko: true } }, spielerAutor('a'));
    expect(t.z.veroeffentlichung.tabellen).toBe(false);
    t.e(ART.turnierDaten, {
      veroeffentlichung: { tabellen: true, ko: true },
      alleKonkurrenzen: true,
    });
    z = t.z;
    expect(etwasVerdeckt(z)).toBe(false);
    expect(z.konkurrenzen.k2!.einst.veroeffentlichung).toBeNull();
  });
});

describe('Paket 4b: Spieler mit Helfer-Recht', () => {
  it('fremde Spiele amtlich, eigene wie ein Spieler', () => {
    const t = new Turnier();
    t.spieler('a');
    t.spieler('b');
    t.spieler('c');
    t.konkurrenz('k', { modus: 'jgj', bestOf: 3 }, ['a', 'b', 'c']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    const helfer: Autor = {
      rolle: 'spieler',
      name: 'A',
      spieler: 'a',
      helfer: true,
    };
    t.gruppenspiel('k', 'b', 'c', s3(3, 3), helfer);
    const bc = Object.values(t.z.konkurrenzen.k!.spiele).find((s) => s.a !== 'a' && s.b !== 'a')!;
    expect(bc.stand).toBe('bestaetigt');
    expect(bc.eintrag!.amtlich).toBe(true);
    t.gruppenspiel('k', 'a', 'b', s3(3, 3), helfer);
    const ab = Object.values(t.z.konkurrenzen.k!.spiele).find((s) => [s.a, s.b].includes('a') && [s.a, s.b].includes('b'))!;
    expect(ab.stand).toBe('eingetragen');
    expect(ab.eintrag!.amtlich).toBe(false);
    expect(t.z.warnungen.length).toBe(0);
  });
});

describe('Paket 4b: Leistungsklassen, Veröffentlichung, Spieler als Helfer', () => {
  it('Klassentrennung: Gruppen nur aus gleicher Klasse, Endrunde gemischt', () => {
    const t = new Turnier();
    for (const [id, kl] of [
      ['a', 'A'],
      ['b', 'A'],
      ['c', 'A'],
      ['d', 'A'],
      ['e', 'B'],
      ['f', 'B'],
      ['g', 'B'],
      ['h', 'B'],
      ['i', 'B'],
      ['j', 'B'],
    ] as const) {
      t.e(ART.spielerAngelegt, {
        id,
        vorname: id,
        nachname: 'T',
        verein: '',
        klasse: kl,
      });
    }
    t.e(ART.turnierDaten, { angaben: ['klasse'] });
    t.konkurrenz(
      'k',
      {
        modus: 'gruppen_ko',
        gruppenGroesse: 3,
        klassenTrennung: 'klasse',
        aufsteiger: 1,
      },
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    );
    const z0 = t.z;
    expect(klassenDerMeldungen(z0, z0.konkurrenzen.k!).map((k) => `${k.name}:${k.mitglieder.length}`)).toEqual(['A:4', 'B:6']);
    t.auslosen('k');
    const k = t.z.konkurrenzen.k!;
    const gruppen = k.auslosungGruppen!.gruppen;
    expect(gruppen.length).toBe(4); // je Klasse eigene Gruppen zu höchstens 3
    const klassen = gruppenKlassen(t.z, k, gruppen);
    expect(klassen).toEqual(['A', 'A', 'B', 'B']);
    for (const g of gruppen) expect(new Set(g.map((s) => t.z.spieler[s]!.klasse)).size).toBe(1);
    t.starten('k', 'gruppen');
    expect(t.z.konkurrenzen.k!.gruppen.length).toBe(4);
  });

  it('TTR-Bereiche: Grenzen bilden Stufen, ohne TTR eigener Bereich', () => {
    const t = new Turnier();
    t.spieler('a', 1100);
    t.spieler('b', 1250);
    t.spieler('c', 1600);
    t.spieler('d', null);
    t.spieler('e', 1199);
    t.spieler('f', 1500);
    t.konkurrenz(
      'k',
      {
        modus: 'gruppen_ko',
        gruppenGroesse: 4,
        klassenTrennung: 'ttr',
        ttrGrenzen: [1200, 1500],
      },
      ['a', 'b', 'c', 'd', 'e', 'f'],
    );
    const z = t.z;
    const kl = klassenDerMeldungen(z, z.konkurrenzen.k!);
    expect(kl.map((x) => `${x.name}|${x.mitglieder.sort().join('')}`)).toEqual(['TTR bis 1199|ae', 'TTR 1200–1499|b', 'TTR ab 1500|cf', 'ohne Angabe|d']);
    expect(ttrBereichName(0, [1200, 1500])).toBe('bis 1199');
  });

  it('Veröffentlichung: Turnier-Standard, Abweichung je Konkurrenz, „alles veröffentlichen“', () => {
    const t = new Turnier();
    t.spieler('a');
    t.spieler('b');
    t.konkurrenz('k1', { modus: 'jgj' }, ['a', 'b']);
    t.konkurrenz('k2', { modus: 'jgj', veroeffentlichung: { tabellen: false, ko: false } }, ['a', 'b']);
    let z = t.z;
    expect(z.veroeffentlichung).toEqual({ tabellen: true, ko: true });
    expect(sichtbar(z, z.konkurrenzen.k1!)).toEqual({
      tabellen: true,
      ko: true,
    });
    expect(sichtbar(z, z.konkurrenzen.k2!)).toEqual({
      tabellen: false,
      ko: false,
    });
    expect(etwasVerdeckt(z)).toBe(true);
    t.e(ART.turnierDaten, { veroeffentlichung: { tabellen: false, ko: true } });
    z = t.z;
    expect(sichtbar(z, z.konkurrenzen.k1!)).toEqual({
      tabellen: false,
      ko: true,
    });
    t.e(ART.turnierDaten, {
      veroeffentlichung: { tabellen: true, ko: true },
      alleKonkurrenzen: true,
    });
    z = t.z;
    expect(etwasVerdeckt(z)).toBe(false);
    expect(z.konkurrenzen.k2!.einst.veroeffentlichung).toBeNull();
    // Unsinn wird ignoriert
    t.e(ART.turnierDaten, { veroeffentlichung: { tabellen: 'ja' } });
    expect(t.z.veroeffentlichung).toEqual({ tabellen: true, ko: true });
  });

  it('Spieler mit Helferrecht: fremde Spiele amtlich, eigene wie ein Spieler', () => {
    const t = new Turnier();
    t.spieler('a');
    t.spieler('b');
    t.spieler('c');
    t.konkurrenz('k', { modus: 'jgj' }, ['a', 'b', 'c']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    const helferA: Autor = {
      rolle: 'spieler',
      name: 'A',
      spieler: 'a',
      helfer: true,
    };
    t.gruppenspiel('k', 'b', 'c', s3(5, 6, 7), helferA);
    t.gruppenspiel('k', 'a', 'b', s3(5, 6, 7), helferA);
    const k = t.z.konkurrenzen.k!;
    const bc = Object.values(k.spiele).find((s) => [s.a, s.b].includes('b') && [s.a, s.b].includes('c'))!;
    const ab = Object.values(k.spiele).find((s) => [s.a, s.b].includes('a') && [s.a, s.b].includes('b'))!;
    expect(bc.eintrag?.amtlich).toBe(true);
    expect(bc.stand).toBe('bestaetigt');
    expect(ab.eintrag?.amtlich).toBe(false);
    expect(ab.stand).toBe('eingetragen');
  });
});
