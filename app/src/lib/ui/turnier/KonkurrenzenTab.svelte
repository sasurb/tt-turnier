<script lang="ts">
  import { onMount } from 'svelte';
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { kurzId } from '../../engine/ids';
  import type { KonkurrenzEinstellungen } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';
  import { pool, poolLaden } from '../../pool.svelte';
  import KonkurrenzDetail from './KonkurrenzDetail.svelte';
  import KonkurrenzForm from './KonkurrenzForm.svelte';

  let { z, eintragen }: { z: TurnierZustand; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();
  // svelte-ignore state_referenced_locally
  let neu = $state(z.konkurrenzReihe.length === 0);

  onMount(() => void poolLaden());

  async function anlegen(e: KonkurrenzEinstellungen) {
    await eintragen(ART.konkurrenzAngelegt, { id: kurzId(), einst: e });
    neu = false;
  }
</script>

<section class="karte">
  <h2>{T.konk.titel}</h2>
  <p class="leise">{T.konk.text}</p>
  {#if neu}
    <KonkurrenzForm knopf={T.konk.anlegen} speichern={anlegen} abbrechen={() => (neu = false)} />
  {:else}
    <button onclick={() => (neu = true)}>+ {T.konk.neu}</button>
  {/if}
</section>

{#each z.konkurrenzReihe as id (id)}
  <KonkurrenzDetail {z} k={z.konkurrenzen[id]!} poolListe={pool.liste} {eintragen} />
{/each}
