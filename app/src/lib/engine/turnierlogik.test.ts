import { describe, expect, it } from 'vitest';
import { ART, type Autor } from '@shared/protokoll';
import {
  anstehendeSpiele,
  automatischeAufrufe,
  auslosungErstellen,
  letztesSpielEnde,
  oeffentlich,
  pauseMinuten,
  verliererAmTisch,
  endrundeErstellen,
  etwasVerdeckt,
  freierTisch,
  gruppenKlassen,
  klassenDerMeldungen,
  meinAufruf,
  name,
  platzierungen,
  pruefliste,
  qualifikanten,
  sichtbar,
  spieleVon,
  tabelle,
  teilnehmerDaten,
  tische,
  trostPlaetze,
  vorgabeVon,
  zulassungsHinweise,
} from './abfragen';
import { gruppenAuslosen, koAuslosen, setzplaetze, treffRunde } from './auslosung';
import { ergebnisText, ergebnisWerten, satzAusVerliererpunkten } from './ergebnis';
import { PLATZ3_ID, koSpielId, rundenName } from './ko';
import { istKurzname, klasseVon, kurzname, paarName, standardEinstellungen, ttrBereichName, vorlaeufigePlatzierungen, type ErgebnisEingabe, type KonkurrenzEinstellungen, type TurnierSpieler } from './modell';
import { rundenplan } from './rundenplan';
import { Baukasten } from './test/baukasten';
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

  it('F-031: Ein strittiges K.-o.-Finale macht nur Platz 1 und 2 vorläufig', () => {
    const t = new Baukasten();
    for (const id of ['a', 'b', 'c', 'd']) t.spieler(id);
    t.konkurrenz('ko', { modus: 'ko' }, ['a', 'b', 'c', 'd']);
    t.auslosen('ko');
    t.starten('ko', 'ko');
    const halbfinale = Object.values(t.z.konkurrenzen.ko!.spiele).filter((s) => s.runde === 1 && s.status === 'offen');
    expect(halbfinale).toHaveLength(2);
    for (const s of halbfinale) t.ergebnis('ko', s.id, s3(5, 5, 5));
    const finale = Object.values(t.z.konkurrenzen.ko!.spiele).find((s) => s.runde === 2 && s.status === 'offen')!;
    const ersterEintrag = t.ergebnis('ko', finale.id, s3(5, 5, 5), spielerAutor(finale.a!));
    t.ergebnis('ko', finale.id, s3(-5, -5, -5), spielerAutor(finale.b!));
    expect(t.z.konkurrenzen.ko!.spiele[finale.id]?.stand).toBe('konflikt');
    expect(vorlaeufigePlatzierungen(t.z.konkurrenzen.ko!)).toEqual(new Set([finale.a, finale.b]));
    t.e(ART.spielEntschieden, { konkurrenz: 'ko', spiel: finale.id, ereignis: ersterEintrag });
    expect(vorlaeufigePlatzierungen(t.z.konkurrenzen.ko!).size).toBe(0);
  });

  it('abweichender Eintrag des Gegners → Konflikt, Leitung entscheidet', () => {
    const { t, spiel } = zwei();
    t.gruppenspiel('k', 'a', 'b', s3(5, 5, 5), spielerAutor('a'));
    const e2 = t.gruppenspiel('k', 'b', 'a', s3(5, 5, 5), spielerAutor('b'));
    expect(t.z.konkurrenzen.k!.spiele[spiel]!.stand).toBe('konflikt');
    expect(pruefliste(t.z).length).toBe(1);
    t.e(ART.turnierAbgeschlossen, {});
    expect(t.z.abgeschlossen).toBe(false);
    t.e(ART.spielEntschieden, { konkurrenz: 'k', spiel, ereignis: e2 });
    t.e(ART.turnierAbgeschlossen, {});
    expect(t.z.abgeschlossen).toBe(true);
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
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Gruppe für die Nachmeldung/);
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


/** Sieger eines K.-o.-Spiels eintragen: a gewinnt 3:0 bzw. b */
function koSieg(t: Turnier, k: string, spiel: string, wer: 'a' | 'b') {
  const s = t.z.konkurrenzen[k]!.spiele[spiel]!;
  expect(s.status, `${spiel} sollte offen sein`).toBe('offen');
  t.ergebnis(k, spiel, wer === 'a' ? s3(5, 6, 7) : s3(-5, -6, -7));
}

describe('Etappe 5: Trostrunde', () => {
  it('Verlierer der ersten Runde spielen in der Trostrunde weiter, eigene Platzierung', () => {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) t.spieler(id, 1800 - id.charCodeAt(0));
    t.konkurrenz('k', { modus: 'ko', trostrunde: true, platz3: true }, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    t.auslosen('k');
    t.starten('k', 'ko');
    let k = t.z.konkurrenzen.k!;
    const trost = Object.values(k.spiele).filter((s) => s.baum === 'trost');
    expect(trost.map((s) => s.id).sort()).toEqual(['tr-1-0', 'tr-1-1', 'tr-2-0']);
    expect(trost.every((s) => s.status === 'wartet')).toBe(true);
    expect(k.spiele['ko-1-0']!.verliererWeiter).toEqual({ spiel: 'tr-1-0', seite: 'a' });
    // erste Runde: immer a gewinnt
    for (let i = 0; i < 4; i++) koSieg(t, 'k', koSpielId(1, i), 'a');
    k = t.z.konkurrenzen.k!;
    const verlierer = [0, 1, 2, 3].map((i) => k.spiele[koSpielId(1, i)]!.b);
    expect(k.spiele['tr-1-0']!.a).toBe(verlierer[0]);
    expect(k.spiele['tr-1-0']!.b).toBe(verlierer[1]);
    expect(k.spiele['tr-1-1']!.a).toBe(verlierer[2]);
    expect(k.spiele['tr-1-1']!.status).toBe('offen');
    koSieg(t, 'k', 'tr-1-0', 'b');
    koSieg(t, 'k', 'tr-1-1', 'a');
    koSieg(t, 'k', 'tr-2-0', 'a');
    k = t.z.konkurrenzen.k!;
    const tp = trostPlaetze(k);
    expect(tp.find((p) => p.platz === 1)?.id).toBe(verlierer[1]);
    expect(tp.find((p) => p.platz === 2)?.id).toBe(verlierer[2]);
    expect(tp.filter((p) => p.bezeichnung === '3–4').map((p) => p.id).sort()).toEqual([verlierer[0], verlierer[3]].sort());
    // Hauptrunde: Verlierer der 1. Runde tauchen nicht als 5–8 auf
    expect(platzierungen(k).some((p) => p.bezeichnung === '5–8')).toBe(false);
    expect(rundenName(2, 2, 'trost')).toBe('Trostrunde: Endspiel');
    // Konkurrenz ist erst beendet, wenn auch die Trostrunde durch ist
    expect(k.status).toBe('ko');
  });

  it('Freilos in Runde 1 ergibt Freilos in der Trostrunde', () => {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) t.spieler(id, 1800 - id.charCodeAt(0));
    t.konkurrenz('k', { modus: 'ko', trostrunde: true }, ['a', 'b', 'c', 'd', 'e', 'f']);
    t.auslosen('k');
    t.starten('k', 'ko');
    const k = t.z.konkurrenzen.k!;
    const freilose = Object.values(k.spiele).filter((s) => s.baum === 'haupt' && s.runde === 1 && s.status === 'freilos');
    expect(freilose.length).toBe(2);
    // je Freilos-Spiel kommt kein Verlierer: Trostspiel hat eine freie Seite
    const trostFrei = Object.values(k.spiele).filter((s) => s.baum === 'trost' && s.runde === 1 && (s.aFrei || s.bFrei));
    expect(trostFrei.length).toBeGreaterThan(0);
  });
});

