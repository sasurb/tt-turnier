<script lang="ts">
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { angemeldet, fehlerText } from '../app.svelte';
  import PasswortFeld from './PasswortFeld.svelte';

  let { schluessel }: { schluessel: string } = $props();
  let passwort = $state('');
  let fehler = $state('');
  let laeuft = $state(false);

  async function speichern(e: SubmitEvent) {
    e.preventDefault();
    fehler = '';
    laeuft = true;
    try {
      angemeldet(await api.passwortZuruecksetzen(schluessel, passwort), T.zuruecksetzen.fertig);
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.zuruecksetzen.titel}</h1>
<form class="karte" onsubmit={speichern}>
  <label for="zp">{T.zuruecksetzen.passwort}</label>
  <PasswortFeld id="zp" bind:wert={passwort} neu min={8} />
  {#if fehler}
    <div class="meldung fehler" role="alert">{fehler}</div>
    <p><a href={linkZu('vergessen')}>{T.zuruecksetzen.neuAnfordern}</a></p>
  {/if}
  <button type="submit" class="breit" style="margin-top:16px" disabled={laeuft}>{T.zuruecksetzen.knopf}</button>
</form>
