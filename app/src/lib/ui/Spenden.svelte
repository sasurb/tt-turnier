<script lang="ts">
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { SPENDENWEGE } from '../rechtliches';
</script>

<section class="karte spenden">
  <h1>{T.spenden.titel}</h1>
  {#each T.spenden.text as absatz (absatz)}<p>{absatz}</p>{/each}
  {#if SPENDENWEGE.length}
    <div class="wege" data-testid="spendenwege">
      {#each SPENDENWEGE as w (w.id)}
        <a class="knopf" href={w.url} target="_blank" rel="noopener noreferrer">{T.spenden.ueber(w.name)}</a>
      {/each}
    </div>
    <p class="leise">{T.spenden.hinweis}</p>
  {:else}
    <p class="leise">{T.spenden.keine}</p>
  {/if}
  <p>{T.spenden.wuensche} <a href={linkZu('kontakt')}>{T.spenden.kontakt}</a></p>
  <a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a>
</section>

<style>
  .spenden p { line-height: 1.55; }
  .wege { display: flex; flex-direction: column; gap: 10px; margin: 16px 0 8px; max-width: 420px; }
  .wege .knopf { justify-content: center; }
</style>
