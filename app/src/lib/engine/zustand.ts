import { ART, type Autor } from '@shared/protokoll';
import type { LokalesEreignis } from './typen';
import { eingabeTauschen, ergebnisGleich, ergebnisWerten } from './ergebnis';
import { abhaengigeMitErgebnis, koAktualisieren, koAnlegen } from './ko';
import { rundenplan } from './rundenplan';
import { kampflosErgebnis } from './wertung';
import {
  ALLE_ANGABEN,
  ALLES_OEFFENTLICH,
  FEST_NACH_START,
  STANDARD_ANGABEN,
  mitKo,
  standardEinstellungen,
  type Angabe,
  type Veroeffentlichung,
  type ErgebnisEingabe,
  type ErgebnisEintrag,
  type KonkurrenzEinstellungen,
  type KonkurrenzZustand,
  type Schiedsrichter,
  type Seite,
  type Spiel,
  type SpielerDaten,
  type TurnierSpieler,
  type Warnung,
} from './modell';

/**
 * Aktueller Stand eines Turniers, berechnet aus den Ereignissen in ihrer Reihenfolge.
 * Ungültige oder unberechtigte Einträge werden nicht verworfen, sondern übersprungen und
 * als Warnung festgehalten (für die Leitung sichtbar). Alle Geräte rechnen gleich.
 */
export interface TurnierZustand {
  name: string;
  datum: string | null;
  ort: string;
  tische: number | null;
  /** Tische, die gerade nicht bespielt werden (defekt, Siegerehrung …) */
  tischeGesperrt: number[];
  /** Angaben neben Name und Verein, die im Turnier geführt werden */
  angaben: Angabe[];
  /** Welche Stände alle sehen dürfen (Konkurrenzen können abweichen) */
  veroeffentlichung: Veroeffentlichung;
  abgeschlossen: boolean;
  notizen: {
    id: string;
    text: string;
    von: string;
    zeit: string;
    bestaetigt: boolean;
  }[];
  anzahlEreignisse: number;
  spieler: Record<string, TurnierSpieler>;
  /** Spieler-IDs in Reihenfolge der Anlage */
  spielerReihe: string[];
  konkurrenzen: Record<string, KonkurrenzZustand>;
  konkurrenzReihe: string[];
  warnungen: Warnung[];
}

export function leererZustand(): TurnierZustand {
  return {
    name: '',
    datum: null,
    ort: '',
    tische: null,
    tischeGesperrt: [],
    angaben: [...STANDARD_ANGABEN],
    veroeffentlichung: { ...ALLES_OEFFENTLICH },
    abgeschlossen: false,
    notizen: [],
    anzahlEreignisse: 0,
    spieler: leer(),
    spielerReihe: [],
    konkurrenzen: leer(),
    konkurrenzReihe: [],
    warnungen: [],
  };
}

/* ---------------- Hilfen ---------------- */

function istLeitung(a: Autor | null): boolean {
  return !a || a.rolle === 'leitung' || a.rolle === 'admin' || a.rolle === 'veranstalter';
}

function veroeffentlichungLesen(v: unknown): Veroeffentlichung | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return undefined;
  const x = v as Record<string, unknown>;
  if (typeof x.tabellen !== 'boolean' || typeof x.ko !== 'boolean') return undefined;
  return { tabellen: x.tabellen, ko: x.ko };
}

/** Map ohne Prototyp: Schlüssel aus Ereignisdaten wie „__proto__“ oder „constructor“ finden nichts */
function leer<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function text(v: unknown, max = 80): string | undefined {
  return typeof v === 'string' ? v.trim().slice(0, max) : undefined;
}

