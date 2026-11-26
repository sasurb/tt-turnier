<script lang="ts">
  import { setzeAktiveSparte } from '../sparte.svelte';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { ALLE_AUFGABEN, ART, HELFER_STANDARD, type Aufgabe, type Rolle, type TurnierEinstellungen as Einstellungen } from '@shared/protokoll';
  import { T } from '../texte';
  import { ersetze, linkZu } from '../router.svelte';
  import { api, serverPruefen, speicher } from '../dienste';
  import { app, fehlerText } from '../app.svelte';
  import { ApiFehler } from '../engine/api';
  import { TurnierSitzung } from '../engine/turnier';
  import { SitzungsSpeicher } from '../engine/speicher';
  import { identitaetsbindung, sitzungsbindung } from '../engine/sitzungsbindung';
  import type { AbgleichStatus } from '../engine/abgleich';
  import type { LokalesEreignis } from '../engine/typen';
  import { berechnen, fristgebundeneAktion, nachTurnierende, type TurnierZustand } from '../engine/zustand';
  import { spielErgebnisText, name as spName } from '../engine/abfragen';
  import type { Spiel } from '../engine/modell';
  import { uebersichtText } from '../engine/uebersicht';
  import { anzeigeName, kontoSitzung, geraetId, gemerktesTurnier, turnierAbmelden, turnierMerken, type GemerktesTurnier } from '../einstellungen';
  import { codeAnzeige } from '../code';
  import { appBasis } from '../zentrale.svelte';
  import { nativ } from '../nativ';
  import { dateiAusgeben, erinnerungFaellig, lokaleSicherung, setzeLokaleSicherung, sicherungAusgeben, sicherungErstellen } from '../sicherung';
  import { etwasVerdeckt } from '../engine/abfragen';
  import { MAX_JE_RUECKNAHME, rueckgaengigBar, rueckgaengigPruefen } from '../engine/verlauf';
  import { aktuelleAktion } from '../aktion';
  import StatusAnzeige from './StatusAnzeige.svelte';
  import Hilfe from './Hilfe.svelte';
  import TurnierEinstellungen from './TurnierEinstellungen.svelte';
  import SpieleListe from './turnier/SpieleListe.svelte';
  import Tabellen from './turnier/Tabellen.svelte';
  import SpielerTab from './turnier/SpielerTab.svelte';
  import TeilnehmerJeKonkurrenz from './turnier/TeilnehmerJeKonkurrenz.svelte';
  import AppWertung from './turnier/AppWertung.svelte';
  import PoolVerwaltung from './PoolVerwaltung.svelte';
  import KonkurrenzenTab from './turnier/KonkurrenzenTab.svelte';
  import Zugaenge from './turnier/Zugaenge.svelte';
  import Mitmachen from './turnier/Mitmachen.svelte';
  import ErgebnisDialog from './turnier/ErgebnisDialog.svelte';
  import BegegnungDialog from './turnier/BegegnungDialog.svelte';
  import QrCode from './turnier/QrCode.svelte';
  import Tische from './turnier/Tische.svelte';
  import DruckExport from './turnier/DruckExport.svelte';
  import KasseTab from './turnier/KasseTab.svelte';
  import AnmeldungTab from './turnier/AnmeldungTab.svelte';
  import Postfach from './turnier/Postfach.svelte';
  import Rundmail from './turnier/Rundmail.svelte';
  import MitteilungKarte from './turnier/MitteilungKarte.svelte';
  import { meinAufruf, name as tnName } from '../engine/abfragen';
  import { appHinweisAn, neueAnmeldungen } from '../anmeldeHinweis';
  import { benachrichtigen, mitteilungEinstellung, wachHalten, wachHaltenErneuern, type MitteilungEinstellung } from '../mitteilung';

  let { id, reiter = null, code = null, weitere = [] }: { id: string; reiter?: string | null; code?: string | null; weitere?: string[] } = $props();

  const lokal = $derived(id.startsWith('l'));
  let eintrag = $state<GemerktesTurnier | null>(null);
  let sitzung: TurnierSitzung | null = null;
  let wechsel = $state(false);
  let fehler = $state('');
  let laedt = $state(true);
  let zustand = $state<TurnierZustand | null>(null);
  let ereignisse = $state<LokalesEreignis[]>([]);
  let status = $state<AbgleichStatus | null>(null);
  let einst = $state<Einstellungen | null>(null);
  let hinweis = $state(app.hinweis);
  app.hinweis = null;

  let zugangFehler = $state('');
  let kopiert = $state<'' | 'link' | 'code'>('');
  let qrOffen = $state(false);
  let jetzt = $state(Date.now());
  let offen = $state<{ k: string; s: string } | null>(null);

  /**
   * Rechte des Kontos für dieses Turnier (Eigentümer oder Administrator → „leitung“). Der Server
   * prüft das beim Öffnen; nach „Abmelden“ fällt es sofort weg, weil das Konto-Token nie am
   * Turnier gespeichert wird.
   */
  let bestaetigteKontoRechte = $state<Rolle | null>(null);
  let kontoIdentitaet = $state<string | null>(null);
  let rechteFuer = $state('');
  let zerstoert = false;
  const kontoRechte = $derived(app.sitzung?.token === rechteFuer ? bestaetigteKontoRechte : null);
  const kontoToken = $derived(kontoRechte && app.sitzung ? app.sitzung.token : null);
  /** Turnierinfo vom Server holen; mit Konto-Token auch die Rechte dieses Kontos */
  async function infoLaden() {
    const s = app.sitzung;
    const kennung = eintrag?.token ?? null;
    let ersteAbfrage = true;
    try {
      // Mit Kennung: prüfen, ob sie noch gilt (gesperrt/neu ausgegeben → Gerät wird Zuschauer)
      const a = await api.turnier(id, kennung ?? s?.token ?? null);
      ersteAbfrage = false;
      if (kennung !== (eintrag?.token ?? null) || zerstoert || wechsel || s !== app.sitzung) return;
      // Name und Datum kennt bei Online-Turnieren der Server (ohne Ereignis turnier.angelegt)
      if (eintrag && (a.turnier.name !== eintrag.name || a.turnier.datum !== eintrag.datum)) {
        turnierMerken({ ...eintrag, name: a.turnier.name, datum: a.turnier.datum });
        eintrag = gemerktesTurnier(id) ?? eintrag;
        if (zustand) zustand = mitKopf(berechnen(ereignisse));
      }
      sperre = a.turnier.zentrale || a.turnier.abgegeben ? { zentrale: a.turnier.zentrale ?? null, abgegeben: !!a.turnier.abgegeben } : null;
      // Pool, Klassen und Kasse-Vorgaben gehören der Sparte des Turniers (ab 0.17)
      setzeAktiveSparte(a.turnier.sparte);
      if (kennung) {
        if (a.turnier.rechte === null || a.turnier.rechte === undefined) {
          turnierAbmelden(id);
          eintrag = gemerktesTurnier(id) ?? null;
          zugangFehler = T.zugang.kennungUngueltig;
        } else {
          const aktuell = a.turnier.identitaet
            ? { bezug: a.turnier.identitaet, tokenHash: sitzungsbindung(kennung)! }
            : null;
          if (eintrag && (eintrag.kennungIdentitaet?.bezug !== aktuell?.bezug || eintrag.kennungIdentitaet?.tokenHash !== aktuell?.tokenHash)) {
            turnierMerken({ ...eintrag, kennungIdentitaet: aktuell });
            eintrag = gemerktesTurnier(id) ?? null;
          }
        }
        if (a.turnier.rechte === 'helfer' && a.turnier.aufgaben && eintrag && JSON.stringify(a.turnier.aufgaben) !== JSON.stringify(eintrag.aufgaben)) {
          // Aufgaben hat die Leitung geändert: gelten sofort
          turnierMerken({ ...eintrag, aufgaben: a.turnier.aufgaben });
          eintrag = gemerktesTurnier(id) ?? null;
          const identitaet = a.turnier.identitaet;
          if (identitaet) await new SitzungsSpeicher(speicher, identitaetsbindung(identitaet)).bestaetigteVerwerfen(id);
        }
        if (s) {
          const k = await api.turnier(id, s.token);
          if (zerstoert || wechsel || s !== app.sitzung) return;
          bestaetigteKontoRechte = k.turnier.rechte ?? null;
          kontoIdentitaet = k.turnier.identitaet ?? null;
        } else {
          bestaetigteKontoRechte = null;
          kontoIdentitaet = null;
        }
      } else {
        bestaetigteKontoRechte = s ? (a.turnier.rechte ?? null) : null;
        kontoIdentitaet = s ? (a.turnier.identitaet ?? null) : null;
      }
      rechteFuer = s?.token ?? '';
      // Für den Offline-Betrieb merken (nur Anzeige – der Server prüft jeden Eintrag beim Nachtragen)
      const g = gemerktesTurnier(id);
      if (g && s && (g.kontoRolle !== bestaetigteKontoRechte || g.kontoId !== s.konto.id || g.kontoIdentitaet !== kontoIdentitaet)) {
        turnierMerken({ ...g, kontoRolle: bestaetigteKontoRechte, kontoId: s.konto.id, kontoIdentitaet });
      }
    } catch (x) {
      if (zerstoert || wechsel || s !== app.sitzung) return;
      if (kennung && kennung !== (gemerktesTurnier(id)?.token ?? null)) return;
      if (ersteAbfrage && kennung && x instanceof ApiFehler && x.code === 'nicht_angemeldet') {
        turnierAbmelden(id);
        eintrag = gemerktesTurnier(id) ?? null;
        zugangFehler = T.zugang.kennungUngueltig;
      }
      // Kein Netz: zuletzt bestätigte Rechte dieses Kontos weiter nutzen (Einträge warten auf das Netz)
      const g = gemerktesTurnier(id);
      bestaetigteKontoRechte = x instanceof ApiFehler && x.istNetzwerk && s && g?.kontoId === s.konto.id ? (g.kontoRolle ?? null) : null;
      kontoIdentitaet = bestaetigteKontoRechte ? (g?.kontoIdentitaet ?? null) : null;
      rechteFuer = s?.token ?? '';
    }
  }
  $effect(() => {
    const s = app.sitzung;
    if (lokal || laedt) return;
    if (!s) {
      bestaetigteKontoRechte = null;
      kontoIdentitaet = null;
      rechteFuer = '';
      return;
    }
    if (s.token !== rechteFuer) void infoLaden();
  });

  const rolle = $derived<Rolle>(lokal ? 'leitung' : eintrag?.token ? eintrag.rolle : (kontoRechte ?? 'zuschauer'));
  const leitung = $derived(lokal || rolle === 'leitung' || rolle === 'admin' || rolle === 'veranstalter');
  const ich = $derived(rolle === 'spieler' ? (eintrag?.spieler ?? null) : null);
  /** Aufgaben dieser Anmeldung: Leitung alle, Helfer laut Kennung, Spieler mit Helfer-Recht Ergebnisse + Aufruf */
  const aufgaben = $derived<readonly Aufgabe[]>(
    leitung ? ALLE_AUFGABEN : rolle === 'helfer' ? (eintrag?.aufgaben ?? HELFER_STANDARD) : rolle === 'spieler' && eintrag?.helfer ? HELFER_STANDARD : [],
  );
  const darfAufgabe = (a: Aufgabe) => aufgaben.includes(a);
  /** Fremde Ergebnisse eintragen (amtlich) */
  const helferRecht = $derived(!leitung && (darfAufgabe('ergebnisse') || darfAufgabe('oberschiri')));
  /** Posteingang je Kennung und Rundmail (ab Server 0.18) */
  const nachrichtenMoeglich = $derived(!lokal && app.server.art === 'bereit' && !!app.server.info.nachrichten);
  let postfachHinweis = $state<string | null>(null);
  let postfach: { neuLaden: () => Promise<void> } | undefined = $state();
  const anmeldungMoeglich = $derived(!lokal && app.server.art === 'bereit' && !!app.server.info.anmeldung && !app.server.info.zentrale);
  /** Token, mit dem dieses Gerät sendet: Kennung vor Konto */
  const schreibToken = $derived(eintrag?.token ?? kontoToken);
  function identitaetFuer(token: string): string | null {
    const kennung = eintrag?.kennungIdentitaet;
    if (token === eintrag?.token && kennung?.tokenHash === sitzungsbindung(token)) return kennung.bezug;
    return token === kontoToken ? kontoIdentitaet : null;
  }
  const darfSchreiben = $derived(lokal || !!schreibToken);
  const name = $derived(zustand?.name || eintrag?.name || '');
  const link = $derived(`${appBasis()}#/t/${id}`);
  const teilenNativ = typeof navigator !== 'undefined' && (!!navigator.share || !!nativ());
  const verdeckt = $derived(!!zustand && etwasVerdeckt(zustand));
  /** Online: Turnier liegt auf einer Zentrale. Zentrale: Turnier wurde zurückgegeben. */
  let sperre = $state<{ zentrale: string | null; abgegeben: boolean } | null>(null);
  const erinnerung = $derived(
    lokal && zustand !== null && eintrag !== null && erinnerungFaellig(lokaleSicherung(id), zustand.anzahlEreignisse, ereignisse[0]?.zeit ?? eintrag.zuletzt, jetzt),
  );

  type Reiter = 'meine' | 'spiele' | 'tische' | 'tabellen' | 'teilnehmer' | 'kasse' | 'konkurrenzen' | 'zugaenge' | 'drucken' | 'pool' | 'einstellungen';
  /** „Tische“ erscheint, sobald eine Konkurrenz läuft */
  const mitTischen = $derived(!!zustand && Object.values(zustand.konkurrenzen).some((k) => k.gestartet.gruppen || k.gestartet.ko));
  const reiterListe = $derived<Reiter[]>(
    leitung
      ? [
          'spiele',
          ...(mitTischen ? ['tische' as const] : []),
          'tabellen',
          'teilnehmer',
          'kasse',
          'konkurrenzen',
          ...(lokal ? [] : ['zugaenge' as const]),
          'drucken',
          'pool',
          'einstellungen',
        ]
      : rolle === 'spieler'
        ? ['meine', 'spiele', ...(mitTischen ? ['tische' as const] : []), 'tabellen', ...(eintrag?.helfer ? ['drucken' as const] : [])]
        : rolle === 'helfer'
          ? ['spiele', ...(mitTischen ? ['tische' as const] : []), 'tabellen', ...(darfAufgabe('kasse') ? ['kasse' as const] : []), 'drucken']
          : ['tabellen', 'spiele', ...(mitTischen ? ['tische' as const] : [])],
  );
  /** Reiterleiste am Handy: aktiven Reiter in die Mitte rollen (Schatten an den Rändern zeigen „hier geht es weiter“) */
  let mehrOffen = $state(false);
  const hauptReiter = new Set(['meine', 'spiele', 'tische', 'tabellen']);
  let reiterNav = $state<HTMLElement | null>(null);
  $effect(() => {
    void aktiv;
    void reiterListe.length;
    const n = reiterNav;
    if (!n) return;
    void tick().then(() => {
      const a = n.querySelector<HTMLElement>('a.aktiv');
      if (a && n.scrollWidth > n.clientWidth) n.scrollTo({ left: a.offsetLeft - (n.clientWidth - a.offsetWidth) / 2 });
    });
  });
  /** Reiter „Spielerpool“: wer aus dem Pool spielt schon mit */
  const poolImTurnier = $derived(new Set(zustand ? zustand.spielerReihe.map((x) => zustand!.spieler[x]!.pool).filter((x): x is string => !!x) : []));
  const aufrufIch = $derived(zustand && ich ? meinAufruf(zustand, ich) : null);
  function gegnerVon(sp: Spiel): string {
    const k = zustand!.konkurrenzen[sp.konkurrenz]!;
    const p = k.paare;
    const meins = (t: string | null) => !!t && (t === ich || !!p[t]?.spieler.includes(ich!));
    return tnName(zustand!, meins(sp.a) ? sp.b : sp.a);
  }
  const standardReiter = $derived<Reiter>(
    leitung
      ? !zustand?.spielerReihe.length
        ? 'teilnehmer'
        : !zustand.konkurrenzReihe.length
          ? 'konkurrenzen'
          : 'spiele'
      : rolle === 'spieler'
        ? 'meine'
        : rolle === 'helfer'
          ? aufgaben.length === 1 && aufgaben[0] === 'kasse'
            ? 'kasse'
            : aufgaben.length === 1 && aufgaben[0] === 'aufruf' && mitTischen
              ? 'tische'
              : 'spiele'
          : 'tabellen',
  );
  /** QR-Code vom Spielzettel: #/t/<id>/spiel/<konkurrenz>/<spiel> öffnet das Spiel zum Eintragen */
  const spielLink = $derived(reiter === 'spiel' && weitere.length === 2 ? { k: weitere[0]!, s: weitere[1]! } : null);
  /** Frühere Adressen …/anmeldung (bis 0.12) und …/spieler (bis 0.13): heute Reiter „Teilnehmer“ */
  const reiterNeu = $derived(reiter === 'anmeldung' || reiter === 'spieler' ? 'teilnehmer' : reiter);
  const aktiv = $derived<Reiter>(spielLink ? (rolle === 'spieler' ? 'meine' : 'spiele') : reiterNeu && reiterListe.includes(reiterNeu as Reiter) ? (reiterNeu as Reiter) : standardReiter);
  $effect(() => {
    const l = spielLink;
    if (!l || laedt || wechsel || !zustand?.konkurrenzen[l.k]?.spiele[l.s]) return;
    offen = { k: l.k, s: l.s };
    // Erst nach dem Öffnen auf den Reiter wechseln, auch wenn das Spiel erst beim Abgleich kommt.
    ersetze(`t/${id}/${rolle === 'spieler' ? 'meine' : 'spiele'}`);
  });

  /** Online-Turniere ohne „turnier.angelegt“: Name und Datum vom Server (gemerkt am Gerät) */
  function mitKopf(z: TurnierZustand): TurnierZustand {
    if (!z.name && eintrag?.name) z.name = eintrag.name;
    if (z.datum === null && eintrag?.datum) z.datum = eintrag.datum;
    return z;
  }
  async function aktualisieren() {
    if (!sitzung || wechsel) return;
    const liste = await sitzung.ereignisse();
    if (wechsel) return;
    ereignisse = liste;
    zustand = mitKopf(berechnen(ereignisse));
    status = sitzung.status ? { ...sitzung.status } : null;
  }

  async function einstellungenLaden() {
    const token = schreibToken;
    if (lokal || !token || !leitung) return;
    try {
      einst = await api.einstellungen(token, id);
    } catch (x) {
      if (x instanceof ApiFehler && !x.istNetzwerk) einst = null;
    }
  }

  function beiSichtbarkeit() {
    if (identitaetGewechselt()) return;
    if (document.visibilityState === 'visible') void sitzung?.abgleich?.anstossen();
  }
  function identitaetGewechselt() {
    if (!lokal && !laedt && ((gemerktesTurnier(id)?.token ?? null) !== (eintrag?.token ?? null) ||
        (kontoSitzung()?.token ?? null) !== (app.sitzung?.token ?? null))) {
      wechsel = true;
      sitzung?.stop();
      offen = null;
      zustand = null;
      ereignisse = [];
      fehler = 'Die Anmeldung wurde in einem anderen Fenster geändert. Bitte lade diese Ansicht neu.';
    }
    return wechsel;
  }
  function beiOnline() {
    if (identitaetGewechselt()) return;
    void sitzung?.abgleich?.anstossen();
  }
  const uhr = setInterval(() => (jetzt = Date.now()), 60_000);

  function autor() {
    const g = eintrag;
    if (lokal) return { rolle: 'leitung' as Rolle, name: g?.wer || anzeigeName() || 'Leitung' };
    if (g?.token) {
      return {
        rolle: g.rolle,
        name: g.wer || anzeigeName() || 'Leitung',
        ...(g.spieler ? { spieler: g.spieler } : {}),
        ...(g.helfer ? { helfer: true } : {}),
        ...(g.rolle === 'helfer' ? { aufgaben: [...(g.aufgaben ?? HELFER_STANDARD)] } : {}),
      };
    }
    return { rolle: (kontoRechte ?? 'zuschauer') as Rolle, name: app.sitzung?.konto.name || anzeigeName() || 'Leitung' };
  }

  async function mitCodeAnmelden(c: string) {
    zugangFehler = '';
    try {
      const a = await api.turnierZugang(id, c);
      turnierMerken({ ...eintrag!, rolle: a.rolle, token: a.token, spieler: a.spieler ?? null, helfer: a.helfer ?? false, aufgaben: a.aufgaben ?? null, wer: a.name ?? null,
        kennungIdentitaet: a.identitaet ? { bezug: a.identitaet, tokenHash: sitzungsbindung(a.token)! } : null });
      // Helferrechte können seit dem letzten Login eingeschränkt worden sein.
      if (a.rolle === 'helfer' && a.identitaet) {
        await new SitzungsSpeicher(speicher, identitaetsbindung(a.identitaet)).bestaetigteVerwerfen(id);
      }
      eintrag = gemerktesTurnier(id) ?? null;
      ereignisse = [];
      zustand = null;
      await aktualisieren();
      const n = a.name ?? '';
      hinweis = a.rolle === 'spieler' && !a.helfer ? T.zugang.willkommen(n) : a.rolle === 'leitung' ? T.zugang.willkommenLeitung(n) : T.zugang.willkommenHelfer(n);
      void sitzung?.abgleich?.anstossen();
      void einstellungenLaden();
      ersetze(`t/${id}/${standardReiter}`);
    } catch (x) {
      zugangFehler = fehlerText(x, T.app.fehlerAllgemein);
      throw x;
    }
  }

  /** Persönlicher Link …/#/c/<turnier>/<kennung>: gleich anmelden */
  let verwendet = '';
  async function codeVerwenden(c: string) {
    if (verwendet === c) return;
    verwendet = c;
    try {
      await mitCodeAnmelden(c);
    } catch {
      zugangFehler = T.zugang.linkFehler;
      ersetze(`t/${id}/${standardReiter}`);
    }
  }
  $effect(() => {
    const c = code;
    if (c && !laedt && !lokal && sitzung) void untrack(() => codeVerwenden(c));
  });

  function codeAbmelden() {
    if (!confirm(T.zugang.abmeldenFrage)) return;
    if (identitaetGewechselt()) return;
    const alt = eintrag?.token;
    if (alt) void api.logout(alt).catch(() => undefined); // Sitzung auch auf dem Server beenden
    turnierAbmelden(id);
    eintrag = gemerktesTurnier(id) ?? null;
    ereignisse = [];
    zustand = null;
    void aktualisieren();
    void sitzung?.abgleich?.anstossen();
    ersetze(`t/${id}/${standardReiter}`);
  }

  onMount(async () => {
    try {
      let g = gemerktesTurnier(id) ?? null;
      if (lokal) {
        if (!g) throw new Error(T.turnier.nichtGefunden);
      } else {
        const s = await serverPruefen();
        if (s.art !== 'bereit') throw new Error(T.start.keinServer);
        if (!g) {
          const info = (await api.turnier(id)).turnier;
          turnierMerken({ id, name: info.name, datum: info.datum, modus: 'online', rolle: 'zuschauer', token: null });
          g = gemerktesTurnier(id)!;
        } else {
          turnierMerken({ ...g });
        }
      }
      eintrag = g;
      sitzung = new TurnierSitzung({
        speicher,
        turnier: id,
        modus: lokal ? 'lokal' : 'online',
        geraet: geraetId(),
        autor,
        api,
        token: () => wechsel || zerstoert ? null : schreibToken,
        sichtVersion: () => {
          const g = gemerktesTurnier(id);
          return JSON.stringify([g?.token ?? null, g?.aufgaben ?? null, g?.helfer ?? false, kontoSitzung()?.token ?? null]);
        },
        bindungFuer: (token) => {
          const identitaet = identitaetFuer(token);
          return identitaet ? identitaetsbindung(identitaet) : null;
        },
        alterLesestandErlaubt: (token) => token === kontoToken || (token === eintrag?.token && eintrag.rolle === 'leitung'),
        altbestandPasst: (e, token) => {
          const autor = e.autor;
          return !!autor?.spieler && autor.rolle === 'spieler' &&
            identitaetFuer(token)?.startsWith(`kennung:spieler:${autor.spieler}:`) === true;
        },
        beiAenderung: () => void aktualisieren(),
        // Kennung gesperrt/neu ausgegeben oder Konto ohne Rechte: sofort Zuschauer, Bestand bleibt vollständig
        beiRechteVerlust: () => {
          if (gemerktesTurnier(id)?.token) {
            turnierAbmelden(id);
            eintrag = gemerktesTurnier(id) ?? null;
            zugangFehler = T.zugang.kennungUngueltig;
          } else {
            const g = gemerktesTurnier(id);
            if (g && g.kontoId === app.sitzung?.konto.id) {
              turnierMerken({ ...g, kontoRolle: null, kontoIdentitaet: null });
            }
            kontoIdentitaet = null;
            bestaetigteKontoRechte = null;
          }
        },
      });
      if (!lokal) await infoLaden(); // Der Speicherbereich hängt von den bestätigten Kontorechten ab.
      await aktualisieren();
      sitzung.start();
      if (code && !lokal) await codeVerwenden(code);
      // Reiter festhalten, damit die Seite beim Eintragen nicht springt
      if (!code && !reiter) ersetze(`t/${id}/${standardReiter}`);
      void einstellungenLaden();
      document.addEventListener('visibilitychange', beiSichtbarkeit);
      addEventListener('online', beiOnline);
      addEventListener('storage', identitaetGewechselt);
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laedt = false;
    }
  });

  onDestroy(() => {
    zerstoert = true;
    sitzung?.stop();
    clearInterval(uhr);
    clearTimeout(uebersichtTimer);
    clearTimeout(aktionTimer);
    document.removeEventListener('visibilitychange', beiSichtbarkeit);
    removeEventListener('online', beiOnline);
    removeEventListener('storage', identitaetGewechselt);
  });

  /**
   * Eintragen. Jede Änderung der Leitung ist eine „letzte Aktion“, die der Hinweis unten zum
   * Rückgängigmachen anbietet; mehrere Einträge einer Aktion (siehe alsEineAktion, z. B. „Alle melden“)
   * zusammen. `still`: automatische Einträge (Tische belegen) – ohne Hinweis.
   */
  let aktion = $state<{ ids: string[]; text: string; gruppe: string | null } | null>(null);
  let aktionTimer: ReturnType<typeof setTimeout> | undefined;
  const fristAnzeige = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });
  function neueZeit(zeit: string | null): string {
    const datum = zeit ? new Date(zeit) : null;
    return datum && Number.isFinite(datum.getTime()) ? fristAnzeige.format(datum) : 'unbekannt';
  }
  function spaeteBallpunkte(wert: unknown): string {
    if (!Array.isArray(wert)) return '';
    return wert.map((zahl) => Number.isSafeInteger(zahl) ? String(zahl) : '?').join(':');
  }
  async function eintragen(art: string, daten: Record<string, unknown>, opt: { still?: boolean; id?: string } = {}) {
    if (identitaetGewechselt()) throw new Error(fehler);
    if (!sitzung) throw new Error(T.app.fehlerAllgemein);
    if (fristgebundeneAktion(art) && nachTurnierende(zustand?.enddatum ?? null, new Date().toISOString())) {
      hinweis = 'Das Turnier ist beendet. Für neue Spiele bitte das Enddatum verlängern.';
      throw new Error(hinweis);
    }
    const e = await sitzung.eintragen(art, daten, opt.id);
    if (leitung && !opt.still && rueckgaengigBar(e)) {
      const gruppe = aktuelleAktion();
      const text = T.verlauf.arten[art] ?? T.protokollArten[art] ?? art;
      hinweis = null; // alter Hinweis („Rückgängig gemacht.“) passt nicht mehr
      if (aktion && gruppe && aktion.gruppe === gruppe) aktion = { ids: [...aktion.ids, e.id], text: T.verlauf.mehrere(aktion.ids.length + 1), gruppe };
      else aktion = { ids: [e.id], text: T.verlauf.gespeichert(text), gruppe };
      verlaufFehler = '';
      clearTimeout(aktionTimer);
      aktionTimer = setTimeout(() => (aktion = null), 12_000);
    }
    return e;
  }

  /** Einträge zurücknehmen (zurueck = true) oder wiederherstellen – vorher prüfen, ob es gefahrlos geht */
  async function rueckgaengig(ids: string[], zurueck = true) {
    const p = rueckgaengigPruefen(ereignisse, ids, zurueck, autor());
    if (!p.ok) {
      verlaufFehler = T.verlauf.nichtMoeglich(p.grund);
      return false;
    }
    verlaufFehler = '';
    // als einfache Liste speichern (Zustands-Proxys lassen sich nicht in IndexedDB ablegen); große
    // Aktionen in Paketen, damit jeder Eintrag klein bleibt (Server nehmen höchstens 16 KB je Eintrag)
    const liste = [...ids];
    for (let i = 0; i < liste.length; i += MAX_JE_RUECKNAHME) await sitzung!.eintragen(ART.eintragZurueck, { ereignisse: liste.slice(i, i + MAX_JE_RUECKNAHME), zurueck });
    hinweis = zurueck ? T.verlauf.erledigt : T.verlauf.wieder;
    if (aktion && aktion.ids.some((x) => ids.includes(x))) aktion = null;
    return true;
  }
  let verlaufFehler = $state('');
  async function aktionZuruecknehmen() {
    if (!aktion) return;
    const ids = aktion.ids;
    if (await rueckgaengig(ids)) {
      aktion = null;
      clearTimeout(aktionTimer);
    }
  }
  const zurueckgenommen = $derived(new Set(zustand?.zurueckgenommen ?? []));

  // Sobald das Konto Rechte hat: Einstellungen laden und ausstehende Einträge senden
  $effect(() => {
    if (kontoRechte && !laedt) {
      void einstellungenLaden();
      void sitzung?.abgleich?.anstossen();
    }
  });

  /* Lesbaren Stand für die Sicherungsmail hochladen (nur Leitung, online, höchstens alle 20 s) */
  let uebersichtTimer: ReturnType<typeof setTimeout> | undefined;
  let letzteUebersicht = '';
  $effect(() => {
    const z = zustand;
    const token = schreibToken;
    if (!z || lokal || !leitung || !token || app.server.art !== 'bereit' || !app.server.info.codes) return;
    void z.anzahlEreignisse;
    clearTimeout(uebersichtTimer);
    uebersichtTimer = setTimeout(() => {
      const text = uebersichtText(z);
      if (text === letzteUebersicht) return;
      api.uebersicht(token, id, text).then(() => (letzteUebersicht = text)).catch(() => undefined);
    }, 20_000);
  });

  /* ---------- Hinweis auf neue Online-Anmeldungen (nur Leitung, online, abschaltbar je Gerät) ---------- */
  let anmeldungNeu = $state(0);
  let anmeldungBekannt = -1;
  async function anmeldungenPruefen() {
    const token = schreibToken;
    if (!token || !leitung || !anmeldungMoeglich || !appHinweisAn(id) || document.visibilityState !== 'visible') return;
    try {
      const a = await api.anmeldungen(token, id);
      const z = zustand;
      const neu = neueAnmeldungen(id, a.anmeldungen, (x) => !!z?.spieler[x]).length;
      // Ton/Mitteilung nur, wenn während der Sitzung neue dazukommen (nicht beim Öffnen)
      if (anmeldungBekannt >= 0 && neu > anmeldungBekannt && aktiv !== 'teilnehmer') {
        void benachrichtigen({ ...mitteilung, spieler: null, vibration: false }, name || T.app.titel, T.anm.neuHinweis(neu), `anmeldung-${id}`);
      }
      anmeldungBekannt = neu;
      if (aktiv !== 'teilnehmer') anmeldungNeu = neu;
    } catch {
      /* kein Netz – später erneut */
    }
  }
  $effect(() => {
    if (laedt || !leitung || !anmeldungMoeglich || !schreibToken) return;
    untrack(() => void anmeldungenPruefen());
    const t = setInterval(() => void anmeldungenPruefen(), 120_000);
    return () => clearInterval(t);
  });

  let fremde = $state.raw<LokalesEreignis[]>([]);
  let fremdeLaeuft = false;
  const fremdeAutoren = $derived([...new Set(fremde.map((e) =>
    e.autor ? `${T.rollen[e.autor.rolle]} · ${e.autor.name}` : T.fremdeEintraege.unbekannt
  ))]);
  async function fremdeLaden() {
    if (!sitzung || fremdeLaeuft || wechsel) return;
    fremdeLaeuft = true;
    try {
      fremde = await sitzung.fremdeAusstehende();
    } finally {
      fremdeLaeuft = false;
    }
  }
  $effect(() => {
    void schreibToken;
    if (laedt || lokal || wechsel) return;
    untrack(() => void fremdeLaden().catch(() => undefined));
    const timer = setInterval(() => void fremdeLaden().catch(() => undefined), 15_000);
    return () => clearInterval(timer);
  });
  async function fremdeSichern() {
    const aktuell = await sitzung?.fremdeAusstehende();
    if (!aktuell?.length) return;
    const eintraege = aktuell.map(({ id: eid, turnier, art, daten, zeit, geraet, autor }) =>
      ({ id: turnier === id ? eid : eid.slice(turnier.length + 1), art, daten, zeit, geraet, autor }));
    await dateiAusgeben(`TT-Turnier-${id}-ausstehend.json`, JSON.stringify({ turnier: id, eintraege }, null, 2), 'application/json', false);
  }
  async function fremdeVerwerfen() {
    if (!confirm(T.fremdeEintraege.bestaetigen)) return;
    await sitzung?.fremdeVerwerfen(fremde);
    await fremdeLaden();
  }

  /* ---------- Vom Server abgelehnte Einträge ---------- */
  const abgelehnt = $derived(ereignisse.filter((e) => e.status === 'abgelehnt'));
  async function abgelehnteVerwerfen() {
    await sitzung?.abgelehnteVerwerfen();
  }

  /* ---------- Mitteilung bei Aufruf (nur bei offener App) ---------- */
  // svelte-ignore state_referenced_locally
  let mitteilung = $state<MitteilungEinstellung>(mitteilungEinstellung(id, null));
  $effect(() => {
    // Eigene Spielerkennung: standardmäßig für sich selbst
    const eigen = ich;
    untrack(() => (mitteilung = mitteilungEinstellung(id, eigen)));
  });
  const gefolgt = $derived(mitteilung.spieler && zustand?.spieler[mitteilung.spieler] ? mitteilung.spieler : null);
  const aufrufGefolgt = $derived(zustand && gefolgt ? meinAufruf(zustand, gefolgt) : null);
  let gemeldet = new Set<string>();
  let mitteilungBereit = false;
  let aufrufHinweis = $state<{ schluessel: string; text: string } | null>(null);
  $effect(() => {
    const a = aufrufGefolgt;
    const z = zustand;
    if (!z || !gefolgt) return;
    const jetztSchluessel = new Set<string>();
    const meldungen: { schluessel: string; text: string }[] = [];
    if (a?.spielt) {
      const s = a.spielt;
      const k = `s/${s.konkurrenz}/${s.id}/${s.tisch}`;
      jetztSchluessel.add(k);
      meldungen.push({ schluessel: k, text: gefolgt === ich ? T.mitteilung.spielt(s.tisch!, gegnerVonSpieler(s, gefolgt)) : T.mitteilung.folgtSpielt(tnName(z, gefolgt), s.tisch!) });
    }
    if (a?.pfeift) {
      const s = a.pfeift;
      const k = `p/${s.konkurrenz}/${s.id}/${s.tisch}`;
      jetztSchluessel.add(k);
      meldungen.push({ schluessel: k, text: T.mitteilung.pfeift(s.tisch!) });
    }
    untrack(() => {
      const neu = meldungen.filter((m) => !gemeldet.has(m.schluessel));
      gemeldet = jetztSchluessel;
      // Beim Öffnen nichts auslösen, was schon lief – nur neue Aufrufe melden
      if (!mitteilungBereit) {
        mitteilungBereit = true;
        if (neu.length) aufrufHinweis = neu[0]!;
        return;
      }
      if (!neu.length) {
        if (aufrufHinweis && !jetztSchluessel.has(aufrufHinweis.schluessel)) aufrufHinweis = null;
        return;
      }
      aufrufHinweis = neu[0]!;
      void benachrichtigen(mitteilung, name || T.app.titel, neu.map((m) => m.text).join(' · '), neu[0]!.schluessel);
    });
  });
  function gegnerVonSpieler(sp: Spiel, wer: string): string {
    const k = zustand!.konkurrenzen[sp.konkurrenz]!;
    const meins = (t: string | null) => !!t && (t === wer || !!k.paare[t]?.spieler.includes(wer));
    return tnName(zustand!, meins(sp.a) ? sp.b : sp.a);
  }
  $effect(() => {
    const an = mitteilung.wach && !!gefolgt;
    void wachHalten(an);
    const erneuern = () => document.visibilityState === 'visible' && wachHaltenErneuern(an);
    document.addEventListener('visibilitychange', erneuern);
    return () => {
      document.removeEventListener('visibilitychange', erneuern);
      void wachHalten(false);
    };
  });

  function sichtbarMachen() {
    if (!confirm(T.einstellungen.veroeffentlichenFrage)) return;
    void eintragen(ART.turnierDaten, { veroeffentlichung: { tabellen: true, ko: true }, alleKonkurrenzen: true }).then(() => (hinweis = T.einstellungen.veroeffentlicht));
  }

  async function kopieren(was: 'link' | 'code', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      kopiert = was;
      setTimeout(() => (kopiert = ''), 2000);
    } catch {
      prompt(T.turnier.linkKopieren, text);
    }
  }

  async function linkTeilen() {
    const n = nativ();
    if (n) {
      n.textTeilen(name, `${T.app.titel}: ${name}\n${link}`);
      return;
    }
    try {
      await navigator.share({ title: name, text: `${T.app.titel}: ${name}`, url: link });
    } catch {
      /* abgebrochen */
    }
  }

  async function sicherungBauen() {
    // Nur aus dem vollständigen Bestand sichern (nie aus der gefilterten Zuschauer-Sicht)
    const sicht = lokal ? null : await sitzung?.sicht();
    if (!lokal && sicht?.split('|')[0] !== 'voll') throw new Error(T.einstellungen.sicherungUnvollstaendig);
    const liste = sitzung ? await sitzung.ereignisse() : ereignisse;
    return sicherungErstellen({ id, name, datum: zustand?.datum ?? eintrag?.datum ?? null, modus: lokal ? 'lokal' : 'online' }, liste);
  }

  async function erinnerungSichern() {
    const r = await sicherungAusgeben(await sicherungBauen(), true);
    if (r !== 'abgebrochen') {
      setzeLokaleSicherung(id, { ...lokaleSicherung(id), zuletzt: new Date().toISOString(), anzahl: zustand?.anzahlEreignisse ?? 0 });
      jetzt = Date.now();
    }
  }

  function zeit(iso: string) {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function beschreibung(e: LokalesEreignis): string {
    const d = e.daten as Record<string, unknown>;
    const z = zustand;
    const k = typeof d.konkurrenz === 'string' ? z?.konkurrenzen[d.konkurrenz]?.einst.name : undefined;
    const art = T.protokollArten[e.art];
    switch (e.art) {
      case ART.testNotiz:
        return String(d.text ?? '');
      case ART.turnierAngelegt:
      case ART.turnierUmbenannt:
        return `${art}: ${String(d.name ?? '')}`;
      case ART.turnierAbgeschlossen:
        return 'Turnier abgeschlossen';
      case ART.turnierWiedereroeffnet:
        return 'Turnier wieder geöffnet';
      case ART.turnierWiederhergestellt:
        return `Aus Sicherung wiederhergestellt (${String(d.anzahl ?? 0)} Einträge)`;
      case ART.spielerAngelegt:
      case ART.spielerGeaendert:
        return `${art}: ${String(d.vorname ?? '')} ${String(d.nachname ?? '')}`;
      case ART.konkurrenzAngelegt:
        return `${art}: ${String((d.einst as Record<string, unknown>)?.name ?? '')}`;
      case ART.teilnehmerGemeldet:
      case ART.teilnehmerAbgemeldet:
        return `${z ? spName(z, String(d.id)) : ''} ${art}${k ? ` (${k})` : ''}`;
      case ART.eintragZurueck: {
        const n = Array.isArray(d.ereignisse) ? d.ereignisse.length : 0;
        return d.zurueck === false ? T.verlauf.wiederText(n) : T.verlauf.zurueckText(n);
      }
      case ART.spielErgebnis: {
        const s = z && typeof d.spiel === 'string' ? z.konkurrenzen[String(d.konkurrenz)]?.spiele[d.spiel] : undefined;
        const namen = z ? `${spName(z, String(d.a ?? ''))} – ${spName(z, String(d.b ?? ''))}` : '';
        const erg = s?.eintrag?.ereignis === e.id && s.ergebnis ? ` ${spielErgebnisText(zustand!, s, s.ergebnis)}` : '';
        return `${art}: ${namen}${erg}${k ? ` (${k})` : ''}`;
      }
      default:
        return art ? `${art}${k ? ` (${k})` : ''}` : e.art;
    }
  }

  const offenesSpiel = $derived<{ k: NonNullable<TurnierZustand['konkurrenzen'][string]>; s: Spiel } | null>(
    offen && zustand?.konkurrenzen[offen.k]?.spiele[offen.s] ? { k: zustand.konkurrenzen[offen.k]!, s: zustand.konkurrenzen[offen.k]!.spiele[offen.s]! } : null,
  );
  function oeffnen(s: Spiel) {
    offen = { k: s.konkurrenz, s: s.id };
  }
</script>

{#if laedt}
  <p class="leise">{T.app.laden}</p>
{:else if fehler}
  <div class="meldung fehler" role="alert">{fehler}</div>
  {#if wechsel}<button onclick={() => location.reload()}>Neu laden</button>{/if}
  <a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a>
{:else}
  {#if hinweis}<div class="meldung ok" role="status">{hinweis}</div>{/if}
  {#if sperre?.zentrale}<div class="meldung info" role="status" data-testid="sperre">{T.zentrale.gesperrtOnline(sperre.zentrale)}</div>{/if}
  {#if sperre?.abgegeben}<div class="meldung info" role="status" data-testid="sperre">{T.zentrale.abgegebenHinweis}</div>{/if}
  {#if schreibToken && fremde.length}
    <section class="meldung info" role="status" data-testid="fremde-ausstehende">
      <strong>{T.fremdeEintraege.titel(fremde.length)}</strong>
      <Hilfe text={T.fremdeEintraege.hilfe} />
      <p>{fremdeAutoren.join(', ')}</p>
      <div class="reihe">
        <button class="zweit" onclick={fremdeSichern}>{T.fremdeEintraege.sichern}</button>
        <button class="zweit" onclick={fremdeVerwerfen}>{T.fremdeEintraege.verwerfen}</button>
      </div>
      <details>
        <summary>{T.fremdeEintraege.anmelden}</summary>
        <Mitmachen anmelden={mitCodeAnmelden} fehler={zugangFehler} />
        <a href={linkZu('anmelden')}>{T.kopf.anmelden}</a>
      </details>
    </section>
  {/if}

  {#if abgelehnt.length}
    <div class="meldung fehler abgelehnt" role="alert" data-testid="abgelehnt">
      <div class="wachsen">
        <strong>{T.abgelehnt.titel(abgelehnt.length)}</strong>
        <ul>{#each abgelehnt.slice(0, 3) as e (e.id)}<li>{T.protokollArten[e.art] ?? e.art}: {e.fehler}</li>{/each}</ul>
        <span class="leise">{T.abgelehnt.text}</span>
      </div>
      <button class="zweit klein" onclick={abgelehnteVerwerfen}>{T.abgelehnt.verwerfen}</button>
    </div>
  {/if}
  {#if anmeldungNeu > 0 && aktiv !== 'teilnehmer'}
    <div class="meldung info reihe" role="status" data-testid="anmeldung-hinweis">
      <span class="wachsen">🔔 {T.anm.neuHinweis(anmeldungNeu)}</span>
      <a class="knopf klein" href={linkZu(`t/${id}/teilnehmer`)}>{T.anm.ansehen}</a>
    </div>
  {/if}
  {#if aufrufHinweis && aktiv !== 'meine'}
    <div class="meldung aufruf reihe" role="alert" data-testid="aufruf-hinweis">
      <span class="wachsen">🔔 {aufrufHinweis.text}</span>
      <button class="klein" onclick={() => (aufrufHinweis = null)}>{T.mitteilung.schliessen}</button>
    </div>
  {/if}

  {#if postfachHinweis}
    <div class="meldung aufruf reihe" role="status" data-testid="postfach-hinweis">
      <span class="wachsen">✉ {postfachHinweis}</span>
      <button class="klein" onclick={() => (postfachHinweis = null)}>{T.mitteilung.schliessen}</button>
    </div>
  {/if}

  <section class="kopf">
    <h1>{name}</h1>
    <div class="reihe">
      <StatusAnzeige {status} {lokal} />
      {#if nachrichtenMoeglich && schreibToken}
        {#key schreibToken}<Postfach bind:this={postfach} turnierId={id} token={schreibToken} onNeu={(n) => (postfachHinweis = T.postfach.neuHinweis(n))} />{/key}
      {/if}
      {#if zustand?.abgeschlossen}<span class="marke">{T.turnier.abgeschlossen}</span>{/if}
      {#if !lokal && eintrag?.token}
        <span class="leise" data-testid="angemeldet-als">{T.zugang.angemeldet(eintrag.wer ?? '', rolle === 'spieler' && eintrag.helfer ? T.zugang.spielerHelfer : T.rollen[rolle])}</span>
        <button class="zweit klein" onclick={codeAbmelden}>{T.zugang.abmelden}</button>
      {/if}
    </div>
  </section>

  {#if !lokal && !darfSchreiben && eintrag?.konto && !app.sitzung}
    <div class="meldung info" role="status">{T.zugang.kontoAbgemeldet} <a href={linkZu('anmelden')}>{T.kopf.anmelden}</a></div>
  {/if}

  {#if erinnerung}
    <div class="meldung info erinnerung" role="status">
      <span>{T.turnier.erinnerung}</span>
      <button class="klein" onclick={erinnerungSichern}>{T.turnier.erinnerungKnopf}</button>
    </div>
  {/if}

  {#if !lokal && !darfSchreiben}
    <details class="karte mitmachen" open={!!zugangFehler}>
      <summary>{T.zugang.titel}</summary>
      <Mitmachen anmelden={mitCodeAnmelden} fehler={zugangFehler} />
    </details>
  {/if}

  <nav class="reiter" class:mehrOffen aria-label="Bereiche" bind:this={reiterNav}>
    {#each reiterListe as r (r)}
      <a href={linkZu(`t/${id}/${r}`)} class:nebenbereich={!hauptReiter.has(r)} class:aktiv={aktiv === r} onclick={() => (mehrOffen = false)} aria-current={aktiv === r ? 'page' : undefined}
        >{T.reiter[r]}{#if r === 'teilnehmer' && anmeldungNeu > 0}<span class="zaehler" data-testid="reiter-neu" aria-label={T.anm.neuHinweis(anmeldungNeu)}>{anmeldungNeu}</span>{/if}</a
      >
    {/each}
    {#if reiterListe.some((r) => !hauptReiter.has(r))}
      <button class="mehr" aria-expanded={mehrOffen} onclick={() => (mehrOffen = !mehrOffen)}>Mehr</button>
    {/if}
    {#if rolle === 'zuschauer'}<a href={linkZu(`live/${id}`)}>Live</a>{/if}
  </nav>

  {#if zustand}
    {#if aktiv === 'meine'}
      {#if aufrufIch?.spielt}
        <div class="meldung aufruf" role="status" data-testid="mein-aufruf">{T.spiele.duSpielst(aufrufIch.spielt.tisch!, gegnerVon(aufrufIch.spielt))}</div>
      {/if}
      {#if aufrufIch?.pfeift}
        <div class="meldung info" role="status">{T.spiele.duPfeifst(aufrufIch.pfeift.tisch!, `${tnName(zustand, aufrufIch.pfeift.a)} – ${tnName(zustand, aufrufIch.pfeift.b)}`)}</div>
      {/if}
      <MitteilungKarte z={zustand} turnierId={id} {ich} bind:einstellung={mitteilung} />
      <SpieleListe z={zustand} leitung={false} {ich} nurMeine mitSchiri={rolle !== 'zuschauer'} {oeffnen} />
    {:else if aktiv === 'tische'}
      <Tische z={zustand} turnierId={id} {leitung} {ich} darfAufrufen={leitung || darfAufgabe('aufruf')} mitSchiri={rolle !== 'zuschauer'} {eintragen} {oeffnen} />
    {:else if aktiv === 'spiele'}
      {#if !leitung && rolle !== 'spieler' && zustand.spielerReihe.length}
        <MitteilungKarte z={zustand} turnierId={id} ich={null} bind:einstellung={mitteilung} zugeklappt />
      {/if}
      {#if leitung && zustand.spaeteErgebnisse.length}
        <section class="karte" aria-label="Verspätet synchronisierte Ergebnisse">
          <h2>Verspätet synchronisierte Ergebnisse</h2>
          {#each zustand.spaeteErgebnisse as meldung (meldung.id)}
            {@const daten = meldung.daten as { konkurrenz?: string; spiel?: string; a?: string; b?: string; ergebnis?: { saetze?: number[][]; stand?: number[]; aufgabe?: string; laufend?: number[]; kampflos?: string } }}
            {@const eingabe = daten.ergebnis}
            <div class="meldung info">
              <strong>{spName(zustand, daten.a ?? null, zustand.konkurrenzen[daten.konkurrenz ?? ''])} gegen {spName(zustand, daten.b ?? null, zustand.konkurrenzen[daten.konkurrenz ?? ''])}</strong>
              <p>{zustand.konkurrenzen[daten.konkurrenz ?? '']?.einst.name} · {daten.spiel}</p>
              <p>{(Array.isArray(eingabe?.saetze) ? eingabe.saetze.map(spaeteBallpunkte).join(', ') : spaeteBallpunkte(eingabe?.stand))}
                {#if eingabe?.aufgabe} · Aufgabe, Seite {eingabe.aufgabe === 'a' ? 'A' : 'B'} {spaeteBallpunkte(eingabe.laufend)}{/if}
                {#if eingabe?.kampflos} · Kampflos, Seite {eingabe.kampflos === 'a' ? 'A' : 'B'} verliert{/if}
              </p>
              <p>{meldung.autor?.name} · Erfasst {neueZeit(meldung.zeit)} · Eingegangen {neueZeit(meldung.empfangen)}</p>
              {#each zustand.warnungen.filter((warnung) => warnung.ereignis === meldung.id).slice(-1) as warnung}
                <p role="alert">{warnung.text}</p>
              {/each}
              <button onclick={() => eintragen(ART.spielSpaetGeprueft, { ereignis: meldung.id, uebernehmen: true })}>Übernehmen</button>
              <button class="zweit" onclick={() => eintragen(ART.spielSpaetGeprueft, { ereignis: meldung.id, uebernehmen: false })}>Ablehnen</button>
            </div>
          {/each}
        </section>
      {/if}
      <SpieleListe z={zustand} leitung={leitung || helferRecht} stufeEintragen={leitung ? eintragen : undefined} tischLink={mitTischen && (leitung || darfAufgabe('aufruf')) ? `t/${id}/tische` : null} {ich} mitSchiri={rolle !== 'zuschauer'} {oeffnen} />
    {:else if aktiv === 'tabellen'}
      {#if leitung && verdeckt}
        <div class="meldung info reihe" role="status">
          <span class="wachsen">{T.tab.verdecktLeitung}</span>
          <button class="klein" onclick={sichtbarMachen} data-testid="veroeffentlichen">{T.einstellungen.veroeffentlichen}</button>
        </div>
      {/if}
      <Tabellen z={zustand} {leitung} {eintragen} {oeffnen} />
      <p class="leise live-link"><a href={linkZu(`live/${id}`)} data-testid="live-link">{T.live.linkTabellen}</a></p>
    {:else if aktiv === 'teilnehmer'}
      {#if nachrichtenMoeglich && schreibToken && leitung}
        <Rundmail z={zustand} turnierId={id} token={schreibToken} gesendet={() => void postfach?.neuLaden()} />
      {/if}
      <SpielerTab z={zustand} {eintragen} />
      {#if anmeldungMoeglich && schreibToken && leitung}
        <AnmeldungTab z={zustand} turnierId={id} token={schreibToken} {eintragen} neuGesehen={() => (anmeldungNeu = 0)} />
      {/if}
      <TeilnehmerJeKonkurrenz z={zustand} turnierId={id} offen={weitere[0] ?? null} {eintragen} />
      <AppWertung z={zustand} {eintragen} />
    {:else if aktiv === 'pool'}
      <h2>{T.pool.titel}</h2>
      <p class="leise">{T.pool.textTurnier}</p>
      <PoolVerwaltung imTurnier={poolImTurnier} />
    {:else if aktiv === 'kasse'}
      <KasseTab z={zustand} turnierId={id} {leitung} {eintragen} />
    {:else if aktiv === 'konkurrenzen'}
      <KonkurrenzenTab z={zustand} turnierId={id} {eintragen} />
    {:else if aktiv === 'drucken'}
      <DruckExport z={zustand} {id} {leitung} {lokal} />
    {:else if aktiv === 'zugaenge'}
      <section class="karte">
        <h2>{T.turnier.teilen}</h2>
        <p class="leise">{T.turnier.teilenHinweis}</p>
        <div class="code-zeile">
          <span>{T.turnier.kennung}<Hilfe text={T.turnier.kennungHilfe} /></span>
          <strong class="code-gross" data-testid="turnierkennung">{codeAnzeige(id)}</strong>
          <button class="zweit klein" onclick={() => kopieren('code', id)}>{kopiert === 'code' ? T.turnier.kopiert : T.turnier.kennungKopieren}</button>
          <button class="zweit klein" aria-expanded={qrOffen} onclick={() => (qrOffen = !qrOffen)}>{T.turnier.qr}</button>
        </div>
        {#if qrOffen}<div class="qr-gross"><QrCode text={link} groesse={220} label="{name}: {codeAnzeige(id)}" /></div>{/if}
        <p class="leise live-zeile"><a href={linkZu(`live/${id}`)}>{T.live.oeffnen}</a> · <a href={linkZu(`druck/${id}/aushang`)}>{T.druck.arten.aushang}</a></p>
        <div class="reihe">
          <input class="wachsen" readonly value={link} aria-label="Link" onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
          {#if teilenNativ}<button onclick={linkTeilen}>{T.turnier.linkTeilen}</button>{/if}
          <button class="zweit" onclick={() => kopieren('link', link)}>{kopiert === 'link' ? T.turnier.kopiert : T.turnier.linkKopieren}</button>
        </div>
      </section>
      {#if schreibToken}
        <Zugaenge z={zustand} {id} token={schreibToken} turnierName={name} />
      {/if}
    {:else if aktiv === 'einstellungen'}
      <TurnierEinstellungen
        {id}
        {lokal}
        abschnitt={weitere[0] ?? null}
        token={schreibToken}
        bind:einst
        z={zustand}
        abgeschlossen={zustand.abgeschlossen}
        anzahl={zustand.anzahlEreignisse}
        eintragen={(art, daten) => eintragen(art, daten ?? {})}
        sicherung={sicherungBauen}
      >
        {#snippet protokoll()}
          {#if zustand && zustand.warnungen.length}
            <details class="warnungen">
              <summary>{T.warn.titel} <span class="leise">({zustand.warnungen.length})</span></summary>
              <p class="leise">{T.warn.text}</p>
              <ul class="liste">
                {#each [...zustand.warnungen].reverse() as w (w.ereignis)}
                  <li><div>{w.text}</div><div class="leise">{zeit(w.zeit)} · {T.turnier.von} {w.von || '–'}</div></li>
                {/each}
              </ul>
            </details>
          {/if}
          {#if ereignisse.length === 0}
            <p class="leise">{T.turnier.leer}</p>
          {:else}
            {#if leitung}<p class="leise verlauf-hilfe">{T.verlauf.rueckgaengig} / {T.verlauf.wiederherstellen}<Hilfe text={T.verlauf.hilfe} /></p>{/if}
            {#if verlaufFehler}<div class="meldung fehler" role="alert">{verlaufFehler}</div>{/if}
            <ul class="liste" data-testid="protokoll">
              {#each [...ereignisse].reverse() as e (e.id)}
                {@const weg = zurueckgenommen.has(e.id)}
                <li class="eintrag" class:wartet={e.status === 'ausstehend'} class:weg>
                  <div class="eintrag-zeile">
                    <div class="wachsen">
                      <div class="text">{beschreibung(e)}{#if weg}<span class="marke">{T.verlauf.zurueckgenommen}</span>{/if}</div>
                      <div class="leise">
                        {#if e.seq !== null && e.status === 'bestaetigt'}#{e.seq} · {/if}
                        {zeit(e.zeit)} · {T.turnier.von} {e.autor?.name ?? '–'}{e.autor && e.autor.rolle !== 'leitung' ? ` (${e.autor.rolle === 'spieler' && e.autor.helfer ? T.zugang.spielerHelfer : T.rollen[e.autor.rolle]})` : ''}
                        <span class="marke">{T.abgleichStatus[e.status]}</span>
                      </div>
                    </div>
                    {#if leitung && darfSchreiben && rueckgaengigBar(e)}
                      <button class="zweit klein" onclick={() => rueckgaengig([e.id], !weg)} data-testid="verlauf-knopf">{weg ? T.verlauf.wiederherstellen : T.verlauf.rueckgaengig}</button>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        {/snippet}
      </TurnierEinstellungen>
    {/if}

    {#if offenesSpiel}
      {#if offenesSpiel.k.einst.art === 'mannschaft'}
        <BegegnungDialog z={zustand} k={offenesSpiel.k} spiel={offenesSpiel.s} turnierId={id} {rolle} {ich} helfer={rolle === 'spieler' && !!eintrag?.helfer} {aufgaben} {eintragen} schliessen={() => (offen = null)} />
      {:else}
        <ErgebnisDialog z={zustand} k={offenesSpiel.k} spiel={offenesSpiel.s} {rolle} {ich} helfer={rolle === 'spieler' && !!eintrag?.helfer} {aufgaben} {eintragen} schliessen={() => (offen = null)} />
      {/if}
    {/if}
  {/if}
  {#if aktion || (verlaufFehler && aktiv !== 'einstellungen')}
    <div class="aktion" role="status" aria-live="polite" data-testid="aktion">
      <span class="wachsen">{verlaufFehler && aktiv !== 'einstellungen' ? verlaufFehler : aktion?.text}</span>
      {#if aktion && !verlaufFehler}
        <button class="klein" onclick={aktionZuruecknehmen} data-testid="rueckgaengig">↶ {T.verlauf.rueckgaengig}</button>
      {/if}
      <button class="zweit klein" aria-label={T.verlauf.schliessen} onclick={() => ((aktion = null), (verlaufFehler = ''))}>✕</button>
    </div>
  {/if}
{/if}

<style>
  .kopf { margin-bottom: 12px; }
  .kopf h1 { margin-bottom: 4px; overflow-wrap: anywhere; }
  .eintrag.wartet { opacity: 0.75; }
  .erinnerung { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: var(--text); border-color: var(--orange); }
  .mitmachen > :global(form) { border: 0; box-shadow: none; padding: 0; margin: 8px 0 0; }
  .reiter {
    position: sticky;
    top: calc(env(safe-area-inset-top) + 60px);
    z-index: 5;
    display: flex;
    gap: 4px;
    overflow-x: auto;
    margin: 0 calc(-1 * var(--abstand)) 14px;
    padding: 6px var(--abstand);
    background: var(--grund);
    border-bottom: 1px solid var(--linie);
    scrollbar-width: none;
  }
  /* Schatten am Rand, solange es in diese Richtung weitergeht (wandert mit dem Rollen, ohne Skript) */
  .reiter {
    background:
      linear-gradient(to right, var(--grund) 30%, transparent) left / 40px 100% no-repeat local,
      linear-gradient(to left, var(--grund) 30%, transparent) right / 40px 100% no-repeat local,
      radial-gradient(farthest-side at 0 50%, rgb(0 0 0 / 0.22), transparent) left / 16px 100% no-repeat scroll,
      radial-gradient(farthest-side at 100% 50%, rgb(0 0 0 / 0.22), transparent) right / 16px 100% no-repeat scroll,
      var(--grund);
  }
  /* Ab Tablet-Breite alle Reiter sichtbar (umbrechen statt waagerecht rollen) */
  @media (min-width: 700px) {
    .reiter { flex-wrap: wrap; overflow-x: visible; background: var(--grund); }
  }
  .reiter a {
    flex: none;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 14px;
    border-radius: 999px;
    text-decoration: none;
    font-weight: 600;
    color: var(--text);
  }
  .reiter a:hover { background: var(--flaeche); }
  .reiter a.aktiv { background: var(--blau); color: #fff; }
  .zaehler { margin-left: 6px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: var(--orange); color: #fff; font-size: 0.85rem; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
  .code-zeile {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 16px;
    padding: 12px 14px;
    margin-bottom: 12px;
    border-radius: 10px;
    background: var(--grund);
  }
  .code-gross { font-family: ui-monospace, monospace; font-size: 1.8rem; letter-spacing: 0.12em; color: var(--blau); }
  .qr-gross { margin: 6px 0 12px; }
  .meldung.aufruf { background: color-mix(in srgb, var(--gruen) 14%, var(--flaeche)); border: 2px solid var(--gruen); font-weight: 700; font-size: 1.1rem; }
  .warnungen { margin-bottom: 12px; }
  .abgelehnt { display: flex; gap: 10px; align-items: flex-start; }
  .abgelehnt ul { margin: 4px 0; padding-left: 18px; }
  .abgelehnt button { flex: none; }
  .eintrag-zeile { display: flex; gap: 10px; align-items: center; }
  .eintrag-zeile button { flex: none; min-height: 44px; }
  .eintrag.weg .text { text-decoration: line-through; color: var(--leise); }
  .eintrag.weg .marke { margin-left: 6px; text-decoration: none; display: inline-block; }
  .verlauf-hilfe { display: flex; align-items: center; gap: 4px; }
  .aktion {
    position: fixed;
    left: 50%;
    bottom: calc(12px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 30;
    width: min(32rem, calc(100vw - 24px));
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px 10px 8px 14px;
    border-radius: 12px;
    background: var(--text);
    color: var(--flaeche);
    box-shadow: 0 6px 24px rgb(0 0 0 / 30%);
    font-weight: 600;
  }
  .aktion button { min-height: 44px; flex: none; }
  .aktion .zweit { background: transparent; color: var(--flaeche); border-color: color-mix(in srgb, var(--flaeche) 50%, transparent); }
  .live-link, .live-zeile { display: flex; gap: 6px; flex-wrap: wrap; }
  .live-link a, .live-zeile a { display: inline-flex; align-items: center; min-height: 44px; }
  .reiter .mehr { display: none; }
  @media (max-width: 600px) {
    .reiter { flex-wrap: wrap; }
    .reiter .mehr { display: inline-block; min-width: 44px; min-height: 44px; }
    .reiter:not(.mehrOffen) .nebenbereich:not(.aktiv) { display: none; }
  }
</style>
