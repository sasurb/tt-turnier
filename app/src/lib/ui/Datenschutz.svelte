<script lang="ts">
  import { linkZu } from '../router.svelte';
  import { BETREIBER, DATENSCHUTZ_STAND, datenschutz } from '../rechtliches';

  const abschnitte = datenschutz(BETREIBER);
</script>

<h1>Datenschutzhinweis</h1>
<p class="leise">Kurz gesagt: Die Daten dienen nur dazu, dass du dich anmelden und Turniere abwickeln kannst. Keine Werbung, kein Tracking, keine Weitergabe.</p>
{#each abschnitte as a (a.titel)}
  <section class="karte">
    <h2>{a.titel}</h2>
    {#each a.absaetze as p (p)}<p>{p}</p>{/each}
  </section>
{/each}
<p class="leise">Stand: {DATENSCHUTZ_STAND} · <a href={linkZu('impressum')}>Impressum</a> · <a href={linkZu('kontakt')}>Kontakt</a></p>
