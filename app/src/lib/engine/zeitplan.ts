import { anzahlGruppen, gruppenGroessen, naechsteZweierpotenz } from './auslosung';
import { erwarteteSaetze } from './ergebnis';
import { bisSiege, systemVon } from './mannschaft';
import { fruehestensUm, tische as tischListe } from './abfragen';
import { festeSaetzeVon, mitKo, uhrzeitMs, type BestOf, type KonkurrenzZustand, type Spiel } from './modell';
import { rundenplan } from './rundenplan';
import { istRundenModus, letzteRunde, rundenAuto, rundenZahl } from './runden';
import { erstePhase, spielerVon, zurueckgezogen, type TurnierZustand } from './zustand';

/**
 * Zeitplan mit geschätzter Dauer: verteilt alle noch offenen Spiele – auch die, deren Teilnehmer
 * noch nicht feststehen, und die Runden/Endrunden, die erst noch entstehen – auf die freien Tische.
 *
 * Regeln der Schätzung:
 * - Dauer eines Spiels = 2 Minuten Einspielen + erwartete Sätze × Minuten je Satz
 *   (Best of 3: 2,5 Sätze, Best of 5: 4, Best of 7: 5,5, Best of 1: 1; feste Satzzahl: genau so viele).
 * - Minuten je Satz: von der Leitung eingestellt; sonst aus den beendeten Spielen gelernt
 *   (Aufruf bis Ergebnis, Median, ab 3 Spielen), sonst 4 Minuten.
 * - Niemand spielt zweimal gleichzeitig; nach jedem Spiel gilt die Mindestpause.
 * - Folgespiele (K.-o.) erst nach ihren Vorgängern, neue Runden (Schweizer, Cup, Kaiser) und die
 *   Endrunde nach Gruppen erst, wenn die vorige Stufe ganz fertig ist.
 * - Vorplanungen der Leitung (Tisch, Uhrzeit) und der Beginn von Turnier und Konkurrenz gelten.
 * - Reihenfolge wie beim Spielaufruf: Gruppen vor K.-o., Runde für Runde über alle Konkurrenzen.
 */

/** Einspielen, Begrüßung, Wechsel (Minuten) */
export const EINSPIELEN_MIN = 2;
export const STANDARD_SATZ_MIN = 4;

export interface PlanEintrag {
  /** „konkurrenz/spiel“ für vorhandene Spiele, sonst „konkurrenz/~stufe-nr“ */
  schluessel: string;
  konkurrenz: string;
  /** vorhandenes Spiel; null = noch nicht angelegt (spätere Runde, Endrunde, noch nicht gestartete Konkurrenz) */
  spiel: string | null;
  tisch: number;
  start: number;
  ende: number;
  /** läuft gerade */
  laeuft: boolean;
  /** Beschreibung für noch nicht angelegte Spiele, z. B. „Endrunde, Runde 2“ */
  titel: string;
}

export interface Zeitplan {
  /** Je Spiel („konkurrenz/spiel“) der geschätzte Beginn */
  spiele: Map<string, PlanEintrag>;
  /** Alle Einträge je Tisch in zeitlicher Folge */
  tische: { nr: number; eintraege: PlanEintrag[] }[];
  /** Voraussichtliches Ende je Konkurrenz (null = fertig oder nicht schätzbar) */
  konkurrenzEnde: Map<string, number | null>;
  /** Voraussichtliches Ende des Turniers (null = nichts mehr offen) */
  ende: number | null;
  /** Benutzte Minuten je Satz und ob sie aus den Spielen gelernt sind */
  satzMinuten: number;
  gelernt: boolean;
  /** Spiele, die sich nicht einplanen lassen (z. B. vorgeplant für einen gesperrten Tisch) */
  nichtPlanbar: number;
}

interface Posten {
  schluessel: string;
  konkurrenz: string;
  spiel: string | null;
  titel: string;
  dauer: number;
  spieler: string[];
  /** einzelne Vorgänger (Schlüssel) */
  vor: string[];
  /** Sperre: erst wenn alle Posten dieser Stufe fertig sind */
  stufe: string | null;
  /** gehört selbst zu dieser Stufe (für nachfolgende Sperren) */
  inStufe: string | null;
  fruehestens: number;
  tisch: number | null;
  rang: [number, number, number, number];
}

const MIN = 60_000;