describe('Etappe 5: Doppel-K.-o.', () => {
  it('4 Teilnehmer: Verliererbaum, Endspiel, zweites Endspiel nur wenn der Verliererbaum gewinnt', () => {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c', 'd']) t.spieler(id, 1800 - id.charCodeAt(0));
    t.konkurrenz('k', { modus: 'doppel_ko', finaleWiederholung: true }, ['a', 'b', 'c', 'd']);
    t.auslosen('k');
    t.starten('k', 'ko');
    let k = t.z.konkurrenzen.k!;
    expect(k.reihenfolge).toEqual(['ko-1-0', 'ko-1-1', 'vl-1-0', 'ko-2-0', 'vl-2-0', 'fi-1-0', 'fi-2-0']);
    koSieg(t, 'k', 'ko-1-0', 'a');
    koSieg(t, 'k', 'ko-1-1', 'a');
    k = t.z.konkurrenzen.k!;
    const [w1, l1, w2, l2] = [k.spiele['ko-1-0']!.a, k.spiele['ko-1-0']!.b, k.spiele['ko-1-1']!.a, k.spiele['ko-1-1']!.b];
    expect([k.spiele['vl-1-0']!.a, k.spiele['vl-1-0']!.b]).toEqual([l1, l2]);
    expect([k.spiele['ko-2-0']!.a, k.spiele['ko-2-0']!.b]).toEqual([w1, w2]);
    koSieg(t, 'k', 'vl-1-0', 'a'); // l1 weiter
    koSieg(t, 'k', 'ko-2-0', 'b'); // w2 ins Endspiel, w1 in den Verliererbaum
    k = t.z.konkurrenzen.k!;
    expect([k.spiele['vl-2-0']!.a, k.spiele['vl-2-0']!.b]).toEqual([l1, w1]);
    koSieg(t, 'k', 'vl-2-0', 'b'); // w1 gewinnt den Verliererbaum
    k = t.z.konkurrenzen.k!;
    expect([k.spiele['fi-1-0']!.a, k.spiele['fi-1-0']!.b]).toEqual([w2, w1]);
    expect(k.spiele['fi-2-0']!.status).toBe('wartet');
    // Verliererbaum-Sieger gewinnt das erste Endspiel → zweites Endspiel
    koSieg(t, 'k', 'fi-1-0', 'b');
    k = t.z.konkurrenzen.k!;
    expect(k.spiele['fi-2-0']!.status).toBe('offen');
    expect([k.spiele['fi-2-0']!.a, k.spiele['fi-2-0']!.b]).toEqual([w1, w2]);
    expect(platzierungen(k).find((p) => p.platz === 1)).toBeUndefined();
    koSieg(t, 'k', 'fi-2-0', 'b');
    k = t.z.konkurrenzen.k!;
    const p = platzierungen(k);
    expect(p.find((x) => x.platz === 1)?.id).toBe(w2);
    expect(p.find((x) => x.platz === 2)?.id).toBe(w1);
    expect(p.find((x) => x.platz === 3)?.id).toBe(l1);
    expect(p.find((x) => x.platz === 4)?.id).toBe(l2);
    expect(k.status).toBe('beendet');
  });

  it('Hauptrundensieger gewinnt das Endspiel → zweites Endspiel entfällt; 8er-Baum hat 6 Verliererrunden', () => {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) t.spieler(id, 1800 - id.charCodeAt(0));
    t.konkurrenz('k', { modus: 'doppel_ko', finaleWiederholung: true }, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    t.auslosen('k');
    t.starten('k', 'ko');
    let k = t.z.konkurrenzen.k!;
    const vl = Object.values(k.spiele).filter((s) => s.baum === 'verlierer');
    expect(Math.max(...vl.map((s) => s.runde))).toBe(4);
    expect(vl.length).toBe(6); // 2 + 2 + 1 + 1
    // alles a gewinnt
    for (const id of k.reihenfolge) {
      const s = t.z.konkurrenzen.k!.spiele[id]!;
      if (s.status === 'offen') koSieg(t, 'k', id, 'a');
    }
    k = t.z.konkurrenzen.k!;
    expect(k.spiele['fi-1-0']!.status).toBe('gespielt');
    expect(k.spiele['fi-2-0']!.status).toBe('entfallen');
    expect(k.status).toBe('beendet');
    const p = platzierungen(k);
    expect(p.map((x) => x.platz).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 5, 7, 7]);
    expect(rundenName(3, 3, 'verlierer')).toBe('Verliererrunde 3');
  });
});

