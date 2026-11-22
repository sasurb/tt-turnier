import { ALLE_AUFGABEN, ART, HELFER_STANDARD, ID_MUSTER, UST_SAETZE, type Aufgabe, type Autor, type KasseEinstellungen, type NamenFuerZuschauer } from '@shared/protokoll';
import type { LokalesEreignis } from './typen';
import { eingabeTauschen, ergebnisGleich, ergebnisWerten } from './ergebnis';
import { abhaengigeMitErgebnis, koAktualisieren, koAnlegen } from './ko';
import { rundenplan } from './rundenplan';
import { ersteRundeAnlegen, istRundenModus, letzteRunde, rundeFertig, rundenAktualisieren } from './runden';
import { kampflosErgebnis } from './wertung';
import {
  aufstellungenKomplett,
  begegnungAuswerten,
  begegnungDaten,
  begegnungUebernehmen,
  istMannschaft,
  kampflosBegegnung,
  mannschaftEinstLesen,
  standardMannschaft,
  systemVon,
  teilAus,
  teileVon,
  type Aufstellung,
  type TeilZustand,
} from './mannschaft';
import {
  ALLE_ANGABEN,
  ALLES_OEFFENTLICH,
  FEST_NACH_START,
  MODI,
  MODI_MANNSCHAFT,
  STANDARD_ANGABEN,
  UHRZEIT_MUSTER,
  festeSaetzeVon,
  mitKo,
  standardEinstellungen,
  type Angabe,
  type Veroeffentlichung,
  type Ergebnis,
  type ErgebnisEingabe,
  type ErgebnisEintrag,
  type KonkurrenzEinstellungen,
  type KonkurrenzZustand,
  type Modus,
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
  /** Wie Zuschauer (ohne Kennung, Live-Anzeige) Spielernamen sehen: voll oder „Max M.“ */
  namen: NamenFuerZuschauer;
  /** Pausenschutz: so viele Minuten nach dem letzten Spiel gilt ein Spieler noch als „in der Pause“ (0 = aus) */
  pause: number;
  /** Geplanter Beginn „HH:MM“ (für den Zeitplan); null = ab jetzt */
  beginn: string | null;
  /** Minuten je Satz für den Zeitplan; null = aus den gespielten Spielen lernen (Standard 4) */
  satzMinuten: number | null;
  /** Rückgängig gemachte Einträge (IDs, siehe eintrag.zurueckgenommen) */
  zurueckgenommen: string[];
  /** Kasse und Quittungen (nur volle Sicht; null = nicht eingerichtet) */
  kasse: KasseEinstellungen | null;
  /** App-Wertung der Hobbyspieler in den Spielerpool übernommen (Zeitpunkt, ab 0.15) – gegen doppeltes Übernehmen */
  wertungUebernommen: string | null;
  /** Check-in am Turniertag: Spieler-ID → da (nur volle Sicht) */
  checkin: Record<string, boolean>;
  /** Startgeld-Buchungen in Reihenfolge (Quittungsnummer = nr; nur volle Sicht) */
  buchungen: Buchung[];
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

export interface Buchung {
  id: string;
  /** Laufende Nummer im Turnier (Quittungsnummer) */
  nr: number;
  spieler: string;
  betrag: number;
  art: 'bar' | 'ueberweisung' | 'erlassen';
  zeit: string;
  von: string;
  storniert: { zeit: string; von: string } | null;
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
    namen: 'voll',
    pause: 0,
    beginn: null,
    satzMinuten: null,
    zurueckgenommen: [],
    kasse: null,
    wertungUebernommen: null,
    checkin: leer(),
    buchungen: [],
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

/**
 * Turnierleitung? Ohne Autor nur bei Einträgen dieses Geräts im Einzelgerät-Betrieb (lokal) – vom Server
 * kommt immer ein Autor, ein fehlender darf dort keine Leitungsrechte geben.
 */
function istLeitung(a: Autor | null, status: LokalesEreignis['status'] | undefined): boolean {
  if (!a) return status === 'lokal';
  return a.rolle === 'leitung' || a.rolle === 'admin' || a.rolle === 'veranstalter';
}

/** Aufgaben eines Autors (Helferkennung bzw. Spielerkennung mit Helfer-Recht); Leitung hat alle */
export function aufgabenVon(a: Autor | null): readonly Aufgabe[] {
  if (!a) return [];
  if (a.rolle === 'leitung' || a.rolle === 'admin' || a.rolle === 'veranstalter') return ALLE_AUFGABEN;
  if (a.rolle === 'helfer') return Array.isArray(a.aufgaben) ? ALLE_AUFGABEN.filter((x) => a.aufgaben!.includes(x)) : HELFER_STANDARD;
  if (a.rolle === 'spieler' && a.helfer === true) return HELFER_STANDARD;
  return [];
}

function kasseLesen(v: unknown, alt: KasseEinstellungen | null): KasseEinstellungen | null {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return alt;
  const x = v as Record<string, unknown>;
  const t = (f: string, max: number) => (typeof x[f] === 'string' ? (x[f] as string).trim().slice(0, max) : '');
  const ust = x.ust === 'befreit' || x.ust === 'enthalten' ? x.ust : 'keiner';
  const satz = (UST_SAETZE as readonly number[]).includes(x.ustSatz as number) ? (x.ustSatz as number) : 19;
  return {
    aussteller: t('aussteller', 160),
    anschrift: t('anschrift', 300),
    ust,
    ustSatz: satz,
    fusstext: t('fusstext', 500),
    empfaenger: t('empfaenger', 70),
    iban: t('iban', 34).replace(/\s+/g, '').toUpperCase(),
    bic: t('bic', 11).replace(/\s+/g, '').toUpperCase(),
  };
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
  if (typeof d.ttrGeschaetzt === 'boolean') r.ttrGeschaetzt = d.ttrGeschaetzt;
  const jg = zahl(d.jahrgang, 1900, 2100);
  if (jg !== undefined) r.jahrgang = jg;
  if (d.klasse === null) r.klasse = null;
  else if (typeof d.klasse === 'string') r.klasse = d.klasse.trim().slice(0, 40) || null;
  if (d.geschlecht === null || d.geschlecht === 'm' || d.geschlecht === 'w' || d.geschlecht === 'd') r.geschlecht = d.geschlecht;
  if (d.pool === null || typeof d.pool === 'string') r.pool = d.pool === null ? null : String(d.pool).slice(0, 64);
  if (d.lizenz === null) r.lizenz = null;
  else if (typeof d.lizenz === 'string' && /^[A-Za-z0-9-]{1,20}$/.test(d.lizenz.trim())) r.lizenz = d.lizenz.trim();
  return r;
}

function einstellungenLesen(d: unknown, basis: KonkurrenzEinstellungen): KonkurrenzEinstellungen {
  const e = { ...basis, zulassung: { ...basis.zulassung } };
  if (!d || typeof d !== 'object') return e;
  const x = d as Record<string, unknown>;
  const n = text(x.name, 80);
  if (n) e.name = n;
  if (typeof x.modus === 'string' && (MODI as readonly string[]).includes(x.modus)) e.modus = x.modus as Modus;
  if (x.runden === null) e.runden = null;
  else if (zahl(x.runden, 1, 30)) e.runden = x.runden as number;
  if (x.vorgabe === null) e.vorgabe = null;
  else if (zahl(x.vorgabe, 10, 500)) e.vorgabe = x.vorgabe as number;
  if (zahl(x.vorgabeMax, 1, 10)) e.vorgabeMax = x.vorgabeMax as number;
  if (x.art === 'einzel' || x.art === 'doppel' || x.art === 'mixed' || x.art === 'mannschaft') e.art = x.art;
  if (x.mannschaft !== undefined) e.mannschaft = mannschaftEinstLesen(x.mannschaft, e.mannschaft);
  if (typeof x.trostrunde === 'boolean') e.trostrunde = x.trostrunde;
  if (typeof x.finaleWiederholung === 'boolean') e.finaleWiederholung = x.finaleWiederholung;
  if (x.bestOf === 1 || x.bestOf === 3 || x.bestOf === 5 || x.bestOf === 7) e.bestOf = x.bestOf;
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
  if (x.festeSaetze === null || x.festeSaetze === 2 || x.festeSaetze === 4) e.festeSaetze = x.festeSaetze;
  if (typeof x.beschleunigt === 'boolean') e.beschleunigt = x.beschleunigt;
  if (x.beginn === null || (typeof x.beginn === 'string' && UHRZEIT_MUSTER.test(x.beginn))) e.beginn = x.beginn;
  const sg = zahl(x.startgeld, 0, 100_000);
  if (sg !== undefined) e.startgeld = sg;
  const mt = zahl(x.maxTeilnehmer, 2, 1000);
  if (mt !== undefined) e.maxTeilnehmer = mt;
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
    if (typeof z.nurHobby === 'boolean') e.zulassung.nurHobby = z.nurHobby;
    if (Array.isArray(z.geschlecht)) e.zulassung.geschlecht = z.geschlecht.filter((g): g is 'm' | 'w' | 'd' => g === 'm' || g === 'w' || g === 'd');
  }
  // Mannschaften: Spielsystem immer vorhanden, nur Gruppen/Jeder gegen jeden/K.-o.
  if (e.art === 'mannschaft') {
    e.mannschaft ??= standardMannschaft();
    if (!MODI_MANNSCHAFT.includes(e.modus)) e.modus = 'gruppen_ko';
  } else e.mannschaft = null;
  return e;
}

function neueKonkurrenz(id: string, einst: KonkurrenzEinstellungen): KonkurrenzZustand {
  return {
    id,
    einst,
    meldungen: [],
    paare: leer(),
    mannschaften: leer(),
    begegnungen: leer(),
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
  if (p) return [...p.spieler];
  const m = k.mannschaften?.[teilnehmer];
  return m ? [...m.spieler] : [teilnehmer];
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
  return (
    Object.values(k.paare).find((p) => p.spieler.includes(spieler) && k.meldungen.includes(p.id))?.id ??
    Object.values(k.mannschaften ?? {}).find((m) => m.spieler.includes(spieler) && k.meldungen.includes(m.id))?.id ??
    null
  );
}

/** Teilnehmer, die zurückgezogen haben (ausdrücklich oder – WO D 7.9 – durch kampflos/Aufgabe in der Gruppe), in Reihenfolge */
export function zurueckgezogen(k: KonkurrenzZustand): string[] {
  const liste = [...k.rueckzuege].sort((a, b) => a.nr - b.nr).map((r) => ({ id: r.teilnehmer, zeit: r.zeit }));
  if (k.einst.rueckzug === 'wo' && !istRundenModus(k.einst.modus)) {
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
        s.ergebnis = kampflosFuer(k, v);
        s.status = 'gespielt';
      }
    } else {
      s.status = s.eintrag ? 'gespielt' : 'offen';
      s.ergebnis = s.eintrag?.ergebnis ?? null;
    }
    s.gewinner = s.ergebnis?.gewinner ?? null;
  }
}