function median(l: number[]): number {
  const s = [...l].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Minuten je Satz aus beendeten Spielen (Aufruf bis Ergebnis), null bei weniger als 3 brauchbaren Spielen */
export function gelernteSatzMinuten(z: TurnierZustand): number | null {
  const werte: number[] = [];
  for (const kid of z.konkurrenzReihe) {
    for (const s of Object.values(z.konkurrenzen[kid]!.spiele)) {
      if (!s.eintrag || !s.aufgerufen || !s.ergebnis || s.ergebnis.art !== 'normal') continue;
      const min = (Date.parse(s.eintrag.zeit) - Date.parse(s.aufgerufen)) / MIN;
      const saetze = s.ergebnis.satzA + s.ergebnis.satzB;
      if (!(min >= 3 && min <= 90) || saetze < 1) continue;
      werte.push((min - EINSPIELEN_MIN) / saetze);
    }
  }
  if (werte.length < 3) return null;
  return Math.min(12, Math.max(2, Math.round(median(werte) * 2) / 2));
}

export function spielDauerMin(k: KonkurrenzZustand, satzMinuten: number): number {
  const satz = erwarteteSaetze(k.einst.bestOf as BestOf, festeSaetzeVon(k.einst)) * satzMinuten;
  if (k.einst.art === 'mannschaft') {
    // Begegnung an einem Tisch: im Mittel zwischen „entschieden“ und „alle Spiele“
    const sys = systemVon(k.einst);
    const teile = k.einst.mannschaft?.durchspielen ? sys.folge.length : Math.round((bisSiege(sys) + sys.folge.length) / 2);
    return EINSPIELEN_MIN + teile * satz;
  }
  return EINSPIELEN_MIN + satz;
}

/** Spiele je K.-o.-Runde bei q Teilnehmern (Freilose in Runde 1 abgezogen) */
function koRundenGroessen(q: number): number[] {
  if (q < 2) return [];
  const P = naechsteZweierpotenz(q);
  const l = [q - P / 2];
  for (let n = P / 4; n >= 1; n /= 2) l.push(n);
  return l.filter((n) => n > 0);
}

export function zeitplan(z: TurnierZustand, jetzt: number = Date.now()): Zeitplan {
  const gelernt = z.satzMinuten === null ? gelernteSatzMinuten(z) : null;
  const satzMinuten = z.satzMinuten ?? gelernt ?? STANDARD_SATZ_MIN;
  const basis = Math.max(jetzt, z.beginn ? uhrzeitMs(z.beginn, jetzt) : jetzt);

  const tische = tischListe(z).filter((t) => !t.gesperrt);
  const frei = new Map<number, number>(tische.map((t) => [t.nr, basis]));
  const spielerFrei = new Map<string, number>();
  const ergebnis = new Map<string, PlanEintrag>();
  const proTisch = new Map<number, PlanEintrag[]>(tische.map((t) => [t.nr, []]));
  const pause = z.pause * MIN;

  // Laufende Spiele belegen ihren Tisch bis zum geschätzten Ende
  for (const t of tische) {
    const s = t.spiel;
    if (!s) continue;
    const k = z.konkurrenzen[s.konkurrenz]!;
    const dauer = spielDauerMin(k, satzMinuten) * MIN;
    const ende = Math.max(Date.parse(s.aufgerufen ?? '') + dauer || jetzt + dauer, jetzt + MIN);
    const e: PlanEintrag = { schluessel: `${k.id}/${s.id}`, konkurrenz: k.id, spiel: s.id, tisch: t.nr, start: Date.parse(s.aufgerufen ?? '') || jetzt, ende, laeuft: true, titel: '' };
    ergebnis.set(e.schluessel, e);
    proTisch.get(t.nr)!.push(e);
    frei.set(t.nr, Math.max(frei.get(t.nr)!, ende));
    for (const id of [...spielerVon(k, s.a), ...spielerVon(k, s.b)]) spielerFrei.set(id, ende + pause);
  }

  /* ---------- Posten sammeln ---------- */
  const posten: Posten[] = [];
  const fertigAm = new Map<string, number>(); // geplante oder schon entschiedene Posten
  const stufeOffen = new Map<string, number>();
  const stufeEnde = new Map<string, number>();

  z.konkurrenzReihe.forEach((kid, kIndex) => {
    const k = z.konkurrenzen[kid]!;
    const dauer = spielDauerMin(k, satzMinuten) * MIN;
    const kBeginn = k.einst.beginn ? uhrzeitMs(k.einst.beginn, jetzt) : 0;
    const neu = (p: Omit<Posten, 'konkurrenz' | 'dauer' | 'fruehestens'> & { fruehestens?: number }) => {
      posten.push({ konkurrenz: kid, dauer, ...p, fruehestens: Math.max(kBeginn, p.fruehestens ?? 0) });
      if (p.inStufe) stufeOffen.set(p.inStufe, (stufeOffen.get(p.inStufe) ?? 0) + 1);
    };
    const offen = (s: Spiel) => s.status === 'offen' || s.status === 'wartet';
    const phaseRang = (ph: string) => (ph === 'gruppen' ? 0 : 1);

    // vorhandene Spiele
    const vorhandeneStufe = `${kid}#a`;
    let hatVorhandene = false;
    k.reihenfolge.forEach((sid, pos) => {
      const s = k.spiele[sid]!;
      const schl = `${kid}/${sid}`;
      if (!offen(s) || s.nurWennBGewinnt) return;
      if (ergebnis.has(schl)) {
        hatVorhandene = true; // läuft gerade (Ende zählt für die Stufe, siehe unten)
        return;
      }
      const vor: string[] = [];
      for (const q of [s.quelleA, s.quelleB]) {
        if (!q || !('spiel' in q)) continue;
        const v = k.spiele[q.spiel];
        if (v && offen(v)) vor.push(`${kid}/${q.spiel}`);
      }
      const ab = fruehestensUm(k, s);
      hatVorhandene = true;
      neu({
        schluessel: schl,
        spiel: sid,
        titel: '',
        spieler: [...spielerVon(k, s.a), ...spielerVon(k, s.b)],
        vor,
        stufe: null,
        inStufe: vorhandeneStufe,
        fruehestens: ab ? uhrzeitMs(ab, jetzt) : 0,
        tisch: s.plan?.tisch ?? null,
        rang: [phaseRang(s.phase), s.runde, kIndex, pos],
      });
    });
    // laufende Spiele dieser Konkurrenz gehören zur Stufe „vorhanden“: ihr Ende zählt für die Sperre
    for (const e of ergebnis.values()) if (e.konkurrenz === kid && e.laeuft) stufeEnde.set(vorhandeneStufe, Math.max(stufeEnde.get(vorhandeneStufe) ?? 0, e.ende));

    // noch nicht angelegte Stufen
    const aktiv = k.meldungen.filter((id) => !zurueckgezogen(k).includes(id)).length;
    const stufen: { titel: string; spiele: number; gruppen?: number[][] }[] = [];
    if (!k.gestartet.gruppen && !k.gestartet.ko) {
      if (aktiv < 2) return;
      if (istRundenModus(k.einst.modus)) {
        const R = k.einst.runden ?? rundenAuto(k.einst.modus, aktiv);
        for (let r = 1; r <= R; r++) stufen.push({ titel: `Runde ${r}`, spiele: Math.floor(aktiv / 2) });
      } else if (erstePhase(k) === 'gruppen') {
        const g = k.einst.modus === 'jgj' ? 1 : Math.max(1, Math.min(anzahlGruppen(aktiv, k.einst.gruppenGroesse), Math.floor(aktiv / 2) || 1));
        const groessen = gruppenGroessen(aktiv, g);
        stufen.push({ titel: 'Gruppen', spiele: 0, gruppen: groessen.map((n) => Array.from({ length: n }, (_, i) => i)) });
        if (k.einst.modus === 'gruppen_ko') koRundenGroessen(groessen.reduce((s, n) => s + Math.min(n, k.einst.aufsteiger), 0)).forEach((n, i) => stufen.push({ titel: `Endrunde ${i + 1}`, spiele: n }));
      } else {
        const r = koRundenGroessen(aktiv);
        r.forEach((n, i) => stufen.push({ titel: `K.-o. Runde ${i + 1}`, spiele: n }));
        if (k.einst.modus === 'doppel_ko') {
          // Verliererbaum grob: insgesamt noch einmal so viele Spiele, in eigenen Stufen
          r.forEach((n, i) => stufen.push({ titel: `Verliererrunde ${i + 1}`, spiele: Math.max(1, n) }));
        }
      }
    } else if (istRundenModus(k.einst.modus) && k.status !== 'beendet') {
      const R = rundenZahl(k);
      for (let r = letzteRunde(k) + 1; r <= R; r++) stufen.push({ titel: `Runde ${r}`, spiele: Math.floor(aktiv / 2) });
    } else if (k.einst.modus === 'gruppen_ko' && k.gestartet.gruppen && !k.gestartet.ko) {
      const q = k.gruppen.reduce((s, g) => s + Math.min(g.mitglieder.length, k.einst.aufsteiger), 0);
      koRundenGroessen(q).forEach((n, i) => stufen.push({ titel: `Endrunde ${i + 1}`, spiele: n }));
    }
    let vorige = hatVorhandene ? vorhandeneStufe : null;
    stufen.forEach((st, si) => {
      const name = `${kid}#${si}`;
      const rangPhase = st.gruppen ? 0 : mitKo(k.einst.modus) && !st.titel.startsWith('Runde') ? 1 : 0;
      if (st.gruppen) {
        // Gruppen einer noch nicht gestarteten Konkurrenz: Rundenplan mit Platzhaltern
        let nr = 0;
        st.gruppen.forEach((m, g) => {
          rundenplan(m.length).forEach((runde, r) => {
            for (const [x, y] of runde) {
              neu({
                schluessel: `${kid}/~g${g}-${x}-${y}`,
                spiel: null,
                titel: `Gruppe ${String.fromCharCode(65 + (g % 26))}`,
                spieler: [`~${kid}-${g}-${x}`, `~${kid}-${g}-${y}`],
                vor: [],
                stufe: vorige,
                inStufe: name,
                tisch: null,
                rang: [0, r + 1, kIndex, nr++],
              });
            }
          });
        });
      } else {
        for (let i = 0; i < st.spiele; i++) {
          neu({ schluessel: `${kid}/~${si}-${i}`, spiel: null, titel: st.titel, spieler: [], vor: [], stufe: vorige, inStufe: name, tisch: null, rang: [rangPhase, 100 + si, kIndex, i] });
        }
      }
      vorige = name;
    });
  });

  posten.sort((x, y) => x.rang[0] - y.rang[0] || x.rang[1] - y.rang[1] || x.rang[2] - y.rang[2] || x.rang[3] - y.rang[3]);

  /* ---------- Verteilen (Listenplanung: freiester Tisch nimmt den ersten bereiten Posten) ---------- */
  const bereitAb = (p: Posten): number => {
    let t = p.fruehestens;
    for (const v of p.vor) {
      const f = fertigAm.get(v);
      if (f === undefined) return Infinity;
      t = Math.max(t, f + pause);
    }
    if (p.stufe) {
      if ((stufeOffen.get(p.stufe) ?? 0) > 0) return Infinity;
      t = Math.max(t, (stufeEnde.get(p.stufe) ?? 0) + pause);
    }
    for (const id of p.spieler) t = Math.max(t, spielerFrei.get(id) ?? 0);
    return t;
  };
  // Laufende Spiele: ihr Ende gilt für Folgespiele
  for (const e of ergebnis.values()) fertigAm.set(e.schluessel, e.ende);

  let rest = [...posten];
  let schritte = 0;
  const gesperrt = new Set<number>();
  while (rest.length && schritte++ < 50_000) {
    const kandidaten = [...frei.entries()].filter(([nr]) => !gesperrt.has(nr));
    if (!kandidaten.length) break;
    const [nr, ab] = kandidaten.reduce((m, x) => (x[1] < m[1] || (x[1] === m[1] && x[0] < m[0]) ? x : m));
    let gewaehlt = -1;
    let naechster = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const p = rest[i]!;
      if (p.tisch !== null && p.tisch !== nr) continue;
      const b = bereitAb(p);
      if (b <= ab) {
        gewaehlt = i;
        break;
      }
      if (b < naechster) naechster = b;
    }
    if (gewaehlt < 0) {
      if (naechster === Infinity) gesperrt.add(nr);
      else frei.set(nr, naechster);
      continue;
    }
    const p = rest.splice(gewaehlt, 1)[0]!;
    const e: PlanEintrag = { schluessel: p.schluessel, konkurrenz: p.konkurrenz, spiel: p.spiel, tisch: nr, start: ab, ende: ab + p.dauer, laeuft: false, titel: p.titel };
    ergebnis.set(p.schluessel, e);
    proTisch.get(nr)!.push(e);
    frei.set(nr, e.ende);
    fertigAm.set(p.schluessel, e.ende);
    for (const id of p.spieler) spielerFrei.set(id, e.ende + pause);
    if (p.inStufe) {
      stufeOffen.set(p.inStufe, (stufeOffen.get(p.inStufe) ?? 1) - 1);
      stufeEnde.set(p.inStufe, Math.max(stufeEnde.get(p.inStufe) ?? 0, e.ende));
    }
    // Neue Freigaben können Tische betreffen, die schon „nichts zu tun“ hatten
    gesperrt.clear();
  }

  const konkurrenzEnde = new Map<string, number | null>();
  for (const kid of z.konkurrenzReihe) konkurrenzEnde.set(kid, null);
  let ende: number | null = null;
  for (const e of ergebnis.values()) {
    konkurrenzEnde.set(e.konkurrenz, Math.max(konkurrenzEnde.get(e.konkurrenz) ?? 0, e.ende));
    ende = Math.max(ende ?? 0, e.ende);
  }
  for (const p of rest) konkurrenzEnde.set(p.konkurrenz, null);
  return {
    spiele: ergebnis,
    tische: [...proTisch.entries()].map(([nr, eintraege]) => ({ nr, eintraege: eintraege.sort((a, b) => a.start - b.start) })),
    konkurrenzEnde,
    ende,
    satzMinuten,
    gelernt: gelernt !== null,
    nichtPlanbar: rest.length,
  };
}