describe('Etappe 5: Doppel und Mixed', () => {
  it('Paare melden, Namen, Setzung nach Summen-TTR, Spieler trägt als Teil des Paares ein', () => {
    const t = new Turnier();
    t.e(ART.spielerAngelegt, { id: 'a', vorname: 'Anna', nachname: 'Alpha', verein: 'TTC', ttr: 1500, geschlecht: 'w' });
    t.e(ART.spielerAngelegt, { id: 'b', vorname: 'Ben', nachname: 'Beta', verein: 'TTC', ttr: 1400, geschlecht: 'm' });
    t.e(ART.spielerAngelegt, { id: 'c', vorname: 'Cem', nachname: 'Gamma', verein: 'SV', ttr: 1300, geschlecht: 'm' });
    t.e(ART.spielerAngelegt, { id: 'd', vorname: 'Dora', nachname: 'Delta', verein: 'SV', ttr: 1200, geschlecht: 'w' });
    t.e(ART.spielerAngelegt, { id: 'e', vorname: 'Eva', nachname: 'Delta', verein: 'SV', ttr: 1100, geschlecht: 'w' });
    t.e(ART.spielerAngelegt, { id: 'f', vorname: 'Fin', nachname: 'Zeta', verein: 'SV', ttr: null, geschlecht: 'm' });
    t.e(ART.konkurrenzAngelegt, { id: 'k', einst: { ...standardEinstellungen('Mixed'), art: 'mixed', modus: 'jgj' } });
    // Einzelmeldung im Doppel geht nicht
    t.e(ART.teilnehmerGemeldet, { konkurrenz: 'k', id: 'a' });
    t.e(ART.paarGemeldet, { konkurrenz: 'k', id: 'p-0001', spieler: ['a', 'b'] });
    t.e(ART.paarGemeldet, { konkurrenz: 'k', id: 'p-0002', spieler: ['c', 'd'] });
    t.e(ART.paarGemeldet, { konkurrenz: 'k', id: 'p-0003', spieler: ['e', 'f'] });
    t.e(ART.paarGemeldet, { konkurrenz: 'k', id: 'p-0004', spieler: ['a', 'c'] }); // a schon gemeldet
    t.e(ART.paarGemeldet, { konkurrenz: 'k', id: 'p-0005', spieler: ['d', 'e'] }); // zwei Frauen im Mixed, d schon gemeldet
    let z = t.z;
    let k = z.konkurrenzen.k!;
    expect(k.meldungen).toEqual(['p-0001', 'p-0002', 'p-0003']);
    expect(z.warnungen.length).toBe(3);
    expect(name(z, 'p-0001')).toBe('Alpha/Beta');
    expect(name(z, 'p-0002')).toBe('Gamma/Delta');
    const daten = teilnehmerDaten(z, k);
    expect(daten['p-0001']!.ttr).toBe(2900);
    expect(daten['p-0001']!.verein).toBe('TTC');
    expect(daten['p-0002']!.verein).toBe('SV');
    expect(daten['p-0003']!.ttr).toBeNull();
    // Mixed mit gleichem Geschlecht wird abgelehnt
    t.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'k', id: 'p-0003' });
    t.e(ART.paarGemeldet, { konkurrenz: 'k', id: 'p-0006', spieler: ['e', 'a'] });
    z = t.z;
    expect(z.konkurrenzen.k!.meldungen).toEqual(['p-0001', 'p-0002']);
    expect(z.konkurrenzen.k!.paare['p-0003']).toBeUndefined();
    t.e(ART.paarGemeldet, { konkurrenz: 'k', id: 'p-0003', spieler: ['e', 'f'] });
    t.auslosen('k');
    t.starten('k', 'gruppen');
    z = t.z;
    k = z.konkurrenzen.k!;
    expect(k.gruppen[0]!.mitglieder).toHaveLength(3);
    expect(k.gruppen[0]!.mitglieder[0]).toBe('p-0001'); // höchste TTR-Summe gesetzt
    // Anna trägt das Spiel ihres Paares ein (zählt als Spielereintrag ihrer Seite)
    const sp = Object.values(k.spiele).find((s) => [s.a, s.b].includes('p-0001') && [s.a, s.b].includes('p-0002'))!;
    t.e(ART.spielErgebnis, { konkurrenz: 'k', spiel: sp.id, a: sp.a, b: sp.b, ergebnis: sp.a === 'p-0001' ? s3(5, 6, 7) : s3(-5, -6, -7) }, spielerAutor('a'));
    z = t.z;
    const sp2 = z.konkurrenzen.k!.spiele[sp.id]!;
    expect(sp2.stand).toBe('eingetragen');
    expect(sp2.eintrag?.seite).toBe(sp.a === 'p-0001' ? 'a' : 'b');
    // Fin (Paar p3) darf dieses Spiel nicht eintragen
    t.e(ART.spielErgebnis, { konkurrenz: 'k', spiel: sp.id, a: sp.a, b: sp.b, ergebnis: s3(5, 6, 7) }, spielerAutor('f'));
    expect(t.z.warnungen.at(-1)?.text).toMatch(/eigenen Spiele/);
    // Meine Spiele: Anna sieht die Spiele von p1
    expect(spieleVon(z, 'a').length).toBe(2);
    // Spieler, der in einer laufenden Doppel-Konkurrenz steckt, lässt sich nicht löschen
    t.e(ART.spielerEntfernt, { id: 'a' });
    expect(t.z.spieler.a).toBeDefined();
  });
});