/** Kampflos-Ergebnis (Rückzug): Einzel/Doppel nach WO D 7.10, Mannschaft alle nötigen Teilspiele */
export function kampflosFuer(k: KonkurrenzZustand, verlierer: Seite): Ergebnis {
  return istMannschaft(k) ? kampflosBegegnung(verlierer, k.einst) : kampflosErgebnis(verlierer, k.einst);
}

function statusAktualisieren(k: KonkurrenzZustand) {
  const zurueck = new Set(zurueckgezogen(k));
  // Mannschaften: Ergebnis jeder Begegnung aus den Teilspielen (Gruppen sofort, K.-o. nach dem Setzen der Gegner)
  if (istMannschaft(k)) for (const id of k.reihenfolge) if (k.spiele[id]!.phase === 'gruppen') begegnungUebernehmen(k, k.spiele[id]!);
  if (k.gestartet.gruppen && istRundenModus(k.einst.modus)) {
    rundenAktualisieren(k, zurueck);
    k.status = rundeFertig(k, letzteRunde(k)) ? 'beendet' : 'gruppen';
    return;
  }
  if (k.gestartet.gruppen) gruppenAktualisieren(k, zurueck);
  if (k.gestartet.ko)
    koAktualisieren(k, zurueck, istMannschaft(k) ? { vorher: (s) => begegnungUebernehmen(k, s), kampflos: (v) => kampflosFuer(k, v) } : undefined);
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
      for (const [x, y] of plaene[nr]![r] ?? []) gruppenSpielAnlegen(k, nr, m[x]!, m[y]!, r + 1, index++);
    });
  }
}

/** Gruppenspiel anlegen (ID „g<Gruppe>-<A>-<B>“) und an die Spielfolge hängen */
function gruppenSpielAnlegen(k: KonkurrenzZustand, nr: number, a: string, b: string, runde: number, index: number): boolean {
  const id = `g${nr}-${a}-${b}`;
  if (k.spiele[id]) return false;
  k.spiele[id] = {
          id,
          konkurrenz: k.id,
          phase: 'gruppen',
          gruppe: nr,
          runde,
          index,
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
          plan: null,
        };
  k.reihenfolge.push(id);
  return true;
}

/* ---------------- Änderungen im laufenden Turnier ---------------- */

