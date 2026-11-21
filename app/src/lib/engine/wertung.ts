import { gewinnSaetze } from './ergebnis';
import { festeSaetzeVon, type Ergebnis, type Gruppe, type KonkurrenzEinstellungen, type Spiel } from './modell';

/**
 * Gruppentabellen „Jeder gegen jeden“.
 *
 * DTTB-Wettspielordnung D 7.5 (Standard): Sieg = 1 Plus-, Niederlage = 1 Minuspunkt.
 *   1. mehr Pluspunkte  2. weniger Minuspunkte  3. Satzdifferenz aller Gruppenspiele
 *   4. Balldifferenz aller Gruppenspiele  5. Spiele der Gleichstehenden untereinander
 *   (Spielpunkt-, Satz-, Balldifferenz)  6. Los
 *
 * ITTF-Regel 3.7.5: Sieg 2, Niederlage 1, nicht angetreten/aufgegeben 0 Punkte.
 *   Bei Punktgleichheit zählen nur die Spiele der Punktgleichen untereinander:
 *   Punkte, dann Verhältnis gewonnener zu verlorenen Sätzen, dann Bällen.
 *   Trennt ein Schritt einen Teil ab, beginnt für die übrigen der Vergleich neu.
 *   Danach Los.
 */

export interface TabellenZeile {
  id: string;
  platz: number;
  spiele: number;
  siege: number;
  niederlagen: number;
  /** DTTB: Pluspunkte; ITTF: Spielpunkte */
  punkte: number;
  saetzeG: number;
  saetzeV: number;
  baelleG: number;
  baelleV: number;
  offen: number;
  zurueckgezogen: boolean;
  /** Steht mit anderen gleich, Los nötig */
  losNoetig: boolean;
  /** Mannschaften: Unentschieden, Minuspunkte und gewonnene/verlorene Teilspiele */
  unentschieden?: number;
  minuspunkte?: number;
  spieleG?: number;
  spieleV?: number;
}

export interface Tabelle {
  zeilen: TabellenZeile[];
  /** Gruppen von Gleichstehenden, die nur das Los trennen kann (noch nicht gelost) */
  losGruppen: string[][];
  /** Alle Spiele entschieden (oder entfallen), keine Anfechtung offen */
  fertig: boolean;
}

interface Wertungsspiel {
  a: string;
  b: string;
  e: Ergebnis;
}

export function losSchluessel(ids: string[]): string {
  return [...ids].sort().join('|');
}

function kampflosErgebnis(verlierer: 'a' | 'b', einst: KonkurrenzEinstellungen): Ergebnis {
  const k = festeSaetzeVon(einst) ?? gewinnSaetze(einst.bestOf);
  const punkte = einst.eingabe === 'punkte';
  const satz: [number, number] = verlierer === 'a' ? [0, 11] : [11, 0];
  const saetze = punkte ? Array.from({ length: k }, () => [...satz] as [number, number]) : null;
  return {
    saetze,
    satzA: verlierer === 'a' ? 0 : k,
    satzB: verlierer === 'b' ? 0 : k,
    ballA: punkte ? satz[0] * k : null,
    ballB: punkte ? satz[1] * k : null,
    gewinner: verlierer === 'a' ? 'b' : 'a',
    art: 'kampflos',
  };
}

/** Gewertete Spiele einer Gruppe (gestrichene ohne, Rückzug „Hobby“: offene als kampflos verloren) */
function wertungsspiele(spiele: Spiel[]): Wertungsspiel[] {
  const aus: Wertungsspiel[] = [];
  for (const s of spiele) {
    if (s.gestrichen || !s.a || !s.b || !s.ergebnis) continue;
    aus.push({ a: s.a, b: s.b, e: s.ergebnis });
  }
  return aus;
}

interface Werte {
  siege: number;
  niederlagen: number;
  mp: number;
  sg: number;
  sv: number;
  bg: number;
  bv: number;
}