describe('Etappe 5: Tische und Spielaufruf', () => {
  it('Aufruf belegt Tisch, Schiedsrichter, Ergebnis gibt den Tisch frei, Helfer dürfen aufrufen', () => {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c', 'd', 'e']) t.spieler(id);
    t.e(ART.turnierDaten, { tische: 2 });
    t.konkurrenz('k', { modus: 'jgj' }, ['a', 'b', 'c', 'd']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    let z = t.z;
    expect(tische(z).map((x) => x.nr)).toEqual([1, 2]);
    expect(freierTisch(z)).toBe(1);
    const an = anstehendeSpiele(z);
    expect(an.length).toBe(6);
    expect(an.every((x) => x.bereit)).toBe(true);
    const erstes = an[0]!.spiel;
    const helfer: Autor = { rolle: 'helfer', name: 'Helga' };
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: erstes.id, tisch: 1, schiri: { spieler: 'e' } }, helfer);
    z = t.z;
    const s = z.konkurrenzen.k!.spiele[erstes.id]!;
    expect(s.tisch).toBe(1);
    expect(s.schiri).toEqual({ name: 'E Test', spieler: 'e' });
    expect(tische(z)[0]!.spiel?.id).toBe(erstes.id);
    expect(freierTisch(z)).toBe(2);
    expect(meinAufruf(z, s.a!).spielt?.id).toBe(erstes.id);
    expect(meinAufruf(z, 'e').pfeift?.id).toBe(erstes.id);
    // Spiele der Beschäftigten rutschen nach hinten
    const an2 = anstehendeSpiele(z);
    expect(an2.length).toBe(5);
    expect(an2.filter((x) => x.bereit).length).toBe(1); // nur das Spiel der beiden anderen
    // Tisch 1 ist belegt, Tisch 3 gibt es nicht ohne Angabe > 2? (zahl erlaubt, aber Warnung bei belegt)
    const zweites = an2.find((x) => x.bereit)!.spiel;
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: zweites.id, tisch: 1 });
    expect(t.z.warnungen.at(-1)?.text).toMatch(/belegt/);
    t.e(ART.tischGesperrt, { nr: 2, gesperrt: true });
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: zweites.id, tisch: 2 });
    expect(t.z.warnungen.at(-1)?.text).toMatch(/gesperrt/);
    expect(freierTisch(t.z)).toBeNull();
    t.e(ART.tischGesperrt, { nr: 2, gesperrt: false });
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: zweites.id, tisch: 2 });
    expect(t.z.konkurrenzen.k!.spiele[zweites.id]!.tisch).toBe(2);
    // Spieler ohne Helferrecht darf nicht aufrufen
    t.e(ART.spielAufrufZurueck, { konkurrenz: 'k', spiel: zweites.id }, spielerAutor('a'));
    expect(t.z.konkurrenzen.k!.spiele[zweites.id]!.tisch).toBe(2);
    // Ergebnis → Tisch frei, Tisch bleibt am Spiel vermerkt
    t.ergebnis('k', erstes.id, s3(5, 6, 7));
    z = t.z;
    expect(z.konkurrenzen.k!.spiele[erstes.id]!.tisch).toBe(1);
    expect(tische(z)[0]!.spiel).toBeNull();
    // Aufruf zurücknehmen
    t.e(ART.spielAufrufZurueck, { konkurrenz: 'k', spiel: zweites.id });
    expect(t.z.konkurrenzen.k!.spiele[zweites.id]!.tisch).toBeNull();
    // beendetes Spiel: Aufruf zurücknehmen geht nicht mehr
    t.e(ART.spielAufrufZurueck, { konkurrenz: 'k', spiel: erstes.id }, helfer);
    expect(t.z.konkurrenzen.k!.spiele[erstes.id]!.tisch).toBe(1);
    // Spieler mit Helferrecht ruft fremde Spiele auf, eigene nicht
    const sh = (id: string): Autor => ({ ...spielerAutor(id), helfer: true });
    const eigenes = Object.values(t.z.konkurrenzen.k!.spiele).find((x) => x.status === 'offen' && (x.a === 'a' || x.b === 'a'))!;
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: eigenes.id, tisch: 2 }, sh('a'));
    expect(t.z.konkurrenzen.k!.spiele[eigenes.id]!.tisch).toBeNull();
    expect(t.z.warnungen.at(-1)?.text).toMatch(/Eigene Spiele/);
  });
});

