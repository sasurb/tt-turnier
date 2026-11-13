import type { Autor } from '@shared/protokoll';
import { Abgleich, type AbgleichStatus } from './abgleich';
import type { Api } from './api';
import { naechsteReihe, neueId } from './ids';
import type { EreignisSpeicher } from './speicher';
import type { LokalesEreignis } from './typen';
import { berechnen, type TurnierZustand } from './zustand';

export type Betriebsart = 'online' | 'lokal';

export interface TurnierOptionen {
  speicher: EreignisSpeicher;
  turnier: string;
  modus: Betriebsart;
  geraet: string;
  /** Wer auf diesem Gerät einträgt (lokal endgültig, online nur vorläufige Anzeige). */
  autor: Autor;
  api?: Api;
  token?: () => string | null;
  intervallMs?: number;
  beiAenderung?: () => void;
}

/**
 * Ein geöffnetes Turnier auf dem Gerät: Einträge erzeugen, Stand berechnen,
 * im Online-Betrieb mit dem Server abgleichen. Die Oberfläche spricht nur mit dieser Klasse.
 */
export class TurnierSitzung {
  readonly abgleich: Abgleich | null;
  private warteschlange: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: TurnierOptionen) {
    if (o.modus === 'online') {
      if (!o.api) throw new Error('Online-Betrieb braucht eine Server-Verbindung.');
      this.abgleich = new Abgleich({
        speicher: o.speicher,
        api: o.api,
        turnier: o.turnier,
        token: o.token ?? (() => null),
        intervallMs: o.intervallMs,
        beiAenderung: () => o.beiAenderung?.(),
      });
    } else {
      this.abgleich = null;
    }
  }

  get turnier() {
    return this.o.turnier;
  }
  get modus() {
    return this.o.modus;
  }
  get status(): AbgleichStatus | null {
    return this.abgleich?.status ?? null;
  }

  start() {
    this.abgleich?.start();
  }
  stop() {
    this.abgleich?.stop();
  }

  /** Neues Ereignis eintragen. Gilt sofort auf dem Gerät; online wird es im Hintergrund gesendet. */
  eintragen(art: string, daten: Record<string, unknown>): Promise<LokalesEreignis> {
    // Nacheinander ausführen, damit lokale Laufnummern eindeutig bleiben
    const schritt = this.warteschlange.then(() => this.eintragenIntern(art, daten));
    this.warteschlange = schritt.catch(() => undefined);
    return schritt;
  }

  private async eintragenIntern(art: string, daten: Record<string, unknown>): Promise<LokalesEreignis> {
    const { speicher, turnier, modus, geraet, autor } = this.o;
    const zeit = new Date().toISOString();
    let seq: number | null = null;
    if (modus === 'lokal') {
      const alle = await speicher.alle(turnier);
      seq = (alle[alle.length - 1]?.seq ?? 0) + 1;
    }
    const e: LokalesEreignis = {
      id: neueId(),
      art,
      daten,
      zeit,
      geraet,
      turnier,
      status: modus === 'lokal' ? 'lokal' : 'ausstehend',
      seq,
      empfangen: modus === 'lokal' ? zeit : null,
      autor,
      reihe: naechsteReihe(),
    };
    await speicher.hinzufuegen(e);
    this.o.beiAenderung?.();
    void this.abgleich?.anstossen();
    return e;
  }

  ereignisse() {
    return this.o.speicher.alle(this.o.turnier);
  }

  async zustand(): Promise<TurnierZustand> {
    return berechnen(await this.ereignisse());
  }
}
