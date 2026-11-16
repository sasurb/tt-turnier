import { kampflosErgebnis } from './wertung';
import { BAUM_PRAEFIX, type Baum, type KonkurrenzZustand, type Quelle, type Seite, type Spiel } from './modell';

/**
 * K.-o.-Teil einer Konkurrenz als Netz von Spielen: Jedes Spiel kennt die Herkunft seiner beiden
 * Teilnehmer (`quelleA`/`quelleB`: ein Platz der Auslosung oder Sieger/Verlierer eines früheren
 * Spiels). Damit lassen sich Hauptrunde, Spiel um Platz 3, Trostrunde und Doppel-K.-o. mit einer
 * einzigen Durchrechnung behandeln.
 *
 * Spiel-IDs: „ko-<Runde>-<Nr>“ Hauptrunde, „ko-p3“ Spiel um Platz 3, „tr-<Runde>-<Nr>“ Trostrunde,
 * „vl-<Runde>-<Nr>“ Verliererbaum, „fi-1-0“/„fi-2-0“ Endspiele des Doppel-K.-o.
 */

export function koSpielId(runde: number, index: number, baum: Baum = 'haupt'): string {
  return `${BAUM_PRAEFIX[baum]}-${runde}-${index}`;
}
export const PLATZ3_ID = 'ko-p3';

function leeresSpiel(konkurrenz: string, id: string, runde: number, index: number, baum: Baum): Spiel {
  return {
    id,
    konkurrenz,
    phase: 'ko',
    gruppe: null,
    runde,
    index,
    a: null,
    b: null,
    aFrei: false,
    bFrei: false,
    status: 'wartet',
    ergebnis: null,
    stand: null,
    eintrag: null,
    alternativen: [],
    angefochtenVon: null,
    kampflosDurchRueckzug: null,
    gestrichen: false,
    gewinner: null,
    weiter: null,
    verliererWeiter: null,
    platz3: false,
    gesperrt: false,
    baum,
    quelleA: null,
    quelleB: null,
    nurWennBGewinnt: false,
    tisch: null,
    aufgerufen: null,
    schiri: null,
    plan: null,
  };
}

export function koRunden(plaetze: number): number {
  return Math.round(Math.log2(plaetze));
}

const sieger = (spiel: string): Quelle => ({ spiel, wer: 'sieger' });
const verlierer = (spiel: string): Quelle => ({ spiel, wer: 'verlierer' });

/**
 * Legt alle Spiele des K.-o.-Teils an (ohne Ergebnisse) und gibt die IDs in Spielfolge zurück.
 * Die Spielfolge ist so gewählt, dass die Herkunft eines Spiels immer vor dem Spiel steht.
 */