function werteBilden(ids: string[], spiele: Wertungsspiel[]): Map<string, Werte> {
  const m = new Map<string, Werte>(ids.map((id) => [id, { siege: 0, niederlagen: 0, mp: 0, sg: 0, sv: 0, bg: 0, bv: 0 }]));
  for (const { a, b, e } of spiele) {
    const wa = m.get(a);
    const wb = m.get(b);
    if (!wa || !wb) continue;
    const aGewinnt = e.gewinner === 'a';
    const sieger = aGewinnt ? wa : wb;
    const verlierer = aGewinnt ? wb : wa;
    sieger.siege++;
    verlierer.niederlagen++;
    sieger.mp += 2;
    if (e.art === 'normal') verlierer.mp += 1; // ITTF: kampflos/aufgegeben 0
    wa.sg += e.satzA;
    wa.sv += e.satzB;
    wb.sg += e.satzB;
    wb.sv += e.satzA;
    if (e.ballA !== null && e.ballB !== null) {
      wa.bg += e.ballA;
      wa.bv += e.ballB;
      wb.bg += e.ballB;
      wb.bv += e.ballA;
    }
  }
  return m;
}

function verhaeltnis(g: number, v: number): number {
  if (v === 0) return g === 0 ? 1 : Infinity;
  return g / v;
}

/** Teilt eine Liste anhand eines Werts (absteigend) in Gruppen gleicher Werte. */
function teilen(ids: string[], wert: (id: string) => number): string[][] {
  const sortiert = [...ids].sort((x, y) => wert(y) - wert(x));
  const gruppen: string[][] = [];
  for (const id of sortiert) {
    const letzte = gruppen[gruppen.length - 1];
    if (letzte && wert(letzte[0]!) === wert(id)) letzte.push(id);
    else gruppen.push([id]);
  }
  return gruppen;
}

type Ordnung = { reihe: string[]; los: string[][] };

/** Gleichstehende nach Losentscheid ordnen; ohne Los bleibt die Positionsreihenfolge und „Los nötig“. */
function losAnwenden(ids: string[], gruppe: Gruppe): Ordnung {
  if (ids.length < 2) return { reihe: ids, los: [] };
  const los = gruppe.los[losSchluessel(ids)];
  if (los && los.length === ids.length && ids.every((i) => los.includes(i))) return { reihe: [...los], los: [] };
  const pos = (id: string) => gruppe.mitglieder.indexOf(id);
  return { reihe: [...ids].sort((x, y) => pos(x) - pos(y)), los: [ids] };
}

function ordneDttb(ids: string[], alle: Map<string, Werte>, spiele: Wertungsspiel[], gruppe: Gruppe): Ordnung {
  const w = (id: string) => alle.get(id)!;
  // Kriterien 1–4 über alle Spiele
  const schluessel = (id: string) => [w(id).siege, -w(id).niederlagen, w(id).sg - w(id).sv, w(id).bg - w(id).bv];
  const vergleich = (x: string, y: string) => {
    const a = schluessel(x);
    const b = schluessel(y);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i]! - a[i]!;
    return 0;
  };
  const sortiert = [...ids].sort(vergleich);
  const reihe: string[] = [];
  const los: string[][] = [];
  let i = 0;
  while (i < sortiert.length) {
    let j = i + 1;
    while (j < sortiert.length && vergleich(sortiert[i]!, sortiert[j]!) === 0) j++;
    const block = sortiert.slice(i, j);
    if (block.length === 1) reihe.push(block[0]!);
    else {
      // 5. Spiele untereinander: Spielpunkt-, Satz-, Balldifferenz
      const unter = spiele.filter((s) => block.includes(s.a) && block.includes(s.b));
      const u = werteBilden(block, unter);
      const k = (id: string) => [u.get(id)!.siege - u.get(id)!.niederlagen, u.get(id)!.sg - u.get(id)!.sv, u.get(id)!.bg - u.get(id)!.bv];
      const v2 = (x: string, y: string) => {
        const a = k(x);
        const b = k(y);
        for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) return b[n]! - a[n]!;
        return 0;
      };
      const s2 = [...block].sort(v2);
      let p = 0;
      while (p < s2.length) {
        let q = p + 1;
        while (q < s2.length && v2(s2[p]!, s2[q]!) === 0) q++;
        const rest = s2.slice(p, q);
        // 6. Los
        const o = losAnwenden(rest, gruppe);
        reihe.push(...o.reihe);
        los.push(...o.los);
        p = q;
      }
    }
    i = j;
  }
  return { reihe, los };
}