/** Unabhängige Kopie einer Konkurrenz (zum Durchrechnen einer Änderung, ohne den Stand anzufassen) */
function kopie(k: KonkurrenzZustand): KonkurrenzZustand {
  // Prototypfreie Objekte wie im Zustand (leer()): IDs wie „constructor“ dürfen nichts von Object.prototype finden
  return JSON.parse(JSON.stringify(k), (_s, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.assign(Object.create(null) as object, v) : v,
  ) as KonkurrenzZustand;
}

/** Spiele, die schon ein Ergebnis haben oder an einem Tisch stehen, dürfen sich nicht ändern */
function festgelegt(s: Spiel): boolean {
  return !!s.eintrag || (s.tisch !== null && s.status === 'offen');
}

/**
 * Prüft einen geänderten K.-o.-Plan (Plätze der ersten Runde) im laufenden Turnier: Kein Spiel mit
 * Ergebnis oder Aufruf darf dadurch eine andere Besetzung bekommen. null = in Ordnung, sonst Grund.
 */
export function koPlaetzePruefen(k: KonkurrenzZustand, neu: (string | null)[]): string | null {
  const alt = k.auslosungKo?.plaetze;
  if (!alt || !k.gestartet.ko) return 'Der K.-o.-Teil hat noch nicht begonnen.';
  if (neu.length !== alt.length) return 'Die Zahl der Plätze passt nicht.';
  const ids = neu.filter((x): x is string => typeof x === 'string');
  if (new Set(ids).size !== ids.length) return 'Ein Teilnehmer steht doppelt im Plan.';
  if (!ids.every((x) => k.meldungen.includes(x))) return 'Unbekannter Teilnehmer im Plan.';
  const k2 = kopie(k);
  k2.auslosungKo!.plaetze = [...neu];
  koAktualisieren(k2, new Set(zurueckgezogen(k2)));
  for (const s of Object.values(k.spiele)) {
    if (s.phase !== 'ko' || !festgelegt(s)) continue;
    const t = k2.spiele[s.id]!;
    if (t.a !== s.a || t.b !== s.b) return 'Ein betroffenes Spiel hat schon ein Ergebnis oder ist aufgerufen.';
  }
  return null;
}

/** Freie K.-o.-Plätze (Freilose), auf die ein Teilnehmer nachgemeldet werden kann */
export function nachmeldePlaetzeKo(k: KonkurrenzZustand): number[] {
  const p = k.auslosungKo?.plaetze;
  if (!p || !k.gestartet.ko || erstePhase(k) !== 'ko') return [];
  const aus: number[] = [];
  p.forEach((x, i) => {
    if (x !== null) return;
    const neu = [...p];
    neu[i] = '\u0000probe';
    const k2 = kopie(k);
    k2.meldungen.push('\u0000probe');
    if (koPlaetzePruefen(k2, neu) === null) aus.push(i);
  });
  return aus;
}

/** Spiele, die eine neue Gruppeneinteilung wegfallen ließe (Paarung nicht mehr in derselben Gruppe) */
function wegfallendeGruppenspiele(k: KonkurrenzZustand, neu: string[][]): Spiel[] {
  const gruppeVon = new Map<string, number>();
  neu.forEach((g, nr) => g.forEach((id) => gruppeVon.set(id, nr)));
  return Object.values(k.spiele).filter((s) => s.phase === 'gruppen' && (gruppeVon.get(s.a!) !== s.gruppe || gruppeVon.get(s.b!) !== s.gruppe));
}

/**
 * Prüft eine neue Gruppeneinteilung im laufenden Turnier (gleiche Teilnehmer, gleiche Gruppenzahl).
 * Wer schon ein Ergebnis hat oder an einem Tisch steht, kann nur mit Spielen umziehen, die
 * dadurch nicht wegfallen. null = in Ordnung, sonst Grund.
 */
export function gruppenAenderungPruefen(k: KonkurrenzZustand, neu: string[][]): string | null {
  if (!k.gestartet.gruppen || k.gestartet.ko || istRundenModus(k.einst.modus) || erstePhase(k) !== 'gruppen') return 'Die Gruppen lassen sich jetzt nicht ändern.';
  if (!Array.isArray(neu) || neu.length !== k.gruppen.length) return 'Die Zahl der Gruppen muss gleich bleiben.';
  if (!neu.every((g) => Array.isArray(g) && g.length >= 2 && g.length <= 16 && g.every((x) => typeof x === 'string'))) return 'Jede Gruppe braucht mindestens zwei Teilnehmer.';
  const flach = neu.flat();
  const alt = k.gruppen.flatMap((g) => g.mitglieder);
  if (new Set(flach).size !== flach.length || !gleicheMenge(flach, alt)) return 'Die Teilnehmer müssen dieselben bleiben.';
  if (wegfallendeGruppenspiele(k, neu).some(festgelegt)) return 'Wer schon gespielt hat oder gerade an einem Tisch steht, bleibt in seiner Gruppe.';
  return null;
}

function gruppenAendern(k: KonkurrenzZustand, neu: string[][]) {
  for (const s of wegfallendeGruppenspiele(k, neu)) delete k.spiele[s.id];
  k.reihenfolge = k.reihenfolge.filter((id) => k.spiele[id]);
  let index = Math.max(-1, ...Object.values(k.spiele).map((s) => s.index)) + 1;
  neu.forEach((m, nr) => {
    const g = k.gruppen[nr]!;
    if (!gleicheMenge(g.mitglieder, m) || g.mitglieder.some((x, i) => m[i] !== x)) g.los = leer();
    g.mitglieder = [...m];
    // fehlende Paarungen in der Reihenfolge des Rundenplans ergänzen
    rundenplan(m.length).forEach((runde, r) => {
      for (const [x, y] of runde) {
        const a = m[x]!;
        const b = m[y]!;
        if (k.spiele[`g${nr}-${a}-${b}`] || k.spiele[`g${nr}-${b}-${a}`]) continue;
        gruppenSpielAnlegen(k, nr, a, b, r + 1, index++);
      }
    });
  });
  if (k.einst.modus === 'gruppen_ko') k.auslosungKo = null; // Endrunde muss neu ausgelost werden
}

/**
 * Nachmeldung nach dem Start: Gruppen – neue Spiele gegen alle der Gruppe; K.-o. – auf einen
 * Freilos-Platz; Schweizer/Cup/Kaiser – spielt ab der nächsten Runde mit. null = in Ordnung.
 */
function nachmelden(k: KonkurrenzZustand, id: string, d: Record<string, unknown>): string | null {
  if (k.status === 'beendet') return `„${k.einst.name}“ ist schon beendet.`;
  if (istRundenModus(k.einst.modus)) {
    k.gruppen[0]!.mitglieder.push(id);
    k.meldungen.push(id);
    return null;
  }
  if (k.gestartet.ko) {
    if (erstePhase(k) !== 'ko') return 'Die Endrunde läuft schon – nachmelden geht nur während der Gruppenspiele.';
    const platz = zahl(d.platz, 0, 1023);
    const p = k.auslosungKo!.plaetze;
    if (platz === undefined || platz === null || platz >= p.length || p[platz] !== null) return 'Bitte einen freien Platz (Freilos) im K.-o.-Plan wählen.';
    const neu = [...p];
    neu[platz] = id;
    k.meldungen.push(id);
    const f = koPlaetzePruefen(k, neu);
    if (f) {
      k.meldungen.pop();
      return f;
    }
    k.auslosungKo!.plaetze = neu;
    return null;
  }
  const nr = zahl(d.gruppe, 0, 255);
  const g = nr === undefined || nr === null ? undefined : k.gruppen[nr];
  if (!g) return 'Bitte eine Gruppe für die Nachmeldung wählen.';
  if (g.mitglieder.length >= 16) return 'Die Gruppe ist voll.';
  let index = Math.max(-1, ...Object.values(k.spiele).map((s) => s.index)) + 1;
  const runden = Math.max(1, ...Object.values(k.spiele).filter((s) => s.gruppe === g.nr).map((s) => s.runde));
  // Nachholspiele früh einplanen (kleine Rundennummern), damit der Nachgemeldete aufholt
  g.mitglieder.forEach((x, i) => gruppenSpielAnlegen(k, g.nr, x, id, Math.min(i + 1, runden), index++));
  g.mitglieder.push(id);
  k.meldungen.push(id);
  if (k.einst.modus === 'gruppen_ko') k.auslosungKo = null;
  return null;
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
  const leitung = istLeitung(e.autor, e.status);
  const aufgaben = leitung ? ALLE_AUFGABEN : aufgabenVon(e.autor);
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
      if (e.art === ART.turnierUmbenannt && !nurLeitung()) break;
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
      if (d.namen === 'voll' || d.namen === 'kurz') z.namen = d.namen;
      const pause = zahl(d.pause, 0, 60);
      if (pause !== undefined && pause !== null) z.pause = pause;
      if (d.beginn === null || (typeof d.beginn === 'string' && UHRZEIT_MUSTER.test(d.beginn))) z.beginn = d.beginn;
      const sm = zahl(d.satzMinuten, 2, 15);
      if (sm !== undefined) z.satzMinuten = sm;
      if ('kasse' in d) z.kasse = kasseLesen(d.kasse, z.kasse);
      // Einmalig: lässt sich nicht zurücksetzen (auch nicht per Rückgängig), damit kein Turnier doppelt zählt
      if (typeof d.wertungUebernommen === 'string' && d.wertungUebernommen.length <= 40 && !z.wertungUebernommen) z.wertungUebernommen = d.wertungUebernommen;
      // „Ergebnisse veröffentlichen“: Abweichungen der Konkurrenzen zurücknehmen
      if (d.alleKonkurrenzen === true) for (const k of Object.values(z.konkurrenzen)) k.einst.veroeffentlichung = null;
      break;
    }

    case ART.spielerAngelegt: {
      if (!nurLeitung()) break;
      const id = typeof d.id === 'string' && ID_MUSTER.test(d.id) ? d.id : undefined;
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
        for (const m of Object.values(k.mannschaften)) {
          m.spieler = m.spieler.filter((x) => x !== id);
          if (m.fuehrer === id) m.fuehrer = null;
          if (!m.spieler.length) paare.push(m.id);
        }
        for (const mid of paare) delete k.mannschaften[mid];
        k.meldungen = k.meldungen.filter((x) => x !== id && !paare.includes(x));
        if (k.setzliste) k.setzliste = k.setzliste.filter((x) => x !== id && !paare.includes(x));
      }
      delete z.spieler[id];
      z.spielerReihe = z.spielerReihe.filter((x) => x !== id);
      break;
    }

    case ART.konkurrenzAngelegt: {
      if (!nurLeitung()) break;
      const id = typeof d.id === 'string' && ID_MUSTER.test(d.id) ? d.id : undefined;
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
        warnen(k.einst.art === 'mannschaft' ? 'Hier werden Mannschaften gemeldet.' : 'Im Doppel werden Paare gemeldet.');
        break;
      }
      if (!z.spieler[id]) {
        warnen('Spieler nicht gefunden.');
        break;
      }
      if (k.meldungen.includes(id)) break;
      if (begonnen(k)) {
        const f = nachmelden(k, id, d);
        if (f) warnen(f);
        statusAktualisieren(k);
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
      if (k.einst.art === 'einzel' || k.einst.art === 'mannschaft') {
        warnen(k.einst.art === 'einzel' ? 'Diese Konkurrenz ist ein Einzel.' : 'In dieser Konkurrenz werden Mannschaften gemeldet.');
        break;
      }
      if (!id || k.paare[id] || sp.length !== 2 || sp[0] === sp[1] || !z.spieler[sp[0]!] || !z.spieler[sp[1]!]) {
        warnen('Paar konnte nicht gemeldet werden.');
        break;
      }
      const belegt = sp.find((x) => teilnehmerVon(k, x));
      if (belegt) {
        warnen(`${z.spieler[belegt]!.vorname} ${z.spieler[belegt]!.nachname} ist in „${k.einst.name}“ schon gemeldet.`);
        break;
      }
      if (begonnen(k)) {
        k.paare[id] = { id, spieler: [sp[0]!, sp[1]!] };
        const f = nachmelden(k, id, d);
        if (f) {
          delete k.paare[id];
          warnen(f);
        }
        statusAktualisieren(k);
        break;
      }
      // Mixed (Frau + Mann) prüft die Oberfläche vor dem Senden: Die Berechnung darf keine Angaben
      // benutzen, die Zuschauer und Spieler aus Datenschutzgründen nicht bekommen (Geschlecht, Jahrgang),
      // sonst käme auf ihren Geräten ein anderer Stand heraus.
      k.paare[id] = { id, spieler: [sp[0]!, sp[1]!] };
      k.meldungen.push(id);
      break;
    }
    case ART.mannschaftGemeldet: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      if (!k) break;
      const f = mannschaftMelden(z, k, d);
      if (f) warnen(f);
      statusAktualisieren(k);
      break;
    }
    case ART.mannschaftAufgestellt: {
      const k = konkurrenz();
      if (!k) break;
      const f = aufstellen(z, k, e, d, leitung, aufgaben);
      if (f) warnen(f);
      statusAktualisieren(k);
      break;
    }
    case ART.mannschaftLos: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      if (!k) break;
      const s = typeof d.spiel === 'string' ? k.spiele[d.spiel] : undefined;
      if (!istMannschaft(k) || !s || s.phase !== 'ko' || (d.sieger !== s.a && d.sieger !== s.b) || !begegnungAuswerten(k, s).losNoetig) {
        warnen('Losentscheid nicht möglich.');
        break;
      }
      begegnungDaten(k, s.id).los = d.sieger as string;
      statusAktualisieren(k);
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
        delete k.mannschaften[id];
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
        if (istRundenModus(k.einst.modus) && g.length !== 1) {
          warnen('Beim Schweizer System und Kaiserturnier gibt es nur eine Startliste.');
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
        if (istRundenModus(k.einst.modus)) {
          k.gruppen = [{ nr: 0, mitglieder: [...k.auslosungGruppen!.gruppen[0]!], los: leer() }];
          k.reihenfolge.push(...ersteRundeAnlegen(k));
        } else gruppenAnlegen(k);
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

    case ART.auslosungGeaendert: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      if (!k) break;
      if (d.phase === 'ko') {
        const p = Array.isArray(d.plaetze) && d.plaetze.every((x) => x === null || typeof x === 'string') ? (d.plaetze as (string | null)[]) : null;
        const alt = k.auslosungKo?.plaetze ?? [];
        const f = !p
          ? 'Ungültiger K.-o.-Plan.'
          : p.filter((x) => x === null).length !== alt.filter((x) => x === null).length || !gleicheMenge(p.filter((x): x is string => !!x), alt.filter((x): x is string => !!x))
            ? 'Beim Ändern des K.-o.-Plans bleiben die Teilnehmer dieselben.'
            : koPlaetzePruefen(k, p);
        if (f) {
          warnen(f);
          break;
        }
        k.auslosungKo!.plaetze = [...p!];
      } else {
        const g = Array.isArray(d.gruppen) ? (d.gruppen as string[][]) : [];
        const f = gruppenAenderungPruefen(k, g);
        if (f) {
          warnen(f);
          break;
        }
        gruppenAendern(k, g);
      }
      statusAktualisieren(k);
      break;
    }
    case ART.spielGeplant: {
      if (!nurLeitung()) break;
      const k = konkurrenz();
      const s = k && typeof d.spiel === 'string' ? k.spiele[d.spiel] : undefined;
      if (!k) break;
      if (!s) {
        warnen('Spiel nicht gefunden.');
        break;
      }
      if (s.status !== 'offen' && s.status !== 'wartet') {
        warnen('Nur offene Spiele lassen sich planen.');
        break;
      }
      const tisch = zahl(d.tisch, 1, 200) ?? null;
      const zeit = typeof d.zeit === 'string' && UHRZEIT_MUSTER.test(d.zeit) ? d.zeit : null;
      s.plan = tisch !== null || zeit !== null ? { tisch, zeit } : null;
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
      const rolle = e.autor?.rolle ?? (leitung ? 'leitung' : 'zuschauer');
      if (!aufgaben.includes('aufruf')) {
        warnen('Spiele aufrufen dürfen die Turnierleitung und Helfer mit der Aufgabe „Spielaufruf“.');
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
      const laufend = alleOffenenAufgerufenen(z).filter((x) => !(x.id === s.id && x.konkurrenz === s.konkurrenz));
      const belegt = laufend.find((x) => x.tisch === tisch);
      if (belegt) {
        warnen(`Tisch ${tisch} ist belegt.`);
        break;
      }
      // Niemand spielt an zwei Tischen zugleich (z. B. zwei Geräte rufen gleichzeitig auf)
      const beteiligt = [...spielerVon(k, s.a), ...spielerVon(k, s.b)];
      const doppelt = laufend.find((x) => {
        const kx = z.konkurrenzen[x.konkurrenz]!;
        return [...spielerVon(kx, x.a), ...spielerVon(kx, x.b)].some((id) => beteiligt.includes(id));
      });
      if (doppelt) {
        warnen(`Ein Spieler dieses Spiels steht schon an Tisch ${doppelt.tisch}.`);
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
      const teil = typeof d.spiel === 'string' && istMannschaft(k) ? teilAus(d.spiel) : null;
      if (teil) {
        const b = k.spiele[teil.spiel];
        const f = b ? teilEreignis(z, k, b, teil.nr, e, d, leitung, aufgaben) : 'Begegnung nicht gefunden.';
        if (f) warnen(f);
        statusAktualisieren(k);
        break;
      }
      const s = typeof d.spiel === 'string' ? k.spiele[d.spiel] : undefined;
      if (!s) {
        warnen('Spiel nicht gefunden.');
        break;
      }
      if (istMannschaft(k) && e.art !== ART.spielZurueckgesetzt) {
        warnen('Bei Mannschaften werden die einzelnen Spiele der Begegnung eingetragen.');
        break;
      }
      const f = istMannschaft(k) ? begegnungZuruecksetzen(k, s, leitung || aufgaben.includes('oberschiri')) : spielEreignis(z, k, s, e, d, leitung, aufgaben);
      if (f) warnen(f);
      statusAktualisieren(k);
      break;
    }

    case ART.teilnehmerEingecheckt: {
      if (!aufgaben.includes('kasse')) {
        warnen('Check-in dürfen die Turnierleitung und die Kasse.');
        break;
      }
      const sp = typeof d.spieler === 'string' ? z.spieler[d.spieler] : undefined;
      if (!sp) {
        warnen('Spieler nicht gefunden.');
        break;
      }
      z.checkin[sp.id] = d.da !== false;
      break;
    }
    case ART.startgeldGebucht: {
      if (!aufgaben.includes('kasse')) {
        warnen('Startgeld buchen dürfen die Turnierleitung und die Kasse.');
        break;
      }
      const id = typeof d.id === 'string' && /^[a-z0-9]{4,16}$/.test(d.id) ? d.id : null;
      const sp = typeof d.spieler === 'string' ? z.spieler[d.spieler] : undefined;
      const betrag = zahl(d.betrag, 0, 100_000);
      const art = d.art === 'bar' || d.art === 'ueberweisung' || d.art === 'erlassen' ? d.art : null;
      if (!id || z.buchungen.some((b) => b.id === id) || !sp || betrag === undefined || betrag === null || !art) {
        warnen('Buchung ungültig.');
        break;
      }
      z.buchungen.push({ id, nr: z.buchungen.length + 1, spieler: sp.id, betrag, art, zeit: e.zeit, von: e.autor?.name ?? '', storniert: null });
      break;
    }
    case ART.startgeldStorniert: {
      if (!aufgaben.includes('kasse')) {
        warnen('Stornieren dürfen die Turnierleitung und die Kasse.');
        break;
      }
      const b = z.buchungen.find((x) => x.id === d.buchung);
      if (!b || b.storniert) {
        warnen('Buchung nicht gefunden oder schon storniert.');
        break;
      }
      b.storniert = { zeit: e.zeit, von: e.autor?.name ?? '' };
      break;
    }

    default:
      // Unbekannte Arten (z. B. von einer neueren App-Version) werden übersprungen, nicht verworfen.
      break;
  }
  return z;
}

