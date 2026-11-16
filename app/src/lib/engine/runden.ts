import { kampflosErgebnis } from './wertung';
import type { KonkurrenzZustand, Modus, Spiel } from './modell';

/**
 * Spielsysteme, die Runde für Runde ausgelost werden: Schweizer System und Kaiserturnier.
 *
 * Schweizer System: Jede Runde spielen Teilnehmer mit gleich vielen Punkten gegeneinander,
 * niemand trifft zweimal auf denselben Gegner. Paarung wie im „holländischen“ Verfahren:
 * innerhalb einer Punktgruppe obere Hälfte gegen untere Hälfte. Bei ungerader Zahl erhält
 * der Letzte der Rangliste, der noch kein Freilos hatte, ein Freilos (zählt als Sieg).
 * Rangfolge: Punkte, Buchholz (Punkte der Gegner), Feinbuchholz (Buchholz der Gegner),
 * Satzdifferenz, Balldifferenz, Startrang.
 *
 * Kaiserturnier: Die Teilnehmer stehen auf einer Rangleiter, je zwei benachbarte spielen
 * gegeneinander (Stufe 1 = Kaisertisch). Der Sieger steigt eine Stufe auf, der Verlierer ab;
 * am Kaisertisch bleibt der Sieger oben, ganz unten bleibt der Verlierer unten. Bei ungerader
 * Zahl setzt der Unterste aus und rückt in der nächsten Runde wieder ein. Endstand ist die
 * Rangleiter nach der letzten Runde – oben steht der Kaiser.
 *
 * Die nächste Runde entsteht, sobald alle Spiele der laufenden Runde entschieden sind. Solange
 * an einer neuen Runde nichts eingetragen und kein Spiel aufgerufen ist, wird sie bei jeder
 * Änderung neu berechnet (z. B. nach einer Ergebniskorrektur oder einem Rückzug).
 */

export type RundenModus = 'schweizer' | 'kaiser';

export function istRundenModus(m: Modus): m is RundenModus {
  return m === 'schweizer' || m === 'kaiser';
}

/** Rundenzahl: eingestellt oder automatisch (Schweizer: ⌈log₂ n⌉ + 1, Kaiser: 7), höchstens n − 1 beim Schweizer System */
export function rundenZahl(k: KonkurrenzZustand): number {
  const n = k.gruppen[0]?.mitglieder.length ?? k.meldungen.length;
  if (k.einst.modus === 'schweizer') {
    const auto = Math.ceil(Math.log2(Math.max(2, n))) + 1;
    return Math.max(1, Math.min(k.einst.runden ?? auto, Math.max(1, n - 1)));
  }
  return Math.max(1, k.einst.runden ?? 7);
}

const PRAEFIX: Record<RundenModus, string> = { schweizer: 'sw', kaiser: 'ks' };

function rundenSpiele(k: KonkurrenzZustand, r: number): Spiel[] {
  return k.reihenfolge
    .map((id) => k.spiele[id]!)
    .filter((s) => s.phase === 'gruppen' && s.runde === r)
    .sort((x, y) => x.index - y.index);
}

/** Höchste angelegte Runde */
export function letzteRunde(k: KonkurrenzZustand): number {
  let r = 0;
  for (const id of k.reihenfolge) {
    const s = k.spiele[id]!;
    if (s.phase === 'gruppen' && s.runde > r) r = s.runde;
  }
  return r;
}

function entschieden(s: Spiel) {
  return (s.status === 'gespielt' || s.status === 'freilos' || s.status === 'entfallen') && s.stand !== 'angefochten' && s.stand !== 'konflikt';
}

export function rundeFertig(k: KonkurrenzZustand, r: number): boolean {
  const sp = rundenSpiele(k, r);
  return sp.length > 0 && sp.every(entschieden);
}

function unberuehrt(sp: Spiel[]) {
  return sp.every((s) => !s.eintrag && s.tisch === null && !s.aufgerufen);
}

function neuesSpiel(k: KonkurrenzZustand, r: number, index: number, a: string, b: string | null): Spiel {
  const id = `${PRAEFIX[k.einst.modus as RundenModus]}-${r}-${index}`;
  return {
    id,
    konkurrenz: k.id,
    phase: 'gruppen',
    gruppe: 0,
    runde: r,
    index,
    a,
    b,
    aFrei: false,
    bFrei: b === null,
    status: b === null ? 'freilos' : 'offen',
    ergebnis: null,
    stand: null,
    eintrag: null,
    alternativen: [],
    angefochtenVon: null,
    kampflosDurchRueckzug: null,
    gestrichen: false,
    gewinner: b === null ? 'a' : null,
    weiter: null,
    verliererWeiter: null,
    platz3: false,
    gesperrt: false,
    baum: 'haupt',
    quelleA: null,
    quelleB: null,
    nurWennBGewinnt: false,
    tisch: null,
    aufgerufen: null,
    schiri: null,
  };
}

