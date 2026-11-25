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
  import Sparte from './lib/ui/Sparte.svelte';
  import Ausschuss from './lib/ui/Ausschuss.svelte';
  import Einladung from './lib/ui/Einladung.svelte';
  import Partner from './lib/ui/Partner.svelte';
  import SicherungLink from './lib/ui/SicherungLink.svelte';
  import Bedingungen from './lib/ui/Bedingungen.svelte';
  import Ueber from './lib/ui/Ueber.svelte';
  import BedingungenDialog from './lib/ui/BedingungenDialog.svelte';
  import Verteiler from './lib/ui/Verteiler.svelte';
  import { turnierIdNorm } from './lib/code';

  /** Turnierkennungen aus Links ohne Groß/klein (ab 0.17) */
  const tid = $derived(route.param ? turnierIdNorm(route.param) : null);

  onMount(() => {
    void serverLaden();
    // Wieder Netz: Server neu prüfen (Offline-Hinweis verschwindet, Einträge werden nachgetragen)
    const online = () => void serverLaden(true);
    addEventListener('online', online);
    return () => removeEventListener('online', online);
  });
</script>

{#if route.seite === 'live' && tid}
  {#key tid}<LiveAnsicht id={tid} />{/key}
{:else if route.seite === 'druck' && tid}
  {#key tid}<DruckAnsicht id={tid} art={route.rest[0] ?? ''} param={route.rest[1] ?? null} />{/key}
{:else}
<Kopf />

<main class="inhalt">
  <BedingungenDialog />
  {#if app.server.art === 'bereit' && app.server.offline}
    <div class="meldung info" role="status" data-testid="offline">{T.app.offline}</div>
  {/if}
  {#if route.seite === ''}
    <Start />
  {:else if route.seite === 'neu'}
    <NeuesTurnier />
  {:else if route.seite === 'anmelden'}
    {#key route.param}<Anmelden zurueck={route.param ? [route.param, ...route.rest].join('/') : null} />{/key}
  {:else if route.seite === 'registrieren'}
    {#key route.param}<Registrieren einladung={route.param} />{/key}
  {:else if route.seite === 'sparte'}
    {#key route.param}<Sparte id={route.param ? Number(route.param) : null} />{/key}
  {:else if route.seite === 'ausschuss' && route.param}
    {#key route.param}<Ausschuss id={Number(route.param)} />{/key}
  {:else if route.seite === 'einladung' && route.param}
    {#key route.param}<Einladung schluessel={route.param} />{/key}
  {:else if route.seite === 'partner' && tid && route.rest[0]}
    {#key route.rest[0]}<Partner turnier={tid} schluessel={route.rest[0]} />{/key}
  {:else if route.seite === 'verteiler' && route.param === 'b' && route.rest[0]}
    {#key route.rest[0]}<Verteiler art="bestaetigen" wert={route.rest[0]} />{/key}
  {:else if route.seite === 'verteiler' && route.param === 'ab' && route.rest[0]}
    {#key route.rest[0]}<Verteiler art="abmelden" wert={route.rest[0]} />{/key}
  {:else if route.seite === 'verteiler' && tid}
    {#key tid}<Verteiler art="eintragen" wert={tid} />{/key}
  {:else if route.seite === 'sicherung' && tid && route.rest[0]}
    {#key route.rest[0]}<SicherungLink turnier={tid} schluessel={route.rest[0]} />{/key}
  {:else if route.seite === 'bedingungen'}
    <Bedingungen />
  {:else if route.seite === 'ueber'}
    <Ueber />
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
  {:else if route.seite === 'meldung' && tid}
    {#key `${tid}/${route.rest[0] ?? ''}`}<Meldung turnier={tid} schluessel={route.rest[0] ?? null} />{/key}
  {:else if (route.seite === 't' || route.seite === 'c') && tid}
    {#key tid}
      <TurnierAnsicht
        id={tid}
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