/* ---------------- Mannschaften ---------------- */

const MANNSCHAFT_ID = /^m-[A-Za-z0-9-]{4,38}$/;
const MAX_MANNSCHAFT = 20;

/** Mannschaft melden oder ändern (gleiche ID): Name, Verein, Spieler, Mannschaftsführung */
function mannschaftMelden(z: TurnierZustand, k: KonkurrenzZustand, d: Record<string, unknown>): Pruefung {
  if (!istMannschaft(k)) return 'Diese Konkurrenz ist keine Mannschafts-Konkurrenz.';
  const id = typeof d.id === 'string' && MANNSCHAFT_ID.test(d.id) ? d.id : null;
  const name = text(d.name, 60);
  const sp = Array.isArray(d.spieler) ? [...new Set(d.spieler.filter((x): x is string => typeof x === 'string'))] : [];
  if (!id || !name) return 'Mannschaft braucht einen Namen.';
  if (!sp.length || sp.length > MAX_MANNSCHAFT || sp.some((x) => !z.spieler[x])) return `Eine Mannschaft hat 1 bis ${MAX_MANNSCHAFT} Spieler aus dem Turnier.`;
  const belegt = sp.find((x) => Object.values(k.mannschaften).some((m) => m.id !== id && m.spieler.includes(x)));
  if (belegt) return `${z.spieler[belegt]!.vorname} ${z.spieler[belegt]!.nachname} spielt in „${k.einst.name}“ schon in einer anderen Mannschaft.`;
  const fuehrer = typeof d.fuehrer === 'string' && sp.includes(d.fuehrer) ? d.fuehrer : null;
  const verein = text(d.verein, 80) ?? '';
  const alt = k.mannschaften[id];
  if (alt) {
    // Spieler, die schon aufgestellt sind und gespielt haben, bleiben in der Mannschaft
    for (const [spiel, b] of Object.entries(k.begegnungen)) {
      const auf = b.aufstellung[id];
      const s = k.spiele[spiel];
      if (!auf || !s || !Object.keys(b.teile).length) continue;
      const weg = [...auf.einzel, ...auf.doppel.flat()].find((x) => x && !sp.includes(x));
      if (weg) return `${z.spieler[weg]?.vorname ?? ''} ${z.spieler[weg]?.nachname ?? ''} hat für die Mannschaft schon gespielt und bleibt gemeldet.`.trim();
    }
    Object.assign(alt, { name, verein, spieler: sp, fuehrer });
    return null;
  }
  k.mannschaften[id] = { id, name, verein, spieler: sp, fuehrer };
  if (begonnen(k)) {
    const f = nachmelden(k, id, d);
    if (f) {
      delete k.mannschaften[id];
      return f;
    }
    return null;
  }
  k.meldungen.push(id);
  return null;
}

