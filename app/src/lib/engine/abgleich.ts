import { MAX_EREIGNISSE_JE_AUFRUF } from '@shared/protokoll';
import { Api, ApiFehler } from './api';
import type { EreignisSpeicher } from './speicher';
import { ausServer } from './typen';

export type Verbindung = 'unbekannt' | 'verbunden' | 'offline' | 'nicht_angemeldet' | 'fehler';

export interface AbgleichStatus {
  verbindung: Verbindung;
  ausstehend: number;
  letzterAbgleich: Date | null;
  meldung: string | null;
}

export interface AbgleichOptionen {
  speicher: EreignisSpeicher;
  api: Api;
  turnier: string;
  /** Liefert das aktuelle Schreib-Token oder null (dann nur Abholen, z. B. Zuschauer). */
  token: () => string | null;
  intervallMs?: number;
  maxIntervallMs?: number;
  /** Wird nach jeder Änderung an Daten oder Status aufgerufen. */
  beiAenderung?: (status: AbgleichStatus, neueDaten: boolean) => void;
}

/**
 * Hält ein Turnier mit dem Server abgeglichen:
 * 1. ausstehende Ereignisse senden (in Blöcken, wiederholbar ohne Doppelung)
 * 2. neue Ereignisse ab der letzten Laufnummer abholen
 * Ohne Verbindung wird mit wachsendem Abstand erneut versucht; Einträge bleiben lokal erhalten.
 */
export class Abgleich {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private laeuft = false;
  private erneut = false;
  private aktiv = false;
  private abstand: number;
  status: AbgleichStatus = { verbindung: 'unbekannt', ausstehend: 0, letzterAbgleich: null, meldung: null };

  constructor(private readonly o: AbgleichOptionen) {
    this.abstand = o.intervallMs ?? 2000;
  }

  start() {
    if (this.aktiv) return;
    this.aktiv = true;
    void this.anstossen();
  }

  stop() {
    this.aktiv = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Sofort einen Durchlauf starten (z. B. nach einem neuen Eintrag oder wenn das Netz zurück ist). */
  async anstossen(): Promise<void> {
    if (!this.aktiv) return;
    if (this.laeuft) {
      this.erneut = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.laeuft = true;
    try {
      do {
        this.erneut = false;
        await this.durchlauf();
      } while (this.erneut);
    } finally {
      this.laeuft = false;
      this.planen();
    }
  }

  private planen() {
    if (!this.aktiv) return;
    this.timer = setTimeout(() => void this.anstossen(), this.abstand);
  }

  /** Ein vollständiger Durchlauf: Senden, dann Abholen. Öffentlich für Tests. */
  async durchlauf(): Promise<void> {
    const { speicher, api, turnier } = this.o;
    let neueDaten = false;
    const basis = this.o.intervallMs ?? 2000;
    try {
      const token = this.o.token();
      let verbindung: Verbindung = 'verbunden';
      let meldung: string | null = null;

      // 1. Senden – ein Block je Durchlauf; die vollständige Bestätigung (mit Autor)
      //    kommt beim Abholen zurück, bis dahin bleibt der Eintrag als „ausstehend“ sichtbar.
      const offen = await speicher.ausstehende(turnier, MAX_EREIGNISSE_JE_AUFRUF);
      if (offen.length > 0 && !token) {
        verbindung = 'nicht_angemeldet';
        meldung = 'Für das Senden ist eine Anmeldung nötig.';
      } else if (offen.length > 0 && token) {
        try {
          await api.senden(
            turnier,
            token,
            offen.map(({ id, art, daten, zeit, geraet }) => ({ id, art, daten, zeit, geraet })),
          );
        } catch (f) {
          if (f instanceof ApiFehler && (f.code === 'nicht_angemeldet' || f.code === 'keine_berechtigung' || f.code === 'gesperrt')) {
            verbindung = 'nicht_angemeldet';
            meldung = f.message;
          } else {
            throw f;
          }
        }
      }

      // 2. Abholen
      let ab = await speicher.abgeholtBis(turnier);
      for (;;) {
        const a = await api.abholen(turnier, ab);
        if (a.ereignisse.length > 0) {
          await speicher.uebernehmen(a.ereignisse.map((e) => ausServer(turnier, e)));
          ab = a.ereignisse[a.ereignisse.length - 1]!.seq;
          await speicher.setzeAbgeholtBis(turnier, ab);
          neueDaten = true;
        }
        if (!a.mehr) break;
      }

      const rest = (await speicher.ausstehende(turnier)).length;
      if (rest > 0 && verbindung === 'verbunden') this.erneut = true; // weitere Blöcke senden
      this.abstand = basis;
      this.setzeStatus({ verbindung, ausstehend: rest, letzterAbgleich: new Date(), meldung }, neueDaten);
    } catch (f) {
      const offline = f instanceof ApiFehler && f.istNetzwerk;
      this.abstand = Math.min(this.abstand * 2, this.o.maxIntervallMs ?? 15_000);
      const rest = (await speicher.ausstehende(turnier)).length;
      this.setzeStatus(
        {
          verbindung: offline ? 'offline' : 'fehler',
          ausstehend: rest,
          letzterAbgleich: this.status.letzterAbgleich,
          meldung: f instanceof Error ? f.message : String(f),
        },
        neueDaten,
      );
    }
  }

  private setzeStatus(s: AbgleichStatus, neueDaten: boolean) {
    this.status = s;
    this.o.beiAenderung?.(s, neueDaten);
  }
}
