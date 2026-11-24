<script lang="ts">
  import { linkZu } from '../router.svelte';
  import { BETREIBER } from '../rechtliches';
</script>

<h1>Impressum</h1>
<section class="karte">
  <h2>Angaben gemäß § 5 DDG</h2>
  {#if BETREIBER.name}
    <p>{BETREIBER.name}<br />{#each BETREIBER.anschrift.split(/\s*[,\n]\s*/) as zeile (zeile)}{zeile}<br />{/each}</p>
  {:else}
    <div class="meldung info">Für diese Installation sind noch keine Betreiberangaben hinterlegt (GitHub-Variablen BETREIBER_NAME und BETREIBER_ANSCHRIFT).</div>
  {/if}
  <h2>Kontakt</h2>
  <p>
    {#if BETREIBER.mail}E-Mail: <a href={'mailto:' + BETREIBER.mail}>{BETREIBER.mail}</a><br />{/if}
    {#if BETREIBER.telefon}Telefon: <a href={'tel:' + BETREIBER.telefon.replace(/[^+\d]/g, '')}>{BETREIBER.telefon}</a><br />{/if}
    Kontaktformular: <a href={linkZu('kontakt')}>Nachricht senden</a>
  </p>
  <h2>Hinweis</h2>
  <p class="leise">
    Private, nicht-kommerzielle Turnier-App ohne Werbung. Quellcode unter AGPL-3.0:
    <a href="https://github.com/Sasurb/tt-turnier">github.com/Sasurb/tt-turnier</a>.
    Für Inhalte, die ein Verein bzw. seine Sparte in Turniere und Ausschüsse einträgt, ist der jeweilige Verein verantwortlich.
  </p>
  <p><a href={linkZu('datenschutz')}>Datenschutzhinweis</a> · <a href={linkZu('bedingungen')}>Nutzungsbedingungen</a> · <a href={linkZu('ueber')}>Über diese App</a></p>
</section>
