import type {
  Aufgabe,
  AnmeldeStatus,
  AnmeldungEinstellungen,
  AnmeldungenAntwort,
  AnmeldungInfo,
  AnmeldungSendenAnfrage,
  AnmeldungStand,
  AbholenAntwort,
  TurnierInfo,
  CodeEintrag,
  CodeRolle,
  CodesAntwort,
  PoolAntwort,
  PoolSpieler,
  FehlerCode,
  InfoAntwort,
  KontenAntwort,
  KontoEinstellungen,
  Konto,
  KontoAnlegenAnfrage,
  LoginAntwort,
  NeuesEreignis,
  OnlineTurnier,
  RegistrierenAnfrage,
  RueckmeldungAnfrage,
  Rolle,
  SendenAntwort,
  SetupAnfrage,
  TurnierAnlegenAnfrage,
  TurnierAnlegenAntwort,
  TurnierAntwort,
  TurniereAntwort,
  TurnierEinstellungen,
  TurnierEinstellungenAnfrage,
  TurnierZugangAntwort,
  ZentraleStatus,
} from '@shared/protokoll';

export interface IchAntwort {
  rolle: Rolle;
  name: string;
  turnier: string | null;
  konto?: Konto | null;
  spieler?: string;
}

export class ApiFehler extends Error {
  constructor(
    public readonly code: FehlerCode | 'netzwerk',
    meldung: string,
    public readonly status = 0,
  ) {
    super(meldung);
  }
  get istNetzwerk() {
    return this.code === 'netzwerk';
  }
}

export type Abruf = (url: string, init: RequestInit) => Promise<Response>;

/** Zugriff auf den Turnier-Server nach shared/protokoll.ts. */
export class Api {
  constructor(
    private readonly basis: string,
    private readonly abruf: Abruf = (u, i) => fetch(u, i),
    private readonly zeitlimitMs = 10_000,
    /** Geheimnis der Zentrale am eigenen Gerät (Kopfzeile X-TT-Zentrale), siehe lib/zentrale.svelte.ts */
    private readonly zentraleGeheimnis: (() => string | null) | null = null,
  ) {}

  private async rufe<T>(
    methode: 'GET' | 'POST',
    route: string,
    opt: {
      query?: Record<string, string>;
      rumpf?: unknown;
      token?: string | null;
    } = {},
    zeitlimitMs = this.zeitlimitMs,
  ): Promise<T> {
    const params = new URLSearchParams({ r: route, ...(opt.query ?? {}) });
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opt.rumpf !== undefined) headers['Content-Type'] = 'application/json';
    if (opt.token) headers['X-TT-Token'] = opt.token;
    const geheimnis = this.zentraleGeheimnis?.();
    if (geheimnis) headers['X-TT-Zentrale'] = geheimnis;

