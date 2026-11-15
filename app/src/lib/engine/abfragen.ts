import { anzahlGesetzte, anzahlGruppen, gruppenAuslosen, koAuslosen, naechsteZweierpotenz, setzreihe } from './auslosung';
import { koPlatzierungen, koRunden, type Platzierung } from './ko';
import {
  gruppenName,
  klasseVon,
  spielerName,
  ttrBereichName,
  type KonkurrenzZustand,
  type Spiel,
  type TurnierSpieler,
  type Veroeffentlichung,
  type Zulassung,
} from './modell';
import { gruppenTabelle, type Tabelle } from './wertung';
import { erstePhase, zurueckgezogen, type TurnierZustand } from './zustand';

/** Abfragen für die Oberfläche (rechnen nur, ändern nichts). */

export function name(z: TurnierZustand, id: string | null): string {
  if (!id) return '–';
  return spielerName(z.spieler[id]);
}

export function tabelle(k: KonkurrenzZustand, nr: number): Tabelle {
  const g = k.gruppen[nr]!;
  const spiele = k.reihenfolge.map((id) => k.spiele[id]!).filter((s) => s.phase === 'gruppen' && s.gruppe === nr);
  return gruppenTabelle(g, spiele, k.einst, zurueckgezogen(k));
}

export type Qualifikation = { ok: true; gruppen: string[][] } | { ok: false; grund: string };

/** Wer kommt aus den Gruppen in die Endrunde? (je Gruppe in Platzreihenfolge) */
export function qualifikanten(k: KonkurrenzZustand): Qualifikation {
  if (!k.gestartet.gruppen) return { ok: false, grund: 'Die Gruppenphase hat noch nicht begonnen.' };
  const aus: string[][] = [];
  for (const g of k.gruppen) {
    const t = tabelle(k, g.nr);
    if (!t.fertig)
      return {
        ok: false,
        grund: `In Gruppe ${gruppenName(g.nr)} sind noch Spiele offen oder strittig.`,
      };
    if (t.losGruppen.length)
      return {
        ok: false,
        grund: `In Gruppe ${gruppenName(g.nr)} muss ein Los entscheiden.`,
      };
    aus.push(
      t.zeilen
        .filter((r) => !r.zurueckgezogen)
        .slice(0, k.einst.aufsteiger)
        .map((r) => r.id),
    );
  }
  if (aus.flat().length < 2)
    return {
      ok: false,
      grund: 'Für eine Endrunde braucht es mindestens 2 Teilnehmer.',
    };
  return { ok: true, gruppen: aus };
}

export function gruppenZahlVorschlag(k: KonkurrenzZustand): number {
  return anzahlGruppen(k.meldungen.length, k.einst.gruppenGroesse);
}

/** Klassen der Gemeldeten (Reihenfolge: Klassenbegriffe alphabetisch bzw. TTR-Bereiche aufsteigend, „ohne“ zuletzt) */
export function klassenDerMeldungen(z: TurnierZustand, k: KonkurrenzZustand): { schluessel: string; name: string; mitglieder: string[] }[] {
  if (k.einst.klassenTrennung === 'keine') return [{ schluessel: '', name: '', mitglieder: [...k.meldungen] }];
  const nachKlasse = new Map<string, string[]>();
  for (const id of k.meldungen) {
    const kl = klasseVon(z.spieler[id], k.einst);
    nachKlasse.set(kl, [...(nachKlasse.get(kl) ?? []), id]);
  }
  const name = (kl: string) => {
    if (kl === '') return 'ohne Angabe';
    if (k.einst.klassenTrennung === 'ttr') return `TTR ${ttrBereichName(Number(kl.slice(3)), k.einst.ttrGrenzen)}`;
    return z.spieler[nachKlasse.get(kl)![0]!]?.klasse?.trim() ?? kl;
  };
  return [...nachKlasse.keys()]
    .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : k.einst.klassenTrennung === 'ttr' ? Number(a.slice(3)) - Number(b.slice(3)) : a.localeCompare(b, 'de')))
    .map((kl) => ({
      schluessel: kl,
      name: name(kl),
      mitglieder: nachKlasse.get(kl)!,
    }));
}