/** Status der Rundenspiele: Ergebnis, offen oder – bei Rückzug – kampflos für den Gegner */
function spieleAktualisieren(k: KonkurrenzZustand, zurueck: Set<string>) {
  for (const id of k.reihenfolge) {
    const s = k.spiele[id]!;
    if (s.phase !== 'gruppen' || s.bFrei) continue;
    s.kampflosDurchRueckzug = null;
    s.gestrichen = false;
    const za = !!s.a && zurueck.has(s.a);
    const zb = !!s.b && zurueck.has(s.b);
    if (s.eintrag) {
      s.status = 'gespielt';
      s.ergebnis = s.eintrag.ergebnis;
    } else if (za && zb) {
      s.status = 'entfallen';
      s.ergebnis = null;
    } else if (za || zb) {
      const v = za ? 'a' : 'b';
      s.kampflosDurchRueckzug = v;
      s.ergebnis = kampflosErgebnis(v, k.einst);
      s.status = 'gespielt';
    } else {
      s.status = 'offen';
      s.ergebnis = null;
    }
    s.gewinner = s.ergebnis?.gewinner ?? null;
  }
}

/** Nach jeder Änderung: Spielstände aktualisieren und – wenn eine Runde fertig ist – die nächste anlegen */
export function rundenAktualisieren(k: KonkurrenzZustand, zurueck: Set<string>) {
  spieleAktualisieren(k, zurueck);
  // Unberührte Folgerunden neu berechnen (Runde 1 bleibt, sie kommt aus der Auslosung)
  let r = letzteRunde(k);
  while (r > 1 && unberuehrt(rundenSpiele(k, r))) {
    for (const s of rundenSpiele(k, r)) delete k.spiele[s.id];
    k.reihenfolge = k.reihenfolge.filter((id) => k.spiele[id]);
    r--;
  }
  const ziel = rundenZahl(k);
  while (r >= 1 && r < ziel && rundeFertig(k, r)) {
    const paare = k.einst.modus === 'kaiser' ? kaiserPaarung(k, zurueck) : schweizerPaarung(k, zurueck);
    if (paare.filter(([, b]) => b !== null).length === 0) break; // niemand mehr zum Spielen
    r++;
    paare.forEach(([a, b], i) => {
      const s = neuesSpiel(k, r, i, a, b);
      k.spiele[s.id] = s;
      k.reihenfolge.push(s.id);
    });
    spieleAktualisieren(k, zurueck);
  }
}

/** Runde 1 aus der Startliste anlegen (Schweizer: obere Hälfte gegen untere; Kaiser: Nachbarn) */
export function ersteRundeAnlegen(k: KonkurrenzZustand): string[] {
  const start = k.gruppen[0]?.mitglieder ?? [];
  const paare: [string, string | null][] = [];
  if (k.einst.modus === 'kaiser') {
    for (let i = 0; i + 1 < start.length; i += 2) paare.push([start[i]!, start[i + 1]!]);
    if (start.length % 2) paare.push([start[start.length - 1]!, null]);
  } else {
    const liste = [...start];
    const frei = liste.length % 2 ? liste.pop()! : null;
    const h = liste.length / 2;
    for (let i = 0; i < h; i++) paare.push([liste[i]!, liste[i + h]!]);
    if (frei) paare.push([frei, null]);
  }
  return paare.map(([a, b], i) => {
    const s = neuesSpiel(k, 1, i, a, b);
    k.spiele[s.id] = s;
    return s.id;
  });
}

/* ---------------- Schweizer System ---------------- */

export interface SchweizerZeile {
  id: string;
  platz: number;
  spiele: number;
  siege: number;
  niederlagen: number;
  freilose: number;
  punkte: number;
  buchholz: number;
  feinbuchholz: number;
  saetzeG: number;
  saetzeV: number;
  baelleG: number;
  baelleV: number;
  zurueckgezogen: boolean;
}

interface Bilanz {
  punkte: number;
  siege: number;
  niederlagen: number;
  freilose: number;
  gegner: string[];
  sg: number;
  sv: number;
  bg: number;
  bv: number;
}