export function koAnlegen(k: KonkurrenzZustand): string[] {
  const P = k.auslosungKo!.plaetze.length;
  const R = koRunden(P);
  const e = k.einst;
  const ids: string[] = [];
  const neu = (id: string, runde: number, index: number, baum: Baum, qa: Quelle, qb: Quelle) => {
    const s = leeresSpiel(k.id, id, runde, index, baum);
    s.quelleA = qa;
    s.quelleB = qb;
    k.spiele[id] = s;
    ids.push(id);
    return s;
  };
  const doppelKo = e.modus === 'doppel_ko' && R >= 2;
  const trost = e.trostrunde && !doppelKo && R >= 2;
  const platz3 = e.platz3 && !doppelKo && R >= 2;

  for (let r = 1; r <= R; r++) {
    const anzahl = P / 2 ** r;
    for (let i = 0; i < anzahl; i++) {
      const qa = r === 1 ? ({ platz: 2 * i } as Quelle) : sieger(koSpielId(r - 1, 2 * i));
      const qb = r === 1 ? ({ platz: 2 * i + 1 } as Quelle) : sieger(koSpielId(r - 1, 2 * i + 1));
      neu(koSpielId(r, i), r, i, 'haupt', qa, qb);
    }
    if (platz3 && r === R) {
      // vor dem Endspiel einsortieren
      const id = ids.pop()!;
      const p3 = neu(PLATZ3_ID, R, 1, 'haupt', verlierer(koSpielId(R - 1, 0)), verlierer(koSpielId(R - 1, 1)));
      p3.platz3 = true;
      ids.push(id);
    }
    if (trost) {
      // Trostrunde: Runde 1 aus den Verlierern der ersten Hauptrunde, danach normal weiter
      if (r === 1) {
        for (let i = 0; i < P / 4; i++) neu(koSpielId(1, i, 'trost'), 1, i, 'trost', verlierer(koSpielId(1, 2 * i)), verlierer(koSpielId(1, 2 * i + 1)));
      } else if (r <= R - 1) {
        const tr = r;
        for (let i = 0; i < P / 2 ** (tr + 1); i++) neu(koSpielId(tr, i, 'trost'), tr, i, 'trost', sieger(koSpielId(tr - 1, 2 * i, 'trost')), sieger(koSpielId(tr - 1, 2 * i + 1, 'trost')));
      }
    }
    if (doppelKo) {
      // Verliererbaum: Runde 1 = Verlierer der 1. Hauptrunde gegeneinander; danach abwechselnd
      // „Einstieg“ (Sieger des Verliererbaums gegen Verlierer der nächsten Hauptrunde) und „Zusammenführung“.
      if (r === 1) {
        for (let i = 0; i < P / 4; i++) neu(koSpielId(1, i, 'verlierer'), 1, i, 'verlierer', verlierer(koSpielId(1, 2 * i)), verlierer(koSpielId(1, 2 * i + 1)));
      } else {
        const m = 2 * (r - 1); // Einstiegsrunde zu Hauptrunde r
        const n = P / 2 ** r;
        for (let i = 0; i < n; i++) {
          // Verlierer der Hauptrunde in jeder zweiten Runde gespiegelt einsetzen (seltener Wiederholungsspiele)
          const j = r % 2 === 0 ? n - 1 - i : i;
          neu(koSpielId(m, i, 'verlierer'), m, i, 'verlierer', sieger(koSpielId(m - 1, i, 'verlierer')), verlierer(koSpielId(r, j)));
        }
        if (r < R) {
          for (let i = 0; i < n / 2; i++) neu(koSpielId(m + 1, i, 'verlierer'), m + 1, i, 'verlierer', sieger(koSpielId(m, 2 * i, 'verlierer')), sieger(koSpielId(m, 2 * i + 1, 'verlierer')));
        }
      }
    }
  }
  if (doppelKo) {
    const lFinale = koSpielId(2 * (R - 1), 0, 'verlierer');
    neu(koSpielId(1, 0, 'finale'), 1, 0, 'finale', sieger(koSpielId(R, 0)), sieger(lFinale));
    if (e.finaleWiederholung) {
      const f2 = neu(koSpielId(2, 0, 'finale'), 2, 0, 'finale', sieger(koSpielId(1, 0, 'finale')), verlierer(koSpielId(1, 0, 'finale')));
      f2.nurWennBGewinnt = true;
    }
  }
  // Rückwärtsverweise für Anzeige und Sperren
  for (const id of ids) {
    const s = k.spiele[id]!;
    for (const [q, seite] of [
      [s.quelleA, 'a'],
      [s.quelleB, 'b'],
    ] as const) {
      if (!q || !('spiel' in q)) continue;
      const vor = k.spiele[q.spiel]!;
      if (q.wer === 'sieger') vor.weiter = { spiel: id, seite };
      else vor.verliererWeiter = { spiel: id, seite };
    }
  }
  return ids;
}

type Ausgang = { id: string | null; frei: boolean; gesperrt: boolean } | undefined;

/** Wer (Teilnehmer-ID) bzw. „frei“ kommt aus einem Spiel als Sieger bzw. Verlierer heraus? undefined = noch offen */
function ausgang(s: Spiel, wer: 'sieger' | 'verlierer'): Ausgang {
  if (s.stand === 'angefochten' || s.stand === 'konflikt') return { id: null, frei: false, gesperrt: true };
  if (s.status === 'entfallen') {
    // zweites Endspiel entfällt: Sieger/Verlierer sind die des ersten
    return undefined;
  }
  if (s.status === 'freilos') {
    const id = s.a ?? s.b;
    return wer === 'sieger' ? { id, frei: id === null, gesperrt: false } : { id: null, frei: true, gesperrt: false };
  }
  if (s.status !== 'gespielt' || !s.gewinner) return s.gesperrt ? { id: null, frei: false, gesperrt: true } : undefined;
  const g = s.gewinner === 'a' ? s.a : s.b;
  const v = s.gewinner === 'a' ? s.b : s.a;
  return { id: wer === 'sieger' ? g : v, frei: false, gesperrt: false };
}

/**
 * K.-o.-Teil neu durchrechnen: Teilnehmer aus Auslosung und Vorgängerspielen übernehmen, Freilose
 * und Rückzüge auflösen. Ändert sich die Besetzung eines Spiels, das schon ein Ergebnis hat, wird es
 * verworfen (kommt nur vor, wenn die Leitung frühere Ergebnisse ändert; die Engine verhindert das sonst).
 */
