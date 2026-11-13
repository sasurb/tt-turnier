<script lang="ts">
  import { onMount } from 'svelte';
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api, serverPruefen } from '../dienste';

  let code = $state('');
  let name = $state('');
  let email = $state('');
  let passwort = $state('');
  let fehler = $state('');
  let fertig = $state(false);
  let schon = $state(false);
  let laeuft = $state(false);

  onMount(async () => {
    const s = await serverPruefen();
    schon = s.art === 'bereit';
  });

  async function einrichten(e: SubmitEvent) {
    e.preventDefault();
    fehler = '';
    laeuft = true;
    try {
      await api.setup({ code: code.trim(), name: name.trim(), email: email.trim(), passwort });
      await serverPruefen(true);
      fertig = true;
    } catch (x) {
      fehler = x instanceof Error ? x.message : T.app.fehlerAllgemein;
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.einrichtung.titel}</h1>
{#if fertig}
  <div class="meldung ok">{T.einrichtung.fertig}</div>
  <a class="knopf" href={linkZu('anmelden')}>{T.anmelden.knopf}</a>
{:else if schon}
  <div class="meldung info">{T.einrichtung.schonEingerichtet}</div>
  <a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a>
{:else}
  <p class="leise">{T.einrichtung.hinweis}</p>
  <form class="karte" onsubmit={einrichten}>
    <label for="c">{T.einrichtung.code}</label>
    <input id="c" bind:value={code} autocomplete="off" required />
    <label for="n">{T.einrichtung.name}</label>
    <input id="n" bind:value={name} autocomplete="name" required />
    <label for="e">{T.einrichtung.email}</label>
    <input id="e" type="email" bind:value={email} autocomplete="username" required />
    <label for="p">{T.einrichtung.passwort}</label>
    <input id="p" type="password" bind:value={passwort} autocomplete="new-password" minlength="8" required />
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <button type="submit" style="margin-top:16px" disabled={laeuft}>{T.einrichtung.knopf}</button>
  </form>
{/if}
