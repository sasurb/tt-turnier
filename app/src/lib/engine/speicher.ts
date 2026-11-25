import type { Sicht } from '@shared/protokoll';

/** Gespeicherte Sicht, ab 0.12 mit Filter-Kennung („zuschauer|ab12…“, siehe AbholenAntwort.filter) */
export type GespeicherteSicht = Sicht | `${Sicht}|${string}`;
import type { LokalesEreignis } from './typen';
import { sortieren } from './typen';

/**
 * Ablage der Ereignisse auf dem Gerät. Zwei Umsetzungen:
 * IndexedDB im Browser (dauerhaft, offline) und Arbeitsspeicher (Tests).
 */
export interface EreignisSpeicher {
  sitzungsbereiche?: boolean;
  /** Alle Ereignisse eines Turniers in Anwendungsreihenfolge. */
  alle(turnier: string): Promise<LokalesEreignis[]>;
  /** Noch nicht vom Server bestätigte Ereignisse (älteste zuerst). */
  ausstehende(turnier: string, max?: number): Promise<LokalesEreignis[]>;
  /** Neues Ereignis vom Gerät ablegen. */
  hinzufuegen(e: LokalesEreignis): Promise<void>;
  /** Ereignisse vom Server übernehmen (ersetzt gleiche IDs, auch eigene ausstehende). */
  uebernehmen(liste: LokalesEreignis[]): Promise<void>;
  /** Laufnummer, bis zu der vom Server abgeholt wurde. */
  abgeholtBis(turnier: string): Promise<number>;
  setzeAbgeholtBis(turnier: string, seq: number): Promise<void>;
  /** Mit welcher Sicht (voll/Zuschauer) die abgeholten Ereignisse geliefert wurden; null = unbekannt */
  sicht(turnier: string): Promise<GespeicherteSicht | null>;
  setzeSicht(turnier: string, sicht: GespeicherteSicht): Promise<void>;
  /** Alle vom Server bestätigten Ereignisse verwerfen (ausstehende bleiben), Laufnummer auf 0 – für neues Abholen */
  bestaetigteVerwerfen(turnier: string): Promise<void>;
  /** Vom Server abgelehnte eigene Einträge markieren (Status „abgelehnt“, mit Grund) */
  ablehnen(turnier: string, liste: { id: string; meldung: string }[]): Promise<void>;
  /** Einzelne Einträge dieses Geräts entfernen (z. B. abgelehnte verwerfen) */
  entfernen(turnier: string, ids: string[]): Promise<void>;
  /** Alles zu einem Turnier löschen. */
  loeschen(turnier: string): Promise<void>;
}

export class SpeicherImArbeitsspeicher implements EreignisSpeicher {
  private ereignisse = new Map<string, LokalesEreignis>();
  private meta = new Map<string, number>();
  private sichten = new Map<string, GespeicherteSicht>();

  async alle(turnier: string) {
    return sortieren([...this.ereignisse.values()].filter((e) => e.turnier === turnier));
  }
  async ausstehende(turnier: string, max = Infinity) {
    return (await this.alle(turnier)).filter((e) => e.status === 'ausstehend').slice(0, max);
  }
  async hinzufuegen(e: LokalesEreignis) {
    if (this.ereignisse.has(e.id)) throw new Error('Ereignis-ID bereits vorhanden: ' + e.id);
    this.ereignisse.set(e.id, structuredClone(e));
  }
  async uebernehmen(liste: LokalesEreignis[]) {
    for (const e of liste) this.ereignisse.set(e.id, structuredClone(e));
  }
  async abgeholtBis(turnier: string) {
    return this.meta.get(turnier) ?? 0;
  }
  async setzeAbgeholtBis(turnier: string, seq: number) {
    this.meta.set(turnier, seq);
  }
  async sicht(turnier: string) {
    return this.sichten.get(turnier) ?? null;
  }
  async setzeSicht(turnier: string, sicht: GespeicherteSicht) {
    this.sichten.set(turnier, sicht);
  }
  async bestaetigteVerwerfen(turnier: string) {
    for (const [id, e] of this.ereignisse) if (e.turnier === turnier && e.status === 'bestaetigt') this.ereignisse.delete(id);
    this.meta.set(turnier, 0);
  }
  async ablehnen(turnier: string, liste: { id: string; meldung: string }[]) {
    for (const { id, meldung } of liste) {
      const e = this.ereignisse.get(id);
      if (e && e.turnier === turnier && e.status === 'ausstehend') this.ereignisse.set(id, { ...e, status: 'abgelehnt', fehler: meldung });
    }
  }
  async entfernen(turnier: string, ids: string[]) {
    for (const id of ids) if (this.ereignisse.get(id)?.turnier === turnier && this.ereignisse.get(id)?.status !== 'bestaetigt') this.ereignisse.delete(id);
  }
  async loeschen(turnier: string) {
    for (const [id, e] of this.ereignisse) if (e.turnier === turnier || e.turnier.startsWith(turnier + '/')) this.ereignisse.delete(id);
    for (const m of [this.meta, this.sichten]) for (const key of m.keys()) {
      if (key === turnier || key.startsWith(turnier + '/')) m.delete(key);
    }
  }
}

