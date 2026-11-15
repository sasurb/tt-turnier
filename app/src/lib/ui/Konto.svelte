<script lang="ts">
  import { onMount } from 'svelte';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { abmelden, anmeldungAbgelaufen, app, fehlerText, setzeSitzung } from '../app.svelte';
  import PasswortFeld from './PasswortFeld.svelte';
  import { klassen, klassenLaden, klassenSpeichern } from '../klassen.svelte';

  const sitzung = $derived(app.sitzung);

  let pwAlt = $state('');
  let pwNeu = $state('');
  let pwMeldung = $state<{ ok: boolean; text: string } | null>(null);
  let loeschPw = $state('');
  let loeschFehler = $state('');

  onMount(() => {
    if (!app.sitzung) gehe('anmelden');
    else void klassenLaden();
  });

  let neueKlasse = $state('');
  let klassenMeldung = $state('');
  async function klasseHinzu(e: SubmitEvent) {
    e.preventDefault();
    if (!neueKlasse.trim()) return;
    try {
      await klassenSpeichern([...klassen.liste, neueKlasse]);
      neueKlasse = '';
      klassenMeldung = '';
    } catch (x) {
      klassenMeldung = fehlerText(x, T.app.fehlerAllgemein);
    }
  }
  async function klasseWeg(k: string) {
    try {
      await klassenSpeichern(klassen.liste.filter((x) => x !== k));
    } catch (x) {
      klassenMeldung = fehlerText(x, T.app.fehlerAllgemein);
    }
  }

  async function passwortAendern(e: SubmitEvent) {
    e.preventDefault();
    if (!sitzung) return;
    try {
      await api.passwortAendern(sitzung.token, pwAlt, pwNeu);
      pwMeldung = { ok: true, text: T.konto.passwortGeaendert };
      pwAlt = pwNeu = '';
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) pwMeldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    }
  }

  async function loeschen(e: SubmitEvent) {
    e.preventDefault();
    if (!sitzung || !confirm(T.konto.loeschenFrage)) return;
    loeschFehler = '';
    try {
      await api.kontoLoeschen(sitzung.token, loeschPw);
      setzeSitzung(null);
      app.hinweis = T.konto.geloescht;
      gehe('');
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) loeschFehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  }
</script>

{#if sitzung}
  <h1>{T.konto.titel}</h1>

  <section class="karte">
    <p><strong>{sitzung.konto.name}</strong><br /><span class="leise">{sitzung.konto.email}</span></p>
    <p>
      <span class="marke">{sitzung.konto.rolle === 'admin' ? T.konto.rolleAdmin : T.konto.rolleVeranstalter}</span>
    </p>
    {#if sitzung.konto.rolle === 'admin'}
      <a class="knopf zweit" href={linkZu('verwaltung')}>{T.konto.zurVerwaltung}</a>
    {/if}
  </section>

  <section class="karte">
    <a class="knopf zweit breit" href={linkZu('turniere')}>{T.konto.turniere}</a>
  </section>

  <details class="karte">
    <summary>{T.konto.klassenTitel}</summary>
    <p class="leise">{T.konto.klassenText}</p>
    {#if klassen.liste.length === 0}
      <p class="leise">{T.konto.klassenLeer}</p>
    {:else}
      <ul class="klassen">
        {#each klassen.liste as k (k)}
          <li><span>{k}</span><button class="zweit klein" aria-label="{k}: {T.app.entfernen}" onclick={() => klasseWeg(k)}>✕</button></li>
        {/each}
      </ul>
    {/if}
    <form class="reihe" onsubmit={klasseHinzu}>
      <input class="wachsen" bind:value={neueKlasse} placeholder={T.konto.klassenPlatzhalter} aria-label={T.konto.klassenNeu} maxlength="40" autocomplete="off" />
      <button type="submit" class="zweit" disabled={!neueKlasse.trim()}>{T.konto.klassenNeu}</button>
    </form>
    {#if klassenMeldung}<div class="meldung fehler" role="alert">{klassenMeldung}</div>{/if}
  </details>

  <section class="karte">
    <button class="zweit breit" onclick={abmelden}>{T.konto.abmelden}</button>
    <p class="leise unten">{T.konto.abmeldenHinweis}</p>
  </section>

  <details class="karte">
    <summary>{T.konto.passwortAendern}</summary>
    <form onsubmit={passwortAendern}>
      <label for="pa">{T.konto.passwortAlt}</label>
      <PasswortFeld id="pa" bind:wert={pwAlt} />
      <label for="pn">{T.konto.passwortNeu}</label>
      <PasswortFeld id="pn" bind:wert={pwNeu} neu min={8} />
      {#if pwMeldung}<div class="meldung" class:ok={pwMeldung.ok} class:fehler={!pwMeldung.ok}>{pwMeldung.text}</div>{/if}
      <button type="submit" style="margin-top:12px">{T.app.speichern}</button>
    </form>
  </details>

  <section class="karte">
    <h2>{T.konto.rueckmeldung}</h2>
    <p class="leise">{T.konto.rueckmeldungText}</p>
    <a class="knopf zweit" href={linkZu('kontakt')}>{T.konto.rueckmeldung}</a>
  </section>

  {#if sitzung.konto.rolle !== 'admin'}
    <details class="karte gefahrzone">
      <summary>{T.konto.loeschen}</summary>
      <p class="leise">{T.konto.loeschenText}</p>
      <form onsubmit={loeschen}>
        <label for="lp">{T.konto.loeschenPasswort}</label>
        <PasswortFeld id="lp" bind:wert={loeschPw} />
        {#if loeschFehler}<div class="meldung fehler" role="alert">{loeschFehler}</div>{/if}
        <button type="submit" class="gefahr" style="margin-top:12px">{T.konto.loeschenKnopf}</button>
      </form>
    </details>
  {/if}
{/if}

<style>
  .unten { margin: 10px 0 0; }
  .klassen { list-style: none; padding: 0; margin: 0 0 10px; display: flex; flex-wrap: wrap; gap: 8px; }
  .klassen li { display: inline-flex; align-items: center; gap: 6px; padding: 4px 4px 4px 12px; border: 1px solid var(--linie); border-radius: 999px; }
  .gefahrzone summary { color: var(--rot); }
</style>