function ordneIttf(ids: string[], spiele: Wertungsspiel[], gruppe: Gruppe, tiefe = 0): Ordnung {
  if (ids.length < 2) return { reihe: ids, los: [] };
  const unter = tiefe === 0 ? spiele : spiele.filter((s) => ids.includes(s.a) && ids.includes(s.b));
  const u = werteBilden(ids, unter);
  const kriterien: ((id: string) => number)[] =
    tiefe === 0
      ? [(id) => u.get(id)!.mp]
      : [(id) => u.get(id)!.mp, (id) => verhaeltnis(u.get(id)!.sg, u.get(id)!.sv), (id) => verhaeltnis(u.get(id)!.bg, u.get(id)!.bv)];
  for (const k of kriterien) {
    const teile = teilen(ids, k);
    if (teile.length > 1) {
      const reihe: string[] = [];
      const los: string[][] = [];
      for (const t of teile) {
        const o = t.length > 1 ? ordneIttf(t, spiele, gruppe, tiefe + 1) : { reihe: t, los: [] };
        reihe.push(...o.reihe);
        los.push(...o.los);
      }
      return { reihe, los };
    }
  }
  if (tiefe === 0) return ordneIttf(ids, spiele, gruppe, 1);
  return losAnwenden(ids, gruppe);
}

/**
 * Tabelle einer Gruppe.
 * @param rueckzug Zurückgezogene Teilnehmer in Reihenfolge des Rückzugs
 */
export function gruppenTabelle(gruppe: Gruppe, spiele: Spiel[], einst: KonkurrenzEinstellungen, rueckzug: string[]): Tabelle {
  if (einst.art === 'mannschaft') return mannschaftsTabelle(gruppe, spiele, einst, rueckzug);
  const gewertet = wertungsspiele(spiele);
  const zurueck = new Set(rueckzug.filter((id) => gruppe.mitglieder.includes(id)));
  // WO D 7.9: Zurückgezogene stehen hinten (wer zuerst ging, ganz unten); bei „Hobby“ zählen sie normal
  const hinten = einst.rueckzug === 'wo' ? rueckzug.filter((id) => zurueck.has(id)).reverse() : [];
  const vorn = gruppe.mitglieder.filter((id) => !hinten.includes(id));
  const alle = werteBilden(gruppe.mitglieder, gewertet);
  const o = einst.wertung === 'ittf' ? ordneIttf(vorn, gewertet, gruppe) : ordneDttb(vorn, alle, gewertet, gruppe);
  const reihe = [...o.reihe, ...hinten];
  const losIds = new Set(o.los.flat());
  const zeilen: TabellenZeile[] = reihe.map((id, i) => {
    const w = alle.get(id)!;
    return {
      id,
      platz: i + 1,
      spiele: w.siege + w.niederlagen,
      siege: w.siege,
      niederlagen: w.niederlagen,
      punkte: einst.wertung === 'ittf' ? w.mp : w.siege,
      saetzeG: w.sg,
      saetzeV: w.sv,
      baelleG: w.bg,
      baelleV: w.bv,
      offen: spiele.filter((s) => (s.a === id || s.b === id) && s.status === 'offen').length,
      zurueckgezogen: zurueck.has(id),
      losNoetig: losIds.has(id),
    };
  });
  const fertig = spiele.every((s) => s.status === 'gespielt' || s.status === 'entfallen') &&
    spiele.every((s) => s.stand !== 'angefochten' && s.stand !== 'konflikt');
  return { zeilen, losGruppen: o.los, fertig };
}

/* ---------------- Mannschaften ---------------- */

interface MWerte {
  plus: number;
  minus: number;
  siege: number;
  unentschieden: number;
  niederlagen: number;
  spg: number;
  spv: number;
  sg: number;
  sv: number;
  bg: number;
  bv: number;
}

/** Begegnung: 2:0 Punkte für den Sieg, 1:1 bei Unentschieden (WO E 2.6) */
function mWerteBilden(ids: string[], spiele: Wertungsspiel[]): Map<string, MWerte> {
  const m = new Map<string, MWerte>(ids.map((id) => [id, { plus: 0, minus: 0, siege: 0, unentschieden: 0, niederlagen: 0, spg: 0, spv: 0, sg: 0, sv: 0, bg: 0, bv: 0 }]));
  for (const { a, b, e } of spiele) {
    const wa = m.get(a);
    const wb = m.get(b);
    if (!wa || !wb) continue;
    if (e.gewinner === null) {
      wa.unentschieden++;
      wb.unentschieden++;
      wa.plus++;
      wa.minus++;
      wb.plus++;
      wb.minus++;
    } else {
      const [s, v] = e.gewinner === 'a' ? [wa, wb] : [wb, wa];
      s.siege++;
      v.niederlagen++;
      s.plus += 2;
      v.minus += 2;
    }
    const [spA, spB] = e.spiele ?? [e.gewinner === 'a' ? 1 : 0, e.gewinner === 'b' ? 1 : 0];
    wa.spg += spA;
    wa.spv += spB;
    wb.spg += spB;
    wb.spv += spA;
    wa.sg += e.satzA;
    wa.sv += e.satzB;
    wb.sg += e.satzB;
    wb.sv += e.satzA;
    if (e.ballA !== null && e.ballB !== null) {
      wa.bg += e.ballA;
      wa.bv += e.ballB;
      wb.bg += e.ballB;
      wb.bv += e.ballA;
    }
  }
  return m;
}