function zahl(v: unknown, min: number, max: number): number | null | undefined {
  if (v === null) return null;
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

function spielerDatenLesen(d: Record<string, unknown>): Partial<SpielerDaten> {
  const r: Partial<SpielerDaten> = {};
  const vn = text(d.vorname);
  const nn = text(d.nachname);
  const ve = text(d.verein, 120);
  if (vn !== undefined) r.vorname = vn;
  if (nn !== undefined) r.nachname = nn;
  if (ve !== undefined) r.verein = ve;
  const ttr = zahl(d.ttr, 0, 4000);
  if (ttr !== undefined) r.ttr = ttr;
  const jg = zahl(d.jahrgang, 1900, 2100);
  if (jg !== undefined) r.jahrgang = jg;
  if (d.klasse === null) r.klasse = null;
  else if (typeof d.klasse === 'string') r.klasse = d.klasse.trim().slice(0, 40) || null;
  if (d.geschlecht === null || d.geschlecht === 'm' || d.geschlecht === 'w' || d.geschlecht === 'd') r.geschlecht = d.geschlecht;
  if (d.pool === null || typeof d.pool === 'string') r.pool = d.pool === null ? null : String(d.pool).slice(0, 64);
  return r;
}

function einstellungenLesen(d: unknown, basis: KonkurrenzEinstellungen): KonkurrenzEinstellungen {
  const e = { ...basis, zulassung: { ...basis.zulassung } };
  if (!d || typeof d !== 'object') return e;
  const x = d as Record<string, unknown>;
  const n = text(x.name, 80);
  if (n) e.name = n;
  if (x.modus === 'jgj' || x.modus === 'gruppen_ko' || x.modus === 'ko' || x.modus === 'doppel_ko') e.modus = x.modus;
  if (x.art === 'einzel' || x.art === 'doppel' || x.art === 'mixed') e.art = x.art;
  if (typeof x.trostrunde === 'boolean') e.trostrunde = x.trostrunde;
  if (typeof x.finaleWiederholung === 'boolean') e.finaleWiederholung = x.finaleWiederholung;
  if (x.bestOf === 3 || x.bestOf === 5 || x.bestOf === 7) e.bestOf = x.bestOf;
  if (x.eingabe === 'punkte' || x.eingabe === 'saetze') e.eingabe = x.eingabe;
  if (x.wertung === 'dttb' || x.wertung === 'ittf') e.wertung = x.wertung;
  if (x.rueckzug === 'wo' || x.rueckzug === 'hobby') e.rueckzug = x.rueckzug;
  if (x.setzung === 'ttr' || x.setzung === 'manuell' || x.setzung === 'keine') e.setzung = x.setzung;
  if (x.gesetzte === null) e.gesetzte = null;
  else if (zahl(x.gesetzte, 0, 256) !== undefined) e.gesetzte = x.gesetzte as number;
  if (typeof x.vereinstrennung === 'boolean') e.vereinstrennung = x.vereinstrennung;
  if (zahl(x.gruppenGroesse, 3, 16)) e.gruppenGroesse = x.gruppenGroesse as number;
  if (zahl(x.aufsteiger, 1, 4)) e.aufsteiger = x.aufsteiger as number;
  if (typeof x.platz3 === 'boolean') e.platz3 = x.platz3;
  if (x.klassenTrennung === 'keine' || x.klassenTrennung === 'klasse' || x.klassenTrennung === 'ttr') e.klassenTrennung = x.klassenTrennung;
  if (Array.isArray(x.ttrGrenzen)) {
    e.ttrGrenzen = [...new Set(x.ttrGrenzen.filter((g): g is number => typeof g === 'number' && Number.isInteger(g) && g > 0 && g <= 4000))]
      .sort((a, b) => a - b)
      .slice(0, 10);
  }
  const vo = veroeffentlichungLesen(x.veroeffentlichung);
  if (vo !== undefined) e.veroeffentlichung = vo;
  const z = x.zulassung as Record<string, unknown> | undefined;
  if (z && typeof z === 'object') {
    for (const f of ['ttrMin', 'ttrMax'] as const) {
      const v = zahl(z[f], 0, 4000);
      if (v !== undefined) e.zulassung[f] = v;
    }
    for (const f of ['jahrgangVon', 'jahrgangBis'] as const) {
      const v = zahl(z[f], 1900, 2100);
      if (v !== undefined) e.zulassung[f] = v;
    }
    if (Array.isArray(z.klassen))
      e.zulassung.klassen = z.klassen
        .filter((k): k is string => typeof k === 'string')
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 20);
    if (Array.isArray(z.geschlecht)) e.zulassung.geschlecht = z.geschlecht.filter((g): g is 'm' | 'w' | 'd' => g === 'm' || g === 'w' || g === 'd');
  }
  return e;
}

function neueKonkurrenz(id: string, einst: KonkurrenzEinstellungen): KonkurrenzZustand {
  return {
    id,
    einst,
    meldungen: [],
    paare: leer(),
    setzliste: null,
    auslosungGruppen: null,
    auslosungKo: null,
    gestartet: { gruppen: false, ko: false },
    status: 'meldung',
    gruppen: [],
    spiele: leer(),
    reihenfolge: [],
    rueckzuege: [],
  };
}

/** Hat die Konkurrenz begonnen (erste Phase gestartet)? */
export function begonnen(k: KonkurrenzZustand): boolean {
  return k.gestartet.gruppen || k.gestartet.ko;
}

/** Erste Phase der Konkurrenz */
export function erstePhase(k: KonkurrenzZustand): 'gruppen' | 'ko' {
  return k.einst.modus === 'ko' || k.einst.modus === 'doppel_ko' ? 'ko' : 'gruppen';
}

/** Spieler-IDs eines Teilnehmers (Einzel: er selbst; Doppel: beide) */
export function spielerVon(k: KonkurrenzZustand, teilnehmer: string | null): string[] {
  if (!teilnehmer) return [];
  const p = k.paare[teilnehmer];
  return p ? [...p.spieler] : [teilnehmer];
}

/** Auf welcher Seite eines Spiels steht dieser Spieler (auch als Teil eines Paares)? */
export function seiteVon(k: KonkurrenzZustand, s: Spiel, spieler: string | null | undefined): Seite | null {
  if (!spieler) return null;
  if (spielerVon(k, s.a).includes(spieler)) return 'a';
  if (spielerVon(k, s.b).includes(spieler)) return 'b';
  return null;
}

/** Teilnehmer-ID, mit der ein Spieler in dieser Konkurrenz gemeldet ist (null = nicht gemeldet) */
export function teilnehmerVon(k: KonkurrenzZustand, spieler: string): string | null {
  if (k.meldungen.includes(spieler)) return spieler;
  return Object.values(k.paare).find((p) => p.spieler.includes(spieler) && k.meldungen.includes(p.id))?.id ?? null;
}