function bilanzen(k: KonkurrenzZustand): Map<string, Bilanz> {
  const start = k.gruppen[0]?.mitglieder ?? [];
  const m = new Map<string, Bilanz>(start.map((id) => [id, { punkte: 0, siege: 0, niederlagen: 0, freilose: 0, gegner: [], sg: 0, sv: 0, bg: 0, bv: 0 }]));
  for (const id of k.reihenfolge) {
    const s = k.spiele[id]!;
    if (s.phase !== 'gruppen' || !s.a) continue;
    const a = m.get(s.a);
    if (!a) continue;
    if (s.bFrei) {
      if (s.status === 'freilos') {
        a.freilose++;
        if (k.einst.modus === 'schweizer') a.punkte++;
      }
      continue;
    }
    const b = s.b ? m.get(s.b) : undefined;
    if (!b) continue;
    a.gegner.push(s.b!);
    b.gegner.push(s.a);
    const e = s.ergebnis;
    if (!e || s.status !== 'gespielt') continue;
    const [w, l] = e.gewinner === 'a' ? [a, b] : [b, a];
    w.siege++;
    w.punkte++;
    l.niederlagen++;
    a.sg += e.satzA;
    a.sv += e.satzB;
    b.sg += e.satzB;
    b.sv += e.satzA;
    if (e.ballA !== null && e.ballB !== null) {
      a.bg += e.ballA;
      a.bv += e.ballB;
      b.bg += e.ballB;
      b.bv += e.ballA;
    }
  }
  return m;
}

function wertungSchweizer(k: KonkurrenzZustand) {
  const start = k.gruppen[0]?.mitglieder ?? [];
  const b = bilanzen(k);
  const bh = new Map(start.map((id) => [id, b.get(id)!.gegner.reduce((s, g) => s + (b.get(g)?.punkte ?? 0), 0)]));
  const fbh = new Map(start.map((id) => [id, b.get(id)!.gegner.reduce((s, g) => s + (bh.get(g) ?? 0), 0)]));
  const reihe = [...start].sort((x, y) => {
    const bx = b.get(x)!;
    const by = b.get(y)!;
    return (
      by.punkte - bx.punkte ||
      bh.get(y)! - bh.get(x)! ||
      fbh.get(y)! - fbh.get(x)! ||
      by.sg - by.sv - (bx.sg - bx.sv) ||
      by.bg - by.bv - (bx.bg - bx.bv) ||
      start.indexOf(x) - start.indexOf(y)
    );
  });
  return { b, bh, fbh, reihe };
}

export function schweizerTabelle(k: KonkurrenzZustand, zurueck: string[]): SchweizerZeile[] {
  const { b, bh, fbh, reihe } = wertungSchweizer(k);
  const z = new Set(zurueck);
  return reihe.map((id, i) => {
    const x = b.get(id)!;
    return {
      id,
      platz: i + 1,
      spiele: x.siege + x.niederlagen,
      siege: x.siege,
      niederlagen: x.niederlagen,
      freilose: x.freilose,
      punkte: x.punkte,
      buchholz: bh.get(id)!,
      feinbuchholz: fbh.get(id)!,
      saetzeG: x.sg,
      saetzeV: x.sv,
      baelleG: x.bg,
      baelleV: x.bv,
      zurueckgezogen: z.has(id),
    };
  });
}

/** Paarung der nächsten Runde (Schweizer System) */
export function schweizerPaarung(k: KonkurrenzZustand, zurueck: Set<string>): [string, string | null][] {
  const { b, reihe } = wertungSchweizer(k);
  const aktiv = reihe.filter((id) => !zurueck.has(id));
  const paare: [string, string | null][] = [];
  let liste = [...aktiv];
  if (liste.length % 2) {
    const frei = [...liste].reverse().find((id) => b.get(id)!.freilose === 0) ?? liste[liste.length - 1]!;
    liste = liste.filter((id) => id !== frei);
    paare.push([frei, null]);
  }
  const punkte = (id: string) => b.get(id)!.punkte;
  const gespielt = (x: string, y: string) => b.get(x)!.gegner.includes(y);
  let schritte = 0;
  const suche = (rest: string[], ohneWiederholung: boolean): [string, string][] | null => {
    if (rest.length === 0) return [];
    if (++schritte > 20000) return null;
    const p = rest[0]!;
    const uebrig = rest.slice(1);
    // Kandidaten: eigene Punktgruppe, obere Hälfte gegen untere, danach die Punktgruppen darunter
    const gruppe = rest.filter((id) => punkte(id) === punkte(p));
    const h = Math.ceil(gruppe.length / 2);
    const bevorzugt = [...gruppe.slice(h), ...gruppe.slice(1, h).reverse()];
    const kandidaten = [...bevorzugt, ...uebrig.filter((id) => !bevorzugt.includes(id))];
    for (const q of kandidaten) {
      if (ohneWiederholung && gespielt(p, q)) continue;
      const weiter = suche(
        uebrig.filter((id) => id !== q),
        ohneWiederholung,
      );
      if (weiter) return [[p, q], ...weiter];
    }
    return null;
  };
  let ergebnis = suche(liste, true);
  if (!ergebnis) {
    // Kein Feld ohne Wiederholung möglich: der Reihe nach paaren
    ergebnis = [];
    for (let i = 0; i + 1 < liste.length; i += 2) ergebnis.push([liste[i]!, liste[i + 1]!]);
  }
  return [...ergebnis, ...paare];
}

