import type {
  AbholenAntwort,
  FehlerCode,
  InfoAntwort,
  KontenAntwort,
  Konto,
  KontoAnlegenAnfrage,
  LoginAntwort,
  NeuesEreignis,
  SendenAntwort,
  SetupAnfrage,
  TurnierAnlegenAnfrage,
  TurnierAnlegenAntwort,
  TurnierAntwort,
  TurniereAntwort,
  TurnierZugangAntwort,
} from '@shared/protokoll';

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
  ) {}

  private async rufe<T>(
    methode: 'GET' | 'POST',
    route: string,
    opt: { query?: Record<string, string>; rumpf?: unknown; token?: string | null } = {},
  ): Promise<T> {
    const params = new URLSearchParams({ r: route, ...(opt.query ?? {}) });
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opt.rumpf !== undefined) headers['Content-Type'] = 'application/json';
    if (opt.token) headers['X-TT-Token'] = opt.token;

    const abbruch = new AbortController();
    const timer = setTimeout(() => abbruch.abort(), this.zeitlimitMs);
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
    return this.rufe<LoginAntwort>('POST', 'login', { rumpf: { email, passwort } });
  }
  logout(token: string) {
    return this.rufe<{ ok: true }>('POST', 'logout', { token });
  }
  passwortAendern(token: string, alt: string, neu: string) {
    return this.rufe<{ ok: true }>('POST', 'passwort.aendern', { token, rumpf: { alt, neu } });
  }
  konten(token: string) {
    return this.rufe<KontenAntwort>('GET', 'konten', { token });
  }
  kontoAnlegen(token: string, a: KontoAnlegenAnfrage) {
    return this.rufe<{ konto: Konto }>('POST', 'konto.anlegen', { token, rumpf: a });
  }
  kontoSperren(token: string, id: number, gesperrt: boolean) {
    return this.rufe<{ konto: Konto }>('POST', 'konto.sperren', { token, rumpf: { id, gesperrt } });
  }
  turniere(token: string, alle = false) {
    return this.rufe<TurniereAntwort>('GET', 'turniere', { token, query: alle ? { alle: '1' } : {} });
  }
  turnierAnlegen(token: string, a: TurnierAnlegenAnfrage) {
    return this.rufe<TurnierAnlegenAntwort>('POST', 'turnier.anlegen', { token, rumpf: a });
  }
  turnier(id: string) {
    return this.rufe<TurnierAntwort>('GET', 'turnier', { query: { id } });
  }
  turnierZugang(turnier: string, passwort: string, name: string) {
    return this.rufe<TurnierZugangAntwort>('POST', 'turnier.zugang', { rumpf: { turnier, passwort, name } });
  }
  abholen(turnier: string, ab: number) {
    return this.rufe<AbholenAntwort>('GET', 'events', { query: { turnier, ab: String(ab) } });
  }
  senden(turnier: string, token: string, ereignisse: NeuesEreignis[]) {
    return this.rufe<SendenAntwort>('POST', 'events', { token, query: { turnier }, rumpf: { ereignisse } });
  }
}