/** Teilnehmer, die zurückgezogen haben (ausdrücklich oder – WO D 7.9 – durch kampflos/Aufgabe in der Gruppe), in Reihenfolge */
export function zurueckgezogen(k: KonkurrenzZustand): string[] {
  const liste = [...k.rueckzuege].sort((a, b) => a.nr - b.nr).map((r) => ({ id: r.teilnehmer, zeit: r.zeit }));
  if (k.einst.rueckzug === 'wo') {
    for (const id of k.reihenfolge) {
      const s = k.spiele[id]!;
      if (s.phase !== 'gruppen' || !s.eintrag) continue;
      const e = s.eintrag.ergebnis;
      if (e.art === 'normal') continue;
      const verlierer = e.gewinner === 'a' ? s.b : s.a;
      if (verlierer) liste.push({ id: verlierer, zeit: s.eintrag.zeit });
    }
  }
  const gesehen = new Set<string>();
  return liste
    .sort((a, b) => (a.zeit < b.zeit ? -1 : a.zeit > b.zeit ? 1 : 0))
    .filter((x) => (gesehen.has(x.id) ? false : (gesehen.add(x.id), true)))
    .map((x) => x.id);
}

function gruppenAktualisieren(k: KonkurrenzZustand, zurueck: Set<string>) {
  for (const id of k.reihenfolge) {
    const s = k.spiele[id]!;
    if (s.phase !== 'gruppen') continue;
    const za = !!s.a && zurueck.has(s.a);
    const zb = !!s.b && zurueck.has(s.b);
    s.kampflosDurchRueckzug = null;
    s.gestrichen = false;
    if (k.einst.rueckzug === 'wo' && (za || zb)) {
      s.gestrichen = true;
      s.status = s.eintrag ? 'gespielt' : 'entfallen';
      s.ergebnis = s.eintrag?.ergebnis ?? null;
    } else if (k.einst.rueckzug === 'hobby' && !s.eintrag && (za || zb)) {
      if (za && zb) {
        s.status = 'entfallen';
        s.ergebnis = null;
      } else {
        const v: Seite = za ? 'a' : 'b';
        s.kampflosDurchRueckzug = v;
        s.ergebnis = kampflosErgebnis(v, k.einst);
        s.status = 'gespielt';
      }
    } else {
      s.status = s.eintrag ? 'gespielt' : 'offen';
      s.ergebnis = s.eintrag?.ergebnis ?? null;
    }
    s.gewinner = s.ergebnis?.gewinner ?? null;
  }
}

function statusAktualisieren(k: KonkurrenzZustand) {
  const zurueck = new Set(zurueckgezogen(k));
  if (k.gestartet.gruppen) gruppenAktualisieren(k, zurueck);
  if (k.gestartet.ko) koAktualisieren(k, zurueck);
  if (!begonnen(k)) k.status = 'meldung';
  else if (k.gestartet.ko) {
    const offen = Object.values(k.spiele).some(
      (s) => s.phase === 'ko' && (s.status === 'offen' || s.status === 'wartet' || s.stand === 'angefochten' || s.stand === 'konflikt'),
    );
    k.status = offen ? 'ko' : 'beendet';
  } else {
    const offen = Object.values(k.spiele).some((s) => s.status === 'offen' || s.stand === 'angefochten' || s.stand === 'konflikt');
    k.status = !offen && k.einst.modus === 'jgj' ? 'beendet' : 'gruppen';
  }
}

