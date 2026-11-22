import { describe, expect, it } from 'vitest';
import { ART, type AnmeldungEintrag, type PoolSpieler } from '@shared/protokoll';
import { einstufen, hobbyStufe, stufeAusPunkten, vereinsKlasse, vorlageErkennen, vorlageGrenzen } from './stufen';
import { appWertungen, gewinnerwartung, poolUebernahmePlanen } from './appwertung';
import { klasseVon, standardEinstellungen, ttrBereichName } from './modell';
import { zulassungsHinweise } from './abfragen';
import { uebernahmePlanen } from './anmeldung';
import { Baukasten, saetze } from './test/baukasten';
import { rueckgaengigErlaubt } from './zustand';
import { csvAusgeben, csvLesen } from '../pool-csv';

describe('Einstufung für Hobbyspieler', () => {
  it('ordnet die Punktsumme den Stufen H1–H4 zu', () => {
    const tabelle: [number, string, number][] = [
      [0, 'H1', 900],
      [2, 'H1', 900],
      [3, 'H2', 1025],
      [5, 'H2', 1025],
      [6, 'H3', 1175],
      [9, 'H3', 1175],
      [10, 'H4', 1350],
      [12, 'H4', 1350],
    ];
    for (const [p, id, start] of tabelle) {
      expect(stufeAusPunkten(p).id).toBe(id);
      expect(stufeAusPunkten(p).start).toBe(start);
    }
  });
  it('ohne Veto-Regel: „aktiv im Verein“ zählt nur seine 3 Punkte', () => {
    expect(einstufen([3, 0, 0, 0])).toMatchObject({ wert: 1025, stufe: { id: 'H2' } });
    expect(einstufen([3, 3, 3, 3])).toMatchObject({ wert: 1350, stufe: { id: 'H4' } });
    // Ungültige Antworten werden auf 0–3 begrenzt
    expect(einstufen([9, -1, 0, 0]).wert).toBe(1025);
  });
  it('Stufe und Klasse eines Werts (nur Obergrenzen)', () => {
    expect(hobbyStufe(950)?.id).toBe('H1');
    expect(hobbyStufe(951)?.id).toBe('H2');
    expect(hobbyStufe(1450)?.id).toBe('H4');
    expect(hobbyStufe(1451)).toBeNull();
    expect(vereinsKlasse(1250).id).toBe('E');
    expect(vereinsKlasse(1700).id).toBe('B');
    expect(vereinsKlasse(2400).id).toBe('A');
  });
});

describe('Klassen-Vorlagen', () => {
  it('Hobby + Verein auf einer Skala', () => {
    const v = vorlageGrenzen('gemischt');
    expect(v.grenzen).toEqual([951, 1101, 1251, 1451, 1651, 1851]);
    expect(v.namen).toEqual(['H1 Einsteiger', 'H2 Geübt', 'H3 / E-Klasse', 'H4 / D-Klasse', 'C-Klasse', 'B-Klasse', 'A-Klasse']);
    expect(vorlageGrenzen('hobby').grenzen).toEqual([951, 1101, 1251, 1451]);
    expect(vorlageGrenzen('dttb').grenzen).toEqual([1251, 1451, 1651, 1851]);
  });
  it('Damen-Abzug senkt D, C und B; fällt D auf E, entfällt D', () => {
    expect(vorlageGrenzen('dttb', 150).grenzen).toEqual([1251, 1301, 1501, 1701]);
    const v = vorlageGrenzen('dttb', 200);
    expect(v.grenzen).toEqual([1251, 1451, 1651]);
    expect(v.namen).toEqual(['E-Klasse', 'C-Klasse', 'B-Klasse', 'A-Klasse']);
  });
  it('Bereichsnamen: Vorlage erkannt, eigene Grenzen wie bisher', () => {
    const g = vorlageGrenzen('gemischt').grenzen;
    expect(vorlageErkennen([...g].reverse())).toMatchObject({ vorlage: 'gemischt', damenAbzug: 0 });
    expect(ttrBereichName(0, g)).toBe('H1 Einsteiger (bis 950)');
    expect(ttrBereichName(1, g)).toBe('H2 Geübt (bis 1100)');
    expect(ttrBereichName(6, g)).toBe('A-Klasse (ab 1851)');
    expect(ttrBereichName(1, [1200, 1500])).toBe('1200–1499');
    expect(klasseVon({ ttr: 1025 }, { klassenTrennung: 'ttr', ttrGrenzen: g })).toBe('ttr1');
    expect(klasseVon({ ttr: 1100 }, { klassenTrennung: 'ttr', ttrGrenzen: g })).toBe('ttr1');
  });
});