/* ---------------- Kaiserturnier ---------------- */

/** Rangleiter nach den fertigen Runden (oben = Kaisertisch) */
export function kaiserLeiter(k: KonkurrenzZustand, zurueck: Set<string>): { reihe: string[]; nachRunde: number } {
  let reihe = [...(k.gruppen[0]?.mitglieder ?? [])];
  let nachRunde = 0;
  const R = letzteRunde(k);
  for (let r = 1; r <= R && rundeFertig(k, r); r++) {
    const sp = rundenSpiele(k, r);
    const tische = sp.filter((s) => !s.bFrei);
    const pause = sp.find((s) => s.bFrei)?.a ?? null;
    const W: (string | null)[] = [];
    const V: (string | null)[] = [];
    for (const s of tische) {
      if (s.status === 'entfallen' || !s.gewinner) {
        W.push(s.a);
        V.push(s.b);
        continue;
      }
      W.push(s.gewinner === 'a' ? s.a : s.b);
      V.push(s.gewinner === 'a' ? s.b : s.a);
    }
    const neu: (string | null)[] = [];
    const T = tische.length;
    if (T > 0) {
      neu.push(W[0]!);
      for (let t = 1; t < T; t++) neu.push(W[t]!, V[t - 1]!);
      if (pause) neu.push(pause);
      neu.push(V[T - 1]!);
    } else if (pause) neu.push(pause);
    // wer in der Runde nicht dabei war (z. B. später gemeldet), bleibt unten
    const dabei = new Set(neu);
    reihe = [...(neu.filter(Boolean) as string[]), ...reihe.filter((id) => !dabei.has(id))];
    nachRunde = r;
  }
  return { reihe: reihe.filter((id) => !zurueck.has(id)), nachRunde };
}

export function kaiserPaarung(k: KonkurrenzZustand, zurueck: Set<string>): [string, string | null][] {
  const { reihe } = kaiserLeiter(k, zurueck);
  const paare: [string, string | null][] = [];
  for (let i = 0; i + 1 < reihe.length; i += 2) paare.push([reihe[i]!, reihe[i + 1]!]);
  if (reihe.length % 2) paare.push([reihe[reihe.length - 1]!, null]);
  return paare;
}

export interface KaiserZeile {
  id: string;
  platz: number;
  siege: number;
  niederlagen: number;
  /** Runden, die er am Kaisertisch gewonnen hat */
  kaiserSiege: number;
  zurueckgezogen: boolean;
}

/** Rangleiter mit Bilanz; zurückgezogene stehen unten */
export function kaiserTabelle(k: KonkurrenzZustand, zurueck: string[]): { zeilen: KaiserZeile[]; nachRunde: number } {
  const z = new Set(zurueck);
  const { reihe, nachRunde } = kaiserLeiter(k, z);
  const b = bilanzen(k);
  const kaiser = new Map<string, number>();
  for (const id of k.reihenfolge) {
    const s = k.spiele[id]!;
    if (s.phase === 'gruppen' && s.index === 0 && !s.bFrei && s.status === 'gespielt' && s.gewinner) {
      const w = s.gewinner === 'a' ? s.a! : s.b!;
      kaiser.set(w, (kaiser.get(w) ?? 0) + 1);
    }
  }
  const alle = [...reihe, ...zurueck.filter((id) => b.has(id))];
  return {
    nachRunde,
    zeilen: alle.map((id, i) => ({
      id,
      platz: i + 1,
      siege: b.get(id)?.siege ?? 0,
      niederlagen: b.get(id)?.niederlagen ?? 0,
      kaiserSiege: kaiser.get(id) ?? 0,
      zurueckgezogen: z.has(id),
    })),
  };
}

/** Endplatzierung (nur wenn alle Runden gespielt sind) */
export function rundenPlatzierungen(k: KonkurrenzZustand, zurueck: string[]): { id: string; platz: number }[] {
  if (k.status !== 'beendet') return [];
  const zeilen = k.einst.modus === 'kaiser' ? kaiserTabelle(k, zurueck).zeilen : schweizerTabelle(k, zurueck);
  return zeilen.map((x) => ({ id: x.id, platz: x.platz }));
}
