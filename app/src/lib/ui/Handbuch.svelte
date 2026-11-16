<script lang="ts">
  import { linkZu } from '../router.svelte';
  import { T } from '../texte';
  import { HANDBUCH, ROLLEN_NAMEN, handbuchFiltern, type HandbuchRolle } from '../handbuch';

  /** Kapitel aus dem Link #/hilfe/<kapitel>: aufgeklappt und angesprungen */
  let { kapitel = null }: { kapitel?: string | null } = $props();

  let rolle = $state<HandbuchRolle | null>(null);
  let suche = $state('');
  const liste = $derived(handbuchFiltern(rolle, suche));
  const rollen: (HandbuchRolle | null)[] = [null, 'leitung', 'helfer', 'spieler', 'zuschauer'];

  $effect(() => {
    if (!kapitel) return;
    const el = document.getElementById('kapitel-' + kapitel);
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
      el.scrollIntoView({ block: 'start' });
    }
  });
</script>

<h1>{T.handbuch.titel}</h1>
<p class="leise">{T.handbuch.einleitung}</p>

<div class="filter karte">
  <label for="handbuch-suche">{T.handbuch.suchen}</label>
  <input id="handbuch-suche" type="search" bind:value={suche} placeholder={T.handbuch.suchenBeispiel} autocomplete="off" data-testid="handbuch-suche" />
  <div class="rollen" role="group" aria-label={T.handbuch.fuer}>
    {#each rollen as r (r ?? 'alle')}
      <button class="klein" class:zweit={rolle !== r} aria-pressed={rolle === r} onclick={() => (rolle = r)}>
        {r === null ? T.handbuch.alle : ROLLEN_NAMEN[r]}
      </button>
    {/each}
  </div>
</div>

{#if liste.length === 0}
  <p class="meldung info" role="status">{T.handbuch.nichts}</p>
{/if}

{#each liste as k (k.id)}
  <details class="karte kapitel" id="kapitel-{k.id}" open={kapitel === k.id || (suche.trim() !== '' && liste.length <= 3)}>
    <summary>
      <span class="wachsen">{k.titel}</span>
      <span class="leise klein-text">{k.fuer.length === 4 ? T.handbuch.alle : k.fuer.map((r) => ROLLEN_NAMEN[r]).join(', ')}</span>
    </summary>
    <p>{k.einleitung}</p>
    {#each k.abschnitte as a (a.titel)}
      <h3>{a.titel}</h3>
      {#if a.text.some((t) => t.startsWith('• '))}
        {#each a.text.filter((t) => !t.startsWith('• ')) as t (t)}<p>{t}</p>{/each}
        <ul>
          {#each a.text.filter((t) => t.startsWith('• ')) as t (t)}<li>{t.slice(2)}</li>{/each}
        </ul>
      {:else}
        {#each a.text as t (t)}<p>{t}</p>{/each}
      {/if}
    {/each}
    <p class="leise klein-text"><a href={linkZu('hilfe/' + k.id)}>{T.handbuch.link}</a></p>
  </details>
{/each}

<p class="leise">{T.handbuch.weiter} <a href={linkZu('kontakt')}>{T.fuss.kontakt}</a> · {T.handbuch.kapitel(HANDBUCH.length)}</p>

<style>
  .filter { display: grid; gap: 8px; }
  .filter input { width: 100%; min-height: 44px; }
  .rollen { display: flex; flex-wrap: wrap; gap: 8px; }
  .kapitel summary {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    cursor: pointer;
    font-weight: 600;
    font-size: 1.05rem;
  }
  .kapitel h3 { margin: 14px 0 4px; font-size: 1rem; }
  .kapitel ul { margin: 4px 0; padding-left: 1.2em; }
  .kapitel li { margin: 4px 0; }
  .kapitel p { overflow-wrap: anywhere; }
  .klein-text { font-size: 0.85rem; font-weight: 400; }
  /* Am Handy nur der Titel in der Kapitelzeile – die Rollen-Knöpfe oben filtern ohnehin */
  @media (max-width: 520px) {
    .kapitel summary .klein-text { display: none; }
  }
</style>
