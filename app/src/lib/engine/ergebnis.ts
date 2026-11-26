import type { BestOf, Eingabe, Ergebnis, ErgebnisEingabe, Seite } from './modell';

/**
 * Prüfung und Wertung von Spielergebnissen.
 * Regeln: Satz bis 11 Punkte mit mindestens 2 Punkten Abstand; ab 10:10 wird
 * gespielt, bis einer 2 Punkte vorn ist. Best of 3/5/7.
 * Aufgabe und kampflos nach DTTB-WO D 7.10.
 */

export function gewinnSaetze(bestOf: BestOf): number {
  return (bestOf + 1) / 2;
}

function ganz(n: unknown, max = Number.MAX_SAFE_INTEGER): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max;
}

/** null = Satz in Ordnung, sonst Fehlertext */
export function satzFehler(a: number, b: number): string | null {
  if (!ganz(a) || !ganz(b)) return 'Bitte ganze Punkte eingeben.';
  const hoch = Math.max(a, b);
  const diff = Math.abs(a - b);
  if (hoch < 11) return 'Ein Satz geht bis mindestens 11 Punkte.';
  if (diff < 2) return 'Ein Satz braucht 2 Punkte Abstand.';
  if (hoch > 11 && diff !== 2) return 'Nach 10:10 endet der Satz bei genau 2 Punkten Abstand (z. B. 12:10).';
  return null;
}

/** Aus „Satzgewinner + Punkte des Verlierers“ den Satz bilden: 9 → 11:9, 10 → 12:10, 15 → 17:15 */
export function satzAusVerliererpunkten(gewinner: Seite, verlierer: number): [number, number] {
  const g = verlierer >= 10 ? verlierer + 2 : 11;
  return gewinner === 'a' ? [g, verlierer] : [verlierer, g];
}

function andere(s: Seite): Seite {
  return s === 'a' ? 'b' : 'a';
}

function summe(saetze: [number, number][]) {
  return saetze.reduce(([x, y], [a, b]) => [x + a, y + b] as [number, number], [0, 0] as [number, number]);
}

function zaehlen(saetze: [number, number][]) {
  let a = 0;
  let b = 0;
  for (const [x, y] of saetze) {
    if (x > y) a++;
    else b++;
  }
  return [a, b] as const;
}

export type Wertungsergebnis = { ok: true; ergebnis: Ergebnis } | { ok: false; fehler: string };

/** Erwartete Zahl gespielter Sätze (für Zeitschätzungen) */
export function erwarteteSaetze(bestOf: BestOf, feste: number | null = null): number {
  if (feste) return feste;
  return bestOf === 1 ? 1 : bestOf === 3 ? 2.5 : bestOf === 5 ? 4 : 5.5;
}

/**
 * Prüft eine Eingabe und liefert das gewertete Ergebnis.
 * Mit `feste` (2 oder 4) werden genau so viele Sätze gespielt; Unentschieden ist möglich.
 */