/** Aufstellung abgeben: Leitung, Helfer (Ergebnisse/Oberschiedsrichter) oder die Mannschaftsführung der eigenen Mannschaft */
function aufstellen(z: TurnierZustand, k: KonkurrenzZustand, e: LokalesEreignis, d: Record<string, unknown>, leitung: boolean, aufgaben: readonly Aufgabe[]): Pruefung {
  if (!istMannschaft(k)) return 'Diese Konkurrenz ist keine Mannschafts-Konkurrenz.';
  const s = typeof d.spiel === 'string' ? k.spiele[d.spiel] : undefined;
  if (!s) return 'Begegnung nicht gefunden.';
  const mid = typeof d.mannschaft === 'string' ? d.mannschaft : '';
  const m = k.mannschaften[mid];
  if (!m || (s.a !== mid && s.b !== mid)) return 'Diese Mannschaft spielt nicht in dieser Begegnung.';
  if (s.status === 'wartet' || s.status === 'freilos' || s.status === 'entfallen' || s.gestrichen) return 'Für diese Begegnung lässt sich keine Aufstellung abgeben.';
  const gegner = s.a === mid ? s.b : s.a;
  if (d.gegner !== gegner) return 'Die Aufstellung nennt den falschen Gegner.';
  // Spieler mit Helferrecht tragen nur amtlich ein, wenn die eigene Mannschaft nicht in der Begegnung spielt
  const ichSpieler = e.autor?.spieler ?? '';
  const inBegegnung = [s.a, s.b].some((x) => !!x && !!k.mannschaften[x]?.spieler.includes(ichSpieler));
  const amtlich = leitung || (e.autor?.rolle === 'helfer' && (aufgaben.includes('ergebnisse') || aufgaben.includes('oberschiri'))) || (e.autor?.rolle === 'spieler' && e.autor.helfer === true && !inBegegnung);
  const fuehrung = e.autor?.rolle === 'spieler' && !!e.autor.spieler && e.autor.spieler === m.fuehrer;
  if (!amtlich && !fuehrung) return 'Die Aufstellung geben die Mannschaftsführung, Helfer oder die Turnierleitung ab.';
  // Sperre gegen Nachbessern: Haben beide Mannschaften schon etwas eingereicht (auch Ungültiges; die Rechte prüfen
  // Server und Engine gleich), ändert nur noch die Leitung. So bringt es nichts, die
  // gegnerische Aufstellung mit einer ungültigen eigenen aufzudecken.
  const b0 = begegnungDaten(k, s.id);
  const schonEingereicht = !!b0.versuche[mid];
  b0.versuche[mid] = true;
  if (!leitung && schonEingereicht && gegner && b0.versuche[gegner]) return 'Beide Aufstellungen stehen – ändern kann sie jetzt nur die Turnierleitung.';
  const sys = systemVon(k.einst);
  const roh = (v: unknown) => (typeof v === 'string' && m.spieler.includes(v) ? v : null);
  const einzel = Array.from({ length: sys.einzel }, (_, i) => roh(Array.isArray(d.einzel) ? d.einzel[i] : null));
  const doppel = Array.from({ length: sys.doppel }, (_, i): [string, string] | null => {
    const p = Array.isArray(d.doppel) ? d.doppel[i] : null;
    if (!Array.isArray(p)) return null;
    const x = roh(p[0]);
    const y = roh(p[1]);
    return x && y && x !== y ? [x, y] : null;
  });
  const imEinzel = einzel.filter(Boolean) as string[];
  if (new Set(imEinzel).size !== imEinzel.length) return 'Jeder Spieler steht im Einzel nur auf einer Position.';
  const imDoppel = doppel.flat().filter(Boolean) as string[];
  if (new Set(imDoppel).size !== imDoppel.length) return 'Jeder Spieler spielt nur in einem Doppel.';
  if (!imEinzel.length && !imDoppel.length) return 'Die Aufstellung ist leer.';
  const b = b0;
  const alt = b.aufstellung[mid];
  if (alt && !leitung && aufstellungenKomplett(k, s)) return 'Beide Aufstellungen stehen – ändern kann sie jetzt nur die Turnierleitung.';
  if (alt) {
    // Positionen gespielter Teilspiele bleiben, wie sie waren
    const teile = teileVon(k, s);
    for (const t of teile) {
      if (!t.eintrag) continue;
      const pos = s.a === mid ? t.posA : t.posB;
      const vorher = t.art === 'einzel' ? alt.einzel[pos - 1] : alt.doppel[pos - 1]?.join('+');
      const jetzt = t.art === 'einzel' ? einzel[pos - 1] : doppel[pos - 1]?.join('+');
      if ((vorher ?? null) !== (jetzt ?? null)) return `Spiel ${t.nr} ist schon gespielt – die Aufstellung dafür lässt sich nicht mehr ändern.`;
    }
  }
  const auf: Aufstellung = { einzel, doppel, ereignis: e.id, von: e.autor?.name ?? '', zeit: e.zeit };
  b.aufstellung[mid] = auf;
  void z;
  return null;
}

