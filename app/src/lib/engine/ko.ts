import { kampflosErgebnis } from './wertung';
import type { KonkurrenzZustand, Seite, Spiel } from './modell';

/**
 * K.-o.-Baum: Spiele anlegen, Sieger weitergeben, Platzierungen.
 * Spiel-IDs: „ko-<Runde>-<Nr>“ (Runde 1 = erste Runde, Nr. ab 0), Spiel um Platz 3: „ko-p3“.
 */

export function koSpielId(runde: number, index: number): string {
  return `ko-${runde}-${index}`;
}
export const PLATZ3_ID = 'ko-p3';

function leeresSpiel(konkurrenz: string, id: string, runde: number, index: number): Spiel {
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
  };
}

export function koRunden(plaetze: number): number {
  return Math.round(Math.log2(plaetze));
}

/** Legt alle Spiele des Baums an (ohne Ergebnisse) und gibt die IDs in Spielfolge zurück. */
export function koAnlegen(k: KonkurrenzZustand, platz3: boolean): string[] {
  const P = k.auslosungKo!.plaetze.length;
  const R = koRunden(P);
  const ids: string[] = [];
  for (let r = 1; r <= R; r++) {
    const anzahl = P / 2 ** r;
    for (let i = 0; i < anzahl; i++) {
      const s = leeresSpiel(k.id, koSpielId(r, i), r, i);
      if (r < R) s.weiter = { spiel: koSpielId(r + 1, Math.floor(i / 2)), seite: i % 2 === 0 ? 'a' : 'b' };
      if (platz3 && R >= 2 && r === R - 1) s.verliererWeiter = { spiel: PLATZ3_ID, seite: i % 2 === 0 ? 'a' : 'b' };
      k.spiele[s.id] = s;
      ids.push(s.id);
    }
    if (platz3 && R >= 2 && r === R) {
      const p3 = leeresSpiel(k.id, PLATZ3_ID, R, 1);
      p3.platz3 = true;
      k.spiele[p3.id] = p3;
      ids.splice(ids.length - 1, 0, p3.id); // vor dem Endspiel
    }
  }
  return ids;
}

/** Wer (Teilnehmer-ID) bzw. „frei“ kommt aus einem Spiel als Sieger bzw. Verlierer heraus? undefined = noch offen */
function ausgang(s: Spiel, wer: 'sieger' | 'verlierer'): { id: string | null; frei: boolean; gesperrt: boolean } | undefined {
  if (s.stand === 'angefochten' || s.stand === 'konflikt') return { id: null, frei: false, gesperrt: true };
  if (s.status === 'freilos') {
    // nur ein Teilnehmer: Sieger ist er, „Verlierer“ ist ein Freilos
    const id = s.a ?? s.b;
    return wer === 'sieger' ? { id, frei: id === null, gesperrt: false } : { id: null, frei: true, gesperrt: false };
  }
  if (s.status !== 'gespielt' || !s.gewinner) return s.gesperrt ? { id: null, frei: false, gesperrt: true } : undefined;
  const sieger = s.gewinner === 'a' ? s.a : s.b;
  const verlierer = s.gewinner === 'a' ? s.b : s.a;
  return { id: wer === 'sieger' ? sieger : verlierer, frei: false, gesperrt: false };
}

/**
 * Baum neu durchrechnen: Teilnehmer aus Vorgängern übernehmen, Freilose und Rückzüge auflösen.
 * Ändert sich die Besetzung eines Spiels, das schon ein Ergebnis hat, wird es verworfen
 * (kommt nur vor, wenn die Leitung frühere Ergebnisse ändert; die Engine verhindert das sonst).
 */
