<script lang="ts">
  import { onMount } from 'svelte';
  import { route, linkZu } from './lib/router.svelte';
  import { T } from './lib/texte';
  import { serverLaden } from './lib/app.svelte';
  import Kopf from './lib/ui/Kopf.svelte';
  import Fuss from './lib/ui/Fuss.svelte';
  import Start from './lib/ui/Start.svelte';
  import NeuesTurnier from './lib/ui/NeuesTurnier.svelte';
  import Anmelden from './lib/ui/Anmelden.svelte';
  import Registrieren from './lib/ui/Registrieren.svelte';
  import Vergessen from './lib/ui/Vergessen.svelte';
  import Zuruecksetzen from './lib/ui/Zuruecksetzen.svelte';
  import Konto from './lib/ui/Konto.svelte';
  import Verwaltung from './lib/ui/Verwaltung.svelte';
  import Einrichtung from './lib/ui/Einrichtung.svelte';
  import Beitreten from './lib/ui/Beitreten.svelte';
  import Kontakt from './lib/ui/Kontakt.svelte';
  import Impressum from './lib/ui/Impressum.svelte';
  import Datenschutz from './lib/ui/Datenschutz.svelte';
  import Wiederherstellen from './lib/ui/Wiederherstellen.svelte';
  import TurnierAnsicht from './lib/ui/TurnierAnsicht.svelte';

  onMount(() => void serverLaden());
</script>

<Kopf />

<main class="inhalt">
  {#if route.seite === ''}
    <Start />
  {:else if route.seite === 'neu'}
    <NeuesTurnier />
  {:else if route.seite === 'anmelden'}
    <Anmelden />
  {:else if route.seite === 'registrieren'}
    <Registrieren />
  {:else if route.seite === 'vergessen'}
    <Vergessen />
  {:else if route.seite === 'zuruecksetzen'}
    <Zuruecksetzen schluessel={route.param ?? ''} />
  {:else if route.seite === 'konto'}
    <Konto />
  {:else if route.seite === 'verwaltung'}
    <Verwaltung />
  {:else if route.seite === 'einrichtung'}
    <Einrichtung />
  {:else if route.seite === 'beitreten'}
    <Beitreten />
  {:else if route.seite === 'kontakt'}
    <Kontakt />
  {:else if route.seite === 'impressum'}
    <Impressum />
  {:else if route.seite === 'datenschutz'}
    <Datenschutz />
  {:else if route.seite === 'wiederherstellen'}
    <Wiederherstellen />
  {:else if route.seite === 't' && route.param}
    {#key route.param}
      <TurnierAnsicht id={route.param} />
    {/key}
  {:else}
    <p>{T.turnier.nichtGefunden}</p>
    <a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a>
  {/if}
</main>

<Fuss />