describe('Robustheit gegen manipulierte Ereignisse', () => {
  it('Schlüssel wie __proto__ oder constructor legen das Turnier nicht lahm', () => {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c', 'd']) t.spieler(id);
    t.konkurrenz('k', { modus: 'jgj' }, ['a', 'b', 'c', 'd']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    const helfer: Autor = { rolle: 'helfer', name: 'Helga' };
    for (const boese of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      t.e(ART.spielAufrufZurueck, { konkurrenz: boese, spiel: 'x' }, helfer);
      t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: boese, tisch: 1, schiri: { spieler: boese } }, helfer);
      t.e(ART.spielErgebnis, { konkurrenz: boese, spiel: boese }, spielerAutor('a'));
      t.e(ART.paarGemeldet, { konkurrenz: 'k', id: boese, spieler: [boese, 'a'] });
      t.e(ART.teilnehmerGemeldet, { konkurrenz: 'k', spieler: boese });
    }
    const z = t.z;
    expect(Object.keys(z.konkurrenzen)).toEqual(['k']);
    expect(z.konkurrenzen.k!.meldungen).toEqual(['a', 'b', 'c', 'd']);
    expect(z.warnungen.length).toBeGreaterThan(0);
    // das Turnier bleibt bedienbar
    const s = Object.values(z.konkurrenzen.k!.spiele)[0]!;
    t.ergebnis('k', s.id, s3(5, 6, 7));
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.status).not.toBe('offen');
  });
});

/* ---------------- Etappe 6 ---------------- */

/** Spielt alle offenen Spiele der aktuellen Runde: Wer in `staerke` weiter vorn steht, gewinnt */
function rundeSpielen(t: Turnier, k: string, staerke: string[]) {
  const ko = t.z.konkurrenzen[k]!;
  for (const s of Object.values(ko.spiele).filter((x) => x.status === 'offen')) {
    const aGewinnt = staerke.indexOf(s.a!) < staerke.indexOf(s.b!);
    t.ergebnis(k, s.id, aGewinnt ? s3(5, 6, 7) : s3(-5, -6, -7));
  }
}
function paarungen(t: Turnier, k: string, runde: number): string[] {
  return Object.values(t.z.konkurrenzen[k]!.spiele)
    .filter((s) => s.runde === runde)
    .sort((x, y) => x.index - y.index)
    .map((s) => `${s.a}-${s.b ?? 'frei'}`);
}

describe('Etappe 6: Schweizer System', () => {
  const acht = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  function aufbau(n = acht, einst: Partial<KonkurrenzEinstellungen> = {}) {
    const t = new Turnier();
    n.forEach((id, i) => t.spieler(id, 2000 - i * 50));
    t.konkurrenz('k', { modus: 'schweizer', ...einst }, n);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    return t;
  }
  it('Runde 1: obere Hälfte gegen untere, dann Punktgruppen, keine Wiederholung, Endstand', () => {
    const t = aufbau();
    expect(paarungen(t, 'k', 1)).toEqual(['a-e', 'b-f', 'c-g', 'd-h']);
    rundeSpielen(t, 'k', acht);
    // Sieger unter sich, Verlierer unter sich (obere gegen untere Hälfte der Punktgruppe)
    expect(paarungen(t, 'k', 2)).toEqual(['a-c', 'b-d', 'e-g', 'f-h']);
    rundeSpielen(t, 'k', acht);
    rundeSpielen(t, 'k', acht);
    rundeSpielen(t, 'k', acht);
    const z = t.z;
    const k = z.konkurrenzen.k!;
    expect(Math.max(...Object.values(k.spiele).map((s) => s.runde))).toBe(4); // ⌈log₂ 8⌉ + 1
    expect(k.status).toBe('beendet');
    const paare = Object.values(k.spiele).map((s) => [s.a, s.b].sort().join('-'));
    expect(new Set(paare).size).toBe(paare.length);
    expect(platzierungen(k)[0]!.id).toBe('a');
    expect(platzierungen(k)[7]!.id).toBe('h');
    expect(uebersichtText(z)).toContain('Buchholz');
  });
  it('ungerade Zahl: Freilos an den Letzten ohne Freilos, zählt als Sieg', () => {
    const fuenf = acht.slice(0, 5);
    const t = aufbau(fuenf, { runden: 4 });
    expect(paarungen(t, 'k', 1)).toEqual(['a-c', 'b-d', 'e-frei']);
    const frei = new Set<string>();
    for (let r = 1; r <= 4; r++) {
      const fs = Object.values(t.z.konkurrenzen.k!.spiele).find((s) => s.runde === r && s.bFrei)!;
      expect(frei.has(fs.a!)).toBe(false);
      frei.add(fs.a!);
      rundeSpielen(t, 'k', fuenf);
    }
    expect(t.z.konkurrenzen.k!.status).toBe('beendet');
  });
  it('Korrektur in Runde 1 berechnet die noch unberührte Runde 2 neu; Rückzug spielt nicht mehr mit', () => {
    const t = aufbau(acht.slice(0, 4), { runden: 3 });
    expect(paarungen(t, 'k', 1)).toEqual(['a-c', 'b-d']);
    t.ergebnis('k', 'sw-1-0', s3(5, 5, 5));
    t.ergebnis('k', 'sw-1-1', s3(5, 5, 5));
    expect(paarungen(t, 'k', 2)).toEqual(['a-b', 'c-d']);
    t.ergebnis('k', 'sw-1-1', s3(-5, -5, -5)); // d schlägt b
    expect(paarungen(t, 'k', 2)).toEqual(['a-d', 'b-c']);
    t.ergebnis('k', 'sw-2-0', s3(5, 5, 5)); // Runde 2 ist jetzt berührt und bleibt
    t.e(ART.teilnehmerAbgemeldet, { konkurrenz: 'k', id: 'c' });
    const r2 = t.z.konkurrenzen.k!.spiele['sw-2-1']!;
    expect(r2.status).toBe('gespielt');
    expect(r2.kampflosDurchRueckzug).toBe('b');
    // Runde 3: nur noch a, b, d – einer hat Freilos, c ist nicht dabei
    expect(paarungen(t, 'k', 3).join(' ')).not.toContain('c');
  });
});