export function koAktualisieren(k: KonkurrenzZustand, zurueck: Set<string>): void {
  const plaetze = k.auslosungKo?.plaetze;
  if (!plaetze) return;
  const P = plaetze.length;
  const R = koRunden(P);
  const rundeSpiele = (r: number) => Array.from({ length: P / 2 ** r }, (_, i) => k.spiele[koSpielId(r, i)]!);

  const setze = (s: Spiel, seite: Seite, w: { id: string | null; frei: boolean; gesperrt: boolean } | undefined) => {
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
    if (s.a && s.b) {
      // Rückzug: ohne eingetragenes Ergebnis kampflos für den anderen
      if (!s.eintrag) {
        const za = zurueck.has(s.a);
        const zb = zurueck.has(s.b);
        if (za || zb) {
          const verlierer: Seite = za ? 'a' : 'b';
          s.kampflosDurchRueckzug = verlierer;
          s.ergebnis = kampflosErgebnis(verlierer, k.einst);
          s.gewinner = za && zb ? null : verlierer === 'a' ? 'b' : 'a';
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
      // ein Freilos (oder zwei)
      s.status = 'freilos';
      s.gewinner = s.a ? 'a' : s.b ? 'b' : null;
      s.ergebnis = null;
      return;
    }
    s.status = 'wartet';
    s.gewinner = null;
    s.ergebnis = null;
  };

  const besetzungPruefen = (s: Spiel, alt: { a: string | null; b: string | null }) => {
    if (s.eintrag && (s.a !== alt.a || s.b !== alt.b)) {
      s.eintrag = null;
      s.alternativen = [];
      s.stand = null;
      s.angefochtenVon = null;
    }
  };

  for (let r = 1; r <= R; r++) {
    const liste = rundeSpiele(r);
    liste.forEach((s, i) => {
      const alt = { a: s.a, b: s.b };
      s.gesperrt = false;
      if (r === 1) {
        const pa = plaetze[2 * i] ?? null;
        const pb = plaetze[2 * i + 1] ?? null;
        setze(s, 'a', { id: pa, frei: pa === null, gesperrt: false });
        setze(s, 'b', { id: pb, frei: pb === null, gesperrt: false });
      } else {
        const vor = rundeSpiele(r - 1);
        setze(s, 'a', ausgang(vor[2 * i]!, 'sieger'));
        setze(s, 'b', ausgang(vor[2 * i + 1]!, 'sieger'));
      }
      besetzungPruefen(s, alt);
      bewerten(s);
    });
    if (r === R && k.spiele[PLATZ3_ID]) {
      const p3 = k.spiele[PLATZ3_ID]!;
      const alt = { a: p3.a, b: p3.b };
      p3.gesperrt = false;
      const halb = rundeSpiele(R - 1);
      setze(p3, 'a', ausgang(halb[0]!, 'verlierer'));
      setze(p3, 'b', ausgang(halb[1]!, 'verlierer'));
      besetzungPruefen(p3, alt);
      bewerten(p3);
    }
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

/** Platzierungen aus dem K.-o.-Baum, soweit entschieden */
export function koPlatzierungen(k: KonkurrenzZustand): Platzierung[] {
  const plaetze = k.auslosungKo?.plaetze;
  if (!plaetze || !k.gestartet.ko) return [];
  const P = plaetze.length;
  const R = koRunden(P);
  const aus: Platzierung[] = [];
  const finale = k.spiele[koSpielId(R, 0)];
  const sv = (s: Spiel | undefined, wer: 'sieger' | 'verlierer') => {
    if (!s || !s.gewinner || (s.status !== 'gespielt' && s.status !== 'freilos')) return null;
    const g = s.gewinner === 'a' ? s.a : s.b;
    const v = s.gewinner === 'a' ? s.b : s.a;
    return wer === 'sieger' ? g : v;
  };
  const fs = sv(finale, 'sieger');
  if (fs) aus.push({ platz: 1, bezeichnung: '1', id: fs });
  const fv = sv(finale, 'verlierer');
  if (fv) aus.push({ platz: 2, bezeichnung: '2', id: fv });
  const p3 = k.spiele[PLATZ3_ID];
  if (p3) {
    const a = sv(p3, 'sieger');
    const b = sv(p3, 'verlierer');
    if (a) aus.push({ platz: 3, bezeichnung: '3', id: a });
    if (b) aus.push({ platz: 4, bezeichnung: '4', id: b });
  }
  for (let r = R - 1; r >= 1; r--) {
    if (r === R - 1 && p3) continue;
    const von = P / 2 ** r + 1;
    const bis = P / 2 ** (r - 1);
    for (let i = 0; i < P / 2 ** r; i++) {
      const v = sv(k.spiele[koSpielId(r, i)], 'verlierer');
      if (v) aus.push({ platz: von, bezeichnung: `${von}–${bis}`, id: v });
    }
  }
  return aus;
}

/** Name der Runde für die Anzeige */
export function rundenName(runde: number, R: number): string {
  const rest = R - runde;
  if (rest === 0) return 'Endspiel';
  if (rest === 1) return 'Halbfinale';
  if (rest === 2) return 'Viertelfinale';
  if (rest === 3) return 'Achtelfinale';
  return `Runde ${runde} (${2 ** (rest + 1)} Spieler)`;
}
