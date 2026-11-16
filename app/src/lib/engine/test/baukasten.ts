import { ART, type Autor } from '@shared/protokoll';
import { auslosungErstellen } from '../abfragen';
import { standardEinstellungen, type ErgebnisEingabe, type KonkurrenzEinstellungen } from '../modell';
import type { LokalesEreignis } from '../typen';
import { berechnen, type TurnierZustand } from '../zustand';

export const LEITUNG: Autor = { rolle: 'leitung', name: 'Leitung' };
export const HELFER: Autor = { rolle: 'helfer', name: 'Helfer' };

/** Kleiner Turnier-Baukasten für Tests: sammelt Ereignisse, rechnet den Stand (mit Zwischenspeicher) */
export class Baukasten {
  liste: LokalesEreignis[] = [];
  private n = 0;
  private stand: TurnierZustand | null = null;
  /** Startzeit der Ereignis-Zeitstempel; jedes Ereignis eine Sekunde später */
  constructor(private readonly start = Date.UTC(2026, 10, 14, 9, 0, 0)) {}
  e(art: string, daten: Record<string, unknown>, autor: Autor | null = LEITUNG, zeit?: number) {
    this.n++;
    this.liste.push({
      id: `e${this.n}`,
      art,
      daten,
      zeit: new Date(zeit ?? this.start + this.n * 1000).toISOString(),
      geraet: 'g1',
      turnier: 't',
      status: 'lokal',
      seq: this.n,
      empfangen: null,
      autor,
    });
    this.stand = null;
    return `e${this.n}`;
  }
  get z(): TurnierZustand {
    return (this.stand ??= berechnen(this.liste));
  }
  spieler(id: string, ttr: number | null = null, verein = '') {
    return this.e(ART.spielerAngelegt, { id, vorname: id.toUpperCase(), nachname: 'Test', verein, ttr });
  }
  konkurrenz(id: string, einst: Partial<KonkurrenzEinstellungen>, spieler: string[]) {
    this.e(ART.konkurrenzAngelegt, { id, einst: { ...standardEinstellungen(id), ...einst } });
    for (const s of spieler) this.e(ART.teilnehmerGemeldet, { konkurrenz: id, id: s });
  }
  auslosen(k: string, zufall = 42) {
    const z = this.z;
    return this.e(ART.auslosung, auslosungErstellen(z, z.konkurrenzen[k]!, zufall));
  }
  starten(k: string, phase: 'gruppen' | 'ko') {
    return this.e(ART.phaseGestartet, { konkurrenz: k, phase });
  }
  ergebnis(k: string, spiel: string, ergebnis: ErgebnisEingabe, autor: Autor = LEITUNG, zeit?: number) {
    const s = this.z.konkurrenzen[k]!.spiele[spiel]!;
    return this.e(ART.spielErgebnis, { konkurrenz: k, spiel, a: s.a, b: s.b, ergebnis }, autor, zeit);
  }
}

/** Sätze aus Sicht von A: 5 → 11:5, −5 → 5:11 */
export const saetze = (...p: number[]): ErgebnisEingabe => ({ saetze: p.map((v) => (v >= 0 ? [11, v] : [-v, 11]) as [number, number]) });