export function ergebnisWerten(e: ErgebnisEingabe, bestOf: BestOf, eingabe: Eingabe, feste: number | null = null): Wertungsergebnis {
  if (feste) return festeWerten(e, feste, eingabe);
  const k = gewinnSaetze(bestOf);
  const nurSaetze = eingabe === 'saetze';
  const fehler = (t: string): Wertungsergebnis => ({ ok: false, fehler: t });

  if (e.kampflos) {
    if (e.kampflos !== 'a' && e.kampflos !== 'b') return fehler('Ungültige Angabe.');
    const g = andere(e.kampflos);
    const satz: [number, number] = g === 'a' ? [11, 0] : [0, 11];
    const saetze = nurSaetze ? null : Array.from({ length: k }, () => [...satz] as [number, number]);
    const [ballA, ballB] = saetze ? summe(saetze) : [null, null];
    return { ok: true, ergebnis: { saetze, satzA: g === 'a' ? k : 0, satzB: g === 'b' ? k : 0, ballA, ballB, gewinner: g, art: 'kampflos' } };
  }

  if (e.aufgabe) {
    if (e.aufgabe !== 'a' && e.aufgabe !== 'b') return fehler('Ungültige Angabe.');
    const g = andere(e.aufgabe);
    if (nurSaetze) {
      const [sa, sb] = e.stand ?? [0, 0];
      if (!ganz(sa, k) || !ganz(sb, k) || sa >= k || sb >= k) return fehler(`Satzstand bei Aufgabe: jeweils weniger als ${k} Sätze.`);
      return { ok: true, ergebnis: { saetze: null, satzA: g === 'a' ? k : sa, satzB: g === 'b' ? k : sb, ballA: null, ballB: null, gewinner: g, art: 'aufgabe' } };
    }
    const gespielt = e.saetze ?? [];
    for (const [x, y] of gespielt) {
      const f = satzFehler(x, y);
      if (f) return fehler(f);
    }
    const [sa, sb] = zaehlen(gespielt);
    if (sa >= k || sb >= k) return fehler('Das Spiel war schon entschieden – bitte ohne Aufgabe eintragen.');
    const saetze = [...gespielt.map((s) => [...s] as [number, number])];
    // angefangener Satz: Bälle des Aufgebenden zählen, Sieger mindestens X+2 (D 7.10)
    const [la, lb] = e.laufend ?? [0, 0];
    if (!ganz(la) || !ganz(lb)) return fehler('Bitte den Stand im angefangenen Satz als ganze Punkte eingeben.');
    if (Math.max(la, lb) >= 11 && Math.abs(la - lb) >= 2) return fehler('Dieser Satz ist bereits beendet. Bitte als gespielten Satz eintragen.');
    const x = e.aufgabe === 'a' ? la : lb;
    const sieger = Math.max(11, x + 2);
    saetze.push(e.aufgabe === 'a' ? [x, sieger] : [sieger, x]);
    // fehlende Sätze 0:11
    while (zaehlen(saetze)[g === 'a' ? 0 : 1] < k) saetze.push(g === 'a' ? [11, 0] : [0, 11]);
    const [satzA, satzB] = zaehlen(saetze);
    const [ballA, ballB] = summe(saetze);
    return { ok: true, ergebnis: { saetze, satzA, satzB, ballA, ballB, gewinner: g, art: 'aufgabe' } };
  }

  if (nurSaetze) {
    const s = e.stand;
    if (!s || !ganz(s[0], k) || !ganz(s[1], k)) return fehler('Bitte den Satzstand angeben.');
    const [sa, sb] = s;
    if (Math.max(sa, sb) !== k || Math.min(sa, sb) >= k) return fehler(`Bei Best of ${bestOf} gewinnt, wer zuerst ${k} Sätze hat.`);
    return { ok: true, ergebnis: { saetze: null, satzA: sa, satzB: sb, ballA: null, ballB: null, gewinner: sa > sb ? 'a' : 'b', art: 'normal' } };
  }

  const saetze = e.saetze;
  if (!Array.isArray(saetze) || saetze.length === 0) return fehler('Bitte die Sätze eintragen.');
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < saetze.length; i++) {
    const satz = saetze[i];
    if (!Array.isArray(satz) || satz.length !== 2) return fehler('Ungültiger Satz.');
    const f = satzFehler(satz[0], satz[1]);
    if (f) return fehler(`Satz ${i + 1}: ${f}`);
    if (sa >= k || sb >= k) return fehler('Nach dem entscheidenden Satz folgt kein weiterer.');
    if (satz[0] > satz[1]) sa++;
    else sb++;
  }
  if (sa < k && sb < k) return fehler(`Noch nicht entschieden: Bei Best of ${bestOf} braucht der Sieger ${k} Sätze.`);
  const [ballA, ballB] = summe(saetze);
  return {
    ok: true,
    ergebnis: { saetze: saetze.map((s) => [s[0], s[1]] as [number, number]), satzA: sa, satzB: sb, ballA, ballB, gewinner: sa > sb ? 'a' : 'b', art: 'normal' },
  };
}