export function koAktualisieren(k: KonkurrenzZustand, zurueck: Set<string>): void {
  const plaetze = k.auslosungKo?.plaetze;
  if (!plaetze) return;

  const quelle = (q: Quelle | null): Ausgang => {
    if (!q) return undefined;
    if ('platz' in q) {
      const id = plaetze[q.platz] ?? null;
      return { id, frei: id === null, gesperrt: false };
    }
    const vor = k.spiele[q.spiel];
    return vor ? ausgang(vor, q.wer) : undefined;
  };
  const setze = (s: Spiel, seite: Seite, w: Ausgang) => {
    const id = w?.id ?? null;
    const frei = w?.frei ?? false;
    if (seite === 'a') {
      s.a = id;
      s.aFrei = frei;
    } else {
      s.b = id;
      s.bFrei = frei;
    }
    if (w?.gesperrt) s.gesperrt = true;
  };

  const bewerten = (s: Spiel) => {
    if (s.nurWennBGewinnt && s.quelleA && 'spiel' in s.quelleA) {
      const erstes = k.spiele[s.quelleA.spiel];
      if (erstes && erstes.status === 'gespielt' && erstes.gewinner === 'a') {
        s.status = 'entfallen';
        s.ergebnis = null;
        s.gewinner = null;
        s.kampflosDurchRueckzug = null;
        return;
      }
    }
    if (s.a && s.b) {
      if (!s.eintrag) {
        const za = zurueck.has(s.a);
        const zb = zurueck.has(s.b);
        if (za || zb) {
          const v: Seite = za ? 'a' : 'b';
          s.kampflosDurchRueckzug = v;
          s.ergebnis = kampflosErgebnis(v, k.einst);
          s.gewinner = za && zb ? null : v === 'a' ? 'b' : 'a';
          s.status = za && zb ? 'freilos' : 'gespielt';
          if (za && zb) {
            s.a = null;
            s.b = null;
            s.aFrei = s.bFrei = true;
          }
          return;
        }
      }
      s.kampflosDurchRueckzug = null;
      s.status = s.eintrag ? 'gespielt' : 'offen';
      s.ergebnis = s.eintrag?.ergebnis ?? null;
      s.gewinner = s.ergebnis?.gewinner ?? null;
      return;
    }
    s.kampflosDurchRueckzug = null;
    if ((s.a || s.aFrei) && (s.b || s.bFrei)) {
      s.status = 'freilos';
      s.gewinner = s.a ? 'a' : s.b ? 'b' : null;
      s.ergebnis = null;
      return;
    }
    s.status = 'wartet';
    s.gewinner = null;
    s.ergebnis = null;
  };

  for (const id of k.reihenfolge) {
    const s = k.spiele[id]!;
    if (s.phase !== 'ko') continue;
    const alt = { a: s.a, b: s.b };
    s.gesperrt = false;
    setze(s, 'a', quelle(s.quelleA));
    setze(s, 'b', quelle(s.quelleB));
    if (s.eintrag && (s.a !== alt.a || s.b !== alt.b)) {
      s.eintrag = null;
      s.alternativen = [];
      s.stand = null;
      s.angefochtenVon = null;
    }
    bewerten(s);
  }
}

/** Spiele, deren Besetzung vom Ausgang dieses Spiels abhängt und die schon ein Ergebnis haben */
export function abhaengigeMitErgebnis(k: KonkurrenzZustand, s: Spiel): Spiel[] {
  const l: Spiel[] = [];
  for (const w of [s.weiter, s.verliererWeiter]) {
    const f = w ? k.spiele[w.spiel] : undefined;
    if (f && f.eintrag) l.push(f);
  }
  return l;
}

export interface Platzierung {
  platz: number;
  /** z. B. „5–8“ */
  bezeichnung: string;
  id: string;
}

function siegerVerlierer(s: Spiel | undefined, wer: 'sieger' | 'verlierer'): string | null {
  if (!s || !s.gewinner || (s.status !== 'gespielt' && s.status !== 'freilos')) return null;
  const g = s.gewinner === 'a' ? s.a : s.b;
  const v = s.gewinner === 'a' ? s.b : s.a;
  return wer === 'sieger' ? g : v;
}

/** Spiele eines Baums und einer Runde in Reihenfolge */
function rundeSpiele(k: KonkurrenzZustand, baum: Baum, runde: number): Spiel[] {
  return k.reihenfolge.map((id) => k.spiele[id]!).filter((s) => s.phase === 'ko' && s.baum === baum && s.runde === runde && !s.platz3);
}
function rundenZahl(k: KonkurrenzZustand, baum: Baum): number {
  return Math.max(0, ...Object.values(k.spiele).filter((s) => s.phase === 'ko' && s.baum === baum && !s.platz3).map((s) => s.runde));
}