describe('Zulassung: reines Hobby-Turnier und Obergrenze', () => {
  const zl = { ...standardEinstellungen().zulassung, nurHobby: true, ttrMax: 1250 };
  it('Hinweis bei amtlichem TTR und über der Obergrenze', () => {
    expect(zulassungsHinweise({ ttr: 1100 }, zl)).toEqual(['amtlicher TTR (nur Hobby)']);
    expect(zulassungsHinweise({ ttr: 1100, ttrGeschaetzt: true }, zl)).toEqual([]);
    expect(zulassungsHinweise({ ttr: 1300, ttrGeschaetzt: true }, zl)).toEqual(['Wert 1300 über 1250']);
    expect(zulassungsHinweise({}, zl)).toEqual([]);
  });
});

describe('App-Wertung', () => {
  function turnier() {
    const b = new Baukasten();
    b.e(ART.spielerAngelegt, { id: 'h', vorname: 'Hanna', nachname: 'H', verein: '', ttr: 1025, ttrGeschaetzt: true, pool: 'ph' });
    b.e(ART.spielerAngelegt, { id: 'k', vorname: 'Kai', nachname: 'K', verein: '', ttr: 1200 });
    b.e(ART.spielerAngelegt, { id: 'g', vorname: 'Gabi', nachname: 'G', verein: '', ttr: 1025, ttrGeschaetzt: true });
    b.konkurrenz('e', { name: 'Einzel', modus: 'jgj', bestOf: 3 }, ['h', 'k', 'g']);
    b.auslosen('e');
    b.starten('e', 'gruppen');
    return b;
  }
  const spielVon = (b: Baukasten, x: string, y: string) =>
    Object.values(b.z.konkurrenzen.e!.spiele).find((s) => (s.a === x && s.b === y) || (s.a === y && s.b === x))!;
  /** Sieg für `sieger` (aus Sicht von A gerechnet) */
  const sieg = (b: Baukasten, sieger: string, verlierer: string) => {
    const s = spielVon(b, sieger, verlierer);
    b.ergebnis('e', s.id, s.a === sieger ? saetze(5, 5) : saetze(-5, -5));
  };

  it('Gewinnerwartung wie beim TTR (Teiler 150)', () => {
    expect(gewinnerwartung(1000, 1000)).toBe(0.5);
    expect(gewinnerwartung(1150, 1000)).toBeCloseTo(1 / 1.1, 10);
  });

  it('nur geschätzte Werte ändern sich; K = 32 in den ersten 5 App-Spielen, danach 16', () => {
    const b = turnier();
    sieg(b, 'h', 'k');
    let w = appWertungen(b.z);
    expect(Object.keys(w).sort()).toEqual(['g', 'h']);
    const e = gewinnerwartung(1025, 1200);
    expect(w.h).toEqual({ start: 1025, aktuell: 1025 + Math.round(32 * (1 - e)), spiele: 1 });
    expect(w.g).toEqual({ start: 1025, aktuell: 1025, spiele: 0 });
    expect(b.z.spieler.k!.ttr).toBe(1200);
    // Mit 5 früheren App-Spielen gilt K = 16
    w = appWertungen(b.z, () => 5);
    expect(w.h!.aktuell).toBe(1025 + Math.round(16 * (1 - e)));
    // Zwei Hobbyspieler gegeneinander: beide ändern sich gegenläufig, Reihenfolge der Eintragung zählt
    sieg(b, 'g', 'h');
    w = appWertungen(b.z);
    const hNach1 = 1025 + Math.round(32 * (1 - e));
    expect(w.h!.aktuell).toBe(hNach1 + Math.round(32 * (0 - gewinnerwartung(hNach1, 1025))));
    expect(w.g!.aktuell).toBe(1025 + Math.round(32 * (1 - gewinnerwartung(1025, hNach1))));
    expect(w.h!.spiele).toBe(2);
  });

  it('kampflose Spiele zählen nicht; Doppel zählen nicht', () => {
    const b = turnier();
    const s = spielVon(b, 'h', 'k');
    b.ergebnis('e', s.id, { kampflos: s.a === 'h' ? 'b' : 'a' } as never);
    expect(b.z.konkurrenzen.e!.spiele[s.id]!.ergebnis?.art).toBe('kampflos');
    expect(appWertungen(b.z).h!.spiele).toBe(0);
  });

  it('Übernahme in den Pool nur einmal je Turnier, amtliche Werte bleiben', () => {
    const b = turnier();
    sieg(b, 'h', 'k');
    const pool: PoolSpieler[] = [{ id: 'ph', vorname: 'Hanna', nachname: 'H', verein: '', ttr: 1025, ttrGeschaetzt: true, appSpiele: 2 }];
    const plan = poolUebernahmePlanen(b.z, pool);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ id: 'ph', ttr: appWertungen(b.z, () => 2).h!.aktuell, ttrGeschaetzt: true, appSpiele: 3 });
    expect(plan[0]).not.toHaveProperty('wertungTurniere');
    // Pool hat inzwischen einen amtlichen Q-TTR: nicht überschreiben
    expect(poolUebernahmePlanen(b.z, [{ ...pool[0]!, ttr: 1110, ttrGeschaetzt: false }])).toEqual([]);
    // Vermerk im Turnier: danach nichts mehr – auch nicht per Rückgängig
    const vermerk = b.e(ART.turnierDaten, { wertungUebernommen: '2027-12-11T18:00:00Z' });
    expect(poolUebernahmePlanen(b.z, pool)).toEqual([]);
    expect(rueckgaengigErlaubt({ art: ART.turnierDaten, daten: { wertungUebernommen: 'x' } })).toBe(false);
    b.e(ART.eintragZurueck, { ereignisse: [vermerk], zurueck: true });
    expect(b.z.wertungUebernommen).toBe('2027-12-11T18:00:00Z');
    b.e(ART.turnierDaten, { wertungUebernommen: '2028-01-01T00:00:00Z' });
    expect(b.z.wertungUebernommen).toBe('2027-12-11T18:00:00Z');
  });

  it('Turnier merkt sich „geschätzt“ nur als Wahrheitswert', () => {
    const b = new Baukasten();
    b.e(ART.spielerAngelegt, { id: 'x', vorname: 'X', nachname: 'X', verein: '', ttr: 900, ttrGeschaetzt: 'ja' });
    expect(b.z.spieler.x!.ttrGeschaetzt).toBeUndefined();
    b.e(ART.spielerGeaendert, { id: 'x', ttrGeschaetzt: true });
    expect(b.z.spieler.x!.ttrGeschaetzt).toBe(true);
  });
});

