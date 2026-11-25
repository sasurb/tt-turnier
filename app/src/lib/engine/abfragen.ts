import { anzahlGesetzte, anzahlGruppen, gruppenAuslosen, koAuslosen, naechsteZweierpotenz, setzreihe } from './auslosung';
import { koPlatzierungen, koRunden, rundenName, trostPlatzierungen, type Platzierung } from './ko';
import {
  gruppeTitel,
  gruppenName,
  istPlatzModus,
  istSchweizerArt,
  uhrzeitMs,
  istKurzname,
  klasseVon,
  kurzname,
  paarName,
  spielerName,
  ttrBereichName,
  type KonkurrenzZustand,
  type Seite,
  type Spiel,
  type TurnierSpieler,
  type Veroeffentlichung,
  type Zulassung,
} from './modell';
import { type Tabelle } from './wertung';
import { istRundenModus, rundenPlatzierungen } from './runden';
import { mischen, zufallAus } from './zufall';
import { systemVon } from './mannschaft';
import { alleOffenenAufgerufenen, begonnen, erstePhase, gruppenTabelleVon, spielerVon, teilnehmerVon, vorrundenGruppen, zurueckgezogen, type TurnierZustand } from './zustand';

/** Abfragen für die Oberfläche (rechnen nur, ändern nichts). */

/** Name eines Teilnehmers: Spieler oder Paar („Müller/Schmidt“) */
export function name(z: TurnierZustand, id: string | null, k?: KonkurrenzZustand): string {
  if (!id) return '–';
  if (z.spieler[id]) return spielerName(z.spieler[id]);
  const paar = k?.paare[id] ?? Object.values(z.konkurrenzen).map((x) => x.paare[id]).find(Boolean);
  if (paar) return paarName(z.spieler[paar.spieler[0]], z.spieler[paar.spieler[1]]);
  const m = k?.mannschaften?.[id] ?? Object.values(z.konkurrenzen).map((x) => x.mannschaften?.[id]).find(Boolean);
  if (m) return m.name;
  return '?';
}

/** Langer Name eines Teilnehmers (Paar mit Vornamen) */
export function nameLang(z: TurnierZustand, id: string | null, k?: KonkurrenzZustand): string {
  if (!id) return '–';
  const paar = k?.paare[id] ?? Object.values(z.konkurrenzen).map((x) => x.paare[id]).find(Boolean);
  if (paar) return `${spielerName(z.spieler[paar.spieler[0]])} / ${spielerName(z.spieler[paar.spieler[1]])}`;
  return name(z, id, k);
}

/**
 * Daten je Teilnehmer für Setzung und Auslosung. Einzel: der Spieler. Doppel: TTR = Summe beider
 * (fehlt einer, kein TTR), Verein = beide Vereine (gleicher Verein → ein Name), Klasse nur bei Gleichheit.
 */
/** Konkurrenzen, in die man Spieler direkt melden kann: Einzel, die noch nicht begonnen haben (Reihenfolge wie angelegt) */
export function meldbareEinzel(z: TurnierZustand): string[] {
  return z.konkurrenzReihe.filter((id) => z.konkurrenzen[id]!.einst.art === 'einzel' && !begonnen(z.konkurrenzen[id]!));
}

/** In welchen Konkurrenzen spielt ein Spieler mit (allein, im Paar oder in einer Mannschaft)? Zurückgezogene zählen nicht. */
export function teilnahmen(z: TurnierZustand, spieler: string): string[] {
  return z.konkurrenzReihe.filter((id) => {
    const k = z.konkurrenzen[id]!;
    const t = teilnehmerVon(k, spieler);
    return !!t && !zurueckgezogen(k).includes(t);
  });
}

