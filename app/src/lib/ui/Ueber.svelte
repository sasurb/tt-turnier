<script lang="ts">
  import { linkZu } from '../router.svelte';
  import { T } from '../texte';

  /** Quellcode-Hinweis nach AGPL-3.0 § 13 und Urheberhinweis nach § 7 b (in veränderten Fassungen beibehalten) */
  const QUELLCODE = 'https://github.com/Sasurb/tt-turnier';
</script>

<h1>{T.ueber.titel}</h1>
<section class="karte">
  <p>{T.ueber.text}</p>
  <p><strong data-testid="urheber">{T.ueber.urheber}</strong></p>
  <p class="leise">{T.ueber.version(__APP_VERSION__)}</p>
</section>
<section class="karte">
  <h2>Lizenz</h2>
  <p>{T.ueber.lizenz}</p>
  <p class="leise">{T.ueber.lizenzAlt}</p>
  <a class="knopf zweit" href={QUELLCODE} target="_blank" rel="noopener" data-testid="quellcode">{T.ueber.quellcode}</a>
</section>
<section class="karte">
  <p class="leise">{T.ueber.selbstBetreiben}</p>
</section>
<p class="leise"><a href={linkZu('bedingungen')}>{T.fuss.bedingungen}</a> · <a href={linkZu('datenschutz')}>{T.fuss.datenschutz}</a> · <a href={linkZu('impressum')}>{T.fuss.impressum}</a></p>
