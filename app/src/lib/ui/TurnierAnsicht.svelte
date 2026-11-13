<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ART, type TurnierEinstellungen as Einstellungen } from '@shared/protokoll';
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api, serverPruefen, speicher } from '../dienste';
  import { app, fehlerText } from '../app.svelte';
  import { ApiFehler } from '../engine/api';
  import { TurnierSitzung } from '../engine/turnier';
  import type { AbgleichStatus } from '../engine/abgleich';
  import type { LokalesEreignis } from '../engine/typen';
  import type { TurnierZustand } from '../engine/zustand';
  import { berechnen } from '../engine/zustand';
  import { anzeigeName, geraetId, gemerktesTurnier, setzeAnzeigeName, turnierMerken, type GemerktesTurnier } from '../einstellungen';
  import { codeAnzeige, codeEingabe } from '../code';
  import { erinnerungFaellig, lokaleSicherung, setzeLokaleSicherung, sicherungAusgeben, sicherungErstellen } from '../sicherung';
  import StatusAnzeige from './StatusAnzeige.svelte';
  import Hilfe from './Hilfe.svelte';
  import TurnierEinstellungen from './TurnierEinstellungen.svelte';

  let { id }: { id: string } = $props();

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

  let notiz = $state('');
  let zugangCode = $state('');
  let zugangName = $state(anzeigeName());
  let zugangFehler = $state('');
  let kopiert = $state<'' | 'link' | 'code'>('');
  let jetzt = $state(Date.now());

  const darfSchreiben = $derived(lokal || !!eintrag?.token);
  const name = $derived(zustand?.name || eintrag?.name || '');
  const link = $derived(`${location.origin}${location.pathname}#/t/${id}`);
  const teilenNativ = typeof navigator !== 'undefined' && !!navigator.share;
  const erinnerung = $derived(
    lokal && zustand !== null && eintrag !== null && erinnerungFaellig(lokaleSicherung(id), zustand.anzahlEreignisse, ereignisse[0]?.zeit ?? eintrag.zuletzt, jetzt),
  );

  async function aktualisieren() {
    if (!sitzung) return;
    ereignisse = await sitzung.ereignisse();
    zustand = berechnen(ereignisse);
    status = sitzung.status ? { ...sitzung.status } : null;
  }

  async function einstellungenLaden() {
    const token = eintrag?.token;
    if (lokal || !token) return;
    try {
      einst = await api.einstellungen(token, id);
    } catch (x) {
      // Kein Leitungsrecht (z. B. veraltetes Token): Einstellungen ausblenden
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

  onMount(async () => {
    try {
      let g = gemerktesTurnier(id) ?? null;
      if (lokal) {
        if (!g) throw new Error(T.turnier.nichtGefunden);
      } else {
        const s = await serverPruefen();
        if (s.art !== 'bereit') throw new Error(T.start.keinServer);
        if (!g) {
          // Über einen Link beigetreten: zunächst als Zuschauer merken
          const info = (await api.turnier(id)).turnier;
          turnierMerken({ id, name: info.name, datum: info.datum, modus: 'online', rolle: 'zuschauer', token: null });
          g = gemerktesTurnier(id)!;
        } else {
          turnierMerken({ ...g }); // „zuletzt geöffnet“ aktualisieren
        }
      }
      eintrag = g;
      sitzung = new TurnierSitzung({
        speicher,
        turnier: id,
        modus: lokal ? 'lokal' : 'online',
        geraet: geraetId(),
        autor: { rolle: g.rolle, name: anzeigeName() || app.sitzung?.konto.name || 'Leitung' },
        api,
        token: () => gemerktesTurnier(id)?.token ?? null,
        beiAenderung: () => void aktualisieren(),
      });
      await aktualisieren();
      sitzung.start();
      void einstellungenLaden();
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
    document.removeEventListener('visibilitychange', beiSichtbarkeit);
    removeEventListener('online', beiOnline);
  });

  async function notizSenden(e: SubmitEvent) {
    e.preventDefault();
    const text = notiz.trim();
    if (!text || !sitzung) return;
    notiz = '';
    await sitzung.eintragen(ART.testNotiz, { text });
  }

  async function mitleiten(e: SubmitEvent) {
    e.preventDefault();
    zugangFehler = '';
    try {
      const a = await api.turnierZugang(id, zugangCode, zugangName.trim() || 'Leitung');
      setzeAnzeigeName(zugangName);
      turnierMerken({ ...eintrag!, rolle: a.rolle, token: a.token });
      eintrag = gemerktesTurnier(id) ?? null;
      zugangCode = '';
      void sitzung?.abgleich?.anstossen();
      void einstellungenLaden();
    } catch (x) {
      zugangFehler = fehlerText(x, T.app.fehlerAllgemein);
    }
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
    if (e.art === ART.testNotiz) return String(d.text ?? '');
    if (e.art === ART.turnierAngelegt) return `Turnier angelegt: ${String(d.name ?? '')}`;
    if (e.art === ART.turnierAbgeschlossen) return 'Turnier abgeschlossen';
    if (e.art === ART.turnierWiedereroeffnet) return 'Turnier wieder geöffnet';
    if (e.art === ART.turnierWiederhergestellt) return `Aus Sicherung wiederhergestellt (${String(d.anzahl ?? 0)} Einträge)`;
    return e.art;
  }
</script>

{#if laedt}
  <p class="leise">{T.app.laden}</p>
{:else if fehler}
  <div class="meldung fehler" role="alert">{fehler}</div>
  <a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a>
{:else}
  {#if hinweis}<div class="meldung ok" role="status">{hinweis}</div>{/if}

  <section class="kopf">
    <h1>{name}</h1>
    <div class="reihe">
      <StatusAnzeige {status} {lokal} />
      {#if zustand?.abgeschlossen}<span class="marke">{T.turnier.abgeschlossen}</span>{/if}
    </div>
  </section>

  {#if erinnerung}
    <div class="meldung info erinnerung" role="status">
      <span>{T.turnier.erinnerung}</span>
      <button class="klein" onclick={erinnerungSichern}>{T.turnier.erinnerungKnopf}</button>
    </div>
  {/if}

  {#if !lokal && !darfSchreiben}
    <form class="karte" onsubmit={mitleiten}>
      <p><span class="marke">{T.turnier.zuschauer}</span></p>
      <h2>{T.turnier.mitleiten}</h2>
      <p class="leise">{T.turnier.mitleitenText}</p>
      <label for="zc">{T.turnier.codeEingabe}</label>
      <input
        id="zc"
        class="code-feld"
        value={zugangCode}
        oninput={(e) => {
          zugangCode = codeEingabe(e.currentTarget.value);
          e.currentTarget.value = zugangCode;
        }}
        inputmode="numeric"
        pattern="[0-9]*"
        maxlength="6"
        autocomplete="one-time-code"
        required
      />
      <label for="zn">{T.turnier.deinName}</label>
      <input id="zn" bind:value={zugangName} autocomplete="name" required />
      {#if zugangFehler}<div class="meldung fehler" role="alert">{zugangFehler}</div>{/if}
      <button type="submit" style="margin-top:12px" disabled={zugangCode.length !== 6}>{T.turnier.mitleitenKnopf}</button>
    </form>
  {/if}

  {#if !lokal}
    <section class="karte">
      <h2>{T.turnier.teilen}</h2>
      <p class="leise">{T.turnier.teilenHinweis}</p>
      {#if darfSchreiben && einst}
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
  {/if}

  <section class="karte">
    <h2>{T.turnier.testTitel}</h2>
    <p class="leise">{T.turnier.testHinweis}</p>
    {#if darfSchreiben}
      <form class="reihe" onsubmit={notizSenden}>
        <input class="wachsen" bind:value={notiz} placeholder={T.turnier.testPlatzhalter} maxlength="200" aria-label={T.turnier.testPlatzhalter} />
        <button type="submit" disabled={!notiz.trim()}>{T.turnier.senden}</button>
      </form>
    {/if}
  </section>

  {#if darfSchreiben}
    <TurnierEinstellungen
      {id}
      {lokal}
      token={eintrag?.token ?? null}
      bind:einst
      abgeschlossen={zustand?.abgeschlossen ?? false}
      anzahl={zustand?.anzahlEreignisse ?? 0}
      eintragen={(art) => sitzung!.eintragen(art, {})}
      sicherung={sicherungBauen}
    />
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
              {zeit(e.zeit)} · {T.turnier.von} {e.autor?.name ?? '–'}
              {#if e.status === 'ausstehend'}<span class="marke">{T.turnier.ausstehend}</span>{/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .kopf { margin-bottom: 16px; }
  .kopf h1 { margin-bottom: 4px; overflow-wrap: anywhere; }
  .kennung { font-family: ui-monospace, monospace; font-size: 1.1rem; letter-spacing: 0.05em; }
  .eintrag.wartet { opacity: 0.75; }
  .erinnerung { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: var(--text); border-color: var(--orange); }
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
