<script lang="ts">
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';

  let eingabe = $state('');
  let fehler = $state('');

  /** Akzeptiert die reine Kennung, einen Link …/#/t/<kennung> oder einen persönlichen Link …/#/c/<kennung>/<code> */
  function ziel(text: string): string | null {
    const t = text.trim().toLowerCase();
    const mitCode = t.match(/#\/c\/([a-z0-9]{6,16})\/([0-9]{6})/);
    if (mitCode) return `c/${mitCode[1]}/${mitCode[2]}`;
    const ausLink = t.match(/#\/t\/([a-z0-9]{6,16})/);
    if (ausLink) return 't/' + ausLink[1]!;
    return /^[a-z0-9]{6,16}$/.test(t) ? 't/' + t : null;
  }

  function weiter(e: SubmitEvent) {
    e.preventDefault();
    const z = ziel(eingabe);
    if (!z) {
      fehler = T.beitreten.kennungHinweis;
      return;
    }
    gehe(z);
  }
</script>

<h1>{T.beitreten.titel}</h1>
<form class="karte" onsubmit={weiter}>
  <label for="k">{T.beitreten.kennung}</label>
  <input id="k" bind:value={eingabe} autocomplete="off" autocapitalize="off" spellcheck="false" required />
  <p class="leise">{T.beitreten.kennungHinweis}</p>
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <div class="reihe">
    <button type="submit">{T.beitreten.weiter}</button>
    <a class="knopf zweit" href={linkZu('')}>{T.app.abbrechen}</a>
  </div>
</form>