const DB_NAME = 'tt-turnier';
const DB_VERSION = 1;

function anfrage<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, fehler) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fehler(r.error);
  });
}

function fertig(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, fehler) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => fehler(tx.error ?? new Error("IndexedDB-Fehler"));
    tx.onabort = () => fehler(tx.error ?? new Error('Transaktion abgebrochen'));
  });
}

export class SpeicherIndexedDb implements EreignisSpeicher {
  private db: Promise<IDBDatabase>;

  constructor(name = DB_NAME, idb: IDBFactory = indexedDB) {
    this.db = new Promise((ok, fehler) => {
      const r = idb.open(name, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        const store = db.createObjectStore('ereignisse', { keyPath: 'id' });
        store.createIndex('turnier', 'turnier');
        db.createObjectStore('meta', { keyPath: 'turnier' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fehler(r.error);
    });
  }

  async alle(turnier: string) {
    const db = await this.db;
    const tx = db.transaction('ereignisse', 'readonly');
    const liste = await anfrage(tx.objectStore('ereignisse').index('turnier').getAll(turnier));
    return sortieren(liste as LokalesEreignis[]);
  }

  async ausstehende(turnier: string, max = Infinity) {
    return (await this.alle(turnier)).filter((e) => e.status === 'ausstehend').slice(0, max);
  }

  async hinzufuegen(e: LokalesEreignis) {
    const db = await this.db;
    const tx = db.transaction('ereignisse', 'readwrite');
    tx.objectStore('ereignisse').add(e);
    await fertig(tx);
  }

  async uebernehmen(liste: LokalesEreignis[]) {
    if (liste.length === 0) return;
    const db = await this.db;
    const tx = db.transaction('ereignisse', 'readwrite');
    const store = tx.objectStore('ereignisse');
    for (const e of liste) store.put(e);
    await fertig(tx);
  }

  private async metaLesen(turnier: string): Promise<{ turnier: string; seq: number; sicht?: GespeicherteSicht }> {
    const db = await this.db;
    const tx = db.transaction('meta', 'readonly');
    const m = (await anfrage(tx.objectStore('meta').get(turnier))) as { seq: number; sicht?: GespeicherteSicht } | undefined;
    return { turnier, seq: m?.seq ?? 0, ...(m?.sicht ? { sicht: m.sicht } : {}) };
  }

  private async metaAendern(turnier: string, f: (m: { turnier: string; seq: number; sicht?: GespeicherteSicht }) => void) {
    const db = await this.db;
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    const r = store.get(turnier);
    r.onsuccess = () => {
      const alt = r.result as { seq: number; sicht?: GespeicherteSicht } | undefined;
      const m = { turnier, seq: alt?.seq ?? 0, ...(alt?.sicht ? { sicht: alt.sicht } : {}) };
      f(m);
      store.put(m);
    };
    await fertig(tx);
  }

  async abgeholtBis(turnier: string) {
    return (await this.metaLesen(turnier)).seq;
  }

  async setzeAbgeholtBis(turnier: string, seq: number) {
    await this.metaAendern(turnier, (m) => (m.seq = seq));
  }

  async sicht(turnier: string) {
    return (await this.metaLesen(turnier)).sicht ?? null;
  }

  async setzeSicht(turnier: string, sicht: GespeicherteSicht) {
    await this.metaAendern(turnier, (m) => (m.sicht = sicht));
  }

  async bestaetigteVerwerfen(turnier: string) {
    const db = await this.db;
    const tx = db.transaction(['ereignisse', 'meta'], 'readwrite');
    const store = tx.objectStore('ereignisse');
    const r = store.index('turnier').getAll(turnier);
    r.onsuccess = () => {
      for (const e of r.result as LokalesEreignis[]) if (e.status === 'bestaetigt') store.delete(e.id);
    };
    const meta = tx.objectStore('meta');
    const m = meta.get(turnier);
    m.onsuccess = () => meta.put({ ...((m.result as object | undefined) ?? {}), turnier, seq: 0 });
    await fertig(tx);
  }

  async ablehnen(turnier: string, liste: { id: string; meldung: string }[]) {
    if (liste.length === 0) return;
    const db = await this.db;
    const tx = db.transaction('ereignisse', 'readwrite');
    const store = tx.objectStore('ereignisse');
    for (const { id, meldung } of liste) {
      const r = store.get(id);
      r.onsuccess = () => {
        const e = r.result as LokalesEreignis | undefined;
        if (e && e.turnier === turnier && e.status === 'ausstehend') store.put({ ...e, status: 'abgelehnt', fehler: meldung });
      };
    }
    await fertig(tx);
  }

  async entfernen(turnier: string, ids: string[]) {
    if (ids.length === 0) return;
    const db = await this.db;
    const tx = db.transaction('ereignisse', 'readwrite');
    const store = tx.objectStore('ereignisse');
    for (const id of ids) {
      const r = store.get(id);
      r.onsuccess = () => {
        const e = r.result as LokalesEreignis | undefined;
        if (e && e.turnier === turnier && e.status !== 'bestaetigt') store.delete(id);
      };
    }
    await fertig(tx);
  }

  async loeschen(turnier: string) {
    const db = await this.db;
    const tx = db.transaction(['ereignisse', 'meta'], 'readwrite');
    const store = tx.objectStore('ereignisse');
    const bereiche = IDBKeyRange.bound(turnier + '/', turnier + '/\uffff');
    const index = store.index('turnier');
    const [einzeln, sitzungen] = await Promise.all([anfrage(index.getAllKeys(turnier)), anfrage(index.getAllKeys(bereiche))]);
    const schluessel = [...einzeln, ...sitzungen];
    tx.objectStore('meta').delete(bereiche);
    for (const k of schluessel) store.delete(k);
    tx.objectStore('meta').delete(turnier);
    await fertig(tx);
  }
}

/** Separater Bestand samt Lesestand je Online-Sitzung. Die fachlichen Ereignis-IDs bleiben beim Versand unverändert. */
export class SitzungsSpeicher implements EreignisSpeicher {
  constructor(private basis: EreignisSpeicher, private bindung: string) {}

  private bereich(turnier: string) { return turnier + '/' + this.bindung; }
  private packen(e: LokalesEreignis): LokalesEreignis {
    const turnier = this.bereich(e.turnier);
    return { ...e, turnier, id: turnier + '/' + e.id };
  }
  private entpacken(turnier: string, e: LokalesEreignis): LokalesEreignis {
    return { ...e, turnier, id: e.id.slice(this.bereich(turnier).length + 1) };
  }
  async alle(t: string) { return (await this.basis.alle(this.bereich(t))).map((e) => this.entpacken(t, e)); }
  async ausstehende(t: string, max?: number) { return (await this.basis.ausstehende(this.bereich(t), max)).map((e) => this.entpacken(t, e)); }
  hinzufuegen(e: LokalesEreignis) { return this.basis.hinzufuegen(this.packen(e)); }
  uebernehmen(liste: LokalesEreignis[]) { return this.basis.uebernehmen(liste.map((e) => this.packen(e))); }
  abgeholtBis(t: string) { return this.basis.abgeholtBis(this.bereich(t)); }
  setzeAbgeholtBis(t: string, seq: number) { return this.basis.setzeAbgeholtBis(this.bereich(t), seq); }
  sicht(t: string) { return this.basis.sicht(this.bereich(t)); }
  setzeSicht(t: string, sicht: GespeicherteSicht) { return this.basis.setzeSicht(this.bereich(t), sicht); }
  bestaetigteVerwerfen(t: string) { return this.basis.bestaetigteVerwerfen(this.bereich(t)); }
  ablehnen(t: string, liste: { id: string; meldung: string }[]) {
    const bereich = this.bereich(t);
    return this.basis.ablehnen(bereich, liste.map((e) => ({ ...e, id: bereich + '/' + e.id })));
  }
  entfernen(t: string, ids: string[]) {
    const bereich = this.bereich(t);
    return this.basis.entfernen(bereich, ids.map((id) => bereich + '/' + id));
  }
  loeschen(t: string) { return this.basis.loeschen(this.bereich(t)); }
}
