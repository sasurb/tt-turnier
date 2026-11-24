<script lang="ts">
  import { linkZu } from '../router.svelte';
  import { T } from '../texte';
  import { BETREIBER, BEDINGUNGEN_STAND, nutzungsbedingungen } from '../rechtliches';

  const abschnitte = nutzungsbedingungen(BETREIBER);
</script>

<h1>{T.bedingungen.titel}</h1>
<p class="leise">{T.bedingungen.stand(BEDINGUNGEN_STAND)}</p>
{#each abschnitte as a (a.titel)}
  <section class="karte">
    <h2>{a.titel}</h2>
    {#each a.absaetze as p (p)}<p>{p}</p>{/each}
  </section>
{/each}
<p class="leise"><a href={linkZu('datenschutz')}>{T.fuss.datenschutz}</a> · <a href={linkZu('impressum')}>{T.fuss.impressum}</a> · <a href={linkZu('ueber')}>{T.fuss.ueber}</a></p>
