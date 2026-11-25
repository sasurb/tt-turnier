import { MAX_EREIGNISSE_JE_AUFRUF } from '@shared/protokoll';
import { Api, ApiFehler } from './api';
import type { EreignisSpeicher, GespeicherteSicht } from './speicher';
import { eigeneAktion, sitzungsbindung } from './sitzungsbindung';
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
  speicherFuer?: (token: string | null) => EreignisSpeicher;
  api: Api;
  turnier: string;
  /** Liefert das aktuelle Schreib-Token oder null (dann nur Abholen, z. B. Zuschauer). */
  token: () => string | null;
  intervallMs?: number;
  maxIntervallMs?: number;
  /** Wird nach jeder Änderung an Daten oder Status aufgerufen. */
  beiAenderung?: (status: AbgleichStatus, neueDaten: boolean) => void;
  /**
   * Das Token gilt nicht mehr für dieses Turnier (Kennung gesperrt/neu ausgegeben, Konto gesperrt,
   * Anmeldung abgelaufen): Der Server liefert nur noch die Zuschauer-Sicht. Der Bestand bleibt dann
   * unverändert; die Oberfläche soll die Anmeldung zurücknehmen.
   */
  beiRechteVerlust?: () => void;
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
  private sendePauseBis = 0;
  private blockGroesse = MAX_EREIGNISSE_JE_AUFRUF;
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
    const { api, turnier } = this.o;
    const token = this.o.token();
    const speicher = this.o.speicherFuer?.(token) ?? this.o.speicher;
    let neueDaten = false;
    const basis = this.o.intervallMs ?? 2000;
    try {
      let verbindung: Verbindung = 'verbunden';
      let meldung: string | null = null;

      // 1. Senden – ein Block je Durchlauf; die vollständige Bestätigung (mit Autor)
      //    kommt beim Abholen zurück, bis dahin bleibt der Eintrag als „ausstehend“ sichtbar.
      const bindung = sitzungsbindung(token);
      const wartend = await speicher.ausstehende(turnier);
      const offen = wartend.filter((e) => eigeneAktion(e, bindung)).slice(0, this.blockGroesse);
      if (!token && wartend.some((e) => e.sitzung === null)) {
        verbindung = 'nicht_angemeldet';
        meldung = 'Für das Senden ist eine Anmeldung nötig.';
      } else if (offen.length > 0 && token && Date.now() >= this.sendePauseBis) {
        try {
          const antwort = await api.senden(
            turnier,
            token,
            offen.map(({ id, art, daten, zeit, geraet }) => ({ id, art, daten, zeit, geraet })),
          );
          this.sendePauseBis = 0;
          // Einzelne Einträge abgelehnt (ab Server 0.11): markieren statt die ganze Warteschlange zu blockieren
          if (antwort.abgelehnt?.length) {
            await speicher.ablehnen(turnier, antwort.abgelehnt.map((x) => ({ id: x.id, meldung: x.meldung })));
            meldung = antwort.abgelehnt.length === 1 ? `Ein Eintrag wurde abgelehnt: ${antwort.abgelehnt[0]!.meldung}` : `${antwort.abgelehnt.length} Einträge wurden abgelehnt.`;
            neueDaten = true;
          }
        } catch (f) {
          if (f instanceof ApiFehler && (f.code === 'nicht_angemeldet' || f.code === 'keine_berechtigung' || f.code === 'gesperrt')) {
            verbindung = 'nicht_angemeldet';
            meldung = f.message;
          } else if (f instanceof ApiFehler && f.code === 'zu_gross') {
            if (offen.length === 1) {
              await speicher.ablehnen(turnier, [{ id: offen[0]!.id, meldung: f.message }]);
              neueDaten = true;
            } else {
              this.blockGroesse = Math.ceil(offen.length / 2);
            }
            meldung = f.message;
          } else if (f instanceof ApiFehler && f.code === 'zu_viele_versuche') {
            this.abstand = Math.min(this.abstand * 2, this.o.maxIntervallMs ?? 15_000);
            this.sendePauseBis = Date.now() + Math.max(this.abstand, f.pauseMs);
            meldung = f.message;
          } else {
            throw f;
          }
        }
      }

      // 2. Abholen – mit Token kommt die volle Sicht, ohne die Zuschauer-Sicht (Datenschutz).
      //    Ändert sich die Sicht (angemeldet, abgemeldet, Kurzform umgestellt), wird alles neu abgeholt.
      let ab = await speicher.abgeholtBis(turnier);
      let neuAufbauten = 0;
      let rechteWeg = false;
      for (;;) {
        const a = await api.abholen(turnier, ab, token);
        if (a.sicht && token && (a.sicht === 'zuschauer' || a.sicht === 'kurz')) {
          // Mit Token, aber ohne Rechte: nichts Gefiltertes übernehmen (der Bestand bleibt vollständig)
          rechteWeg = true;
          break;
        }
        if (a.sicht) {
          const bisher = await speicher.sicht(turnier);
          // Ab 0.12 gehört die Filter-Kennung (entfernte Spieler) zur Sicht: ändert sie sich, wird neu abgeholt
          const kennung: GespeicherteSicht = a.filter ? `${a.sicht}|${a.filter}` : a.sicht;
          if (bisher !== kennung) {
            // Alter Bestand ohne Angabe stammt von einer Version, die immer alles lieferte
            if (ab > 0 && !(bisher === null && a.sicht === 'voll')) {
              // Wechselt die Sicht mitten im Neuaufbau noch einmal, von vorn; nach 3 Versuchen beim nächsten Durchlauf
              if (++neuAufbauten > 3) throw new Error('Die Sicht auf das Turnier hat sich mehrfach geändert.');
              // Erst verwerfen, dann die neue Sicht merken: Bricht die App dazwischen ab, bleibt die alte Kennung
              // stehen und der Neuaufbau wird beim nächsten Mal nachgeholt
              await speicher.bestaetigteVerwerfen(turnier);
              await speicher.setzeSicht(turnier, kennung);
              ab = 0;
              neueDaten = true;
              continue;
            }
            await speicher.setzeSicht(turnier, kennung);
          }
        }
        if (a.ereignisse.length > 0) {
          await speicher.uebernehmen(a.ereignisse.map((e) => ausServer(turnier, e)));
          neueDaten = true;
        }
        // Lesestand: ab 0.11 meldet der Server, bis wohin er gelesen hat (auch wenn er gefilterte Einträge weglässt)
        const bis = Math.max(ab, a.bis ?? 0, a.ereignisse.length ? a.ereignisse[a.ereignisse.length - 1]!.seq : 0);
        if (bis > ab) {
          ab = bis;
          await speicher.setzeAbgeholtBis(turnier, ab);
        } else if (a.mehr) {
          throw new Error('Der Server meldet weitere Einträge, liefert aber keine.');
        }
        if (!a.mehr) break;
      }

      if (rechteWeg) {
        verbindung = 'nicht_angemeldet';
        meldung = 'Die Anmeldung gilt für dieses Turnier nicht mehr.';
        if (token === this.o.token()) this.o.beiRechteVerlust?.();
      }
      const aktuelleBindung = sitzungsbindung(this.o.token());
      const rest = (await speicher.ausstehende(turnier)).filter((e) => eigeneAktion(e, aktuelleBindung)).length;
      if (rest > 0 && verbindung === 'verbunden' && Date.now() >= this.sendePauseBis) this.erneut = true; // weitere Blöcke senden
      if (this.sendePauseBis === 0) this.abstand = basis;
      this.setzeStatus({ verbindung, ausstehend: rest, letzterAbgleich: new Date(), meldung }, neueDaten);
    } catch (f) {
      const offline = f instanceof ApiFehler && f.istNetzwerk;
      this.abstand = Math.min(this.abstand * 2, this.o.maxIntervallMs ?? 15_000);
      const aktuelleBindung = sitzungsbindung(this.o.token());
      const rest = (await speicher.ausstehende(turnier)).filter((e) => eigeneAktion(e, aktuelleBindung)).length;
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
