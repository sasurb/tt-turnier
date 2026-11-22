/**
 * Gemeinsame Wertungsskala (ab 0.15): Vereinsspieler nutzen ihren Q-TTR-Wert, Hobbyspieler ohne TTR
 * bekommen über eine Einstufung mit 4 Fragen einen geschätzten Startwert. Beide Werte stehen im Feld
 * `ttr`; `ttrGeschaetzt` unterscheidet sie. Klassen haben nur eine Obergrenze (DTTB-Praxis):
 * Wer darunter liegt, darf auch in höheren Klassen starten.
 */

export interface Stufe {
  id: string;
  name: string;
  /** Obergrenze (einschließlich); null = offen */
  bis: number | null;
  hobby: boolean;
  /** Hobby-Stufen: Startwert aus der Einstufung und Punktebereich der 4 Fragen */
  start?: number;
  punkte?: [number, number];
}

export const STUFEN: readonly Stufe[] = [
  { id: 'H1', name: 'H1 Einsteiger', bis: 950, hobby: true, start: 900, punkte: [0, 2] },
  { id: 'H2', name: 'H2 Geübt', bis: 1100, hobby: true, start: 1025, punkte: [3, 5] },
  { id: 'H3', name: 'H3 Ambitioniert', bis: 1250, hobby: true, start: 1175, punkte: [6, 9] },
  { id: 'H4', name: 'H4 Hobby-Profi', bis: 1450, hobby: true, start: 1350, punkte: [10, 12] },
  { id: 'E', name: 'E-Klasse', bis: 1250, hobby: false },
  { id: 'D', name: 'D-Klasse', bis: 1450, hobby: false },
  { id: 'C', name: 'C-Klasse', bis: 1650, hobby: false },
  { id: 'B', name: 'B-Klasse', bis: 1850, hobby: false },
  { id: 'A', name: 'A-Klasse', bis: null, hobby: false },
];
const stufe = (id: string) => STUFEN.find((s) => s.id === id)!;

/** Wertebereich der geschätzten Werte (Hobbyspieler) */
export const WERTUNG_MIN = 800;
export const WERTUNG_MAX = 3000;

/* ---------- Einstufung mit 4 Fragen (je 0–3 Punkte) ---------- */

export const EINSTUFUNG_FRAGEN = 4;
export const EINSTUFUNG_MAX = 12;

/** Hobby-Stufe zur Punktsumme der Einstufung (0–12) */
export function stufeAusPunkten(summe: number): Stufe {
  const s = Math.max(0, Math.min(EINSTUFUNG_MAX, Math.round(summe)));
  return STUFEN.find((x) => x.hobby && s >= x.punkte![0] && s <= x.punkte![1])!;
}

/** Startwert zur Einstufung; `antworten` je Frage 0–3 */
export function einstufen(antworten: readonly number[]): { stufe: Stufe; wert: number } {
  const summe = antworten.reduce((a, b) => a + Math.max(0, Math.min(3, Math.round(b))), 0);
  const st = stufeAusPunkten(summe);
  return { stufe: st, wert: st.start! };
}

/** Hobby-Stufe eines (geschätzten) Werts: die niedrigste, deren Obergrenze er nicht übersteigt; null = über H4 */
export function hobbyStufe(wert: number): Stufe | null {
  return STUFEN.find((s) => s.hobby && wert <= s.bis!) ?? null;
}
/** Vereins-Klasse eines Werts (E–A) */
export function vereinsKlasse(wert: number): Stufe {
  return STUFEN.find((s) => !s.hobby && (s.bis === null || wert <= s.bis))!;
}

/* ---------- Vorlagen für TTR-Bereiche (Leistungsklassen) ---------- */

export type KlassenVorlage = 'dttb' | 'hobby' | 'gemischt';
export const KLASSEN_VORLAGEN: readonly KlassenVorlage[] = ['gemischt', 'dttb', 'hobby'];
/** Abzug für Damen-Konkurrenzen auf die Obergrenzen der Klassen A–D */
export const DAMEN_ABZUEGE = [0, 150, 200] as const;

interface Bereich {
  name: string;
  bis: number | null;
  /** Obergrenze einer Vereinsklasse D, C oder B (für den Damen-Abzug) */
  verein: boolean;
}

function bereiche(v: KlassenVorlage): Bereich[] {
  const b = (id: string, name = stufe(id).name, verein = !stufe(id).hobby): Bereich => ({ name, bis: stufe(id).bis, verein });
  if (v === 'dttb') return ['E', 'D', 'C', 'B', 'A'].map((id) => b(id, undefined, id !== 'E'));
  if (v === 'hobby') return [...['H1', 'H2', 'H3', 'H4'].map((id) => b(id)), { name: 'Vereinsniveau', bis: null, verein: false }];
  return [b('H1'), b('H2'), b('H3', 'H3 / E-Klasse', false), b('H4', 'H4 / D-Klasse', true), b('C'), b('B'), b('A')];
}

/**
 * TTR-Grenzen und Namen der Bereiche einer Vorlage. Grenzen wie in `ttrGrenzen` (Beginn des nächsten
 * Bereichs, also Obergrenze + 1). Der Damen-Abzug senkt die Obergrenzen der Klassen D, C und B;
 * fällt dabei eine Klasse mit der darunterliegenden zusammen, entfällt sie.
 */
export function vorlageGrenzen(v: KlassenVorlage, damenAbzug = 0): { grenzen: number[]; namen: string[] } {
  const liste = bereiche(v).map((x) => ({ ...x, bis: x.bis !== null && x.verein ? x.bis - damenAbzug : x.bis }));
  const grenzen: number[] = [];
  const namen: string[] = [];
  let letzte = -Infinity;
  for (const x of liste) {
    if (x.bis !== null && x.bis <= letzte) continue;
    namen.push(x.name);
    if (x.bis !== null) {
      grenzen.push(x.bis + 1);
      letzte = x.bis;
    }
  }
  return { grenzen, namen };
}

/** Passen Grenzen genau zu einer Vorlage (mit einem der Damen-Abzüge)? Dann deren Namen, sonst null. */
export function vorlageErkennen(grenzen: readonly number[]): { vorlage: KlassenVorlage; damenAbzug: number; namen: string[] } | null {
  const g = [...grenzen].sort((a, b) => a - b).join(',');
  for (const v of KLASSEN_VORLAGEN)
    for (const abzug of DAMEN_ABZUEGE) {
      const x = vorlageGrenzen(v, abzug);
      if (x.grenzen.join(',') === g) return { vorlage: v, damenAbzug: abzug, namen: x.namen };
    }
  return null;
}
