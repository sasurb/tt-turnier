<script lang="ts">
  import type { RueckmeldungArt } from '@shared/protokoll';
  import { T } from '../texte';
  import { api } from '../dienste';
  import { app, fehlerText } from '../app.svelte';
  import { BETREIBER } from '../rechtliches';

  const arten = Object.entries(T.kontakt.arten) as [RueckmeldungArt, string][];
  let art = $state<RueckmeldungArt>(app.sitzung ? 'fehler' : 'kontakt');
  let text = $state('');
  let name = $state('');
  let email = $state('');
  let website = $state('');
  let fehler = $state('');
  let gesendet = $state(false);
  let laeuft = $state(false);

  async function senden(e: SubmitEvent) {
    e.preventDefault();
    fehler = '';
    laeuft = true;
    try {
      const s = app.sitzung;
      await api.rueckmeldung(s?.token ?? null, s ? { art, text: text.trim(), website } : { art, text: text.trim(), name: name.trim(), email: email.trim(), website });
      gesendet = true;
      text = '';
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.kontakt.titel}</h1>

{#if app.server.art !== 'bereit'}
  <div class="meldung info">
    {T.kontakt.ohneServer}
    {#if BETREIBER.mail}<a href={'mailto:' + BETREIBER.mail}>{BETREIBER.mail}</a>{/if}
    {#if BETREIBER.kontaktUrl}· <a href={BETREIBER.kontaktUrl.replace(/\/?$/, '/') + '#/kontakt'}>{T.kontakt.titel}</a>{/if}
  </div>
{:else if gesendet}
  <div class="meldung ok" role="status">{T.kontakt.gesendet}</div>
  <button class="zweit" onclick={() => (gesendet = false)}>{T.kontakt.knopf}</button>
{:else}
  <p class="leise">{T.kontakt.einleitung}</p>
  <form class="karte" onsubmit={senden}>
    <label for="ka">{T.kontakt.art}</label>
    <select id="ka" bind:value={art}>
      {#each arten as [wert, text] (wert)}
        <option value={wert}>{text}</option>
      {/each}
    </select>
    <label for="kt">{T.kontakt.text}</label>
    <textarea id="kt" bind:value={text} rows="6" minlength="5" maxlength="4000" placeholder={T.kontakt.textPlatzhalter} required></textarea>
    {#if !app.sitzung}
      <label for="kn">{T.kontakt.name}</label>
      <input id="kn" bind:value={name} autocomplete="name" minlength="2" required />
      <label for="ke">{T.kontakt.email}</label>
      <input id="ke" type="email" bind:value={email} autocomplete="email" inputmode="email" autocapitalize="off" required />
    {/if}
    <div class="fang" aria-hidden="true">
      <label for="kw">Website</label>
      <input id="kw" bind:value={website} tabindex="-1" autocomplete="off" />
    </div>
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <button type="submit" class="breit" style="margin-top:16px" disabled={laeuft}>{T.kontakt.knopf}</button>
  </form>
{/if}

<style>
  .fang { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
  textarea { resize: vertical; }
</style>
