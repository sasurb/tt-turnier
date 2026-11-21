<script lang="ts">
  import { onMount } from 'svelte';
  import { route, linkZu } from './lib/router.svelte';
  import { T } from './lib/texte';
  import { app, serverLaden } from './lib/app.svelte';
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
  import Pool from './lib/ui/Pool.svelte';
  import MeineTurniere from './lib/ui/MeineTurniere.svelte';
  import Zentrale from './lib/ui/Zentrale.svelte';
  import LiveAnsicht from './lib/ui/LiveAnsicht.svelte';
  import DruckAnsicht from './lib/ui/DruckAnsicht.svelte';
  import Meldung from './lib/ui/Meldung.svelte';
  import Handbuch from './lib/ui/Handbuch.svelte';
  import Spenden from './lib/ui/Spenden.svelte';

  onMount(() => {
    void serverLaden();
    // Wieder Netz: Server neu prüfen (Offline-Hinweis verschwindet, Einträge werden nachgetragen)
    const online = () => void serverLaden(true);
    addEventListener('online', online);
    return () => removeEventListener('online', online);
  });
</script>

{#if route.seite === 'live' && route.param}
  {#key route.param}<LiveAnsicht id={route.param} />{/key}
{:else if route.seite === 'druck' && route.param}
  {#key route.param}<DruckAnsicht id={route.param} art={route.rest[0] ?? ''} param={route.rest[1] ?? null} />{/key}
{:else}
<Kopf />

<main class="inhalt">
  {#if app.server.art === 'bereit' && app.server.offline}
    <div class="meldung info" role="status" data-testid="offline">{T.app.offline}</div>
  {/if}
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
  {:else if route.seite === 'turniere'}
    <MeineTurniere />
  {:else if route.seite === 'pool'}
    <Pool />
  {:else if route.seite === 'zentrale'}
    <Zentrale />
  {:else if route.seite === 'spenden'}
    <Spenden />
  {:else if route.seite === 'hilfe'}
    <Handbuch kapitel={route.param} />
  {:else if route.seite === 'meldung' && route.param}
    {#key `${route.param}/${route.rest[0] ?? ''}`}<Meldung turnier={route.param} schluessel={route.rest[0] ?? null} />{/key}
  {:else if (route.seite === 't' || route.seite === 'c') && route.param}
    {#key route.param}
      <TurnierAnsicht
        id={route.param}
        reiter={route.seite === 't' ? (route.rest[0] ?? null) : null}
        code={route.seite === 'c' ? (route.rest[0] ?? null) : null}
        weitere={route.seite === 't' ? route.rest.slice(1) : []}
      />
    {/key}
  {:else}
    <p>{T.turnier.nichtGefunden}</p>
    <a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a>
  {/if}
</main>

<Fuss />
{/if}
