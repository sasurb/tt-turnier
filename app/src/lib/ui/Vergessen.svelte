<script lang="ts">
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { fehlerText } from '../app.svelte';

  let email = $state('');
  let fehler = $state('');
  let gesendet = $state(false);
  let laeuft = $state(false);

  async function senden(e: SubmitEvent) {
    e.preventDefault();
    fehler = '';
    laeuft = true;
    try {
      await api.passwortVergessen(email.trim());
      gesendet = true;
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.vergessen.titel}</h1>
{#if gesendet}
  <div class="meldung ok" role="status">{T.vergessen.gesendet}</div>
  <a class="knopf zweit" href={linkZu('anmelden')}>{T.anmelden.knopf}</a>
{:else}
  <p class="leise">{T.vergessen.einleitung}</p>
  <form class="karte" onsubmit={senden}>
    <label for="ve">{T.anmelden.email}</label>
    <input id="ve" type="email" bind:value={email} autocomplete="email" inputmode="email" autocapitalize="off" required />
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <div class="reihe" style="margin-top:16px">
      <button type="submit" disabled={laeuft}>{T.vergessen.knopf}</button>
      <a class="knopf zweit" href={linkZu('anmelden')}>{T.app.zurueck}</a>
    </div>
  </form>
{/if}
