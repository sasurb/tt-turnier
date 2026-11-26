import { expect, it } from 'vitest';
import { ART } from '@shared/protokoll';
import { Baukasten, saetze } from './test/baukasten';
import { gesamtPlatzierung } from './abfragen';
import { standardMannschaft, teilId } from './mannschaft';
import { platzGruppenBilden } from './zustand';

// Mannschaftsergebnisse aus SIM-TTT-001. Die Satzpunkte der Teilspiele sind synthetisch.
type Begegnung = [string, string, number, number];
const referenz: Record<string, { VR: Begegnung[]; HR: Begegnung[]; plaetze: string[] }> = {
  A: {
    VR: [
      ['A13', 'A14', 0, 2],
      ['A23', 'A24', 2, 1],
      ['A11', 'A13', 1, 2],
      ['A22', 'A24', 2, 1],
      ['A11', 'A14', 0, 2],
      ['A22', 'A23', 0, 2],
    ],
    HR: [
      ['A14', 'A13', 3, 1],
      ['A11', 'A24', 3, 0],
      ['A23', 'A22', 3, 1],
      ['A14', 'A23', 1, 3],
      ['A13', 'A22', 3, 1],
      ['A14', 'A22', 3, 0],
      ['A13', 'A23', 1, 3],
    ],
    plaetze: ['A23', 'A14', 'A13', 'A22', 'A11', 'A24'],
  },
  B: {
    VR: [
      ['B11', 'B12', 2, 1],
      ['B21', 'B22', 1, 2],
      ['B13', 'B14', 2, 1],
      ['B23', 'B24', 1, 2],
      ['B11', 'B13', 1, 2],
      ['B21', 'B23', 2, 0],
      ['B12', 'B14', 0, 2],
      ['B22', 'B24', 2, 0],
      ['B11', 'B14', 0, 2],
      ['B21', 'B24', 0, 2],
      ['B12', 'B13', 2, 1],
      ['B22', 'B23', 2, 1],
    ],
    HR: [
      ['B14', 'B13', 3, 0],
      ['B21', 'B11', 1, 3],
      ['B22', 'B24', 3, 0],
      ['B23', 'B12', 1, 3],
      ['B14', 'B22', 3, 1],
      ['B21', 'B23', 1, 3],
      ['B13', 'B24', 1, 3],
      ['B11', 'B12', 1, 3],
      ['B14', 'B24', 3, 0],
      ['B21', 'B12', 1, 3],
      ['B13', 'B22', 0, 3],
      ['B11', 'B23', 3, 1],
    ],
    plaetze: ['B14', 'B22', 'B24', 'B13', 'B12', 'B11', 'B23', 'B21'],
  },
  C: {
    VR: [
      ['C11', 'C12', 1, 2],
      ['C21', 'C22', 0, 2],
      ['C11', 'C13', 1, 2],
      ['C21', 'C23', 1, 2],
      ['C12', 'C13', 1, 2],
      ['C22', 'C23', 0, 2],
    ],
    HR: [
      ['C11', 'C21', 3, 0],
      ['C23', 'C22', 1, 3],
      ['C13', 'C23', 3, 1],
      ['C13', 'C22', 3, 1],
    ],
    plaetze: ['C13', 'C22', 'C23', 'C11', 'C21'],
  },
  D: {
    VR: [
      ['D11', 'D12', 0, 2],
      ['D13', 'D14', 0, 2],
      ['D23', 'D24', 2, 1],
      ['D11', 'D13', 1, 2],
      ['D12', 'D14', 2, 1],
      ['D22', 'D24', 2, 0],
      ['D11', 'D14', 0, 2],
      ['D12', 'D13', 2, 0],
      ['D22', 'D23', 2, 0],
    ],
    HR: [
      ['D12', 'D14', 3, 0],
      ['D13', 'D11', 0, 3],
      ['D22', 'D23', 3, 0],
      ['D12', 'D22', 3, 1],
      ['D13', 'D24', 3, 0],
      ['D14', 'D23', 3, 0],
      ['D12', 'D23', 3, 0],
      ['D14', 'D22', 3, 1],
      ['D11', 'D24', 3, 0],
    ],
    plaetze: ['D12', 'D14', 'D22', 'D23', 'D11', 'D13', 'D24'],
  },
};

