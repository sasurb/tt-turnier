import type { LokalesEreignis } from './typen';
import { sortieren } from './typen';

/**
 * Ablage der Ereignisse auf dem Gerät. Zwei Umsetzungen:
 * IndexedDB im Browser (dauerhaft, offline) und Arbeitsspeicher (Tests).
 */
export interface EreignisSpeicher {
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
  /** Alles zu einem Turnier löschen. */
  loeschen(turnier: string): Promise<void>;
}

export class SpeicherImArbeitsspeicher implements EreignisSpeicher {
  private ereignisse = new Map<string, LokalesEreignis>();
  private meta = new Map<string, number>();

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
  async loeschen(turnier: string) {
    for (const [id, e] of this.ereignisse) if (e.turnier === turnier) this.ereignisse.delete(id);
    this.meta.delete(turnier);
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

  async abgeholtBis(turnier: string) {
    const db = await this.db;
    const tx = db.transaction('meta', 'readonly');
    const m = (await anfrage(tx.objectStore('meta').get(turnier))) as { seq: number } | undefined;
    return m?.seq ?? 0;
  }

  async setzeAbgeholtBis(turnier: string, seq: number) {
    const db = await this.db;
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ turnier, seq });
    await fertig(tx);
  }

  async loeschen(turnier: string) {
    const db = await this.db;
    const tx = db.transaction(['ereignisse', 'meta'], 'readwrite');
    const store = tx.objectStore('ereignisse');
    const schluessel = await anfrage(store.index('turnier').getAllKeys(turnier));
    for (const k of schluessel) store.delete(k);
    tx.objectStore('meta').delete(turnier);
    await fertig(tx);
  }
}