function gleicheMenge(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Passt die gespeicherte Auslosung der ersten Phase noch zu den Meldungen? */
export function auslosungAktuell(k: KonkurrenzZustand): boolean {
  if (erstePhase(k) === 'gruppen') return !!k.auslosungGruppen && gleicheMenge(k.auslosungGruppen.gruppen.flat(), k.meldungen);
  return (
    !!k.auslosungKo &&
    gleicheMenge(
      k.auslosungKo.plaetze.filter((x): x is string => !!x),
      k.meldungen,
    )
  );
}

function gruppenAnlegen(k: KonkurrenzZustand) {
  const gruppen = k.auslosungGruppen!.gruppen;
  k.gruppen = gruppen.map((m, nr) => ({ nr, mitglieder: [...m], los: leer() }));
  const plaene = gruppen.map((m) => rundenplan(m.length));
  const maxRunden = Math.max(0, ...plaene.map((p) => p.length));
  let index = 0;
  for (let r = 0; r < maxRunden; r++) {
    gruppen.forEach((m, nr) => {
      for (const [x, y] of plaene[nr]![r] ?? []) {
        const a = m[x]!;
        const b = m[y]!;
        const id = `g${nr}-${a}-${b}`;
        k.spiele[id] = {
          id,
          konkurrenz: k.id,
          phase: 'gruppen',
          gruppe: nr,
          runde: r + 1,
          index: index++,
          a,
          b,
          aFrei: false,
          bFrei: false,
          status: 'offen',
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
          baum: 'haupt',
          quelleA: null,
          quelleB: null,
          nurWennBGewinnt: false,
          tisch: null,
          aufgerufen: null,
          schiri: null,
        };
        k.reihenfolge.push(id);
      }
    });
  }
}

/* ---------------- Ergebnisse ---------------- */

type Pruefung = string | null;

function ergebnisAnwenden(k: KonkurrenzZustand, s: Spiel, neu: ErgebnisEintrag): Pruefung {
  if (neu.amtlich) {
    s.eintrag = neu;
    s.stand = 'bestaetigt';
    s.alternativen = [];
    s.angefochtenVon = null;
    return null;
  }
  const alt = s.eintrag;
  if (!alt) {
    s.eintrag = neu;
    s.stand = 'eingetragen';
    return null;
  }
  if (alt.amtlich && s.stand === 'bestaetigt') return 'Das Ergebnis hat die Turnierleitung eingetragen – ändern kann es nur die Leitung.';
  switch (s.stand) {
    case 'eingetragen':
      if (alt.seite === neu.seite) {
        s.eintrag = neu; // eigene Korrektur
      } else if (ergebnisGleich(alt.ergebnis, neu.ergebnis)) {
        s.stand = 'bestaetigt';
      } else {
        s.stand = 'konflikt';
        s.alternativen = [alt, neu];
      }
      return null;
    case 'bestaetigt':
      if (!ergebnisGleich(alt.ergebnis, neu.ergebnis)) {
        s.stand = 'konflikt';
        s.alternativen = [alt, neu];
      }
      return null;
    case 'angefochten':
      if (neu.seite === alt.seite) {
        s.eintrag = neu;
        s.stand = 'eingetragen';
        s.angefochtenVon = null;
      } else {
        s.stand = 'konflikt';
        s.alternativen = [alt, neu];
      }
      return null;
    case 'konflikt': {
      s.alternativen = [...s.alternativen.filter((x) => x.seite !== neu.seite), neu];
      const erste = s.alternativen[0]!;
      if (s.alternativen.every((x) => ergebnisGleich(x.ergebnis, erste.ergebnis))) {
        s.eintrag = erste;
        s.stand = 'bestaetigt';
        s.alternativen = [];
        s.angefochtenVon = null;
      }
      return null;
    }
    default:
      void k;
      return null;
  }
}

/** Würde sich der Sieger ändern, obwohl ein Folgespiel schon ein Ergebnis hat? */
function folgeBlockiert(k: KonkurrenzZustand, s: Spiel, neuerSieger: Seite | null): Pruefung {
  if (s.phase !== 'ko') return null;
  if (s.gewinner === neuerSieger) return null;
  if (abhaengigeMitErgebnis(k, s).length > 0) return 'Das Folgespiel hat schon ein Ergebnis. Bitte zuerst dort das Ergebnis zurücksetzen.';
  return null;
}

/* ---------------- Ereignisse anwenden ---------------- */

export function anwenden(z: TurnierZustand, e: LokalesEreignis): TurnierZustand {
  z.anzahlEreignisse++;
  const d = (e.daten ?? {}) as Record<string, unknown>;
  const warnen = (t: string) =>
    z.warnungen.push({
      ereignis: e.id,
      text: t,
      zeit: e.zeit,
      von: e.autor?.name ?? '',
    });
  const leitung = istLeitung(e.autor);
  const nurLeitung = (): boolean => {
    if (leitung) return true;
    warnen(`Nur die Turnierleitung darf das (${e.art}).`);
    return false;
  };
  const konkurrenz = (): KonkurrenzZustand | null => {
    const k = typeof d.konkurrenz === 'string' ? z.konkurrenzen[d.konkurrenz] : undefined;
    if (!k) warnen('Konkurrenz nicht gefunden.');
    return k ?? null;
  };

  switch (e.art) {
    case ART.turnierAngelegt:
    case ART.turnierUmbenannt: {
      if (typeof d.name === 'string') z.name = d.name;
      if (typeof d.datum === 'string' || d.datum === null) z.datum = d.datum as string | null;
      break;
    }
    case ART.turnierAbgeschlossen:
      z.abgeschlossen = true;
      break;
    case ART.turnierWiedereroeffnet:
      z.abgeschlossen = false;
      break;
    case ART.testNotiz: {
      if (typeof d.text === 'string') {
        z.notizen.push({
          id: e.id,
          text: d.text,
          von: e.autor?.name ?? '',
          zeit: e.zeit,
          bestaetigt: e.status !== 'ausstehend',
        });
      }
      break;
    }

    case ART.turnierDaten: {
      if (!nurLeitung()) break;
      const ort = text(d.ort, 120);
      if (ort !== undefined) z.ort = ort;
      const t = zahl(d.tische, 1, 200);
      if (t !== undefined) z.tische = t;
      if (Array.isArray(d.angaben)) z.angaben = ALLE_ANGABEN.filter((a) => (d.angaben as unknown[]).includes(a));
      const vo = veroeffentlichungLesen(d.veroeffentlichung);
      if (vo) z.veroeffentlichung = vo;
      // „Ergebnisse veröffentlichen“: Abweichungen der Konkurrenzen zurücknehmen
      if (d.alleKonkurrenzen === true) for (const k of Object.values(z.konkurrenzen)) k.einst.veroeffentlichung = null;
      break;
    }

    case ART.spielerAngelegt: {
      if (!nurLeitung()) break;
      const id = text(d.id, 40);
      const daten = spielerDatenLesen(d);
      if (!id || z.spieler[id] || (!daten.vorname && !daten.nachname)) {
        warnen('Spieler konnte nicht angelegt werden.');
        break;
      }
      z.spieler[id] = { id, vorname: '', nachname: '', verein: '', ...daten };
      z.spielerReihe.push(id);
      break;
    }
    case ART.spielerGeaendert: {
      if (!nurLeitung()) break;
      const sp = typeof d.id === 'string' ? z.spieler[d.id] : undefined;
      if (!sp) {
        warnen('Spieler nicht gefunden.');
        break;
      }
      Object.assign(sp, spielerDatenLesen(d));
      break;
    }
    case ART.spielerEntfernt: {
      if (!nurLeitung()) break;
      const id = typeof d.id === 'string' ? d.id : '';
      if (!z.spieler[id]) break;
      const inBetrieb = Object.values(z.konkurrenzen).find((k) => begonnen(k) && teilnehmerVon(k, id));
      if (inBetrieb) {
        warnen(`Spieler spielt schon in „${inBetrieb.einst.name}“ und kann nicht entfernt werden.`);
        break;
      }
      for (const k of Object.values(z.konkurrenzen)) {
        const paare = Object.values(k.paare).filter((p) => p.spieler.includes(id)).map((p) => p.id);
        for (const pid of paare) delete k.paare[pid];
        k.meldungen = k.meldungen.filter((x) => x !== id && !paare.includes(x));
        if (k.setzliste) k.setzliste = k.setzliste.filter((x) => x !== id && !paare.includes(x));
      }
      delete z.spieler[id];
      z.spielerReihe = z.spielerReihe.filter((x) => x !== id);
      break;
    }

    case ART.konkurrenzAngelegt: {
      if (!nurLeitung()) break;
      const id = text(d.id, 40);
      if (!id || z.konkurrenzen[id]) {
        warnen('Konkurrenz konnte nicht angelegt werden.');
        break;
      }
      const einst = einstellungenLesen(d.einst, standardEinstellungen('Konkurrenz'));
      z.konkurrenzen[id] = neueKonkurrenz(id, einst);
      z.konkurrenzReihe.push(id);
      break;
    }
    case ART.konkurrenzGeaendert: {
      if (!nurLeitung()) break;
      const k = typeof d.id === 'string' ? z.konkurrenzen[d.id] : undefined;
      if (!k) {
        warnen('Konkurrenz nicht gefunden.');
        break;
      }
      const neu = einstellungenLesen(d.einst, k.einst);
      if (begonnen(k)) {
        const fest = FEST_NACH_START.filter((f) => JSON.stringify(neu[f]) !== JSON.stringify(k.einst[f]));
        if (fest.length) warnen('Nach dem Start lassen sich Spielsystem, Sätze, Eingabe und Setzung nicht mehr ändern.');
        for (const f of fest) (neu as unknown as Record<string, unknown>)[f] = k.einst[f];
        if (k.gestartet.ko) {
          neu.platz3 = k.einst.platz3;
          neu.trostrunde = k.einst.trostrunde;
          neu.finaleWiederholung = k.einst.finaleWiederholung;
        }
      }
      if (neu.art !== k.einst.art && (k.meldungen.length || Object.keys(k.paare).length)) {
        warnen('Einzel/Doppel lässt sich nur ohne Meldungen umstellen.');
        neu.art = k.einst.art;
      }
      k.einst = neu;
      statusAktualisieren(k);
      break;
    }
    case ART.konkurrenzEntfernt: {
      if (!nurLeitung()) break;
      const k = typeof d.id === 'string' ? z.konkurrenzen[d.id] : undefined;
      if (!k) break;
      if (Object.values(k.spiele).some((s) => s.eintrag)) {
        warnen('Die Konkurrenz hat schon Ergebnisse und kann nicht gelöscht werden.');
        break;
      }
      delete z.konkurrenzen[k.id];
      z.konkurrenzReihe = z.konkurrenzReihe.filter((x) => x !== k.id);
      break;
    }

    case ART.teilnehmerGemeldet: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      const id = typeof d.id === 'string' ? d.id : '';
      if (!k) break;
      if (k.einst.art !== 'einzel') {
        warnen('Im Doppel werden Paare gemeldet.');
        break;
      }
      if (!z.spieler[id]) {
        warnen('Spieler nicht gefunden.');
        break;
      }
      if (k.meldungen.includes(id)) break;
      if (begonnen(k)) {
        warnen(`„${k.einst.name}“ hat schon begonnen – Nachmelden ist nicht mehr möglich.`);
        break;
      }
      k.meldungen.push(id);
      break;
    }
    case ART.paarGemeldet: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      if (!k) break;
      const id = typeof d.id === 'string' && /^p-[A-Za-z0-9-]{4,38}$/.test(d.id) ? d.id : undefined;
      const sp = Array.isArray(d.spieler) ? d.spieler.filter((x): x is string => typeof x === 'string') : [];
      if (k.einst.art === 'einzel') {
        warnen('Diese Konkurrenz ist ein Einzel.');
        break;
      }
      if (!id || k.paare[id] || sp.length !== 2 || sp[0] === sp[1] || !z.spieler[sp[0]!] || !z.spieler[sp[1]!]) {
        warnen('Paar konnte nicht gemeldet werden.');
        break;
      }
      if (begonnen(k)) {
        warnen(`„${k.einst.name}“ hat schon begonnen – Nachmelden ist nicht mehr möglich.`);
        break;
      }
      const belegt = sp.find((x) => teilnehmerVon(k, x));
      if (belegt) {
        warnen(`${z.spieler[belegt]!.vorname} ${z.spieler[belegt]!.nachname} ist in „${k.einst.name}“ schon gemeldet.`);
        break;
      }
      if (k.einst.art === 'mixed') {
        const g = sp.map((x) => z.spieler[x]!.geschlecht).filter((x): x is 'm' | 'w' | 'd' => !!x);
        if (g.length === 2 && g[0] === g[1] && g[0] !== 'd') {
          warnen('Ein Mixed besteht aus einer Spielerin und einem Spieler.');
          break;
        }
      }
      k.paare[id] = { id, spieler: [sp[0]!, sp[1]!] };
      k.meldungen.push(id);
      break;
    }
    case ART.teilnehmerAbgemeldet: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      const id = typeof d.id === 'string' ? d.id : '';
      if (!k || !k.meldungen.includes(id)) break;
      if (!begonnen(k)) {
        k.meldungen = k.meldungen.filter((x) => x !== id);
        if (k.setzliste) k.setzliste = k.setzliste.filter((x) => x !== id);
        delete k.paare[id];
        break;
      }
      if (!k.rueckzuege.some((r) => r.teilnehmer === id)) {
        k.rueckzuege.push({
          teilnehmer: id,
          phase: k.gestartet.ko ? 'ko' : 'gruppen',
          zeit: e.zeit,
          nr: k.rueckzuege.length,
        });
      }
      statusAktualisieren(k);
      break;
    }
    case ART.setzliste: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      if (!k) break;
      if (begonnen(k)) {
        warnen('Nach dem Start lässt sich die Setzliste nicht mehr ändern.');
        break;
      }
      if (Array.isArray(d.liste)) k.setzliste = d.liste.filter((x): x is string => typeof x === 'string' && k.meldungen.includes(x));
      break;
    }

    case ART.auslosung: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      if (!k) break;
      const zufall = typeof d.zufall === 'number' ? d.zufall : 0;
      if (d.phase === 'gruppen') {
        if (erstePhase(k) === 'ko' || k.gestartet.gruppen) {
          warnen('Die Gruppen lassen sich jetzt nicht mehr auslosen.');
          break;
        }
        const g = Array.isArray(d.gruppen) ? d.gruppen : null;
        const flach = g?.flat() ?? [];
        if (
          !g ||
          !g.every((x) => Array.isArray(x) && x.length >= 1 && x.every((y) => typeof y === 'string')) ||
          new Set(flach).size !== flach.length ||
          !flach.every((x) => k.meldungen.includes(x as string))
        ) {
          warnen('Ungültige Gruppenauslosung.');
          break;
        }
        k.auslosungGruppen = { zufall, gruppen: g as string[][] };
      } else if (d.phase === 'ko') {
        if (k.gestartet.ko || (k.einst.modus === 'gruppen_ko' && !k.gestartet.gruppen) || !mitKo(k.einst.modus)) {
          warnen('Der K.-o.-Baum lässt sich jetzt nicht auslosen.');
          break;
        }
        const p = Array.isArray(d.plaetze) ? d.plaetze : null;
        const ids = (p ?? []).filter((x): x is string => typeof x === 'string');
        const groesse = p?.length ?? 0;
        if (
          !p ||
          groesse < 2 ||
          (groesse & (groesse - 1)) !== 0 ||
          !p.every((x) => x === null || typeof x === 'string') ||
          new Set(ids).size !== ids.length ||
          !ids.every((x) => k.meldungen.includes(x))
        ) {
          warnen('Ungültige K.-o.-Auslosung.');
          break;
        }
        k.auslosungKo = { zufall, plaetze: p as (string | null)[] };
      }
      break;
    }
    case ART.phaseGestartet: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      if (!k) break;
      if (d.phase === 'gruppen') {
        if (k.gestartet.gruppen || erstePhase(k) === 'ko') break;
        if (!auslosungAktuell(k)) {
          warnen('Die Auslosung passt nicht zu den Meldungen – bitte neu auslosen.');
          break;
        }
        gruppenAnlegen(k);
        k.gestartet.gruppen = true;
      } else if (d.phase === 'ko') {
        if (k.gestartet.ko || !mitKo(k.einst.modus) || !k.auslosungKo) break;
        if (erstePhase(k) === 'ko' && !auslosungAktuell(k)) {
          warnen('Die Auslosung passt nicht zu den Meldungen – bitte neu auslosen.');
          break;
        }
        k.reihenfolge.push(...koAnlegen(k));
        k.gestartet.ko = true;
      }
      statusAktualisieren(k);
      break;
    }
    case ART.phaseZurueck: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      if (!k) break;
      const phase = d.phase === 'ko' ? 'ko' : 'gruppen';
      if (phase === 'gruppen' && k.gestartet.ko) {
        warnen('Bitte zuerst die Endrunde zurücknehmen.');
        break;
      }
      const spiele = Object.values(k.spiele).filter((s) => s.phase === phase);
      if (spiele.some((s) => s.eintrag)) {
        warnen('Es gibt schon Ergebnisse – der Start lässt sich nicht mehr zurücknehmen.');
        break;
      }
      for (const s of spiele) delete k.spiele[s.id];
      k.reihenfolge = k.reihenfolge.filter((id) => k.spiele[id]);
      k.gestartet[phase] = false;
      if (phase === 'gruppen') k.gruppen = [];
      if (phase === 'ko' && k.einst.modus === 'gruppen_ko') k.auslosungKo = null;
      k.rueckzuege = k.rueckzuege.filter((r) => r.phase !== phase);
      statusAktualisieren(k);
      break;
    }
    case ART.gruppeLos: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      const g = k && typeof d.gruppe === 'number' ? k.gruppen[d.gruppe] : undefined;
      const reihe = Array.isArray(d.reihenfolge) ? d.reihenfolge.filter((x): x is string => typeof x === 'string') : [];
      if (!g || reihe.length < 2 || !reihe.every((x) => g.mitglieder.includes(x))) {
        if (k) warnen('Ungültiger Losentscheid.');
        break;
      }
      g.los[[...reihe].sort().join('|')] = reihe;
      break;
    }

    case ART.tischGesperrt: {
      if (!nurLeitung()) break;
      const nr = zahl(d.nr, 1, 200);
      if (!nr) break;
      z.tischeGesperrt = d.gesperrt === true ? [...new Set([...z.tischeGesperrt, nr])].sort((a, b) => a - b) : z.tischeGesperrt.filter((x) => x !== nr);
      break;
    }
    case ART.spielAufgerufen:
    case ART.spielAufrufZurueck: {
      const k = konkurrenz();
      if (!k) break;
      const s = typeof d.spiel === 'string' ? k.spiele[d.spiel] : undefined;
      if (!s) {
        warnen('Spiel nicht gefunden.');
        break;
      }
      const rolle = e.autor?.rolle ?? 'leitung';
      if (!leitung && rolle !== 'helfer' && !(rolle === 'spieler' && e.autor?.helfer === true)) {
        warnen('Spiele aufrufen dürfen Turnierleitung und Helfer.');
        break;
      }
      if (rolle === 'spieler' && seiteVon(k, s, e.autor?.spieler)) {
        warnen('Eigene Spiele ruft die Turnierleitung oder ein Helfer auf.');
        break;
      }
      if (s.status !== 'offen') {
        warnen('Das Spiel ist schon beendet.');
        break;
      }
      if (e.art === ART.spielAufrufZurueck) {
        s.tisch = null;
        s.aufgerufen = null;
        s.schiri = null;
        break;
      }
      if (s.status !== 'offen' || s.eintrag) {
        warnen('Nur offene Spiele lassen sich aufrufen.');
        break;
      }
      const tisch = zahl(d.tisch, 1, 200);
      if (tisch === undefined || tisch === null) {
        warnen('Tisch fehlt.');
        break;
      }
      if (z.tischeGesperrt.includes(tisch)) {
        warnen(`Tisch ${tisch} ist gesperrt.`);
        break;
      }
      const belegt = alleOffenenAufgerufenen(z).find((x) => x.tisch === tisch && x.id !== s.id);
      if (belegt) {
        warnen(`Tisch ${tisch} ist belegt.`);
        break;
      }
      s.tisch = tisch;
      s.aufgerufen = e.zeit;
      s.schiri = schiriLesen(z, d.schiri);
      break;
    }

    case ART.spielErgebnis:
    case ART.spielBestaetigt:
    case ART.spielAngefochten:
    case ART.spielEntschieden:
    case ART.spielZurueckgesetzt: {
      const k = konkurrenz();
      if (!k) break;
      const s = typeof d.spiel === 'string' ? k.spiele[d.spiel] : undefined;
      if (!s) {
        warnen('Spiel nicht gefunden.');
        break;
      }
      const f = spielEreignis(z, k, s, e, d, leitung);
      if (f) warnen(f);
      statusAktualisieren(k);
      break;
    }

    default:
      // Unbekannte Arten (z. B. von einer neueren App-Version) werden übersprungen, nicht verworfen.
      break;
  }
  return z;
}