export function teilnehmerDaten(z: TurnierZustand, k: KonkurrenzZustand): Record<string, TurnierSpieler> {
  if (k.einst.art === 'einzel') return z.spieler;
  const aus: Record<string, TurnierSpieler> = {};
  if (k.einst.art === 'mannschaft') {
    // Mannschaft: TTR = Durchschnitt der Spieler mit TTR (für die Setzung), Verein wie gemeldet
    // Ab 0.18: Wechselspieler zählen nicht; von den Stammspielern die besten je Einzelposition
    const n = Math.max(1, systemVon(k.einst).einzel);
    for (const m of Object.values(k.mannschaften)) {
      const stamm = m.spieler.filter((x) => !(m.wechsler ?? []).includes(x));
      const ttr = stamm
        .map((x) => z.spieler[x]?.ttr)
        .filter((t): t is number => typeof t === 'number')
        .sort((a, b) => b - a)
        .slice(0, n);
      aus[m.id] = { id: m.id, vorname: '', nachname: m.name, verein: m.verein, ttr: ttr.length ? Math.round(ttr.reduce((a, b) => a + b, 0) / ttr.length) : null, klasse: null, geschlecht: null, jahrgang: null };
    }
    return aus;
  }
  for (const p of Object.values(k.paare)) {
    const a = z.spieler[p.spieler[0]];
    const b = z.spieler[p.spieler[1]];
    if (!a || !b) continue;
    const vereine = [...new Set([a.verein, b.verein].map((v) => v.trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'de'));
    aus[p.id] = {
      id: p.id,
      vorname: '',
      nachname: paarName(a, b),
      verein: vereine.join(' / '),
      ttr: typeof a.ttr === 'number' && typeof b.ttr === 'number' ? a.ttr + b.ttr : null,
      klasse: a.klasse && b.klasse && a.klasse.trim().toLowerCase() === b.klasse.trim().toLowerCase() ? a.klasse : null,
      geschlecht: null,
      jahrgang: null,
    };
  }
  return aus;
}

export function tabelle(k: KonkurrenzZustand, nr: number): Tabelle {
  return gruppenTabelleVon(k, nr);
}

export type Qualifikation = { ok: true; gruppen: string[][] } | { ok: false; grund: string };

/** Wer kommt aus den Gruppen in die Endrunde? (je Gruppe in Platzreihenfolge) */
export function qualifikanten(k: KonkurrenzZustand): Qualifikation {
  if (!k.gestartet.gruppen) return { ok: false, grund: 'Die Gruppenphase hat noch nicht begonnen.' };
  const aus: string[][] = [];
  for (const g of vorrundenGruppen(k)) {
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
  const daten = teilnehmerDaten(z, k);
  const nachKlasse = new Map<string, string[]>();
  for (const id of k.meldungen) {
    const kl = klasseVon(daten[id], k.einst);
    nachKlasse.set(kl, [...(nachKlasse.get(kl) ?? []), id]);
  }
  const name = (kl: string) => {
    if (kl === '') return 'ohne Angabe';
    if (k.einst.klassenTrennung === 'ttr') return `TTR ${ttrBereichName(Number(kl.slice(3)), k.einst.ttrGrenzen)}`;
    return daten[nachKlasse.get(kl)![0]!]?.klasse?.trim() ?? kl;
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
  const daten = teilnehmerDaten(z, k);
  const reihe = setzreihe(k.meldungen, daten, k.einst, k.setzliste);
  if (istRundenModus(k.einst.modus)) {
    // Startliste: nach Setzung; Gleichstarke (gleicher TTR, ohne TTR, ohne Setzung) werden gemischt
    const z0 = zufallAus(zufall);
    const schluessel = (id: string) =>
      k.einst.setzung === 'keine' ? '' : k.einst.setzung === 'manuell' ? String(k.setzliste?.indexOf(id) ?? -1) : String(daten[id]?.ttr ?? -1);
    const liste: string[] = [];
    let i = 0;
    while (i < reihe.length) {
      let j = i;
      const s = schluessel(reihe[i]!);
      while (j < reihe.length && schluessel(reihe[j]!) === s) j++;
      liste.push(...mischen(reihe.slice(i, j), z0));
      i = j;
    }
    return { konkurrenz: k.id, phase: 'gruppen' as const, zufall, gruppen: [liste] };
  }
  if (erstePhase(k) === 'gruppen') {
    if (k.einst.modus !== 'jgj' && k.einst.klassenTrennung !== 'keine') {
      // Je Leistungsklasse eigene Gruppen; Gesetzte und Zufall wie sonst, nur innerhalb der Klasse
      const alle: string[][] = [];
      let z2 = zufall;
      for (const kl of klassenDerMeldungen(z, k)) {
        const r = reihe.filter((id) => kl.mitglieder.includes(id));
        const g = Math.max(1, Math.min(anzahlGruppen(r.length, k.einst.gruppenGroesse), Math.floor(r.length / 2) || 1));
        const s = k.einst.setzung === 'keine' ? 0 : Math.min(g, r.length);
        alle.push(...gruppenAuslosen(r, g, s, daten, k.einst.vereinstrennung, z2));
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
      gruppen: gruppenAuslosen(reihe, g, Math.min(s, reihe.length), daten, k.einst.vereinstrennung, zufall),
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
      spieler: daten,
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
      spieler: teilnehmerDaten(z, k),
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

/** Lesbare Runde eines Spiels: „Gruppe A · Runde 2“, „Halbfinale“, „Trostrunde: Endspiel“, „Verliererrunde 3“ */
export function rundeVon(k: KonkurrenzZustand, s: Spiel): string {
  if (istSchweizerArt(k.einst.modus) && s.phase === 'gruppen') return `Runde ${s.runde}`;
  if (k.einst.modus === 'kaiser' && s.phase === 'gruppen')
    return s.bFrei ? `Runde ${s.runde} · setzt aus` : `Runde ${s.runde} · ${s.index === 0 ? 'Kaisertisch' : `Stufe ${s.index + 1}`}`;
  if (s.phase === 'gruppen') return `${gruppeTitel(k, s.gruppe ?? 0)} · Runde ${s.runde}`;
  if (s.platz3) return 'Spiel um Platz 3';
  const R = s.baum === 'haupt' ? runden(k) : s.baum === 'trost' ? runden(k) - 1 : 0;
  return rundenName(s.runde, R, s.baum);
}

export function platzierungen(k: KonkurrenzZustand): Platzierung[] {
  if (istRundenModus(k.einst.modus)) return rundenPlatzierungen(k, zurueckgezogen(k)).map((x) => ({ ...x, bezeichnung: `${x.platz}.` }));
  if (istPlatzModus(k.einst.modus)) return gesamtPlatzierung(k).map((x) => ({ ...x, bezeichnung: `${x.platz}.` }));
  return koPlatzierungen(k);
}

/**
 * Gruppen + Platzierungsgruppen: Gesamtplatzierung aus den fertigen Platzierungsgruppen (Platz = erster Platz der
 * Gruppe + Tabellenplatz − 1). Noch offene Gruppen (oder ein ausstehendes Los) fehlen; zurückgezogene stehen hinten.
 */
export function gesamtPlatzierung(k: KonkurrenzZustand): { id: string; platz: number }[] {
  if (!istPlatzModus(k.einst.modus) || !k.gestartet.ko) return [];
  const aus: { id: string; platz: number }[] = [];
  for (const g of k.gruppen) {
    if (typeof g.platzAb !== 'number') continue;
    const t = tabelle(k, g.nr);
    if (!t.fertig || t.losGruppen.length) continue;
    for (const r of t.zeilen) if (!r.zurueckgezogen) aus.push({ id: r.id, platz: g.platzAb + r.platz - 1 });
  }
  return aus.sort((a, b) => a.platz - b.platz);
}

/**
 * Vorgabe eines Spiels (Vorgabeturnier): Wer hat Vorgabe und wie viele Punkte je Satz?
 * Je `einst.vorgabe` TTR-Punkte Unterschied ein Punkt, höchstens `vorgabeMax`. Doppel: Mittel beider TTR.
 * Ohne TTR bei einem der beiden: keine Vorgabe (null).
 */
export function vorgabeVon(z: TurnierZustand, k: KonkurrenzZustand, s: Spiel): { seite: Seite; punkte: number } | null {
  const je = k.einst.vorgabe;
  if (!je || !s.a || !s.b) return null;
  const ttr = (t: string) => {
    const w = spielerVon(k, t).map((id) => z.spieler[id]?.ttr);
    return w.every((x): x is number => typeof x === 'number') ? w.reduce((a, b) => a + b, 0) / w.length : null;
  };
  const a = ttr(s.a);
  const b = ttr(s.b);
  if (a === null || b === null) return null;
  const punkte = Math.min(k.einst.vorgabeMax, Math.floor(Math.abs(a - b) / je));
  if (punkte <= 0) return null;
  return { seite: a < b ? 'a' : 'b', punkte };
}
/**
 * Endstand einer Konkurrenz für Ergebnisliste und Urkunden: K.-o.-Platzierungen, Rangliste
 * (Schweizer/Kaiser, wenn beendet) oder die Tabelle bei „Jeder gegen jeden“ (wenn fertig, ohne offenes Los).
 * bezeichnung ohne Punkt: „1“, „3“, „5–8“.
 */
export function endstand(k: KonkurrenzZustand): Platzierung[] {
  if (istRundenModus(k.einst.modus)) return rundenPlatzierungen(k, zurueckgezogen(k)).map((x) => ({ ...x, bezeichnung: String(x.platz) }));
  if (istPlatzModus(k.einst.modus)) return gesamtPlatzierung(k).map((x) => ({ ...x, bezeichnung: String(x.platz) }));
  if (k.einst.modus !== 'jgj') return koPlatzierungen(k).map((x) => ({ ...x, bezeichnung: x.bezeichnung.replace(/\.$/, '') }));
  if (k.gruppen.length !== 1 || !k.gestartet.gruppen) return [];
  const t = tabelle(k, 0);
  if (!t.fertig || t.losGruppen.length) return [];
  return t.zeilen.filter((r) => !r.zurueckgezogen).map((r) => ({ id: r.id, platz: r.platz, bezeichnung: String(r.platz) }));
}

/** „1“ → „1. Platz“, „5–8“ → „Platz 5–8“ */
export function platzText(bezeichnung: string): string {
  const b = bezeichnung.replace(/\.$/, '');
  return /^\d+$/.test(b) ? `${b}. Platz` : `Platz ${b}`;
}

export function trostPlaetze(k: KonkurrenzZustand): Platzierung[] {
  return trostPlatzierungen(k);
}

/** Alle Spiele eines Spielers über alle Konkurrenzen (in Spielfolge), auch als Teil eines Paares */
export function spieleVon(z: TurnierZustand, spieler: string): Spiel[] {
  const aus: Spiel[] = [];
  for (const kid of z.konkurrenzReihe) {
    const k = z.konkurrenzen[kid]!;
    for (const id of k.reihenfolge) {
      const s = k.spiele[id]!;
      if (spielerVon(k, s.a).includes(spieler) || spielerVon(k, s.b).includes(spieler)) aus.push(s);
    }
  }
  return aus;
}

/** Konkurrenzen, in denen ein Spieler gemeldet ist (direkt oder im Paar) */
export function konkurrenzenVon(z: TurnierZustand, spieler: string): KonkurrenzZustand[] {
  return z.konkurrenzReihe.map((id) => z.konkurrenzen[id]!).filter((k) => teilnehmerVon(k, spieler));
}

/* ---------- Tische und Spielaufruf ---------- */

export interface TischStand {
  nr: number;
  gesperrt: boolean;
  /** laufendes Spiel (aufgerufen, noch ohne Ergebnis) */
  spiel: Spiel | null;
}

/** Alle Tische mit Belegung (Anzahl aus den Turnierangaben; ohne Angabe: so viele wie benutzt, mindestens 1) */
export function tische(z: TurnierZustand): TischStand[] {
  const laufend = alleOffenenAufgerufenen(z);
  const n = z.tische ?? Math.max(1, ...laufend.map((s) => s.tisch ?? 0), ...z.tischeGesperrt);
  return Array.from({ length: n }, (_, i) => {
    const nr = i + 1;
    return { nr, gesperrt: z.tischeGesperrt.includes(nr), spiel: laufend.find((s) => s.tisch === nr || s.tisch2 === nr) ?? null };
  });
}

/** Spieler-IDs, die gerade an einem Tisch spielen oder pfeifen */
export function beschaeftigt(z: TurnierZustand): Set<string> {
  const aus = new Set<string>();
  for (const s of alleOffenenAufgerufenen(z)) {
    const k = z.konkurrenzen[s.konkurrenz]!;
    for (const id of [...spielerVon(k, s.a), ...spielerVon(k, s.b)]) aus.add(id);
    if (s.schiri?.spieler) aus.add(s.schiri.spieler);
  }
  return aus;
}

export interface Anstehend {
  spiel: Spiel;
  /** Beide Seiten frei (niemand spielt, pfeift oder ist noch in der Pause) und nichts spricht gegen den Aufruf */
  bereit: boolean;
  /** Spieler, die noch beschäftigt sind (spielen oder pfeifen) */
  wartetAuf: string[];
  /** Spieler, die noch in der Mindestpause sind */
  inPause: string[];
  /** Geplant oder Konkurrenz beginnt erst um diese Uhrzeit („HH:MM“), sonst null */
  ab: string | null;
}

/** Frühester Beginn eines Spiels: Vorplanung oder Beginn der Konkurrenz (Uhrzeit „HH:MM“) */
export function fruehestensUm(k: KonkurrenzZustand, s: Spiel): string | null {
  const a = s.plan?.zeit ?? null;
  const b = k.einst.beginn;
  if (a && b) return a > b ? a : b;
  return a ?? b;
}

/**
 * Offene, noch nicht aufgerufene Spiele in sinnvoller Reihenfolge: zuerst fällige vorgeplante Spiele
 * (nach Uhrzeit), dann Runde für Runde über alle Konkurrenzen hinweg (damit keine Konkurrenz
 * hinterherhinkt), innerhalb der Runde in Spielfolge. Spiele, deren Teilnehmer gerade spielen oder
 * pfeifen oder die erst später beginnen dürfen, stehen hinten.
 */
export function anstehendeSpiele(z: TurnierZustand, jetzt = Date.now()): Anstehend[] {
  const b = beschaeftigt(z);
  const ende = z.pause > 0 ? letztesSpielEnde(z) : new Map<string, string>();
  const liste: { s: Spiel; kIndex: number; pos: number; ab: string | null }[] = [];
  z.konkurrenzReihe.forEach((kid, kIndex) => {
    const k = z.konkurrenzen[kid]!;
    k.reihenfolge.forEach((id, pos) => {
      const s = k.spiele[id]!;
      if (s.status === 'offen' && !s.eintrag && s.tisch === null && !s.gesperrt) liste.push({ s, kIndex, pos, ab: fruehestensUm(k, s) });
    });
  });
  const phaseRang = (s: Spiel) => (s.phase === 'gruppen' ? 0 : 1);
  const faellig = (x: { ab: string | null; s: Spiel }) => !!x.s.plan?.zeit && uhrzeitMs(x.s.plan.zeit, jetzt) <= jetzt;
  liste.sort(
    (x, y) =>
      Number(faellig(y)) - Number(faellig(x)) ||
      (faellig(x) && faellig(y) ? (x.s.plan!.zeit! < y.s.plan!.zeit! ? -1 : x.s.plan!.zeit! > y.s.plan!.zeit! ? 1 : 0) : 0) ||
      phaseRang(x.s) - phaseRang(y.s) ||
      x.s.runde - y.s.runde ||
      x.kIndex - y.kIndex ||
      x.pos - y.pos,
  );
  const aus = liste.map(({ s, ab }) => {
    const k = z.konkurrenzen[s.konkurrenz]!;
    const beteiligt = [...spielerVon(k, s.a), ...spielerVon(k, s.b)];
    const wartetAuf = beteiligt.filter((id) => b.has(id));
    const inPause = beteiligt.filter((id) => !b.has(id) && (pauseMinuten(ende, id, jetzt) ?? Infinity) < z.pause);
    const spaeter = ab !== null && uhrzeitMs(ab, jetzt) > jetzt;
    return { spiel: s, bereit: wartetAuf.length === 0 && inPause.length === 0 && !spaeter, wartetAuf, inPause, ab: spaeter ? ab : null };
  });
  return [...aus.filter((a) => a.bereit), ...aus.filter((a) => !a.bereit)];
}

/**
 * Verlierer des zuletzt beendeten Spiels an diesem Tisch (üblich als nächster Schiedsrichter).
 * Doppel: der erste Spieler des unterlegenen Paares. Nur wer gerade frei ist.
 */
export function verliererAmTisch(z: TurnierZustand, nr: number, ausser: string[] = []): string | null {
  let letztes: Spiel | null = null;
  for (const s of alleSpiele(z)) {
    if ((s.tisch !== nr && s.tisch2 !== nr) || s.status !== 'gespielt' || !s.eintrag || !s.gewinner || s.ergebnis?.art === 'kampflos') continue;
    if (!letztes || letztes.eintrag!.zeit < s.eintrag.zeit) letztes = s;
  }
  if (!letztes) return null;
  const k = z.konkurrenzen[letztes.konkurrenz]!;
  const b = beschaeftigt(z);
  const verlierer = spielerVon(k, letztes.gewinner === 'a' ? letztes.b : letztes.a).find((id) => !b.has(id) && !ausser.includes(id) && z.spieler[id]);
  return verlierer ?? null;
}

/**
 * Freie Tische automatisch belegen: je freiem Tisch das nächste bereite Spiel (niemand spielt,
 * pfeift oder ist in der Mindestpause). Ein für einen Tisch vorgeplantes Spiel kommt nur an diesen
 * Tisch – und dort vor allen anderen. Liefert die Aufrufe; die Oberfläche trägt sie ein.
 */
export function automatischeAufrufe(
  z: TurnierZustand,
  jetzt: number,
  schiriVerlierer: boolean,
  /** Spieler mit Helfer-Recht: eigene Spiele ruft die Leitung auf */
  ich: string | null = null,
  /** Spiele, die gerade nicht aufgerufen werden sollen (Schlüssel „konkurrenz/spiel“) */
  zurueckgestellt: ReadonlySet<string> = new Set(),
): { spiel: Spiel; tisch: number; tisch2: number | null; schiri: string | null }[] {
  const frei = tische(z).filter((t) => !t.gesperrt && !t.spiel).map((t) => t.nr);
  if (!frei.length) return [];
  const aus: { spiel: Spiel; tisch: number; tisch2: number | null; schiri: string | null }[] = [];
  const tischWeg = new Set<number>();
  const vergeben = new Set<string>();
  const kandidaten = anstehendeSpiele(z, jetzt).filter((a) => {
    if (!a.bereit) return false;
    const k = z.konkurrenzen[a.spiel.konkurrenz]!;
    const beteiligt = [...spielerVon(k, a.spiel.a), ...spielerVon(k, a.spiel.b)];
    return !(ich && beteiligt.includes(ich)) && !zurueckgestellt.has(`${a.spiel.konkurrenz}/${a.spiel.id}`);
  });
  const genommen = new Set<Spiel>();
  for (const tisch of frei) {
    if (tischWeg.has(tisch)) continue;
    const passt = (a: Anstehend) => {
      if (genommen.has(a.spiel)) return false;
      const k = z.konkurrenzen[a.spiel.konkurrenz]!;
      return ![...spielerVon(k, a.spiel.a), ...spielerVon(k, a.spiel.b)].some((id) => vergeben.has(id)); // ein Spieler nie an zwei Tischen
    };
    const a = kandidaten.find((x) => x.spiel.plan?.tisch === tisch && passt(x)) ?? kandidaten.find((x) => (x.spiel.plan?.tisch ?? null) === null && passt(x));
    if (!a) continue;
    genommen.add(a.spiel);
    const k = z.konkurrenzen[a.spiel.konkurrenz]!;
    const beteiligt = [...spielerVon(k, a.spiel.a), ...spielerVon(k, a.spiel.b)];
    const schiri = schiriVerlierer ? verliererAmTisch(z, tisch, [...beteiligt, ...vergeben]) : null;
    for (const id of beteiligt) vergeben.add(id);
    if (schiri) vergeben.add(schiri);
    tischWeg.add(tisch);
    // Mannschaft mit zwei Tischen: nächsten freien Tisch dazunehmen (sonst spielt sie an einem)
    const tisch2 = k.einst.art === 'mannschaft' && k.einst.zweiTische ? (frei.find((t) => t !== tisch && !tischWeg.has(t)) ?? null) : null;
    if (tisch2 !== null) tischWeg.add(tisch2);
    aus.push({ spiel: a.spiel, tisch, tisch2, schiri });
  }
  return aus;
}

/** Erster freier, nicht gesperrter Tisch */
export function freierTisch(z: TurnierZustand): number | null {
  return tische(z).find((t) => !t.gesperrt && !t.spiel)?.nr ?? null;
}

/** Laufende Spiele und Aufgaben eines Spielers: „Du spielst an Tisch 3“, „Du pfeifst Tisch 2“ */
export function meinAufruf(z: TurnierZustand, spieler: string): { spielt: Spiel | null; pfeift: Spiel | null } {
  let spielt: Spiel | null = null;
  let pfeift: Spiel | null = null;
  for (const s of alleOffenenAufgerufenen(z)) {
    const k = z.konkurrenzen[s.konkurrenz]!;
    if (spielerVon(k, s.a).includes(spieler) || spielerVon(k, s.b).includes(spieler)) spielt = s;
    if (s.schiri?.spieler === spieler) pfeift = s;
  }
  return { spielt, pfeift };
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
    if (zl.ttrMax !== null && s.ttr > zl.ttrMax) h.push(`${s.ttrGeschaetzt ? 'Wert' : 'TTR'} ${s.ttr} über ${zl.ttrMax}`);
  }
  if (zl.nurHobby && typeof s.ttr === 'number' && !s.ttrGeschaetzt) h.push('amtlicher TTR (nur Hobby)');
  if (zl.klassen.length && s.klasse && !zl.klassen.some((k) => k.toLowerCase() === s.klasse!.toLowerCase())) h.push(`Klasse „${s.klasse}“`);
  if (zl.geschlecht.length && s.geschlecht && !zl.geschlecht.includes(s.geschlecht)) h.push('Geschlecht');
  if (typeof s.jahrgang === 'number') {
    if (zl.jahrgangVon !== null && s.jahrgang < zl.jahrgangVon) h.push(`Jahrgang ${s.jahrgang}`);
    else if (zl.jahrgangBis !== null && s.jahrgang > zl.jahrgangBis) h.push(`Jahrgang ${s.jahrgang}`);
  }
  return h;
}

/**
 * Der Stand, wie Zuschauer ihn sehen (Live-Anzeige zeigt das auch am Gerät der Leitung):
 * bei „Namen für Zuschauer: Kurzform“ nur „Max M.“; ohne Jahrgang und Geschlecht.
 */
export function oeffentlich(z: TurnierZustand): TurnierZustand {
  const spieler: TurnierZustand['spieler'] = Object.create(null);
  for (const [id, s] of Object.entries(z.spieler)) {
    spieler[id] = {
      ...s,
      nachname: z.namen === 'kurz' && !istKurzname(s.nachname) ? kurzname(s.nachname) : s.nachname,
      jahrgang: null,
      geschlecht: null,
    };
  }
  return { ...z, spieler };
}

/* ---------- Pausen ---------- */

/** Ende des letzten gespielten Spiels je Spieler (ISO-Zeit des gültigen Ergebnisses) */
export function letztesSpielEnde(z: TurnierZustand): Map<string, string> {
  const aus = new Map<string, string>();
  for (const s of alleSpiele(z)) {
    if (!s.eintrag || s.status !== 'gespielt' || s.ergebnis?.art === 'kampflos') continue;
    const k = z.konkurrenzen[s.konkurrenz]!;
    for (const id of [...spielerVon(k, s.a), ...spielerVon(k, s.b)]) {
      const bisher = aus.get(id);
      if (!bisher || bisher < s.eintrag.zeit) aus.set(id, s.eintrag.zeit);
    }
  }
  return aus;
}

/** Minuten seit dem letzten Spiel (null = noch nicht gespielt) */
export function pauseMinuten(ende: Map<string, string>, spieler: string, jetzt: number): number | null {
  const t = ende.get(spieler);
  return t ? Math.max(0, Math.floor((jetzt - Date.parse(t)) / 60_000)) : null;
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