    const abbruch = new AbortController();
    const timer = setTimeout(() => abbruch.abort(), zeitlimitMs);
    let antwort: Response;
    try {
      antwort = await this.abruf(`${this.basis}?${params}`, {
        method: methode,
        headers,
        body: opt.rumpf === undefined ? undefined : JSON.stringify(opt.rumpf),
        signal: abbruch.signal,
        cache: 'no-store',
      });
    } catch {
      throw new ApiFehler('netzwerk', 'Keine Verbindung zum Server.');
    } finally {
      clearTimeout(timer);
    }
    let daten: unknown = null;
    try {
      daten = await antwort.json();
    } catch {
      throw new ApiFehler(antwort.ok ? 'serverfehler' : 'netzwerk', 'Antwort des Servers ist kein JSON.', antwort.status);
    }
    if (!antwort.ok) {
      const f = daten as { fehler?: FehlerCode; meldung?: string };
      throw new ApiFehler(f.fehler ?? 'serverfehler', f.meldung ?? `Fehler ${antwort.status}`, antwort.status);
    }
    return daten as T;
  }

  info() {
    return this.rufe<InfoAntwort>('GET', 'info');
  }
  setup(a: SetupAnfrage) {
    return this.rufe<{ ok: true }>('POST', 'setup', { rumpf: a });
  }
  login(email: string, passwort: string) {
    return this.rufe<LoginAntwort>('POST', 'login', {
      rumpf: { email, passwort },
    });
  }
  logout(token: string) {
    return this.rufe<{ ok: true }>('POST', 'logout', { token });
  }
  ich(token: string) {
    return this.rufe<IchAntwort>('GET', 'ich', { token });
  }
  registrieren(a: RegistrierenAnfrage) {
    return this.rufe<LoginAntwort>('POST', 'registrieren', { rumpf: a });
  }
  passwortVergessen(email: string) {
    return this.rufe<{ ok: true }>('POST', 'passwort.vergessen', {
      rumpf: { email },
    });
  }
  passwortZuruecksetzen(schluessel: string, neu: string) {
    return this.rufe<LoginAntwort>('POST', 'passwort.zuruecksetzen', {
      rumpf: { schluessel, neu },
    });
  }
  kontoLoeschen(token: string, passwort: string) {
    return this.rufe<{ ok: true }>('POST', 'konto.loeschen', {
      token,
      rumpf: { passwort },
    });
  }
  rueckmeldung(token: string | null, a: RueckmeldungAnfrage) {
    return this.rufe<{ ok: true }>('POST', 'rueckmeldung', { token, rumpf: a });
  }
  einstellungen(token: string, id: string) {
    return this.rufe<TurnierEinstellungen>('GET', 'turnier.einstellungen', {
      token,
      query: { id },
    });
  }
  einstellungenSetzen(token: string, a: TurnierEinstellungenAnfrage) {
    return this.rufe<TurnierEinstellungen>('POST', 'turnier.einstellungen', {
      token,
      rumpf: a,
    });
  }
  sichern(token: string, turnier: string) {
    return this.rufe<{
      ok: true;
      gesendetAn: string[];
      zeit: string;
      wartend?: boolean;
      meldung?: string;
    }>('POST', 'turnier.sichern', {
      token,
      rumpf: { turnier },
    });
  }
  passwortAendern(token: string, alt: string, neu: string) {
    return this.rufe<{ ok: true }>('POST', 'passwort.aendern', {
      token,
      rumpf: { alt, neu },
    });
  }
  konten(token: string) {
    return this.rufe<KontenAntwort>('GET', 'konten', { token });
  }
  kontoAnlegen(token: string, a: KontoAnlegenAnfrage) {
    return this.rufe<{ konto: Konto }>('POST', 'konto.anlegen', {
      token,
      rumpf: a,
    });
  }
  /** Admin: Online-Anmeldung für ein Konto (ab 0.12) */
  kontoAnmeldung(token: string, id: number, anmeldung: 'auto' | 'frei' | 'gesperrt') {
    return this.rufe<{ konto: Konto }>('POST', 'konto.anmeldung', { token, rumpf: { id, anmeldung } });
  }
  kontoSperren(token: string, id: number, gesperrt: boolean) {
    return this.rufe<{ konto: Konto }>('POST', 'konto.sperren', {
      token,
      rumpf: { id, gesperrt },
    });
  }
  turniere(token: string, alle = false) {
    return this.rufe<TurniereAntwort>('GET', 'turniere', {
      token,
      query: alle ? { alle: '1' } : {},
    });
  }
  turnierAnlegen(token: string, a: TurnierAnlegenAnfrage) {
    return this.rufe<TurnierAnlegenAntwort>('POST', 'turnier.anlegen', {
      token,
      rumpf: a,
    });
  }
  /** Öffentlich; mit Token steht in turnier.rechte, was diese Anmeldung darf. */
  turnier(id: string, token: string | null = null) {
    return this.rufe<TurnierAntwort>('GET', 'turnier', {
      query: { id },
      token,
    });
  }
  turnierZugang(turnier: string, code: string) {
    return this.rufe<TurnierZugangAntwort>('POST', 'turnier.zugang', {
      rumpf: { turnier, code },
    });
  }
  codes(token: string, turnier: string) {
    return this.rufe<CodesAntwort>('GET', 'codes', {
      token,
      query: { turnier },
    });
  }
  codesAnlegen(token: string, turnier: string, eintraege: { rolle: CodeRolle; bezug: string; name: string; aufgaben?: Aufgabe[] }[]) {
    return this.rufe<CodesAntwort>('POST', 'codes.anlegen', {
      token,
      rumpf: { turnier, eintraege },
    });
  }
  codeNeu(token: string, turnier: string, rolle: CodeRolle, bezug: string) {
    return this.rufe<{ code: CodeEintrag }>('POST', 'code.neu', {
      token,
      rumpf: { turnier, rolle, bezug },
    });
  }
  codeSperren(token: string, turnier: string, rolle: CodeRolle, bezug: string, gesperrt: boolean) {
    return this.rufe<{ code: CodeEintrag }>('POST', 'code.sperren', {
      token,
      rumpf: { turnier, rolle, bezug, gesperrt },
    });
  }
  codeEntfernen(token: string, turnier: string, rolle: CodeRolle, bezug: string) {
    return this.rufe<{ ok: true }>('POST', 'code.entfernen', {
      token,
      rumpf: { turnier, rolle, bezug },
    });
  }
  codeHelfer(token: string, turnier: string, bezug: string, helfer: boolean) {
    return this.rufe<{ code: CodeEintrag }>('POST', 'code.helfer', {
      token,
      rumpf: { turnier, bezug, helfer },
    });
  }
  codeAufgaben(token: string, turnier: string, bezug: string, aufgaben: Aufgabe[]) {
    return this.rufe<{ code: CodeEintrag }>('POST', 'code.aufgaben', {
      token,
      rumpf: { turnier, bezug, aufgaben },
    });
  }
  /* ---------- Online-Anmeldung (ab 0.11) ---------- */
  anmeldungInfo(turnier: string) {
    return this.rufe<AnmeldungInfo>('GET', 'anmeldung', { query: { turnier } });
  }
  anmeldungSenden(a: AnmeldungSendenAnfrage) {
    return this.rufe<{ ok: true; mail: boolean }>('POST', 'anmeldung.senden', { rumpf: a });
  }
  anmeldungBestaetigen(turnier: string, schluessel: string) {
    return this.rufe<AnmeldungStand>('POST', 'anmeldung.bestaetigen', { rumpf: { turnier, schluessel } });
  }
  anmeldungStand(turnier: string, schluessel: string) {
    return this.rufe<AnmeldungStand>('POST', 'anmeldung.stand', { rumpf: { turnier, schluessel } });
  }
  anmeldungAbmelden(turnier: string, schluessel: string, konkurrenz?: string) {
    return this.rufe<AnmeldungStand>('POST', 'anmeldung.abmelden', { rumpf: { turnier, schluessel, ...(konkurrenz ? { konkurrenz } : {}) } });
  }
  anmeldungen(token: string, turnier: string) {
    return this.rufe<AnmeldungenAntwort>('GET', 'anmeldungen', { token, query: { turnier } });
  }
  anmeldungEinstellungen(token: string, turnier: string, e: AnmeldungEinstellungen) {
    return this.rufe<AnmeldungenAntwort>('POST', 'anmeldung.einstellungen', { token, rumpf: { turnier, ...e } });
  }
  anmeldungAendern(token: string, turnier: string, id: string, konkurrenz: string, status: AnmeldeStatus) {
    return this.rufe<AnmeldungenAntwort>('POST', 'anmeldung.aendern', { token, rumpf: { turnier, id, konkurrenz, status } });
  }
  anmeldungUebernommen(token: string, turnier: string, ids: string[]) {
    return this.rufe<{ ok: true }>('POST', 'anmeldung.uebernommen', { token, rumpf: { turnier, ids } });
  }
  anmeldungLoeschen(token: string, turnier: string, id: string) {
    return this.rufe<AnmeldungenAntwort>('POST', 'anmeldung.loeschen', { token, rumpf: { turnier, id } });
  }
  /** Turnier endgültig löschen (Eigentümer-Konto/Admin, mit Passwort) */
  turnierLoeschen(token: string, turnier: string, passwort: string) {
    return this.rufe<{ ok: true }>('POST', 'turnier.loeschen', {
      token,
      rumpf: { turnier, passwort },
    });
  }
  kontoEinstellungen(token: string) {
    return this.rufe<KontoEinstellungen>('GET', 'konto.einstellungen', {
      token,
    });
  }
  kontoEinstellungenSetzen(token: string, a: Partial<KontoEinstellungen>) {
    return this.rufe<KontoEinstellungen>('POST', 'konto.einstellungen', {
      token,
      rumpf: a,
    });
  }
  pool(token: string) {
    return this.rufe<PoolAntwort>('GET', 'pool', { token });
  }
  poolSpeichern(token: string, spieler: PoolSpieler[]) {
    return this.rufe<PoolAntwort>('POST', 'pool.speichern', {
      token,
      rumpf: { spieler },
    });
  }
  poolLoeschen(token: string, ids: string[]) {
    return this.rufe<{ ok: true }>('POST', 'pool.loeschen', {
      token,
      rumpf: { ids },
    });
  }
  uebersicht(token: string, turnier: string, text: string) {
    return this.rufe<{ ok: true }>('POST', 'turnier.uebersicht', {
      token,
      rumpf: { turnier, text },
    });
  }
  /* ---------- nur Android-Zentrale, nur vom Gerät der Zentrale ---------- */
  zentraleAnmelden() {
    return this.rufe<LoginAntwort>('POST', 'zentrale.anmelden', { rumpf: {} });
  }
  zentraleStatus() {
    return this.rufe<ZentraleStatus>('GET', 'zentrale.status');
  }
  zentraleWlan(ssid: string, passwort: string) {
    return this.rufe<ZentraleStatus>('POST', 'zentrale.wlan', {
      rumpf: { ssid, passwort },
    });
  }
  zentraleHotspot(an: boolean) {
    return this.rufe<ZentraleStatus>('POST', 'zentrale.hotspot', {
      rumpf: { an },
    });
  }
  zentraleOeffnen(ziel: 'hotspot' | 'akku' | 'wlan') {
    return this.rufe<{ ok: boolean }>('POST', 'zentrale.oeffnen', {
      rumpf: { ziel },
    });
  }
  zentraleOnlineAnmelden(email: string, passwort: string, url?: string) {
    return this.rufe<ZentraleStatus>('POST', 'zentrale.online.anmelden', { rumpf: { email, passwort, url } }, 30_000);
  }
  zentraleOnlineAbmelden() {
    return this.rufe<ZentraleStatus>('POST', 'zentrale.online.abmelden', {
      rumpf: {},
    });
  }
  zentraleOnlineTurniere() {
    return this.rufe<{ turniere: OnlineTurnier[] }>('GET', 'zentrale.online.turniere', {}, 30_000);
  }
  zentraleUebernehmen(turnier: string, erzwingen = false) {
    return this.rufe<{ turnier: TurnierInfo; neu: number }>('POST', 'zentrale.uebernehmen', { rumpf: { turnier, erzwingen } }, 120_000);
  }
  zentraleRueckgabe(turnier: string) {
    return this.rufe<{ turnier: TurnierInfo; gesendet: number }>('POST', 'zentrale.rueckgabe', { rumpf: { turnier } }, 120_000);
  }
  zentralePoolAbgleichen() {
    return this.rufe<{ ok: true; hochgeladen: number; anzahl: number }>('POST', 'zentrale.pool.abgleichen', { rumpf: {} }, 60_000);
  }
  zentraleSicherungenSenden() {
    return this.rufe<ZentraleStatus>('POST', 'zentrale.sicherungen.senden', { rumpf: {} }, 60_000);
  }
  zentraleTurnierLoeschen(turnier: string, trotzdem = false) {
    return this.rufe<{ ok: true }>('POST', 'zentrale.turnier.loeschen', {
      rumpf: { turnier, trotzdem },
    });
  }

  /** Mit Token (Leitung, Helfer, Spieler) kommt alles, ohne nur die Zuschauer-Sicht (siehe AbholenAntwort.sicht) */
  abholen(turnier: string, ab: number, token: string | null = null) {
    return this.rufe<AbholenAntwort>('GET', 'events', {
      query: { turnier, ab: String(ab) },
      token,
    });
  }
  senden(turnier: string, token: string, ereignisse: NeuesEreignis[]) {
    return this.rufe<SendenAntwort>('POST', 'events', {
      token,
      query: { turnier },
      rumpf: { ereignisse },
    });
  }
}
