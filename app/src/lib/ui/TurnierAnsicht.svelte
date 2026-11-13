<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { ART, type Rolle, type TurnierEinstellungen as Einstellungen } from '@shared/protokoll';
  import { T } from '../texte';
  import { ersetze, linkZu } from '../router.svelte';
  import { api, serverPruefen, speicher } from '../dienste';
  import { app, fehlerText } from '../app.svelte';
  import { ApiFehler } from '../engine/api';
  import { TurnierSitzung } from '../engine/turnier';
  import type { AbgleichStatus } from '../engine/abgleich';
  import type { LokalesEreignis } from '../engine/typen';
  import { berechnen, type TurnierZustand } from '../engine/zustand';
  import { name as spName } from '../engine/abfragen';
  import { ergebnisText } from '../engine/ergebnis';
  import type { Spiel } from '../engine/modell';
  import { uebersichtText } from '../engine/uebersicht';
  import { anzeigeName, geraetId, gemerktesTurnier, setzeAnzeigeName, turnierAbmelden, turnierMerken, type GemerktesTurnier } from '../einstellungen';
  import { codeAnzeige } from '../code';
  import { appBasis } from '../zentrale.svelte';
  import { nativ } from '../nativ';
  import { erinnerungFaellig, lokaleSicherung, setzeLokaleSicherung, sicherungAusgeben, sicherungErstellen } from '../sicherung';
  import StatusAnzeige from './StatusAnzeige.svelte';
  import Hilfe from './Hilfe.svelte';
  import TurnierEinstellungen from './TurnierEinstellungen.svelte';
  import SpieleListe from './turnier/SpieleListe.svelte';
  import Tabellen from './turnier/Tabellen.svelte';
  import SpielerTab from './turnier/SpielerTab.svelte';
  import KonkurrenzenTab from './turnier/KonkurrenzenTab.svelte';
  import Codes from './turnier/Codes.svelte';
  import Mitmachen from './turnier/Mitmachen.svelte';
  import ErgebnisDialog from './turnier/ErgebnisDialog.svelte';

  let { id, reiter = null, code = null }: { id: string; reiter?: string | null; code?: string | null } = $props();

  const lokal = $derived(id.startsWith('l'));
  let eintrag = $state<GemerktesTurnier | null>(null);
  let sitzung: TurnierSitzung | null = null;
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
  let jetzt = $state(Date.now());
  let offen = $state<{ k: string; s: string } | null>(null);

  const rolle = $derived<Rolle>(lokal ? 'leitung' : eintrag?.token ? eintrag.rolle : 'zuschauer');
  const leitung = $derived(lokal || rolle === 'leitung' || rolle === 'admin' || rolle === 'veranstalter');
  const ich = $derived(rolle === 'spieler' ? (eintrag?.spieler ?? null) : null);
  const darfSchreiben = $derived(lokal || !!eintrag?.token);
  const name = $derived(zustand?.name || eintrag?.name || '');
  const link = $derived(`${appBasis()}#/t/${id}`);
  const teilenNativ = typeof navigator !== 'undefined' && (!!navigator.share || !!nativ());
  /** Online: Turnier liegt auf einer Zentrale. Zentrale: Turnier wurde zurückgegeben. */
  let sperre = $state<{ zentrale: string | null; abgegeben: boolean } | null>(null);
  const erinnerung = $derived(
    lokal && zustand !== null && eintrag !== null && erinnerungFaellig(lokaleSicherung(id), zustand.anzahlEreignisse, ereignisse[0]?.zeit ?? eintrag.zuletzt, jetzt),
  );

  type Reiter = 'meine' | 'spiele' | 'tabellen' | 'spieler' | 'konkurrenzen' | 'zugaenge' | 'einstellungen' | 'protokoll';
  const reiterListe = $derived<Reiter[]>(
    leitung
      ? ['spiele', 'tabellen', 'spieler', 'konkurrenzen', ...(lokal ? [] : ['zugaenge' as const]), 'einstellungen', 'protokoll']
      : rolle === 'spieler'
        ? ['meine', 'spiele', 'tabellen']
        : rolle === 'helfer'
          ? ['spiele', 'tabellen', 'protokoll']
          : ['tabellen', 'spiele'],
  );
  const standardReiter = $derived<Reiter>(
    leitung ? (!zustand?.spielerReihe.length ? 'spieler' : !zustand.konkurrenzReihe.length ? 'konkurrenzen' : 'spiele') : rolle === 'spieler' ? 'meine' : rolle === 'helfer' ? 'spiele' : 'tabellen',
  );
  const aktiv = $derived<Reiter>(reiter && reiterListe.includes(reiter as Reiter) ? (reiter as Reiter) : standardReiter);

  async function aktualisieren() {
    if (!sitzung) return;
    ereignisse = await sitzung.ereignisse();
    zustand = berechnen(ereignisse);
    status = sitzung.status ? { ...sitzung.status } : null;
  }

  async function einstellungenLaden() {
    const token = eintrag?.token;
    if (lokal || !token || !leitung) return;
    try {
      einst = await api.einstellungen(token, id);
    } catch (x) {
      if (x instanceof ApiFehler && !x.istNetzwerk) einst = null;
    }
  }

  function beiSichtbarkeit() {
    if (document.visibilityState === 'visible') void sitzung?.abgleich?.anstossen();
  }
  function beiOnline() {
    void sitzung?.abgleich?.anstossen();
  }
  const uhr = setInterval(() => (jetzt = Date.now()), 60_000);

  function autor() {
    const g = gemerktesTurnier(id);
    return {
      rolle: lokal ? ('leitung' as Rolle) : (g?.token ? g.rolle : 'zuschauer'),
      name: g?.wer || anzeigeName() || app.sitzung?.konto.name || 'Leitung',
      ...(g?.spieler ? { spieler: g.spieler } : {}),
    };
  }

  async function mitCodeAnmelden(c: string, n: string) {
    zugangFehler = '';
    try {
      const a = await api.turnierZugang(id, c, n || undefined);
      if (a.rolle === 'leitung' && n) setzeAnzeigeName(n);
      turnierMerken({ ...eintrag!, rolle: a.rolle, token: a.token, spieler: a.spieler ?? null, wer: a.rolle === 'leitung' ? n || null : (a.name ?? null) });
      eintrag = gemerktesTurnier(id) ?? null;
      if (a.rolle === 'spieler' && a.name) hinweis = T.zugang.willkommen(a.name);
      void sitzung?.abgleich?.anstossen();
      void einstellungenLaden();
      ersetze(`t/${id}/${standardReiter}`);
    } catch (x) {
      zugangFehler = fehlerText(x, T.app.fehlerAllgemein);
      throw x;
    }
  }

  /** Persönlicher Link …/#/c/<turnier>/<code>: gleich anmelden */
  let verwendet = '';
  async function codeVerwenden(c: string) {
    if (verwendet === c) return;
    verwendet = c;
    try {
      await mitCodeAnmelden(c, '');
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
    turnierAbmelden(id);
    eintrag = gemerktesTurnier(id) ?? null;
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
        token: () => gemerktesTurnier(id)?.token ?? null,
        beiAenderung: () => void aktualisieren(),
      });
      await aktualisieren();
      sitzung.start();
      if (code && !lokal) await codeVerwenden(code);
      // Reiter festhalten, damit die Seite beim Eintragen nicht springt
      if (!code && !reiter) ersetze(`t/${id}/${standardReiter}`);
      void einstellungenLaden();
      if (!lokal) {
        api
          .turnier(id)
          .then((a) => (sperre = a.turnier.zentrale || a.turnier.abgegeben ? { zentrale: a.turnier.zentrale ?? null, abgegeben: !!a.turnier.abgegeben } : null))
          .catch(() => undefined);
      }
      document.addEventListener('visibilitychange', beiSichtbarkeit);
      addEventListener('online', beiOnline);
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laedt = false;
    }
  });

  onDestroy(() => {
    sitzung?.stop();
    clearInterval(uhr);
    clearTimeout(uebersichtTimer);
    document.removeEventListener('visibilitychange', beiSichtbarkeit);
    removeEventListener('online', beiOnline);
  });

  async function eintragen(art: string, daten: Record<string, unknown>) {
    if (!sitzung) throw new Error(T.app.fehlerAllgemein);
    await sitzung.eintragen(art, daten);
  }

  /* Lesbaren Stand für die Sicherungsmail hochladen (nur Leitung, online, höchstens alle 20 s) */
  let uebersichtTimer: ReturnType<typeof setTimeout> | undefined;
  let letzteUebersicht = '';
  $effect(() => {
    const z = zustand;
    const token = eintrag?.token;
    if (!z || lokal || !leitung || !token || app.server.art !== 'bereit' || !app.server.info.codes) return;
    void z.anzahlEreignisse;
    clearTimeout(uebersichtTimer);
    uebersichtTimer = setTimeout(() => {
      const text = uebersichtText(z);
      if (text === letzteUebersicht) return;
      api.uebersicht(token, id, text).then(() => (letzteUebersicht = text)).catch(() => undefined);
    }, 20_000);
  });

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
        return `Turnier angelegt: ${String(d.name ?? '')}`;
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
      case ART.spielErgebnis: {
        const s = z && typeof d.spiel === 'string' ? z.konkurrenzen[String(d.konkurrenz)]?.spiele[d.spiel] : undefined;
        const namen = z ? `${spName(z, String(d.a ?? ''))} – ${spName(z, String(d.b ?? ''))}` : '';
        const erg = s?.eintrag?.ereignis === e.id && s.ergebnis ? ` ${ergebnisText(s.ergebnis)}` : '';
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
  <a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a>
{:else}
  {#if hinweis}<div class="meldung ok" role="status">{hinweis}</div>{/if}
  {#if sperre?.zentrale}<div class="meldung info" role="status" data-testid="sperre">{T.zentrale.gesperrtOnline(sperre.zentrale)}</div>{/if}
  {#if sperre?.abgegeben}<div class="meldung info" role="status" data-testid="sperre">{T.zentrale.abgegebenHinweis}</div>{/if}

  <section class="kopf">
    <h1>{name}</h1>
    <div class="reihe">
      <StatusAnzeige {status} {lokal} />
      {#if zustand?.abgeschlossen}<span class="marke">{T.turnier.abgeschlossen}</span>{/if}
      {#if !lokal && eintrag?.token && !leitung}
        <span class="leise">{T.zugang.angemeldet(eintrag.wer ?? '', T.rollen[rolle])}</span>
        <button class="zweit klein" onclick={codeAbmelden}>{T.zugang.abmelden}</button>
      {/if}
    </div>
  </section>

  {#if erinnerung}
    <div class="meldung info erinnerung" role="status">
      <span>{T.turnier.erinnerung}</span>
      <button class="klein" onclick={erinnerungSichern}>{T.turnier.erinnerungKnopf}</button>
    </div>
  {/if}

  {#if !lokal && !darfSchreiben}
    <details class="karte mitmachen" open={!!zugangFehler}>
      <summary>{T.zugang.titel}</summary>
      <Mitmachen anmelden={mitCodeAnmelden} fehler={zugangFehler} standardName={anzeigeName()} />
    </details>
  {/if}

  <nav class="reiter" aria-label="Bereiche">
    {#each reiterListe as r (r)}
      <a href={linkZu(`t/${id}/${r}`)} class:aktiv={aktiv === r} aria-current={aktiv === r ? 'page' : undefined}>{T.reiter[r]}</a>
    {/each}
  </nav>

  {#if zustand}
    {#if aktiv === 'meine'}
      <SpieleListe z={zustand} leitung={false} {ich} nurMeine {oeffnen} />
    {:else if aktiv === 'spiele'}
      <SpieleListe z={zustand} {leitung} {ich} {oeffnen} />
    {:else if aktiv === 'tabellen'}
      <Tabellen z={zustand} {leitung} {eintragen} {oeffnen} />
    {:else if aktiv === 'spieler'}
      <SpielerTab z={zustand} {eintragen} />
    {:else if aktiv === 'konkurrenzen'}
      <KonkurrenzenTab z={zustand} {eintragen} />
    {:else if aktiv === 'zugaenge'}
      <section class="karte">
        <h2>{T.turnier.teilen}</h2>
        <p class="leise">{T.turnier.teilenHinweis}</p>
        {#if einst}
          {#if einst.leitungsCode}
            <div class="code-zeile">
              <span>{T.turnier.code}<Hilfe text={T.turnier.codeHilfe} /></span>
              <strong class="code-gross" data-testid="leitungscode">{codeAnzeige(einst.leitungsCode)}</strong>
              <button class="zweit klein" onclick={() => kopieren('code', einst!.leitungsCode!)}>{kopiert === 'code' ? T.turnier.kopiert : T.turnier.codeKopieren}</button>
            </div>
          {:else}
            <div class="meldung info">{T.turnier.codeUnbekannt}</div>
          {/if}
        {/if}
        <p>{T.turnier.kennung}: <strong class="kennung">{id}</strong></p>
        <div class="reihe">
          <input class="wachsen" readonly value={link} aria-label="Link" onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
          {#if teilenNativ}<button onclick={linkTeilen}>{T.turnier.linkTeilen}</button>{/if}
          <button class="zweit" onclick={() => kopieren('link', link)}>{kopiert === 'link' ? T.turnier.kopiert : T.turnier.linkKopieren}</button>
        </div>
      </section>
      {#if eintrag?.token}
        <Codes z={zustand} {id} token={eintrag.token} turnierName={name} />
      {/if}
    {:else if aktiv === 'einstellungen'}
      <TurnierEinstellungen
        {id}
        {lokal}
        token={eintrag?.token ?? null}
        bind:einst
        abgeschlossen={zustand.abgeschlossen}
        anzahl={zustand.anzahlEreignisse}
        eintragen={(art) => sitzung!.eintragen(art, {})}
        sicherung={sicherungBauen}
      />
    {:else if aktiv === 'protokoll'}
      {#if leitung && zustand.warnungen.length}
        <details class="karte">
          <summary>{T.warn.titel} <span class="leise">({zustand.warnungen.length})</span></summary>
          <p class="leise">{T.warn.text}</p>
          <ul class="liste">
            {#each [...zustand.warnungen].reverse() as w (w.ereignis)}
              <li><div>{w.text}</div><div class="leise">{zeit(w.zeit)} · {T.turnier.von} {w.von || '–'}</div></li>
            {/each}
          </ul>
        </details>
      {/if}
      <section class="karte">
        <h2>{T.turnier.protokoll} <span class="leise">({ereignisse.length})</span></h2>
        {#if ereignisse.length === 0}
          <p class="leise">{T.turnier.leer}</p>
        {:else}
          <ul class="liste">
            {#each [...ereignisse].reverse() as e (e.id)}
              <li class="eintrag" class:wartet={e.status === 'ausstehend'}>
                <div>{beschreibung(e)}</div>
                <div class="leise">
                  {#if e.seq !== null && e.status === 'bestaetigt'}#{e.seq} · {/if}
                  {zeit(e.zeit)} · {T.turnier.von} {e.autor?.name ?? '–'}{e.autor && e.autor.rolle !== 'leitung' ? ` (${T.rollen[e.autor.rolle]})` : ''}
                  {#if e.status === 'ausstehend'}<span class="marke">{T.turnier.ausstehend}</span>{/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    {#if offenesSpiel}
      <ErgebnisDialog z={zustand} k={offenesSpiel.k} spiel={offenesSpiel.s} {rolle} {ich} {eintragen} schliessen={() => (offen = null)} />
    {/if}
  {/if}
{/if}

<style>
  .kopf { margin-bottom: 12px; }
  .kopf h1 { margin-bottom: 4px; overflow-wrap: anywhere; }
  .kennung { font-family: ui-monospace, monospace; font-size: 1.1rem; letter-spacing: 0.05em; }
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
</style>
