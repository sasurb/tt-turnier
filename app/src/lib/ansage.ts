import { name as tnName, rundeVon } from './engine/abfragen';
import type { Spiel } from './engine/modell';
import { alleOffenenAufgerufenen, type TurnierZustand } from './engine/zustand';

/**
 * Sprachausgabe für Spielaufrufe („Tisch 3: Max Müller gegen Eva Schmidt“), z. B. am Beamer-Laptop
 * mit Hallenlautsprecher. Datenschutz: Es werden nur Stimmen genutzt, die auf dem Gerät selbst laufen
 * (SpeechSynthesisVoice.localService). Online-Stimmen würden die Namen an den Anbieter schicken.
 */

export interface Aufruf {
  /** eindeutig je Aufruf: Spiel und Zeitpunkt (ein erneuter Aufruf desselben Spiels zählt neu) */
  schluessel: string;
  tisch: number;
  spiel: Spiel;
}

/** Alle laufenden Aufrufe, ältester zuerst */
export function aufrufeVon(z: TurnierZustand): Aufruf[] {
  return alleOffenenAufgerufenen(z)
    .filter((s) => s.tisch !== null && s.aufgerufen)
    .sort((a, b) => (a.aufgerufen! < b.aufgerufen! ? -1 : a.aufgerufen! > b.aufgerufen! ? 1 : a.tisch! - b.tisch!))
    .map((s) => ({ schluessel: `${s.konkurrenz}/${s.id}/${s.aufgerufen}`, tisch: s.tisch!, spiel: s }));
}

/** Aufrufe, die in `bekannt` noch fehlen (bekannt wird ergänzt) */
export function neueAufrufe(bekannt: Set<string>, jetzt: Aufruf[]): Aufruf[] {
  const neu = jetzt.filter((a) => !bekannt.has(a.schluessel));
  for (const a of neu) bekannt.add(a.schluessel);
  return neu;
}

/** Gesprochener Text: Paare „Müller und Schmidt“ statt „Müller/Schmidt“ */
export function ansageText(z: TurnierZustand, a: Aufruf): string {
  const k = z.konkurrenzen[a.spiel.konkurrenz];
  const n = (id: string | null) => tnName(z, id, k).replace(/\//g, ' und ');
  const runde = k ? rundeVon(k, a.spiel).replace(k.gruppen.length === 1 ? /^Gruppe A · / : /^$/, '') : '';
  const wo = k ? `${k.einst.name}, ${runde.replace(/ · /g, ', ')}` : '';
  return `${a.spiel.tisch2 ? `Tische ${a.tisch} und ${a.spiel.tisch2}` : `Tisch ${a.tisch}`}: ${n(a.spiel.a)} gegen ${n(a.spiel.b)}.${wo ? ` ${wo}.` : ''}`;
}

type Synth = Pick<SpeechSynthesis, 'getVoices' | 'speak' | 'cancel'> & Partial<Pick<SpeechSynthesis, 'addEventListener'>>;

function synth(): Synth | null {
  return typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
}

/** Deutsche Stimme, die auf dem Gerät läuft (bevorzugt de-DE), oder null */
export function geraeteStimme(stimmen: Pick<SpeechSynthesisVoice, 'lang' | 'localService' | 'name' | 'default'>[]): number {
  let beste = -1;
  let rang = -1;
  stimmen.forEach((v, i) => {
    if (!v.localService || !v.lang.toLowerCase().startsWith('de')) return;
    const r = (v.lang.toLowerCase() === 'de-de' ? 2 : 1) + (v.default ? 0.5 : 0);
    if (r > rang) {
      rang = r;
      beste = i;
    }
  });
  return beste;
}

/** Stimmen laden manche Browser erst nach einer Weile („voiceschanged“) */
export function stimmeLaden(): Promise<SpeechSynthesisVoice | null> {
  const s = synth();
  if (!s) return Promise.resolve(null);
  const finden = () => {
    const alle = s.getVoices();
    const i = geraeteStimme(alle);
    return i >= 0 ? alle[i]! : null;
  };
  const sofort = finden();
  if (sofort || s.getVoices().length) return Promise.resolve(sofort);
  return new Promise((ok) => {
    const t = setTimeout(() => ok(finden()), 1500);
    s.addEventListener?.('voiceschanged', () => {
      clearTimeout(t);
      ok(finden());
    });
  });
}

let ton: AudioContext | null = null;
/** Kurzer Gong vor der Ansage (zwei Töne), damit die Halle aufhorcht */
export function gong(): Promise<void> {
  try {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return Promise.resolve();
    ton ??= new Ctx();
    const c = ton;
    const t0 = c.currentTime + 0.02;
    for (const [f, ab] of [
      [784, 0],
      [523, 0.35],
    ] as const) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + ab);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + ab + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + ab + 0.6);
      o.connect(g).connect(c.destination);
      o.start(t0 + ab);
      o.stop(t0 + ab + 0.65);
    }
    return new Promise((ok) => setTimeout(ok, 1000));
  } catch {
    return Promise.resolve();
  }
}