it('F-016: 27 Teams spielen alle 65 Referenzbegegnungen bis zur Siegerehrung', () => {
  const t = new Baukasten();
  const teamId = (name: string) => 'm-' + name.toLowerCase() + 'x';
  const kader = (id: string) => [id.slice(2) + 'a', id.slice(2) + 'b'];
  for (const [nameKlasse, ref] of Object.entries(referenz)) {
    const klasse = nameKlasse.toLowerCase();
    const teams = [...new Set(ref.VR.flatMap(([a, b]) => [a, b]))].sort();
    t.konkurrenz(klasse, {
      art: 'mannschaft', modus: 'gruppen_platz', gruppenGroesse: Math.ceil(teams.length / 2), aufsteiger: 2,
      mannschaft: { ...standardMannschaft(), system: 'zweier3', durchspielen: false, eigen: null },
      endrunde: { bestOf: null, mannschaft: { ...standardMannschaft(), system: 'corbillon2', durchspielen: false, eigen: null } },
    }, []);
    for (const name of teams) {
      const id = teamId(name);
      const spieler = kader(id);
      for (const p of spieler) t.spieler(p);
      t.e(ART.mannschaftGemeldet, { konkurrenz: klasse, id, name, spieler, fuehrer: spieler[0] });
    }
    const gruppen = ['1', '2'].map((gruppe) => teams.filter((n) => n[1] === gruppe).map(teamId));
    t.e(ART.auslosung, { konkurrenz: klasse, phase: 'gruppen', zufall: 1, gruppen });
    t.starten(klasse, 'gruppen');
    for (const phase of ['VR', 'HR'] as const) {
      if (phase === 'HR') {
        if (klasse === 'c') t.e(ART.teilnehmerAbgemeldet, { konkurrenz: klasse, id: teamId('C12') });
        const plan = platzGruppenBilden(t.z.konkurrenzen[klasse]!, klasse === 'c');
        if (!plan.ok) throw new Error(plan.grund);
        t.e(ART.phaseGestartet, { konkurrenz: klasse, phase: 'ko', rueckzugUebergang: 'vakanz', gruppen: plan.gruppen.map((g) => g.mitglieder) });
      }
      for (const [links, rechts, siegeLinks, siegeRechts] of ref[phase]) {
        const spiel = Object.values(t.z.konkurrenzen[klasse]!.spiele).find((s) =>
          s.status === 'offen' && [s.a, s.b].includes(teamId(links)) && [s.a, s.b].includes(teamId(rechts)));
        if (!spiel) throw new Error('Offene Paarung fehlt: ' + phase + ' ' + links + '–' + rechts);
        const { id, a, b } = spiel;
        for (const [mannschaft, gegner] of [[a!, b!], [b!, a!]]) {
          const einzel = kader(mannschaft!);
          t.e(ART.mannschaftAufgestellt, { konkurrenz: klasse, spiel: id, mannschaft, gegner, einzel, doppel: [einzel] });
        }
        const linksGewinnt = siegeLinks > siegeRechts;
        const verliererSiege = Math.min(siegeLinks, siegeRechts);
        for (let nr = 1; nr <= siegeLinks + siegeRechts; nr++) {
          const linksSiegt = nr <= verliererSiege ? !linksGewinnt : linksGewinnt;
          const punkte = linksSiegt === (a === teamId(links)) ? 5 : -5;
          t.e(ART.spielErgebnis, { konkurrenz: klasse, spiel: teilId(id, nr), a, b, ergebnis: saetze(punkte, punkte, punkte) });
        }
        expect(t.z.konkurrenzen[klasse]!.spiele[id]!.status).toBe('gespielt');
      }
    }
    expect(gesamtPlatzierung(t.z.konkurrenzen[klasse]!).map((x) => x.id)).toEqual(ref.plaetze.map(teamId));
  }
});