/** Klassenname je Gruppe (für Anzeige), leer ohne Klassentrennung */
export function gruppenKlassen(z: TurnierZustand, k: KonkurrenzZustand, gruppen: string[][]): string[] {
  if (k.einst.klassenTrennung === 'keine') return gruppen.map(() => '');
  const klassen = klassenDerMeldungen(z, k);
  return gruppen.map((g) => klassen.find((kl) => g.every((id) => kl.mitglieder.includes(id)))?.name ?? 'gemischt');
}

/** Daten für das Ereignis „auslosung.gesetzt“ der ersten Phase */
export function auslosungErstellen(z: TurnierZustand, k: KonkurrenzZustand, zufall: number, gruppen?: number) {
  const reihe = setzreihe(k.meldungen, z.spieler, k.einst, k.setzliste);
  if (erstePhase(k) === 'gruppen') {
    if (k.einst.modus !== 'jgj' && k.einst.klassenTrennung !== 'keine') {
      // Je Leistungsklasse eigene Gruppen; Gesetzte und Zufall wie sonst, nur innerhalb der Klasse
      const alle: string[][] = [];
      let z2 = zufall;
      for (const kl of klassenDerMeldungen(z, k)) {
        const r = reihe.filter((id) => kl.mitglieder.includes(id));
        const g = Math.max(1, Math.min(anzahlGruppen(r.length, k.einst.gruppenGroesse), Math.floor(r.length / 2) || 1));
        const s = k.einst.setzung === 'keine' ? 0 : Math.min(g, r.length);
        alle.push(...gruppenAuslosen(r, g, s, z.spieler, k.einst.vereinstrennung, z2));
        z2 = (z2 * 1103515245 + 12345) % 2 ** 31;
      }
      return {
        konkurrenz: k.id,
        phase: 'gruppen' as const,
        zufall,
        gruppen: alle,
      };
    }
    const g = k.einst.modus === 'jgj' ? 1 : Math.max(1, Math.min(gruppen ?? gruppenZahlVorschlag(k), Math.floor(reihe.length / 2) || 1));
    const s = k.einst.setzung === 'keine' ? 0 : Math.min(k.einst.gesetzte ?? g, reihe.length);
    return {
      konkurrenz: k.id,
      phase: 'gruppen' as const,
      zufall,
      gruppen: gruppenAuslosen(reihe, g, Math.min(s, reihe.length), z.spieler, k.einst.vereinstrennung, zufall),
    };
  }
  const s = anzahlGesetzte(k.einst, reihe.length, false);
  return {
    konkurrenz: k.id,
    phase: 'ko' as const,
    zufall,
    plaetze: koAuslosen({
      gesetzte: reihe.slice(0, s),
      stufen: [reihe.slice(s)],
      spieler: z.spieler,
      vereinstrennung: k.einst.vereinstrennung,
      zufall,
    }),
  };
}

/** Daten für die Endrunde (Gruppen + K.-o.): Gruppensieger gesetzt, Spieler derselben Gruppe getrennt */
export function endrundeErstellen(z: TurnierZustand, k: KonkurrenzZustand, zufall: number) {
  const q = qualifikanten(k);
  if (!q.ok) return null;
  const gruppeVon: Record<string, number> = {};
  q.gruppen.forEach((l, nr) => l.forEach((id) => (gruppeVon[id] = nr)));
  const tiefe = Math.max(...q.gruppen.map((l) => l.length));
  const gesetzte = q.gruppen.map((l) => l[0]).filter((x): x is string => !!x);
  const stufen: string[][] = [];
  for (let p = 1; p < tiefe; p++) stufen.push(q.gruppen.map((l) => l[p]).filter((x): x is string => !!x));
  return {
    konkurrenz: k.id,
    phase: 'ko' as const,
    zufall,
    plaetze: koAuslosen({
      gesetzte,
      stufen,
      spieler: z.spieler,
      vereinstrennung: k.einst.vereinstrennung,
      gruppeVon,
      zufall,
    }),
  };
}

