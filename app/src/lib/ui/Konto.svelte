<script lang="ts">
  import { onMount } from 'svelte';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { abmelden, anmeldungAbgelaufen, app, fehlerText, setzeSitzung } from '../app.svelte';
  import PasswortFeld from './PasswortFeld.svelte';

  const sitzung = $derived(app.sitzung);

  let pwAlt = $state('');
  let pwNeu = $state('');
  let pwMeldung = $state<{ ok: boolean; text: string } | null>(null);
  let loeschPw = $state('');
  let loeschFehler = $state('');

  onMount(() => {
    if (!app.sitzung) gehe('anmelden');
  });

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
  .gefahrzone summary { color: var(--rot); }
</style>