describe('Etappe 6: Kaiserturnier', () => {
  it('Sieger steigt auf, Verlierer ab; ungerade: der Unterste setzt aus', () => {
    const t = new Turnier();
    ['a', 'b', 'c', 'd', 'e'].forEach((id, i) => t.spieler(id, 2000 - i * 50));
    t.konkurrenz('k', { modus: 'kaiser', runden: 3, bestOf: 1 }, ['a', 'b', 'c', 'd', 'e']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    expect(paarungen(t, 'k', 1)).toEqual(['a-b', 'c-d', 'e-frei']);
    t.ergebnis('k', 'ks-1-0', { saetze: [[11, 5]] }); // a
    t.ergebnis('k', 'ks-1-1', { saetze: [[11, 5]] }); // c
    expect(paarungen(t, 'k', 2)).toEqual(['a-c', 'b-e', 'd-frei']);
    t.ergebnis('k', 'ks-2-0', { saetze: [[5, 11]] }); // c wird Kaiser
    t.ergebnis('k', 'ks-2-1', { saetze: [[5, 11]] }); // e steigt auf
    expect(paarungen(t, 'k', 3)).toEqual(['c-e', 'a-d', 'b-frei']);
    t.ergebnis('k', 'ks-3-0', { saetze: [[11, 3]] });
    t.ergebnis('k', 'ks-3-1', { saetze: [[11, 3]] });
    const k = t.z.konkurrenzen.k!;
    expect(k.status).toBe('beendet');
    expect(platzierungen(k).map((p) => p.id)).toEqual(['c', 'a', 'e', 'b', 'd']);
  });
});

describe('Etappe 6: Vorgabe', () => {
  it('der Schwächere bekommt je 50 TTR-Punkte einen Punkt Vorgabe, höchstens das Maximum', () => {
    const t = new Turnier();
    t.spieler('a', 1500);
    t.spieler('b', 1290);
    t.spieler('c', 900);
    t.spieler('d');
    t.konkurrenz('k', { modus: 'jgj', vorgabe: 50, vorgabeMax: 6 }, ['a', 'b', 'c', 'd']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    const z = t.z;
    const k = z.konkurrenzen.k!;
    const spiel = (x: string, y: string) => Object.values(k.spiele).find((s) => [s.a, s.b].sort().join() === [x, y].sort().join())!;
    const ab = spiel('a', 'b');
    expect(vorgabeVon(z, k, ab)).toEqual({ seite: ab.a === 'b' ? 'a' : 'b', punkte: 4 });
    expect(vorgabeVon(z, k, spiel('a', 'c'))?.punkte).toBe(6);
    expect(vorgabeVon(z, k, spiel('a', 'd'))).toBeNull();
  });
});

describe('Etappe 7: Pausenschutz, automatischer Aufruf, Ansage, Namen für Zuschauer', () => {
  const zeit = (sek: number) => Date.UTC(2026, 10, 14, 9, 0, sek);
  function aufbau() {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) t.spieler(id);
    t.e(ART.turnierDaten, { tische: 2 });
    t.konkurrenz('k', { modus: 'jgj' }, ['a', 'b', 'c', 'd', 'e', 'f']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    return t;
  }

  it('belegt freie Tische mit bereiten Spielen, nie einen Spieler doppelt', () => {
    const t = aufbau();
    const plan = automatischeAufrufe(t.z, zeit(100), false);
    expect(plan.map((p) => p.tisch)).toEqual([1, 2]);
    const leute = plan.flatMap((p) => [p.spiel.a, p.spiel.b]);
    expect(new Set(leute).size).toBe(4);
    for (const p of plan) t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: p.spiel.id, tisch: p.tisch });
    expect(automatischeAufrufe(t.z, zeit(200), false)).toEqual([]);
    // gesperrter Tisch bekommt nichts
    const erstes = plan[0]!.spiel;
    t.ergebnis('k', erstes.id, s3(5, 6, 7));
    t.e(ART.tischGesperrt, { nr: 1, gesperrt: true });
    expect(automatischeAufrufe(t.z, zeit(300), false)).toEqual([]);
  });

  it('Mindestpause: frisch fertige Spieler sind nicht bereit; Verlierer pfeift das nächste Spiel', () => {
    const t = aufbau();
    t.e(ART.turnierDaten, { pause: 5 });
    const an = anstehendeSpiele(t.z, zeit(100));
    const erstes = an[0]!.spiel;
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: erstes.id, tisch: 1 });
    t.ergebnis('k', erstes.id, s3(5, 6, 7)); // a-Seite gewinnt
    const z = t.z;
    const ende = letztesSpielEnde(z);
    const sieger = erstes.a!;
    const verlierer = erstes.b!;
    expect(ende.has(sieger) && ende.has(verlierer)).toBe(true);
    const fertig = Date.parse(ende.get(sieger)!);
    expect(pauseMinuten(ende, sieger, fertig + 3 * 60_000)).toBe(3);
    expect(pauseMinuten(ende, ['a', 'b', 'c', 'd', 'e', 'f'].find((x) => !ende.has(x))!, fertig)).toBeNull();
    const bald = anstehendeSpiele(z, fertig + 2 * 60_000);
    const mitSieger = bald.find((x) => x.spiel.a === sieger || x.spiel.b === sieger)!;
    expect(mitSieger.bereit).toBe(false);
    expect(mitSieger.inPause).toContain(sieger);
    // bereite Spiele zuerst
    expect(bald[0]!.bereit).toBe(true);
    const spaeter = anstehendeSpiele(z, fertig + 6 * 60_000);
    expect(spaeter.find((x) => x.spiel.id === mitSieger.spiel.id)!.bereit).toBe(true);
    // Verlierer am Tisch 1 als Schiedsrichter (nicht, wenn er selbst spielt)
    expect(verliererAmTisch(z, 1)).toBe(verlierer);
    expect(verliererAmTisch(z, 1, [verlierer])).toBeNull();
    expect(verliererAmTisch(z, 2)).toBeNull();
    const plan = automatischeAufrufe(z, fertig + 60_000, true);
    const amTisch1 = plan.find((p) => p.tisch === 1)!;
    expect([amTisch1.spiel.a, amTisch1.spiel.b]).not.toContain(sieger);
    if (![amTisch1.spiel.a, amTisch1.spiel.b].includes(verlierer)) expect(amTisch1.schiri).toBe(verlierer);
  });

  it('Kurzform der Namen für Zuschauer', () => {
    expect(kurzname(' müller ')).toBe('M.');
    expect(kurzname('Élise')).toBe('É.');
    expect(kurzname('')).toBe('');
    expect(istKurzname('M.')).toBe(true);
    expect(istKurzname('Mü.')).toBe(false);
    const a = { vorname: 'Max', nachname: 'M.', verein: '' };
    const b = { vorname: 'Eva', nachname: 'S.', verein: '' };
    expect(paarName(a, b)).toBe('Max M./Eva S.');
    const t = aufbau();
    t.e(ART.spielerGeaendert, { id: 'a', vorname: 'Anna', nachname: 'Arndt', jahrgang: 2012, geschlecht: 'w' });
    expect(oeffentlich(t.z).spieler.a!.nachname).toBe('Arndt');
    expect(oeffentlich(t.z).spieler.a!.jahrgang).toBeNull();
    t.e(ART.turnierDaten, { namen: 'kurz' });
    const z = t.z;
    expect(z.namen).toBe('kurz');
    expect(name(oeffentlich(z), 'a')).toBe('Anna A.');
    expect(z.spieler.a!.nachname).toBe('Arndt'); // Original bleibt
    // nur die Leitung stellt um
    t.e(ART.turnierDaten, { namen: 'voll' }, spielerAutor('a'));
    expect(t.z.namen).toBe('kurz');
    t.e(ART.turnierDaten, { namen: 'unsinn' });
    expect(t.z.namen).toBe('kurz');
  });
});