/**
 * Spricht Aufrufe nacheinander. `freischalten()` muss aus einem Tipp heraus aufgerufen werden
 * (Browser erlauben Ton erst nach einer Bedienung).
 */
export class Ansager {
  private stimme: SpeechSynthesisVoice | null = null;
  private kette: Promise<void> = Promise.resolve();
  bereit = false;

  async freischalten(): Promise<boolean> {
    this.stimme = await stimmeLaden();
    this.bereit = !!this.stimme;
    if (this.bereit) {
      // leere Ansage aus dem Tipp heraus: schaltet die Sprachausgabe frei (iOS)
      try {
        const u = new SpeechSynthesisUtterance('');
        u.voice = this.stimme;
        synth()?.speak(u);
      } catch {
        /* egal */
      }
      try {
        void ton?.resume();
        if (!ton) await gong();
      } catch {
        /* egal */
      }
    }
    return this.bereit;
  }

  sagen(text: string, mitGong = true) {
    const s = synth();
    if (!s || !this.stimme) return;
    const stimme = this.stimme;
    this.kette = this.kette.then(async () => {
      if (mitGong) await gong();
      await new Promise<void>((ok) => {
        const u = new SpeechSynthesisUtterance(text);
        u.voice = stimme;
        u.lang = stimme.lang;
        u.rate = 0.95;
        u.onend = () => ok();
        u.onerror = () => ok();
        s.speak(u);
        setTimeout(ok, 15_000); // falls onend nie kommt
      });
    });
  }

  stoppen() {
    synth()?.cancel();
    this.kette = Promise.resolve();
  }
}

/* ---------- Einstellungen am Gerät ---------- */

function lesen<T>(schluessel: string, standard: T): T {
  try {
    const t = localStorage.getItem(schluessel);
    return t ? { ...standard, ...(JSON.parse(t) as T) } : standard;
  } catch {
    return standard;
  }
}
function schreiben(schluessel: string, wert: unknown) {
  try {
    localStorage.setItem(schluessel, JSON.stringify(wert));
  } catch {
    /* privater Modus */
  }
}

/** Spielaufruf am Gerät der Leitung bzw. eines Helfers (je Turnier) */
export interface AufrufGeraet {
  /** Aufrufe auf diesem Gerät ansagen */
  ansage: boolean;
  /** Freie Tische automatisch mit dem nächsten bereiten Spiel belegen */
  automatisch: boolean;
  /** Beim automatischen Aufruf: Verlierer des vorigen Spiels am Tisch pfeift */
  schiriVerlierer: boolean;
}
export function aufrufGeraet(turnier: string): AufrufGeraet {
  return lesen(`tt-aufruf-${turnier}`, { ansage: false, automatisch: false, schiriVerlierer: false });
}
export function setzeAufrufGeraet(turnier: string, a: AufrufGeraet) {
  schreiben(`tt-aufruf-${turnier}`, a);
}
