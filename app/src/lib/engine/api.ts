import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
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
  SparteAntwort,
  Sparte,
  SparteKurz,
  AusschussKurz,
  SparteRolle,
  EinladenAntwort,
  EinladungInfo,
  AusschussAntwort,
  TurnierKontenAntwort,
  PartnerAntwort,
  KontoLoeschenAnfrage,
  ErgebnisAnfrage,
  GruppenAnmeldungAnfrage,
  ErgebnisAntwort,
  PostfachAntwort,
  RundmailAnfrage,
  RundmailAntwort,
  VerteilerAntwort,
  VerteilerEintragenAnfrage,
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
    public readonly pauseMs = 0,
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
    const daten = await antwort.json().catch(() => null);
    if (!antwort.ok) {
      const f = daten as { fehler?: FehlerCode; meldung?: string } | null;
      const nach = antwort.headers.get('retry-after') ?? '';
      const pause = /^\d+$/.test(nach) ? Number(nach) * 1000 : Date.parse(nach) - Date.now();
      const code = antwort.status === 429 ? 'zu_viele_versuche' : antwort.status === 413 ? 'zu_gross' : f?.fehler ?? 'serverfehler';
      throw new ApiFehler(code, f?.meldung ?? `Fehler ${antwort.status}`, antwort.status, Number.isFinite(pause) ? Math.max(0, pause) : 0);
    }
    if (daten === null) throw new ApiFehler('serverfehler', 'Antwort des Servers ist kein JSON.', antwort.status);
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
  async registrierlink(email: string, einladung: string | null, website: string) {
    const { aufgabe } = await this.rufe<{ aufgabe: string }>('GET', 'registrieraufgabe');
    let nonce = 0;
    for (;;) {
      const hash = sha256(utf8ToBytes(aufgabe + ':' + nonce));
      if (hash[0] === 0 && hash[1]! < 16) break;
      if (++nonce % 256 === 0) await new Promise((fertig) => setTimeout(fertig, 0));
    }
    return this.rufe<{ ok: true }>('POST', 'registrierlink', { rumpf: { email, einladung: einladung ?? '', website, aufgabe, nonce } });
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
  /** Ab 0.17: Nutzungsbedingungen (mit AVV) annehmen */
  bedingungenAnnehmen(token: string) {
    return this.rufe<Konto>('POST', 'konto.bedingungen', { token, rumpf: { zustimmung: true, volljaehrig: true } });
  }
  /* ---------- Sparten, Einladungen, Ausschüsse (ab 0.17) ---------- */
  sparte(token: string, id: number) {
    return this.rufe<SparteAntwort>('GET', 'sparte', { token, query: { id: String(id) } });
  }
  sparten(token: string) {
    return this.rufe<{ sparten: Sparte[] }>('GET', 'sparten', { token });
  }
  sparteAnlegen(token: string, verein: string, name: string) {
    return this.rufe<{ sparte: Sparte; sparten: SparteKurz[]; ausschuesse: AusschussKurz[] }>('POST', 'sparte.anlegen', { token, rumpf: { verein, name, avv: true } });
  }
  sparteAendern(token: string, sparte: number, a: { name?: string; verein?: string; avv?: true }) {
    return this.rufe<{ sparte: Sparte }>('POST', 'sparte.aendern', { token, rumpf: { sparte, ...a } });
  }
  sparteAnmeldung(token: string, id: number, anmeldung: 'auto' | 'frei' | 'gesperrt') {
    return this.rufe<{ sparte: Sparte }>('POST', 'sparte.anmeldung', { token, rumpf: { id, anmeldung } });
  }
  sparteLoeschen(token: string, sparte: number, passwort: string) {
    return this.rufe<{ ok: true; sparten: SparteKurz[]; ausschuesse: AusschussKurz[] }>('POST', 'sparte.loeschen', { token, rumpf: { sparte, passwort } });
  }
  sparteEinladen(token: string, sparte: number, email: string, name: string, rolle: SparteRolle, anlegen: boolean) {
    return this.rufe<EinladenAntwort>('POST', 'sparte.einladen', { token, rumpf: { sparte, email, name, rolle, anlegen } });
  }
  turnierEinladen(token: string, turnier: string, email: string, name: string) {
    return this.rufe<EinladenAntwort & TurnierKontenAntwort>('POST', 'sparte.einladen', { token, rumpf: { turnier, email, name } });
  }
  einladungInfo(schluessel: string) {
    return this.rufe<{ einladung: EinladungInfo }>('POST', 'einladung.info', { rumpf: { schluessel } });
  }
  einladungAnnehmen(token: string, schluessel: string) {
    return this.rufe<{ ok: true; art: string; turnier?: string; ausschuss?: number; sparte?: number; sparten: SparteKurz[]; ausschuesse: AusschussKurz[] }>(
      'POST', 'einladung.annehmen', { token, rumpf: { schluessel } });
  }
  einladungZurueckziehen(token: string, id: string) {
    return this.rufe<{ ok: true }>('POST', 'einladung.zurueckziehen', { token, rumpf: { id } });
  }
  mitgliedAendern(token: string, sparte: number, konto: number, a: { rolle?: SparteRolle; anlegen?: boolean }) {
    return this.rufe<SparteAntwort>('POST', 'mitglied.aendern', { token, rumpf: { sparte, konto, ...a } });
  }
  mitgliedEntfernen(token: string, sparte: number, konto: number) {
    return this.rufe<SparteAntwort & { ok?: true }>('POST', 'mitglied.entfernen', { token, rumpf: { sparte, konto } });
  }
  turnierKonten(token: string, turnier: string) {
    return this.rufe<TurnierKontenAntwort>('GET', 'turnier.konten', { token, query: { id: turnier } });
  }
  turnierKontoEntfernen(token: string, turnier: string, konto: number) {
    return this.rufe<TurnierKontenAntwort>('POST', 'turnier.konto.entfernen', { token, rumpf: { turnier, konto } });
  }
  ausschuss(token: string, id: number) {
    return this.rufe<AusschussAntwort>('GET', 'ausschuss', { token, query: { id: String(id) } });
  }
  ausschussAnlegen(token: string, sparte: number, name: string) {
    return this.rufe<AusschussAntwort>('POST', 'ausschuss.anlegen', { token, rumpf: { sparte, name } });
  }
  ausschussEinladen(token: string, ausschuss: number, email: string, name: string) {
    return this.rufe<AusschussAntwort & EinladenAntwort>('POST', 'ausschuss.einladen', { token, rumpf: { ausschuss, email, name } });
  }
  ausschussSperren(token: string, ausschuss: number, konto: number, gesperrt: boolean) {
    return this.rufe<AusschussAntwort>('POST', 'ausschuss.sperren', { token, rumpf: { ausschuss, konto, gesperrt } });
  }
  ausschussVerlassen(token: string, ausschuss: number) {
    return this.rufe<{ ok: true; sparten: SparteKurz[]; ausschuesse: AusschussKurz[] }>('POST', 'ausschuss.verlassen', { token, rumpf: { ausschuss } });
  }
  ausschussNachricht(token: string, ausschuss: number, text: string) {
    return this.rufe<AusschussAntwort>('POST', 'ausschuss.nachricht', { token, rumpf: { ausschuss, text } });
  }
  ausschussLoeschen(token: string, ausschuss: number) {
    return this.rufe<{ ok: true }>('POST', 'ausschuss.loeschen', { token, rumpf: { ausschuss } });
  }
  veranstaltungAnlegen(token: string, sparte: number, name: string, datum: string | null, ausschuss: number | null) {
    return this.rufe<SparteAntwort>('POST', 'veranstaltung.anlegen', { token, rumpf: { sparte, name, datum, ausschuss } });
  }
  veranstaltungLoeschen(token: string, sparte: number, id: number) {
    return this.rufe<SparteAntwort>('POST', 'veranstaltung.loeschen', { token, rumpf: { sparte, id } });
  }
  sicherungBestaetigen(turnier: string, schluessel: string) {
    return this.rufe<{ ok: true; email: string; turnier: string }>('POST', 'sicherung.bestaetigen', { rumpf: { turnier, schluessel } });
  }
  anmeldungPartner(turnier: string, schluessel: string, antwort?: 'ja' | 'nein', volljaehrig?: boolean) {
    return this.rufe<PartnerAntwort>('POST', 'anmeldung.partner', { rumpf: { turnier, schluessel, ...(antwort ? { antwort } : {}), ...(volljaehrig ? { volljaehrig } : {}) } });
  }
  kontoLoeschen(token: string, passwort: string, sparteLoeschen = false) {
    return this.rufe<{ ok: true }>('POST', 'konto.loeschen', {
      token,
      rumpf: { passwort, ...(sparteLoeschen ? { sparteLoeschen } : {}) } satisfies KontoLoeschenAnfrage,
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
  anmeldungSenden(a: AnmeldungSendenAnfrage | GruppenAnmeldungAnfrage) {
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
  anmeldungAendern(token: string, turnier: string, id: string, konkurrenz: string, status: AnmeldeStatus, eintrag?: number) {
    return this.rufe<AnmeldungenAntwort>('POST', 'anmeldung.aendern', { token, rumpf: { turnier, id, konkurrenz, status, ...(eintrag !== undefined ? { eintrag } : {}) } });
  }
  anmeldungUebernommen(token: string, turnier: string, ids: string[]) {
    return this.rufe<{ ok: true }>('POST', 'anmeldung.uebernommen', { token, rumpf: { turnier, ids } });
  }
  anmeldungLoeschen(token: string, turnier: string, id: string) {
    return this.rufe<AnmeldungenAntwort>('POST', 'anmeldung.loeschen', { token, rumpf: { turnier, id } });
  }
  /* ---------- Favoriten der Sparte (ab 0.18) ---------- */
  favoriten(token: string, sparte: number) {
    return this.rufe<{ favoriten: { name: string; einst: Record<string, unknown> }[] }>('GET', 'sparte.favoriten', { token, query: { sparte: String(sparte) } });
  }
  favoritenSpeichern(token: string, sparte: number, favoriten: { name: string; einst: Record<string, unknown> }[]) {
    return this.rufe<{ favoriten: { name: string; einst: Record<string, unknown> }[] }>('POST', 'sparte.favoriten', { token, rumpf: { sparte, favoriten } });
  }
  /* ---------- Nachrichten (ab 0.18) ---------- */
  postfach(token: string, turnier: string) {
    return this.rufe<PostfachAntwort>('GET', 'nachrichten', { token, query: { turnier } });
  }
  postfachGelesen(token: string, turnier: string, bis: number) {
    return this.rufe<{ ok: true }>('POST', 'nachrichten.gelesen', { token, rumpf: { turnier, bis } });
  }
  rundmail(token: string, a: RundmailAnfrage) {
    return this.rufe<RundmailAntwort>('POST', 'rundmail', { token, rumpf: a });
  }
  ergebnisSenden(token: string, a: ErgebnisAnfrage) {
    return this.rufe<ErgebnisAntwort>('POST', 'turnier.ergebnis', { token, rumpf: a }, 30_000);
  }
  verteilerEintragen(a: VerteilerEintragenAnfrage) {
    return this.rufe<{ ok: true }>('POST', 'verteiler.eintragen', { rumpf: a });
  }
  verteilerBestaetigen(schluessel: string) {
    return this.rufe<{ verein: string; sparte: string; abmelden: string }>('POST', 'verteiler.bestaetigen', { rumpf: { schluessel } });
  }
  verteilerAbmelden(kennung: string) {
    return this.rufe<{ ok: true }>('POST', 'verteiler.abmelden', { rumpf: { kennung } });
  }
  verteiler(token: string, sparte: number) {
    return this.rufe<VerteilerAntwort>('GET', 'verteiler', { token, query: { sparte: String(sparte) } });
  }
  verteilerEntfernen(token: string, sparte: number, id: string) {
    return this.rufe<VerteilerAntwort>('POST', 'verteiler.entfernen', { token, rumpf: { sparte, id } });
  }
  verteilerSenden(token: string, sparte: number, betreff: string, text: string) {
    return this.rufe<{ mails: number }>('POST', 'verteiler.senden', { token, rumpf: { sparte, betreff, text } });
  }
  /** Turnier endgültig löschen (Eigentümer-Konto/Admin, mit Passwort) */
  turnierLoeschen(token: string, turnier: string, passwort: string) {
    return this.rufe<{ ok: true }>('POST', 'turnier.loeschen', {
      token,
      rumpf: { turnier, passwort },
    });
  }
  /** Ab 0.17 je Sparte (ohne sparte: erste Sparte des Kontos; die Zentrale kennt keine Sparten) */
  kontoEinstellungen(token: string, sparte: number | null = null) {
    return this.rufe<KontoEinstellungen>('GET', 'konto.einstellungen', {
      token,
      ...(sparte ? { query: { sparte: String(sparte) } } : {}),
    });
  }
  kontoEinstellungenSetzen(token: string, a: Partial<KontoEinstellungen>, sparte: number | null = null) {
    return this.rufe<KontoEinstellungen>('POST', 'konto.einstellungen', {
      token,
      rumpf: { ...a, ...(sparte ? { sparte } : {}) },
    });
  }
  pool(token: string, sparte: number | null = null) {
    return this.rufe<PoolAntwort>('GET', 'pool', { token, ...(sparte ? { query: { sparte: String(sparte) } } : {}) });
  }
  poolSpeichern(token: string, spieler: PoolSpieler[], sparte: number | null = null) {
    return this.rufe<PoolAntwort>('POST', 'pool.speichern', {
      token,
      rumpf: { spieler, ...(sparte ? { sparte } : {}) },
    });
  }
  poolLoeschen(token: string, ids: string[], sparte: number | null = null) {
    return this.rufe<{ ok: true }>('POST', 'pool.loeschen', {
      token,
      rumpf: { ids, ...(sparte ? { sparte } : {}) },
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