/** Wertung bei fester Satzzahl n: alle n Sätze werden gespielt, Unentschieden möglich */
function festeWerten(e: ErgebnisEingabe, n: number, eingabe: Eingabe): Wertungsergebnis {
  const nurSaetze = eingabe === 'saetze';
  const fehler = (t: string): Wertungsergebnis => ({ ok: false, fehler: t });
  const sieger = (sa: number, sb: number): Seite | null => (sa > sb ? 'a' : sb > sa ? 'b' : null);
  if (e.kampflos) {
    if (e.kampflos !== 'a' && e.kampflos !== 'b') return fehler('Ungültige Angabe.');
    const g = andere(e.kampflos);
    const satz: [number, number] = g === 'a' ? [11, 0] : [0, 11];
    const saetze = nurSaetze ? null : Array.from({ length: n }, () => [...satz] as [number, number]);
    const [ballA, ballB] = saetze ? summe(saetze) : [null, null];
    return { ok: true, ergebnis: { saetze, satzA: g === 'a' ? n : 0, satzB: g === 'b' ? n : 0, ballA, ballB, gewinner: g, art: 'kampflos' } };
  }
  if (e.aufgabe) {
    // Wer aufgibt, verliert (D 7.10); die restlichen Sätze gehen an den Gegner
    if (e.aufgabe !== 'a' && e.aufgabe !== 'b') return fehler('Ungültige Angabe.');
    const g = andere(e.aufgabe);
    if (nurSaetze) {
      const [sa, sb] = e.stand ?? [0, 0];
      if (!ganz(sa, n) || !ganz(sb, n) || sa + sb >= n) return fehler(`Satzstand bei Aufgabe: zusammen weniger als ${n} Sätze.`);
      const rest = n - sa - sb;
      return { ok: true, ergebnis: { saetze: null, satzA: sa + (g === 'a' ? rest : 0), satzB: sb + (g === 'b' ? rest : 0), ballA: null, ballB: null, gewinner: g, art: 'aufgabe' } };
    }
    const gespielt = e.saetze ?? [];
    for (const [x, y] of gespielt) {
      const f = satzFehler(x, y);
      if (f) return fehler(f);
    }
    if (gespielt.length >= n) return fehler('Alle Sätze sind gespielt – bitte ohne Aufgabe eintragen.');
    const saetze = gespielt.map((s) => [...s] as [number, number]);
    const [la, lb] = e.laufend ?? [0, 0];
    if (!ganz(la) || !ganz(lb)) return fehler('Bitte den Stand im angefangenen Satz als ganze Punkte eingeben.');
    if (Math.max(la, lb) >= 11 && Math.abs(la - lb) >= 2) return fehler('Dieser Satz ist bereits beendet. Bitte als gespielten Satz eintragen.');
    const x = e.aufgabe === 'a' ? la : lb;
    const s = Math.max(11, x + 2);
    saetze.push(e.aufgabe === 'a' ? [x, s] : [s, x]);
    while (saetze.length < n) saetze.push(g === 'a' ? [11, 0] : [0, 11]);
    const [satzA, satzB] = zaehlen(saetze);
    const [ballA, ballB] = summe(saetze);
    return { ok: true, ergebnis: { saetze, satzA, satzB, ballA, ballB, gewinner: g, art: 'aufgabe' } };
  }
  if (nurSaetze) {
    const st = e.stand;
    if (!st || !ganz(st[0], n) || !ganz(st[1], n) || st[0] + st[1] !== n) return fehler(`Es werden genau ${n} Sätze gespielt – bitte den Satzstand angeben.`);
    return { ok: true, ergebnis: { saetze: null, satzA: st[0], satzB: st[1], ballA: null, ballB: null, gewinner: sieger(st[0], st[1]), art: 'normal' } };
  }
  const saetze = e.saetze;
  if (!Array.isArray(saetze) || saetze.length === 0) return fehler('Bitte die Sätze eintragen.');
  for (let i = 0; i < saetze.length; i++) {
    const satz = saetze[i];
    if (!Array.isArray(satz) || satz.length !== 2) return fehler('Ungültiger Satz.');
    const f = satzFehler(satz[0], satz[1]);
    if (f) return fehler(`Satz ${i + 1}: ${f}`);
  }
  if (saetze.length !== n) return fehler(`Es werden genau ${n} Sätze gespielt (${saetze.length} eingetragen).`);
  const [sa, sb] = zaehlen(saetze);
  const [ballA, ballB] = summe(saetze);
  return { ok: true, ergebnis: { saetze: saetze.map((s) => [s[0], s[1]] as [number, number]), satzA: sa, satzB: sb, ballA, ballB, gewinner: sieger(sa, sb), art: 'normal' } };
}

/** Eingabe aus Sicht der anderen Seite (A und B vertauscht) */
export function eingabeTauschen(e: ErgebnisEingabe): ErgebnisEingabe {
  const t = (s?: Seite) => (s ? andere(s) : undefined);
  const p = (x?: [number, number]) => (x ? ([x[1], x[0]] as [number, number]) : undefined);
  const r: ErgebnisEingabe = {};
  if (e.saetze) r.saetze = e.saetze.map(([a, b]) => [b, a]);
  if (e.stand) r.stand = p(e.stand);
  if (e.kampflos) r.kampflos = t(e.kampflos);
  if (e.aufgabe) r.aufgabe = t(e.aufgabe);
  if (e.laufend) r.laufend = p(e.laufend);
  return r;
}

export function ergebnisGleich(x: Ergebnis, y: Ergebnis): boolean {
  if (x.satzA !== y.satzA || x.satzB !== y.satzB || x.art !== y.art || x.gewinner !== y.gewinner) return false;
  if (x.saetze && y.saetze) {
    return x.saetze.length === y.saetze.length && x.saetze.every((s, i) => s[0] === y.saetze![i]![0] && s[1] === y.saetze![i]![1]);
  }
  return true;
}

/** „3:1 (11:7, 9:11, 11:5, 12:10)“ – optional aus Sicht von B */
export function ergebnisText(e: Ergebnis, ausSichtVon: Seite = 'a', gewinnerName?: string): string {
  const b = ausSichtVon === 'b';
  // Mannschafts-Begegnung: gewonnene Spiele, Sätze in Klammern
  if (e.spiele) {
    const [x, y] = b ? [e.spiele[1], e.spiele[0]] : e.spiele;
    return `${x}:${y} (${b ? `${e.satzB}:${e.satzA}` : `${e.satzA}:${e.satzB}`} Sätze)${e.art === 'kampflos' ? ' kampflos' : ''}`;
  }
  const stand = b ? `${e.satzB}:${e.satzA}` : `${e.satzA}:${e.satzB}`;
  const zusatz = e.art === 'kampflos' ? ' kampflos' : e.art === 'aufgabe' && e.gewinner ? ` (Aufgabe, ${gewinnerName || (e.gewinner === ausSichtVon ? 'erste Seite' : 'zweite Seite')} gewinnt)` : '';
  if (!e.saetze || e.art === 'kampflos') return stand + zusatz;
  const s = e.saetze.map(([x, y]) => (b ? `${y}:${x}` : `${x}:${y}`)).join(', ');
  return `${stand} (${s})${zusatz}`;
}
