<script lang="ts">
  import { route, linkZu } from './lib/router.svelte';
  import { T } from './lib/texte';
  import Start from './lib/ui/Start.svelte';
  import NeuLokal from './lib/ui/NeuLokal.svelte';
  import Anmelden from './lib/ui/Anmelden.svelte';
  import Konto from './lib/ui/Konto.svelte';
  import Einrichtung from './lib/ui/Einrichtung.svelte';
  import Beitreten from './lib/ui/Beitreten.svelte';
  import TurnierAnsicht from './lib/ui/TurnierAnsicht.svelte';
</script>

<header>
  <a class="marke-app" href={linkZu('')}>
    <img src="./favicon.svg" alt="" width="28" height="28" />
    <span>{T.app.titel}</span>
  </a>
</header>

<main class="inhalt">
  {#if route.seite === ''}
    <Start />
  {:else if route.seite === 'neu'}
    <NeuLokal />
  {:else if route.seite === 'anmelden'}
    <Anmelden />
  {:else if route.seite === 'konto'}
    <Konto />
  {:else if route.seite === 'einrichtung'}
    <Einrichtung />
  {:else if route.seite === 'beitreten'}
    <Beitreten />
  {:else if route.seite === 't' && route.param}
    {#key route.param}
      <TurnierAnsicht id={route.param} />
    {/key}
  {:else}
    <p>{T.turnier.nichtGefunden}</p>
    <a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a>
  {/if}
</main>

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--blau);
    color: #fff;
    padding: calc(env(safe-area-inset-top) + 10px) 16px 10px;
  }
  .marke-app {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: #fff;
    text-decoration: none;
    font-weight: 700;
    font-size: 1.1rem;
    min-height: 40px;
  }
  .marke-app img { border-radius: 7px; background: #fff2; }
</style>
