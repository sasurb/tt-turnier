<script lang="ts">
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { angemeldet, app, fehlerText } from '../app.svelte';
  import PasswortFeld from './PasswortFeld.svelte';

  let email = $state('');
  let passwort = $state('');
  let fehler = $state('');
  let laeuft = $state(false);

  async function anmelden(e: SubmitEvent) {
    e.preventDefault();
    fehler = '';
    laeuft = true;
    try {
      angemeldet(await api.login(email.trim(), passwort));
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.anmelden.titel}</h1>
{#if app.server.art === 'keiner'}
  <div class="meldung info">{T.app.keinServer}</div>
{/if}
<form class="karte" onsubmit={anmelden}>
  <label for="e">{T.anmelden.email}</label>
  <input id="e" type="email" bind:value={email} autocomplete="username" inputmode="email" autocapitalize="off" required />
  <label for="p">{T.anmelden.passwort}</label>
  <PasswortFeld id="p" bind:wert={passwort} />
  <p class="vergessen"><a href={linkZu('vergessen')}>{T.anmelden.vergessen}</a></p>
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <button type="submit" class="breit" disabled={laeuft}>{T.anmelden.knopf}</button>
  <p class="leise unten">{T.anmelden.hinweisGeraet}</p>
</form>

<section class="karte neu">
  <span>{T.anmelden.keinKonto}</span>
  <a class="knopf zweit" href={linkZu('registrieren')}>{T.anmelden.kontoAnlegen}</a>
</section>

<style>
  .vergessen { margin: 8px 0 4px; text-align: right; }
  .vergessen a { display: inline-flex; min-height: 40px; align-items: center; }
  .unten { margin: 12px 0 0; }
  .neu { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
</style>