/**
 * Mannschaftstabelle nach WO D 7.5 für Mannschaftswettbewerbe: mehr Plus-, weniger Minuspunkte,
 * Spiel-, Satz-, Balldifferenz aller Begegnungen, dann der direkte Vergleich der Gleichstehenden
 * (Punkte, Spiel-, Satz-, Balldifferenz untereinander), zuletzt das Los.
 */
function mannschaftsTabelle(gruppe: Gruppe, spiele: Spiel[], einst: KonkurrenzEinstellungen, rueckzug: string[]): Tabelle {
  const gewertet = wertungsspiele(spiele);
  const zurueck = new Set(rueckzug.filter((id) => gruppe.mitglieder.includes(id)));
  const hinten = einst.rueckzug === 'wo' ? rueckzug.filter((id) => zurueck.has(id)).reverse() : [];
  const vorn = gruppe.mitglieder.filter((id) => !hinten.includes(id));
  const alle = mWerteBilden(gruppe.mitglieder, gewertet);
  const schluesselVon = (w: MWerte) => [w.plus, -w.minus, w.spg - w.spv, w.sg - w.sv, w.bg - w.bv];
  const vgl = (f: (id: string) => number[]) => (x: string, y: string) => {
    const a = f(x);
    const b = f(y);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i]! - a[i]!;
    return 0;
  };
  const v1 = vgl((id) => schluesselVon(alle.get(id)!));
  const sortiert = [...vorn].sort(v1);
  const reihe: string[] = [];
  const los: string[][] = [];
  let i = 0;
  while (i < sortiert.length) {
    let j = i + 1;
    while (j < sortiert.length && v1(sortiert[i]!, sortiert[j]!) === 0) j++;
    const block = sortiert.slice(i, j);
    if (block.length === 1) reihe.push(block[0]!);
    else {
      const u = mWerteBilden(block, gewertet.filter((x) => block.includes(x.a) && block.includes(x.b)));
      const v2 = vgl((id) => schluesselVon(u.get(id)!));
      const s2 = [...block].sort(v2);
      let p = 0;
      while (p < s2.length) {
        let q = p + 1;
        while (q < s2.length && v2(s2[p]!, s2[q]!) === 0) q++;
        const o = losAnwenden(s2.slice(p, q), gruppe);
        reihe.push(...o.reihe);
        los.push(...o.los);
        p = q;
      }
    }
    i = j;
  }
  const ganz = [...reihe, ...hinten];
  const losIds = new Set(los.flat());
  const zeilen: TabellenZeile[] = ganz.map((id, n) => {
    const w = alle.get(id)!;
    return {
      id,
      platz: n + 1,
      spiele: w.siege + w.unentschieden + w.niederlagen,
      siege: w.siege,
      niederlagen: w.niederlagen,
      punkte: w.plus,
      saetzeG: w.sg,
      saetzeV: w.sv,
      baelleG: w.bg,
      baelleV: w.bv,
      offen: spiele.filter((s) => (s.a === id || s.b === id) && s.status === 'offen').length,
      zurueckgezogen: zurueck.has(id),
      losNoetig: losIds.has(id),
      unentschieden: w.unentschieden,
      minuspunkte: w.minus,
      spieleG: w.spg,
      spieleV: w.spv,
    };
  });
  const fertig = spiele.every((s) => s.status === 'gespielt' || s.status === 'entfallen') && spiele.every((s) => s.stand !== 'angefochten' && s.stand !== 'konflikt');
  return { zeilen, losGruppen: los, fertig };
}

export { kampflosErgebnis };
