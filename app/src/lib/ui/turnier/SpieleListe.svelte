<script lang="ts">
  import { T } from '../../texte';
  import { alleSpiele, pruefliste, spieleVon } from '../../engine/abfragen';
  import type { Spiel } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';
  import SpielKarte from './SpielKarte.svelte';

  let {
    z,
    leitung,
    ich = null,
    nurMeine = false,
    oeffnen,
  }: { z: TurnierZustand; leitung: boolean; ich?: string | null; nurMeine?: boolean; oeffnen: (s: Spiel) => void } = $props();

  let filter = $state<'offen' | 'fertig' | 'alle'>('offen');
  let konkurrenz = $state('');

  const basis = $derived(nurMeine && ich ? spieleVon(z, ich) : alleSpiele(z));
  const pruef = $derived(leitung && !nurMeine ? pruefliste(z) : []);
  const liste = $derived(
    basis.filter((s) => {
      if (konkurrenz && s.konkurrenz !== konkurrenz) return false;
      if (s.status === 'freilos') return false;
      if (filter === 'offen') return s.status === 'offen' || s.status === 'wartet' || (nurMeine && s.stand === 'eingetragen');
      if (filter === 'fertig') return s.status === 'gespielt' || s.status === 'entfallen';
      return true;
    }),
  );
  /** offene vor wartenden */
  const sortiert = $derived(filter === 'offen' ? [...liste].sort((a, b) => Number(a.status === 'wartet') - Number(b.status === 'wartet')) : liste);
</script>

{#if pruef.length}
  <section class="karte pruef">
    <h2>{T.spiele.pruefliste} <span class="leise">({pruef.length})</span></h2>
    <p class="leise">{T.spiele.prueflisteText}</p>
    {#each pruef as s (s.konkurrenz + s.id)}
      <SpielKarte {z} k={z.konkurrenzen[s.konkurrenz]!} spiel={s} oeffnen={() => oeffnen(s)} />
    {/each}
  </section>
{/if}

{#if basis.length === 0}
  <p class="meldung info">{nurMeine ? T.spiele.meineLeer : T.spiele.keine}</p>
{:else}
  <div class="filter reihe">
    <div class="chips" role="radiogroup" aria-label={T.spiele.titel}>
      {#each ['offen', 'fertig', 'alle'] as const as f (f)}
        <button class="chip" class:aktiv={filter === f} role="radio" aria-checked={filter === f} onclick={() => (filter = f)}>{T.spiele.filter[f]}</button>
      {/each}
    </div>
    {#if z.konkurrenzReihe.length > 1}
      <select class="wachsen" bind:value={konkurrenz} aria-label={T.konk.titel}>
        <option value="">{T.spiele.alleKonkurrenzen}</option>
        {#each z.konkurrenzReihe as id (id)}<option value={id}>{z.konkurrenzen[id]!.einst.name}</option>{/each}
      </select>
    {/if}
  </div>
  {#if sortiert.length === 0}
    <p class="leise">{T.spiele.leer}</p>
  {:else}
    {#each sortiert as s (s.konkurrenz + s.id)}
      <SpielKarte {z} k={z.konkurrenzen[s.konkurrenz]!} spiel={s} {ich} mitKonkurrenz={z.konkurrenzReihe.length > 1} oeffnen={() => oeffnen(s)} />
    {/each}
  {/if}
{/if}

<style>
  .pruef { border-color: var(--orange); }
  .filter { margin-bottom: 12px; }
  .chips { display: flex; gap: 6px; }
  .chip { min-height: 40px; padding: 6px 14px; background: var(--flaeche); color: var(--text); border: 1px solid var(--linie); font-weight: 600; }
  .chip.aktiv { background: var(--blau); color: #fff; border-color: var(--blau); }
</style>