describe('Datenschutz: gleicher Stand aus voller und gefilterter Sicht', () => {
  /** Filter wie der Server (Api::gefiltert): spieler = ohne Jahrgang/Geschlecht/Pool; zuschauer/kurz zusätzlich ohne Namen */
  function filtern(liste: LokalesEreignis[], sicht: 'spieler' | 'zuschauer' | 'kurz'): LokalesEreignis[] {
    return liste.map((e) => {
      const d = { ...(e.daten as Record<string, unknown>) };
      if (e.art === ART.spielerAngelegt || e.art === ART.spielerGeaendert) {
        delete d.jahrgang;
        delete d.geschlecht;
        delete d.pool;
        if (sicht === 'kurz' && typeof d.nachname === 'string') d.nachname = kurzname(d.nachname);
      }
      if (sicht !== 'spieler' && e.art === ART.spielAufgerufen && d.schiri) {
        const sc = d.schiri as { spieler?: string };
        if (sc.spieler) d.schiri = { spieler: sc.spieler };
        else delete d.schiri;
      }
      return { ...e, daten: d, autor: e.autor && sicht !== 'spieler' ? { ...e.autor, name: '' } : e.autor };
    });
  }
  /** Was sich aus Datenschutzgründen unterscheiden darf, herausnehmen */
  function kern(z: TurnierZustand) {
    return JSON.stringify({
      konk: Object.values(z.konkurrenzen).map((k) => ({
        m: k.meldungen,
        p: k.paare,
        g: k.gruppen,
        s: Object.values(k.spiele).map((x) => [x.id, x.a, x.b, x.status, x.gewinner, x.tisch, x.ergebnis?.satzA, x.stand, x.schiri?.spieler ?? null]),
      })),
      tische: z.tischeGesperrt,
      w: z.warnungen.length,
    });
  }

  it('Mixed, Doppel, Zulassung und Aufrufe rechnen überall gleich', () => {
    const t = new Turnier();
    t.e(ART.turnierDaten, { tische: 3, angaben: ['ttr', 'geschlecht', 'jahrgang'] });
    t.e(ART.spielerAngelegt, { id: 'a', vorname: 'Anna', nachname: 'Alpha', verein: 'TTC', ttr: 1500, geschlecht: 'w', jahrgang: 2012, pool: 'x1' });
    t.e(ART.spielerAngelegt, { id: 'b', vorname: 'Ben', nachname: 'Beta', verein: 'TTC', ttr: 1400, geschlecht: 'm', jahrgang: 2011 });
    t.e(ART.spielerAngelegt, { id: 'c', vorname: 'Cem', nachname: 'Gamma', verein: 'SV', ttr: 1300, geschlecht: 'm', jahrgang: 2010 });
    t.e(ART.spielerAngelegt, { id: 'd', vorname: 'Dora', nachname: 'Delta', verein: 'SV', ttr: 1200, geschlecht: 'w' });
    t.e(ART.spielerAngelegt, { id: 'e', vorname: 'Eva', nachname: 'Epsilon', verein: 'SV', ttr: 1100, geschlecht: 'w' });
    t.e(ART.spielerAngelegt, { id: 'f', vorname: 'Fin', nachname: 'Zeta', verein: 'SV', ttr: 1000, geschlecht: 'm' });
    t.e(ART.konkurrenzAngelegt, { id: 'mx', einst: { ...standardEinstellungen('Mixed'), art: 'mixed', modus: 'jgj', zulassung: { ttrMin: null, ttrMax: null, klassen: [], geschlecht: ['w'], jahrgangVon: 2011, jahrgangBis: null } } });
    t.e(ART.paarGemeldet, { konkurrenz: 'mx', id: 'p-0001', spieler: ['a', 'b'] });
    t.e(ART.paarGemeldet, { konkurrenz: 'mx', id: 'p-0002', spieler: ['c', 'f'] }); // zwei Männer: die Oberfläche verhindert das
    t.e(ART.paarGemeldet, { konkurrenz: 'mx', id: 'p-0003', spieler: ['d', 'e'] });
    t.konkurrenz('ez', { modus: 'gruppen_ko', gruppenGroesse: 3, aufsteiger: 1 }, ['a', 'b', 'c', 'd', 'e', 'f']);
    t.auslosen('mx');
    t.starten('mx', 'gruppen');
    t.auslosen('ez');
    t.starten('ez', 'gruppen');
    const z0 = t.z;
    const sp = Object.values(z0.konkurrenzen.ez!.spiele).filter((x) => x.status === 'offen');
    t.e(ART.spielAufgerufen, { konkurrenz: 'ez', spiel: sp[0]!.id, tisch: 1, schiri: { name: 'Opa Paul' } });
    t.e(ART.spielAufgerufen, { konkurrenz: 'ez', spiel: sp[1]!.id, tisch: 2, schiri: { spieler: 'f' } });
    t.ergebnis('ez', sp[0]!.id, s3(5, 6, 7));
    t.e(ART.spielerGeaendert, { id: 'a', jahrgang: 2013 });
    const voll = kern(t.z);
    for (const sicht of ['spieler', 'zuschauer', 'kurz'] as const) expect(kern(berechnen(filtern(t.liste, sicht)))).toBe(voll);
  });

  it('niemand steht an zwei Tischen; automatischer Aufruf ohne eigene und zurückgestellte Spiele', () => {
    const t = new Turnier();
    for (const id of ['a', 'b', 'c', 'd']) t.spieler(id);
    t.e(ART.turnierDaten, { tische: 3 });
    t.konkurrenz('k', { modus: 'jgj' }, ['a', 'b', 'c', 'd']);
    t.auslosen('k');
    t.starten('k', 'gruppen');
    const spiele = Object.values(t.z.konkurrenzen.k!.spiele);
    const ersteMitA = spiele.filter((s) => s.a === 'a' || s.b === 'a');
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: ersteMitA[0]!.id, tisch: 1 });
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: ersteMitA[1]!.id, tisch: 2 });
    expect(t.z.warnungen.at(-1)?.text).toMatch(/schon an Tisch 1/);
    expect(t.z.konkurrenzen.k!.spiele[ersteMitA[1]!.id]!.tisch).toBeNull();
    // erneuter Aufruf desselben Spiels an einen anderen Tisch (umsetzen) bleibt möglich
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: ersteMitA[0]!.id, tisch: 3 });
    expect(t.z.konkurrenzen.k!.spiele[ersteMitA[0]!.id]!.tisch).toBe(3);
    t.e(ART.spielAufrufZurueck, { konkurrenz: 'k', spiel: ersteMitA[0]!.id });
    const z = t.z;
    const plan = automatischeAufrufe(z, Date.UTC(2026, 10, 14, 10), false, 'a');
    expect(plan.every((p) => p.spiel.a !== 'a' && p.spiel.b !== 'a')).toBe(true);
    expect(plan).toHaveLength(1);
    const key = `k/${plan[0]!.spiel.id}`;
    const ohne = automatischeAufrufe(z, Date.UTC(2026, 10, 14, 10), false, 'a', new Set([key]));
    expect(ohne.some((p) => `k/${p.spiel.id}` === key)).toBe(false);
  });
});
