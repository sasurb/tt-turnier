<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ART } from '@shared/protokoll';
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api, serverPruefen, speicher } from '../dienste';
  import { TurnierSitzung } from '../engine/turnier';
  import type { AbgleichStatus } from '../engine/abgleich';
  import type { LokalesEreignis } from '../engine/typen';
  import type { TurnierZustand } from '../engine/zustand';
  import { berechnen } from '../engine/zustand';
  import { anzeigeName, geraetId, gemerktesTurnier, setzeAnzeigeName, turnierMerken, type GemerktesTurnier } from '../einstellungen';
  import StatusAnzeige from './StatusAnzeige.svelte';

  let { id }: { id: string } = $props();

  const lokal = $derived(id.startsWith('l'));
  let eintrag = $state<GemerktesTurnier | null>(null);
  let sitzung: TurnierSitzung | null = null;
  let fehler = $state('');
  let laedt = $state(true);
  let zustand = $state<TurnierZustand | null>(null);
  let ereignisse = $state<LokalesEreignis[]>([]);
  let status = $state<AbgleichStatus | null>(null);

  let notiz = $state('');
  let zugangPasswort = $state('');
  let zugangName = $state(anzeigeName());
  let zugangFehler = $state('');
  let kopiert = $state(false);

  const darfSchreiben = $derived(lokal || !!eintrag?.token);
  const name = $derived(zustand?.name || eintrag?.name || '');
  const link = $derived(`${location.origin}${location.pathname}#/t/${id}`);

  async function aktualisieren() {
    if (!sitzung) return;
    ereignisse = await sitzung.ereignisse();
    zustand = berechnen(ereignisse);
    status = sitzung.status ? { ...sitzung.status } : null;
  }

  function beiSichtbarkeit() {
    if (document.visibilityState === 'visible') void sitzung?.abgleich?.anstossen();
  }
  function beiOnline() {
    void sitzung?.abgleich?.anstossen();
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
        autor: { rolle: g.rolle, name: anzeigeName() || 'Leitung' },
        api,
        token: () => gemerktesTurnier(id)?.token ?? null,
        beiAenderung: () => void aktualisieren(),
      });
      await aktualisieren();
      sitzung.start();
      document.addEventListener('visibilitychange', beiSichtbarkeit);
      addEventListener('online', beiOnline);
    } catch (x) {
      fehler = x instanceof Error ? x.message : T.app.fehlerAllgemein;
    } finally {
      laedt = false;
    }
  });

  onDestroy(() => {
    sitzung?.stop();
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

  async function zugang(e: SubmitEvent) {
    e.preventDefault();
    zugangFehler = '';
    try {
      const a = await api.turnierZugang(id, zugangPasswort, zugangName.trim() || 'Leitung');
      setzeAnzeigeName(zugangName);
      turnierMerken({ ...eintrag!, rolle: a.rolle, token: a.token });
      eintrag = gemerktesTurnier(id) ?? null;
      zugangPasswort = '';
      void sitzung?.abgleich?.anstossen();
    } catch (x) {
      zugangFehler = x instanceof Error ? x.message : T.app.fehlerAllgemein;
    }
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(link);
      kopiert = true;
      setTimeout(() => (kopiert = false), 2000);
    } catch {
      prompt(T.turnier.linkKopieren, link);
    }
  }

  function zeit(iso: string) {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function beschreibung(e: LokalesEreignis): string {
    const d = e.daten as Record<string, unknown>;
    if (e.art === ART.testNotiz) return String(d.text ?? '');
    if (e.art === ART.turnierAngelegt) return `Turnier angelegt: ${String(d.name ?? '')}`;
    return e.art;
  }
</script>

{#if laedt}
  <p class="leise">{T.app.laden}</p>
{:else if fehler}
  <div class="meldung fehler" role="alert">{fehler}</div>
  <a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a>
{:else}
  <section class="kopf">
    <h1>{name}</h1>
    <StatusAnzeige {status} {lokal} />
  </section>

  {#if !lokal}
    <details class="karte">
      <summary>{T.turnier.teilen}</summary>
      <p class="leise">{T.turnier.teilenHinweis}</p>
      <p>{T.turnier.kennung}: <strong class="kennung">{id}</strong></p>
      <div class="reihe">
        <input class="wachsen" readonly value={link} aria-label="Link" onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
        <button class="zweit" onclick={kopieren}>{kopiert ? T.turnier.kopiert : T.turnier.linkKopieren}</button>
      </div>
    </details>
  {/if}

  {#if !darfSchreiben}
    <form class="karte" onsubmit={zugang}>
      <p><span class="marke">{T.turnier.zuschauer}</span></p>
      <h2>{T.turnier.alsLeitungAnmelden}</h2>
      <label for="zp">{T.beitreten.passwort}</label>
      <input id="zp" type="password" bind:value={zugangPasswort} autocomplete="off" required />
      <label for="zn">{T.beitreten.deinName}</label>
      <input id="zn" bind:value={zugangName} autocomplete="name" required />
      {#if zugangFehler}<div class="meldung fehler" role="alert">{zugangFehler}</div>{/if}
      <button type="submit" style="margin-top:12px">{T.beitreten.knopf}</button>
    </form>
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
  .kopf h1 { margin-bottom: 4px; }
  .kennung { font-family: ui-monospace, monospace; font-size: 1.1rem; letter-spacing: 0.05em; }
  .eintrag.wartet { opacity: 0.75; }
</style>
