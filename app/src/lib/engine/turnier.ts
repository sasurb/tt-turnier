import { eigeneAktion, sitzungsbindung } from './sitzungsbindung';
import type { Autor } from '@shared/protokoll';
import { Abgleich, type AbgleichStatus } from './abgleich';
import type { Api } from './api';
import { naechsteReihe, neueId } from './ids';
import { SitzungsSpeicher, type EreignisSpeicher } from './speicher';
import type { LokalesEreignis } from './typen';
import { berechnen, type TurnierZustand } from './zustand';

export type Betriebsart = 'online' | 'lokal';

export interface TurnierOptionen {
  speicher: EreignisSpeicher;
  turnier: string;
  modus: Betriebsart;
  geraet: string;
  /** Wer auf diesem Gerät einträgt (lokal endgültig, online nur vorläufige Anzeige). */
  autor: Autor | (() => Autor);
  api?: Api;
  token?: () => string | null;
  intervallMs?: number;
  beiAenderung?: () => void;
  /** Siehe AbgleichOptionen.beiRechteVerlust */
  beiRechteVerlust?: () => void;
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
        speicherFuer: (token) => this.speicherFuer(sitzungsbindung(token)),
        turnier: o.turnier,
        token: o.token ?? (() => null),
        intervallMs: o.intervallMs,
        beiAenderung: () => o.beiAenderung?.(),
        beiRechteVerlust: () => o.beiRechteVerlust?.(),
      });
    } else {
      this.abgleich = null;
    }
  }

  private speicherFuer(bindung: string | null) {
    return this.o.modus === 'online' && this.o.speicher.sitzungsbereiche
      ? new SitzungsSpeicher(this.o.speicher, bindung ?? 'zuschauer') : this.o.speicher;
  }
  sicht() { return this.speicherFuer(sitzungsbindung(this.o.token?.() ?? null)).sicht(this.turnier); }

  private autor(): Autor {
    return typeof this.o.autor === 'function' ? this.o.autor() : this.o.autor;
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

  /**
   * Neues Ereignis eintragen. Gilt sofort auf dem Gerät; online wird es im Hintergrund gesendet.
   * `festeId`: Ereignis-ID vorgeben (z. B. Übernahme aus der Online-Anmeldung); gibt es sie schon,
   * bleibt es beim vorhandenen Eintrag.
   */
  eintragen(art: string, daten: Record<string, unknown>, festeId?: string): Promise<LokalesEreignis> {
    // Nacheinander ausführen, damit lokale Laufnummern eindeutig bleiben
    const autor = this.autor();
    const bindung = sitzungsbindung(this.o.token?.() ?? null);
    const schritt = this.warteschlange.then(() => this.eintragenIntern(art, daten, autor, bindung, festeId));
    this.warteschlange = schritt.catch(() => undefined);
    return schritt;
  }

  private async eintragenIntern(art: string, daten: Record<string, unknown>, autor: Autor, bindung: string | null, festeId?: string): Promise<LokalesEreignis> {
    const { turnier, modus, geraet } = this.o;
    const speicher = this.speicherFuer(bindung);
    const zeit = new Date().toISOString();
    let seq: number | null = null;
    if (festeId) {
      const da = (await speicher.alle(turnier)).find((x) => x.id === festeId);
      if (da) return da;
    }
    if (modus === 'lokal') {
      const alle = await speicher.alle(turnier);
      seq = (alle[alle.length - 1]?.seq ?? 0) + 1;
    }
    const e: LokalesEreignis = {
      id: festeId ?? neueId(),
      art,
      daten,
      zeit,
      geraet,
      turnier,
      status: modus === 'lokal' ? 'lokal' : 'ausstehend',
      seq,
      empfangen: modus === 'lokal' ? zeit : null,
      autor,
      ...(modus === 'online' ? { sitzung: bindung } : {}),
      reihe: naechsteReihe(),
    };
    await speicher.hinzufuegen(e);
    this.o.beiAenderung?.();
    void this.abgleich?.anstossen();
    return e;
  }

  async ereignisse() {
    const anfang = sitzungsbindung(this.o.token?.() ?? null);
    const liste = await this.speicherFuer(anfang).alle(this.o.turnier);
    if (this.o.modus === 'lokal') return liste;
    const bindung = sitzungsbindung(this.o.token?.() ?? null);
    if (anfang !== bindung) return [];
    return liste.filter((e) => e.status === 'bestaetigt' || eigeneAktion(e, bindung));
  }

  /** Vom Server abgelehnte Einträge dieses Geräts verwerfen */
  async abgelehnteVerwerfen(): Promise<void> {
    const speicher = this.speicherFuer(sitzungsbindung(this.o.token?.() ?? null));
    const ids = (await this.ereignisse()).filter((e) => e.status === 'abgelehnt').map((e) => e.id);
    await speicher.entfernen(this.o.turnier, ids);
    this.o.beiAenderung?.();
  }

  /**
   * Ereignisse aus einer Sicherung übernehmen (IDs bleiben erhalten, damit erneutes Einspielen
   * nichts verdoppelt). Lokal gelten sie sofort; online werden sie wie neue Einträge gesendet –
   * als Autor setzt der Server dann die Person, die wiederherstellt.
   */
  importieren(liste: Pick<LokalesEreignis, 'id' | 'art' | 'daten' | 'zeit' | 'geraet' | 'autor'>[]): Promise<number> {
    const autor = this.autor();
    const bindung = sitzungsbindung(this.o.token?.() ?? null);
    const schritt = this.warteschlange.then(async () => {
      const { turnier, modus } = this.o;
      const speicher = this.speicherFuer(bindung);
      const vorhanden = new Set((await speicher.alle(turnier)).map((e) => e.id));
      let seq = (await speicher.alle(turnier)).reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
      const neu: LokalesEreignis[] = [];
      for (const e of liste) {
        if (vorhanden.has(e.id)) continue;
        vorhanden.add(e.id);
        neu.push({
          id: e.id,
          art: e.art,
          daten: e.daten,
          zeit: e.zeit,
          geraet: e.geraet,
          turnier,
          status: modus === 'lokal' ? 'lokal' : 'ausstehend',
          seq: modus === 'lokal' ? ++seq : null,
          empfangen: modus === 'lokal' ? e.zeit : null,
          autor: modus === 'lokal' ? e.autor : autor,
          ...(modus === 'online' ? { sitzung: bindung } : {}),
          reihe: naechsteReihe(),
        });
      }
      await speicher.uebernehmen(neu);
      this.o.beiAenderung?.();
      void this.abgleich?.anstossen();
      return neu.length;
    });
    this.warteschlange = schritt.catch(() => undefined);
    return schritt;
  }

  async zustand(): Promise<TurnierZustand> {
    return berechnen(await this.ereignisse());
  }
}