/** Alle Teilspiele einer Begegnung zurücksetzen (Leitung/Oberschiedsrichter) */
function begegnungZuruecksetzen(k: KonkurrenzZustand, s: Spiel, darf: boolean): Pruefung {
  if (!darf) return 'Ergebnisse löschen können die Turnierleitung und der Oberschiedsrichter.';
  if (s.phase === 'ko' && abhaengigeMitErgebnis(k, s).length > 0) return 'Das Folgespiel hat schon ein Ergebnis. Bitte zuerst dort zurücksetzen.';
  const b = k.begegnungen[s.id];
  if (b) {
    b.teile = leer();
    b.los = null;
  }
  return null;
}

/**
 * Ergebnis eines Teilspiels. Spieler dürfen Teilspiele eintragen, in denen sie selbst spielen; die
 * Mannschaftsführung alle Teilspiele der eigenen Begegnung. Bestätigen/Anfechten durch die Gegenseite wie bei
 * normalen Spielen. Im K.-o. darf sich der Sieger der Begegnung nicht ändern, wenn das Folgespiel schon läuft.
 */
function teilEreignis(z: TurnierZustand, k: KonkurrenzZustand, s: Spiel, nr: number, e: LokalesEreignis, d: Record<string, unknown>, leitung: boolean, aufgaben: readonly Aufgabe[]): Pruefung {
  const teile = teileVon(k, s);
  const t = teile[nr - 1];
  if (!t) return 'Teilspiel nicht gefunden.';
  if (e.autor?.rolle === 'spieler' && !leitung) {
    const ich = e.autor.spieler ?? '';
    const team = [s.a, s.b].map((x) => (x ? k.mannschaften[x] : undefined)).find((m) => m?.spieler.includes(ich));
    const amtlichAlsHelfer = e.autor.helfer === true && !team;
    if (!amtlichAlsHelfer && !(t.a.includes(ich) || t.b.includes(ich) || (!!team && team.fuehrer === ich)))
      return 'Spieler tragen nur eigene Spiele ein; die Mannschaftsführung alle Spiele ihrer Begegnung.';
  }
  const b = begegnungDaten(k, s.id);
  const alt = b.teile[String(nr)];
  const ziel: TeilZustand = alt && (alt.aTeam === s.a || alt.aTeam === s.b) ? alt : { eintrag: null, stand: null, alternativen: [], angefochtenVon: null, aTeam: s.a ?? '' };
  // Vorhandene Einträge in die Sicht der aktuellen Seite A bringen
  if (ziel.aTeam !== s.a && ziel.eintrag) {
    const um = (x: ErgebnisEintrag): ErgebnisEintrag => ({ ...x, eingabe: eingabeTauschen(x.eingabe), ergebnis: tauschen(x.ergebnis), seite: x.seite === 'a' ? 'b' : x.seite === 'b' ? 'a' : null });
    ziel.eintrag = um(ziel.eintrag);
    ziel.alternativen = ziel.alternativen.map(um);
    ziel.aTeam = s.a ?? '';
  }
  // Pseudo-Spiel: gleiche Regeln wie ein Einzel (Seite = Mannschaft des Eintragenden)
  const pseudo: Spiel = {
    ...s,
    phase: 'gruppen',
    status: t.status === 'offen' || t.status === 'gespielt' || (t.status === 'entfallen' && t.a.length > 0 && t.b.length > 0) ? 'offen' : 'wartet',
    gesperrt: false,
    gestrichen: false,
    kampflosDurchRueckzug: null,
    eintrag: ziel.eintrag,
    stand: ziel.stand,
    alternativen: ziel.alternativen,
    angefochtenVon: ziel.angefochtenVon,
  };
  const einst = k.einst;
  const vorher = s.gewinner;
  const f = spielEreignis(z, { ...k, einst: { ...einst, festeSaetze: null } }, pseudo, e, d, leitung, aufgaben);
  if (f) return f.replace('Dieses Spiel kann noch nicht eingetragen werden.', 'Dieses Spiel kann erst eingetragen werden, wenn beide Aufstellungen stehen.');
  const sicherung = b.teile[String(nr)];
  b.teile[String(nr)] = { eintrag: pseudo.eintrag, stand: pseudo.stand, alternativen: pseudo.alternativen, angefochtenVon: pseudo.angefochtenVon, aTeam: s.a ?? '' };
  if (s.phase === 'ko') {
    const neu = begegnungAuswerten(k, s).eintrag?.ergebnis.gewinner ?? null;
    if (neu !== vorher && abhaengigeMitErgebnis(k, s).length > 0) {
      if (sicherung) b.teile[String(nr)] = sicherung;
      else delete b.teile[String(nr)];
      return 'Das Folgespiel hat schon ein Ergebnis. Bitte zuerst dort das Ergebnis zurücksetzen.';
    }
  }
  return null;
}

