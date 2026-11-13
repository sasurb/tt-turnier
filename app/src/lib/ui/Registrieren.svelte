<script lang="ts">
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { angemeldet, app, fehlerText } from '../app.svelte';
  import PasswortFeld from './PasswortFeld.svelte';
  import Hilfe from './Hilfe.svelte';

  let name = $state('');
  let email = $state('');
  let passwort = $state('');
  let website = $state(''); // Fangfeld für Bots, für Menschen unsichtbar
  let fehler = $state('');
  let laeuft = $state(false);

  async function anlegen(e: SubmitEvent) {
    e.preventDefault();
    fehler = '';
    laeuft = true;
    try {
      const a = await api.registrieren({ name: name.trim(), email: email.trim(), passwort, website });
      angemeldet(a, T.registrieren.willkommen);
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.registrieren.titel}</h1>
<p class="leise">{T.registrieren.einleitung}</p>
{#if app.server.art === 'keiner'}
  <div class="meldung info">{T.app.keinServer}</div>
{/if}

<form class="karte" onsubmit={anlegen}>
  <div class="label-zeile"><label for="rn">{T.registrieren.name}</label><Hilfe text={T.registrieren.nameHilfe} /></div>
  <input id="rn" bind:value={name} autocomplete="organization" minlength="2" maxlength="120" required />
  <div class="label-zeile"><label for="re">{T.registrieren.email}</label><Hilfe text={T.registrieren.emailHilfe} /></div>
  <input id="re" type="email" bind:value={email} autocomplete="email" inputmode="email" autocapitalize="off" required />
  <label for="rp">{T.registrieren.passwort}</label>
  <PasswortFeld id="rp" bind:wert={passwort} neu min={8} />

  <div class="fang" aria-hidden="true">
    <label for="rw">Website</label>
    <input id="rw" bind:value={website} tabindex="-1" autocomplete="off" />
  </div>

  <p class="leise datenschutz">
    {T.registrieren.datenschutzVor} <a href={linkZu('datenschutz')}>{T.registrieren.datenschutzLink}</a>{T.registrieren.datenschutzNach}
  </p>
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <button type="submit" class="breit" disabled={laeuft}>{T.registrieren.knopf}</button>
</form>

<section class="karte neu">
  <span>{T.registrieren.schonKonto}</span>
  <a class="knopf zweit" href={linkZu('anmelden')}>{T.anmelden.knopf}</a>
</section>

<style>
  .fang { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
  .datenschutz { margin: 16px 0 12px; }
  .neu { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
</style>