/**
 * Gedrosselter Zeitplan für die Oberfläche: Bei großen Turnieren kann die Berechnung spürbar dauern.
 * Ist sie schnell (unter 30 ms), wird sofort gerechnet; sonst höchstens alle `abstandMs` (mindestens
 * dem Doppelten der letzten Rechenzeit), und die zuletzt angeforderte Lage gewinnt. Gleicher Stand
 * (dasselbe Zustands-Objekt) wird nicht neu gerechnet – auch nicht von zwei Ansichten.
 */
const zuletzt = new WeakMap<TurnierZustand, { jetzt: number; plan: Zeitplan }>();
let rechenzeit = 0;
let zuletztGerechnet = 0;
let geplant: ReturnType<typeof setTimeout> | null = null;
let anfrage: { z: TurnierZustand; jetzt: number; fertig: Set<(p: Zeitplan) => void> } | null = null;

function rechnen(z: TurnierZustand, jetzt: number): Zeitplan {
  const t0 = performance.now();
  const plan = zeitplan(z, jetzt);
  rechenzeit = performance.now() - t0;
  zuletztGerechnet = Date.now();
  zuletzt.set(z, { jetzt, plan });
  return plan;
}

/** Sofort (z. B. beim Öffnen einer Ansicht), aber aus dem Zwischenspeicher, wenn der Stand gleich ist */
export function zeitplanSofort(z: TurnierZustand, jetzt: number): Zeitplan {
  const da = zuletzt.get(z);
  return da && Math.abs(da.jetzt - jetzt) < 30_000 ? da.plan : rechnen(z, jetzt);
}