function schiriLesen(z: TurnierZustand, v: unknown): Schiedsrichter | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  const spieler = typeof x.spieler === 'string' && z.spieler[x.spieler] ? x.spieler : null;
  const name = text(x.name, 80) || (spieler ? `${z.spieler[spieler]!.vorname} ${z.spieler[spieler]!.nachname}`.trim() : '');
  return name ? { name, spieler } : null;
}

/** Spiele, die aufgerufen und noch nicht beendet sind (belegen einen Tisch) */
export function alleOffenenAufgerufenen(z: TurnierZustand): Spiel[] {
  const aus: Spiel[] = [];
  for (const k of Object.values(z.konkurrenzen)) for (const s of Object.values(k.spiele)) if (s.tisch !== null && s.status === 'offen') aus.push(s);
  return aus;
}

function spielEreignis(z: TurnierZustand, k: KonkurrenzZustand, s: Spiel, e: LokalesEreignis, d: Record<string, unknown>, leitung: boolean): Pruefung {
  void z;
  const rolle = e.autor?.rolle ?? 'leitung';
  const ich = e.autor?.spieler;
  const meineSeite: Seite | null = rolle === 'spieler' ? seiteVon(k, s, ich) : null;
  // Spieler mit Helfer-Recht: fremde Spiele amtlich wie ein Helfer, eigene wie jeder Spieler (Gegner bestätigt)
  const amtlich = leitung || rolle === 'helfer' || (rolle === 'spieler' && e.autor?.helfer === true && !meineSeite);
  if (!amtlich && !meineSeite) return 'Spieler dürfen nur ihre eigenen Spiele eintragen.';

  switch (e.art) {
    case ART.spielErgebnis: {
      if (s.status === 'wartet' || s.status === 'freilos' || s.gesperrt) return 'Dieses Spiel kann noch nicht eingetragen werden.';
      if (s.status === 'entfallen' || s.gestrichen) return 'Dieses Spiel zählt nicht (Rückzug).';
      if (s.kampflosDurchRueckzug && !s.eintrag) return 'Ein Teilnehmer hat zurückgezogen – das Spiel ist kampflos entschieden.';
      let eingabe = d.ergebnis as ErgebnisEingabe | undefined;
      if (!eingabe || typeof eingabe !== 'object') return 'Ergebnis fehlt.';
      if (d.a === s.b && d.b === s.a) eingabe = eingabeTauschen(eingabe);
      else if (d.a !== s.a || d.b !== s.b) return 'Die Spieler passen nicht zu diesem Spiel.';
      const w = ergebnisWerten(eingabe, k.einst.bestOf, k.einst.eingabe);
      if (!w.ok) return `Ergebnis ungültig: ${w.fehler}`;
      const blockiert = folgeBlockiert(k, s, w.ergebnis.gewinner);
      if (blockiert) return blockiert;
      return ergebnisAnwenden(k, s, {
        ereignis: e.id,
        eingabe,
        ergebnis: w.ergebnis,
        von: e.autor,
        seite: amtlich ? null : meineSeite,
        amtlich,
        zeit: e.zeit,
      });
    }
    case ART.spielBestaetigt: {
      if (amtlich) return null;
      if (s.stand !== 'eingetragen' || !s.eintrag || s.eintrag.ereignis !== d.ereignis) return null;
      if (s.eintrag.seite === meineSeite) return null;
      s.stand = 'bestaetigt';
      return null;
    }
    case ART.spielAngefochten: {
      if (!s.eintrag || s.eintrag.ereignis !== d.ereignis) return 'Das angefochtene Ergebnis ist nicht mehr aktuell.';
      if (s.stand !== 'eingetragen') return 'Nur ein noch nicht bestätigtes Spieler-Ergebnis kann angefochten werden.';
      if (!amtlich && s.eintrag.seite === meineSeite) return 'Das eigene Ergebnis kann man korrigieren, nicht anfechten.';
      s.stand = 'angefochten';
      s.angefochtenVon = e.autor;
      return null;
    }
    case ART.spielEntschieden: {
      if (!leitung) return 'Nur die Turnierleitung entscheidet Anfechtungen.';
      const wahl = [s.eintrag, ...s.alternativen].find((x) => x && x.ereignis === d.ereignis);
      if (!wahl) return 'Der gewählte Eintrag gehört nicht zu diesem Spiel.';
      const blockiert = folgeBlockiert(k, s, wahl.ergebnis.gewinner);
      if (blockiert) return blockiert;
      s.eintrag = { ...wahl, amtlich: true };
      s.stand = 'bestaetigt';
      s.alternativen = [];
      s.angefochtenVon = null;
      return null;
    }
    case ART.spielZurueckgesetzt: {
      if (!leitung) return 'Nur die Turnierleitung kann Ergebnisse löschen.';
      if (s.phase === 'ko' && abhaengigeMitErgebnis(k, s).length > 0) return 'Das Folgespiel hat schon ein Ergebnis. Bitte zuerst dort zurücksetzen.';
      s.eintrag = null;
      s.stand = null;
      s.alternativen = [];
      s.angefochtenVon = null;
      return null;
    }
  }
  return null;
}

/** Ein fehlerhaftes Ereignis darf das Turnier nie unlesbar machen: es wird übersprungen und gemeldet. */
function sicherAnwenden(z: TurnierZustand, e: LokalesEreignis): TurnierZustand {
  try {
    return anwenden(z, e);
  } catch {
    z.warnungen.push({ ereignis: e.id, text: 'Eintrag konnte nicht verarbeitet werden und wurde übersprungen.', zeit: e.zeit, von: e.autor?.name ?? '' });
    return z;
  }
}

export function berechnen(ereignisse: LokalesEreignis[]): TurnierZustand {
  return ereignisse.reduce(sicherAnwenden, leererZustand());
}