/** Platzierungen der Hauptrunde bzw. des Doppel-K.-o., soweit entschieden */
export function koPlatzierungen(k: KonkurrenzZustand): Platzierung[] {
  const plaetze = k.auslosungKo?.plaetze;
  if (!plaetze || !k.gestartet.ko) return [];
  const P = plaetze.length;
  const R = koRunden(P);
  const aus: Platzierung[] = [];
  const hatFinale = Object.values(k.spiele).some((s) => s.baum === 'finale');

  if (hatFinale) {
    // Doppel-K.-o.: Endspiel (ggf. zweites) entscheidet 1/2, Verliererbaum den Rest
    const f1 = k.spiele[koSpielId(1, 0, 'finale')];
    const f2 = k.spiele[koSpielId(2, 0, 'finale')];
    const ende = f2 && f2.status === 'gespielt' ? f2 : f1 && f1.status === 'gespielt' && (!f2 || f2.status === 'entfallen') ? f1 : undefined;
    const s1 = siegerVerlierer(ende, 'sieger');
    const s2 = siegerVerlierer(ende, 'verlierer');
    if (s1) aus.push({ platz: 1, bezeichnung: '1', id: s1 });
    if (s2) aus.push({ platz: 2, bezeichnung: '2', id: s2 });
    let platz = 3;
    for (let m = rundenZahl(k, 'verlierer'); m >= 1; m--) {
      const liste = rundeSpiele(k, 'verlierer', m);
      const n = liste.length;
      const bez = n === 1 ? `${platz}` : `${platz}–${platz + n - 1}`;
      for (const s of liste) {
        const v = siegerVerlierer(s, 'verlierer');
        if (v) aus.push({ platz, bezeichnung: bez, id: v });
      }
      platz += n;
    }
    return aus;
  }

  const finale = k.spiele[koSpielId(R, 0)];
  const fs = siegerVerlierer(finale, 'sieger');
  if (fs) aus.push({ platz: 1, bezeichnung: '1', id: fs });
  const fv = siegerVerlierer(finale, 'verlierer');
  if (fv) aus.push({ platz: 2, bezeichnung: '2', id: fv });
  const p3 = k.spiele[PLATZ3_ID];
  if (p3) {
    const a = siegerVerlierer(p3, 'sieger');
    const b = siegerVerlierer(p3, 'verlierer');
    if (a) aus.push({ platz: 3, bezeichnung: '3', id: a });
    if (b) aus.push({ platz: 4, bezeichnung: '4', id: b });
  }
  const trost = rundenZahl(k, 'trost') > 0;
  for (let r = R - 1; r >= 1; r--) {
    if (r === R - 1 && p3) continue;
    if (r === 1 && trost) continue; // Verlierer der 1. Runde werden in der Trostrunde platziert
    const von = P / 2 ** r + 1;
    const bis = P / 2 ** (r - 1);
    for (let i = 0; i < P / 2 ** r; i++) {
      const v = siegerVerlierer(k.spiele[koSpielId(r, i)], 'verlierer');
      if (v) aus.push({ platz: von, bezeichnung: `${von}–${bis}`, id: v });
    }
  }
  return aus;
}

/** Platzierungen der Trostrunde (eigene Zählung: Trostrunden-Sieger = 1) */
export function trostPlatzierungen(k: KonkurrenzZustand): Platzierung[] {
  const RT = rundenZahl(k, 'trost');
  if (!RT) return [];
  const aus: Platzierung[] = [];
  const finale = rundeSpiele(k, 'trost', RT)[0];
  const s1 = siegerVerlierer(finale, 'sieger');
  const s2 = siegerVerlierer(finale, 'verlierer');
  if (s1) aus.push({ platz: 1, bezeichnung: '1', id: s1 });
  if (s2) aus.push({ platz: 2, bezeichnung: '2', id: s2 });
  let platz = 3;
  for (let r = RT - 1; r >= 1; r--) {
    const liste = rundeSpiele(k, 'trost', r);
    const n = liste.length;
    const bez = `${platz}–${platz + n - 1}`;
    for (const s of liste) {
      const v = siegerVerlierer(s, 'verlierer');
      if (v) aus.push({ platz, bezeichnung: bez, id: v });
    }
    platz += n;
  }
  return aus;
}

/** Name der Runde für die Anzeige */
export function rundenName(runde: number, R: number, baum: Baum = 'haupt'): string {
  if (baum === 'finale') return runde === 1 ? 'Endspiel' : 'Zweites Endspiel';
  if (baum === 'verlierer') return `Verliererrunde ${runde}`;
  const rest = R - runde;
  const vor = baum === 'trost' ? 'Trostrunde: ' : '';
  if (rest === 0) return vor + 'Endspiel';
  if (rest === 1) return vor + 'Halbfinale';
  if (rest === 2) return vor + 'Viertelfinale';
  if (rest === 3) return vor + 'Achtelfinale';
  return `${vor}Runde ${runde} (${2 ** (rest + 1)} Teilnehmer)`;
}

/** Anzahl Runden eines Baums (Verliererbaum: 2·(R−1), Trostrunde: R−1) */
export function baumRunden(k: KonkurrenzZustand, baum: Baum): number {
  return rundenZahl(k, baum);
}
