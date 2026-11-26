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
  sichtVersion?: () => string;
  bindungFuer?: (token: string) => string | null;
  alterLesestandErlaubt?: (token: string) => boolean;
  altbestandPasst?: (e: LokalesEreignis, token: string) => boolean;
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
  private readonly alteCachesGeprueft = new Set<string>();
  private readonly uebertragungen = new Map<string, Promise<void>>();
  private warteschlange: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: TurnierOptionen) {
    if (o.modus === 'online') {
      if (!o.api) throw new Error('Online-Betrieb braucht eine Server-Verbindung.');
      this.abgleich = new Abgleich({
        speicher: o.speicher,
        api: o.api,
        speicherFuer: (token) => this.speicherFuer(this.bindungFuer(token)),
        bindungFuer: (token) => this.bindungFuer(token),
        sichtVersion: o.sichtVersion,
        vorbereiten: (token, bindung) => this.uebernehmen(token, bindung),
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

  private bindungFuer(token: string | null): string | null {
    return token ? this.o.bindungFuer?.(token) ?? sitzungsbindung(token) : null;
  }

  private async uebernehmen(token: string | null, bindung: string | null): Promise<void> {
    if (!token || !bindung || !bindung.startsWith('i-') || !this.o.speicher.sitzungsbereiche) return;
    const basis = this.o.speicher;
    const alt = sitzungsbindung(token)!;
    const schluessel = alt + '/' + bindung;
    const laufend = this.uebertragungen.get(schluessel);
    if (laufend) return laufend;
    const ziel = this.turnier + '/' + bindung;
    const passt = this.o.altbestandPasst;
    const schritt = (async () => {
      await basis.wartendeVerschieben?.(this.turnier + '/' + alt, ziel, bindung, (e) => e.sitzung === alt);
      if (passt) await basis.wartendeVerschieben?.(this.turnier, ziel, bindung, (e) => !e.sitzung && passt(e, token));
    })();
    this.uebertragungen.set(schluessel, schritt);
    try {
      await schritt;
    } catch (x) {
      this.uebertragungen.delete(schluessel);
      throw x;
    }
  }

  private speicherFuer(bindung: string | null) {
    return this.o.modus === 'online' && this.o.speicher.sitzungsbereiche
      ? new SitzungsSpeicher(this.o.speicher, bindung ?? 'zuschauer') : this.o.speicher;
  }
  sicht() { return this.speicherFuer(this.bindungFuer(this.o.token?.() ?? null)).sicht(this.turnier); }

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
    const bindung = this.bindungFuer(this.o.token?.() ?? null);
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
    const token = this.o.token?.() ?? null;
    const anfang = this.bindungFuer(token);
    if (this.o.modus === 'online') await this.uebernehmen(token, anfang);
    let liste = await this.speicherFuer(anfang).alle(this.o.turnier);
    if (token && anfang?.startsWith('i-') && this.o.speicher.sitzungsbereiche) {
      const alt = sitzungsbindung(token)!;
      const altBereich = this.turnier + '/' + alt;
      const sicht = await this.speicherFuer(anfang).sicht(this.turnier);
      if (!sicht && this.o.alterLesestandErlaubt?.(token) && !liste.some((e) => e.status === 'bestaetigt')) {
        const alterLesestand = await this.speicherFuer(alt).alle(this.turnier);
        liste = [...alterLesestand.filter((e) => e.status === 'bestaetigt'), ...liste];
      } else if (sicht && this.status?.verbindung === 'verbunden' && !this.alteCachesGeprueft.has(altBereich)) {
        this.alteCachesGeprueft.add(altBereich);
        await this.o.speicher.leerenCacheEntfernen?.(altBereich);
      }
    }
    if (this.o.modus === 'lokal') return liste;
    const bindung = this.bindungFuer(this.o.token?.() ?? null);
    if (anfang !== bindung) return [];
    return liste.filter((e) => e.status === 'bestaetigt' || eigeneAktion(e, bindung));
  }

  async fremdeAusstehende(): Promise<LokalesEreignis[]> {
    if (this.o.modus !== 'online' || !this.o.speicher.sitzungsbereiche) return [];
    const token = this.o.token?.() ?? null;
    const eigenerBereich = this.turnier + '/' + (this.bindungFuer(token) ?? 'zuschauer');
    const liste = await this.o.speicher.fremdeAusstehende?.(this.turnier, eigenerBereich) ?? [];
    return token === (this.o.token?.() ?? null) ? liste : [];
  }

  async fremdeVerwerfen(liste: readonly LokalesEreignis[]): Promise<void> {
    const gewaehlt = new Set(liste.map((e) => e.id));
    const aktuell = await this.fremdeAusstehende();
    const nachBereich = new Map<string, string[]>();
    for (const e of aktuell) {
      if (!gewaehlt.has(e.id)) continue;
      const ids = nachBereich.get(e.turnier) ?? [];
      ids.push(e.id);
      nachBereich.set(e.turnier, ids);
    }
    for (const [bereich, ids] of nachBereich) await this.o.speicher.entfernen(bereich, ids, true);
  }

  /** Vom Server abgelehnte Einträge dieses Geräts verwerfen */
  async abgelehnteVerwerfen(): Promise<void> {
    const speicher = this.speicherFuer(this.bindungFuer(this.o.token?.() ?? null));
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
    const bindung = this.bindungFuer(this.o.token?.() ?? null);
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
