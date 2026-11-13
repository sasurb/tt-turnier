<script lang="ts">
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { setzeAnzeigeName, setzeKontoSitzung, anzeigeName } from '../einstellungen';

  let email = $state('');
  let passwort = $state('');
  let fehler = $state('');
  let laeuft = $state(false);

  async function anmelden(e: SubmitEvent) {
    e.preventDefault();
    fehler = '';
    laeuft = true;
    try {
      const a = await api.login(email.trim(), passwort);
      setzeKontoSitzung({ token: a.token, konto: a.konto });
      if (!anzeigeName()) setzeAnzeigeName(a.konto.name);
      gehe('konto');
    } catch (x) {
      fehler = x instanceof Error ? x.message : T.app.fehlerAllgemein;
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.anmelden.titel}</h1>
<form class="karte" onsubmit={anmelden}>
  <label for="e">{T.anmelden.email}</label>
  <input id="e" type="email" bind:value={email} autocomplete="username" inputmode="email" required />
  <label for="p">{T.anmelden.passwort}</label>
  <input id="p" type="password" bind:value={passwort} autocomplete="current-password" required />
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <div class="reihe" style="margin-top:16px">
    <button type="submit" disabled={laeuft}>{T.anmelden.knopf}</button>
    <a class="knopf zweit" href={linkZu('')}>{T.app.abbrechen}</a>
  </div>
</form>
<p class="leise">{T.anmelden.hinweis}</p>