describe('Online-Anmeldung und Pool-Datei', () => {
  it('Übernahme einer Anmeldung mit geschätztem Wert', () => {
    const b = new Baukasten();
    b.konkurrenz('e', { ...standardEinstellungen('E'), modus: 'jgj' }, []);
    const a: AnmeldungEintrag = {
      id: 'abcdefghij', vorname: 'Hanna', nachname: 'H', verein: '', email: 'h@example.org', ttr: 1025, ttrGeschaetzt: true, klasse: null, geschlecht: null, jahrgang: null,
      minderjaehrig: false, angelegt: '', bestaetigt: '2026-11-22T10:00:00Z', konkurrenzen: [{ id: 'e', status: 'platz', position: null, partner: null }], spieler: null,
    };
    const schritt = uebernahmePlanen(b.z, [a]).schritte[0]!;
    expect(schritt.daten).toMatchObject({ ttr: 1025, ttrGeschaetzt: true });
    expect(uebernahmePlanen(b.z, [{ ...a, ttrGeschaetzt: false }]).schritte[0]!.daten).not.toHaveProperty('ttrGeschaetzt');
  });

  it('CSV: Spalte „Geschätzt“ hin und zurück, Schutz vor Formeln', () => {
    const text = csvAusgeben([
      { id: 'a', vorname: '=HYPERLINK("x")', nachname: 'B', verein: 'TTC; Süd', ttr: 1025, ttrGeschaetzt: true },
      { id: 'b', vorname: 'Kai', nachname: 'K', verein: '', ttr: 1500 },
    ]);
    const zeilen = text.split('\r\n');
    expect(zeilen[0]).toBe('Vorname;Nachname;Verein;TTR;Geschätzt;Klasse;Geschlecht;Jahrgang');
    expect(zeilen[1]!.startsWith(`"'=HYPERLINK(""x"")";B;"TTC; Süd";1025;ja;`)).toBe(true);
    const zurueck = csvLesen(text).spieler;
    expect(zurueck[0]!.vorname).toBe('=HYPERLINK("x")');
    expect(zurueck[0]!.verein).toBe('TTC; Süd');
    // Zeilenumbruch in Anführungszeichen zerreißt die Zeile nicht; Kopf „constructor“ trifft nichts
    const mehrzeilig = csvLesen('Vorname;Nachname;constructor\r\n"Ann\na";Berg;x\r\nBen;Bach;y');
    expect(mehrzeilig.spieler.map((p) => p.vorname)).toEqual(['Ann a', 'Ben']);
    expect(mehrzeilig.uebersprungen).toBe(0);
    expect(zurueck.map((p) => [p.nachname, p.ttr, !!p.ttrGeschaetzt])).toEqual([
      ['B', 1025, true],
      ['K', 1500, false],
    ]);
  });
});