export function zeitplanGedrosselt(z: TurnierZustand, jetzt: number, fertig: (p: Zeitplan) => void, abstandMs = 1500): void {
  const da = zuletzt.get(z);
  if (da && Math.abs(da.jetzt - jetzt) < 30_000) {
    fertig(da.plan);
    return;
  }
  const warten = Math.max(abstandMs, rechenzeit * 2) - (Date.now() - zuletztGerechnet);
  if (rechenzeit < 30 || warten <= 0) {
    if (!geplant) {
      fertig(rechnen(z, jetzt));
      return;
    }
  }
  const alle = anfrage?.fertig ?? new Set<(p: Zeitplan) => void>();
  alle.add(fertig);
  anfrage = { z, jetzt, fertig: alle };
  if (geplant) return;
  geplant = setTimeout(() => {
    geplant = null;
    const a = anfrage!;
    anfrage = null;
    const plan = rechnen(a.z, a.jetzt);
    for (const f of a.fertig) f(plan);
  }, Math.max(50, warten));
}

/** Nur für Tests: Drossel zurücksetzen */
export function zeitplanDrosselZuruecksetzen() {
  if (geplant) clearTimeout(geplant);
  geplant = null;
  anfrage = null;
  rechenzeit = 0;
  zuletztGerechnet = 0;
}