function tauschen(x: Ergebnis): Ergebnis {
  return {
    ...x,
    saetze: x.saetze ? x.saetze.map(([a, b]) => [b, a] as [number, number]) : null,
    satzA: x.satzB,
    satzB: x.satzA,
    ballA: x.ballB,
    ballB: x.ballA,
    gewinner: x.gewinner === 'a' ? 'b' : x.gewinner === 'b' ? 'a' : null,
  };
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

function spielEreignis(
  z: TurnierZustand,
  k: KonkurrenzZustand,
  s: Spiel,
  e: LokalesEreignis,
  d: Record<string, unknown>,
  leitung: boolean,
  aufgaben: readonly Aufgabe[],
): Pruefung {
  void z;
  const rolle = e.autor?.rolle ?? (leitung ? 'leitung' : 'zuschauer');
  const ich = e.autor?.spieler;
  const meineSeite: Seite | null = rolle === 'spieler' ? seiteVon(k, s, ich) : null;
  // Spieler mit Helfer-Recht: fremde Spiele amtlich wie ein Helfer, eigene wie jeder Spieler (Gegner bestätigt).
  // Helfer brauchen die Aufgabe „Ergebnisse“ oder „Oberschiedsrichter“.
  const traegtEin = aufgaben.includes('ergebnisse') || aufgaben.includes('oberschiri');
  const oberschiri = leitung || aufgaben.includes('oberschiri');
  const amtlich = leitung || (rolle === 'helfer' && traegtEin) || (rolle === 'spieler' && e.autor?.helfer === true && !meineSeite);
  if (!amtlich && !meineSeite) return rolle === 'spieler' ? 'Spieler dürfen nur ihre eigenen Spiele eintragen.' : 'Mit dieser Kennung lassen sich keine Ergebnisse eintragen.';

  switch (e.art) {
    case ART.spielErgebnis: {
      if (s.status === 'wartet' || s.status === 'freilos' || s.gesperrt) return 'Dieses Spiel kann noch nicht eingetragen werden.';
      if (s.status === 'entfallen' || s.gestrichen) return 'Dieses Spiel zählt nicht (Rückzug).';
      if (s.kampflosDurchRueckzug && !s.eintrag) return 'Ein Teilnehmer hat zurückgezogen – das Spiel ist kampflos entschieden.';
      let eingabe = d.ergebnis as ErgebnisEingabe | undefined;
      if (!eingabe || typeof eingabe !== 'object') return 'Ergebnis fehlt.';
      if (d.a === s.b && d.b === s.a) eingabe = eingabeTauschen(eingabe);
      else if (d.a !== s.a || d.b !== s.b) return 'Die Spieler passen nicht zu diesem Spiel.';
      const w = ergebnisWerten(eingabe, k.einst.bestOf, k.einst.eingabe, festeSaetzeVon(k.einst));
      if (w.ok && w.ergebnis.gewinner === null && s.phase === 'ko') return 'Im K.-o.-System gibt es kein Unentschieden.';
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
      if (!oberschiri) return 'Anfechtungen entscheiden die Turnierleitung und der Oberschiedsrichter.';
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
      if (!oberschiri) return 'Ergebnisse löschen können die Turnierleitung und der Oberschiedsrichter.';
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

/**
 * Rückgängig gemachte Einträge: Die Leitung nimmt mit „eintrag.zurueckgenommen“ frühere Einträge
 * zurück (oder stellt sie wieder her). Der letzte Stand je Eintrag gilt. Zurücknehmen lassen sich
 * nur Einträge, die vorher im Protokoll stehen – nicht das Anlegen des Turniers und nicht das
 * Rückgängigmachen selbst (dafür gibt es „wiederherstellen“).
 */
/** Nicht rücknehmbare Arten (Turnier anlegen, Rückgängig selbst, Wiederherstellen aus Sicherung, Testnotiz) */
export const NICHT_RUECKGAENGIG: readonly string[] = [
  ART.turnierAngelegt,
  ART.eintragZurueck,
  ART.turnierWiederhergestellt,
  ART.testNotiz,
  // Kassenbuch: Buchungen werden storniert, nie zurückgenommen (Quittungen bleiben gültig)
  ART.startgeldGebucht,
  ART.startgeldStorniert,
];

/**
 * Darf dieser Eintrag zurückgenommen werden? Zusätzlich gesperrt: Turnierangaben mit „Namen für
 * Zuschauer“ – diese Einstellung werten auch die Server aus (Datenschutz-Filter), die vom Rückgängig
 * nichts wissen. Sie wird stattdessen neu eingestellt.
 */
export function rueckgaengigErlaubt(e: Pick<LokalesEreignis, 'art' | 'daten'>): boolean {
  if (NICHT_RUECKGAENGIG.includes(e.art)) return false;
  if (e.art === ART.turnierDaten && e.daten && typeof e.daten === 'object' && ('namen' in e.daten || 'wertungUebernommen' in e.daten)) return false;
  return true;
}

export function zurueckgenommeneEintraege(ereignisse: (Pick<LokalesEreignis, 'id' | 'art' | 'daten' | 'autor'> & { status?: LokalesEreignis['status'] })[]): Set<string> {
  const pos = new Map<string, number>();
  ereignisse.forEach((e, i) => {
    if (!pos.has(e.id)) pos.set(e.id, i);
  });
  const stand = new Map<string, boolean>();
  ereignisse.forEach((e, i) => {
    if (e.art !== ART.eintragZurueck || !istLeitung(e.autor, e.status)) return;
    const d = (e.daten ?? {}) as Record<string, unknown>;
    if (!Array.isArray(d.ereignisse)) return;
    const zurueck = d.zurueck !== false;
    for (const id of d.ereignisse.slice(0, 200)) {
      if (typeof id !== 'string') continue;
      const p = pos.get(id);
      if (p === undefined || p >= i) continue;
      const ziel = ereignisse[p]!;
      if (!rueckgaengigErlaubt(ziel)) continue;
      stand.set(id, zurueck);
    }
  });
  return new Set([...stand].filter(([, v]) => v).map(([id]) => id));
}

export function berechnen(alle: LokalesEreignis[]): TurnierZustand {
  // Vom Server abgelehnte Einträge zählen nie (sie bleiben nur sichtbar, bis das Gerät sie verwirft)
  const ereignisse = alle.some((e) => e.status === 'abgelehnt') ? alle.filter((e) => e.status !== 'abgelehnt') : alle;
  const weg = zurueckgenommeneEintraege(ereignisse);
  const z = leererZustand();
  for (const e of ereignisse) {
    if (e.art === ART.eintragZurueck || weg.has(e.id)) z.anzahlEreignisse++;
    else sicherAnwenden(z, e);
  }
  z.zurueckgenommen = [...weg];
  return z;
}