export function koGroesseVorschau(n: number) {
  return naechsteZweierpotenz(n);
}

export function runden(k: KonkurrenzZustand): number {
  return k.auslosungKo ? koRunden(k.auslosungKo.plaetze.length) : 0;
}

export function platzierungen(k: KonkurrenzZustand): Platzierung[] {
  return koPlatzierungen(k);
}

/** Alle Spiele eines Spielers über alle Konkurrenzen (in Spielfolge) */
export function spieleVon(z: TurnierZustand, spieler: string): Spiel[] {
  const aus: Spiel[] = [];
  for (const kid of z.konkurrenzReihe) {
    const k = z.konkurrenzen[kid]!;
    for (const id of k.reihenfolge) {
      const s = k.spiele[id]!;
      if (s.a === spieler || s.b === spieler) aus.push(s);
    }
  }
  return aus;
}

export function alleSpiele(z: TurnierZustand): Spiel[] {
  return z.konkurrenzReihe.flatMap((kid) => {
    const k = z.konkurrenzen[kid]!;
    return k.reihenfolge.map((id) => k.spiele[id]!);
  });
}

/** Spiele, bei denen die Leitung entscheiden muss */
export function pruefliste(z: TurnierZustand): Spiel[] {
  return alleSpiele(z).filter((s) => s.stand === 'angefochten' || s.stand === 'konflikt');
}

/** Hinweise, wenn ein Spieler nicht zur Zulassung der Konkurrenz passt (warnt, sperrt nicht) */
export function zulassungsHinweise(s: Partial<TurnierSpieler> | undefined, zl: Zulassung): string[] {
  const h: string[] = [];
  if (!s) return h;
  if (typeof s.ttr === 'number') {
    if (zl.ttrMin !== null && s.ttr < zl.ttrMin) h.push(`TTR ${s.ttr} unter ${zl.ttrMin}`);
    if (zl.ttrMax !== null && s.ttr > zl.ttrMax) h.push(`TTR ${s.ttr} über ${zl.ttrMax}`);
  }
  if (zl.klassen.length && s.klasse && !zl.klassen.some((k) => k.toLowerCase() === s.klasse!.toLowerCase())) h.push(`Klasse „${s.klasse}“`);
  if (zl.geschlecht.length && s.geschlecht && !zl.geschlecht.includes(s.geschlecht)) h.push('Geschlecht');
  if (typeof s.jahrgang === 'number') {
    if (zl.jahrgangVon !== null && s.jahrgang < zl.jahrgangVon) h.push(`Jahrgang ${s.jahrgang}`);
    else if (zl.jahrgangBis !== null && s.jahrgang > zl.jahrgangBis) h.push(`Jahrgang ${s.jahrgang}`);
  }
  return h;
}

/** Was in dieser Konkurrenz für alle sichtbar ist (Konkurrenz vor Turnier) */
export function sichtbar(z: TurnierZustand, k: KonkurrenzZustand): Veroeffentlichung {
  return k.einst.veroeffentlichung ?? z.veroeffentlichung;
}

/** Ist irgendwo etwas verdeckt (Tabellen oder K.-o.-Baum)? */
export function etwasVerdeckt(z: TurnierZustand): boolean {
  if (!z.veroeffentlichung.tabellen || !z.veroeffentlichung.ko) return true;
  return Object.values(z.konkurrenzen).some((k) => k.einst.veroeffentlichung && (!k.einst.veroeffentlichung.tabellen || !k.einst.veroeffentlichung.ko));
}
