<script lang="ts">
  import { linkZu } from '../../router.svelte';
  import { T } from '../../texte';
  import { alleSpiele, pruefliste, spieleVon, tische } from '../../engine/abfragen';
  import { uhrzeitText, type Spiel } from '../../engine/modell';
  import { zeitplanGedrosselt, zeitplanSofort } from '../../engine/zeitplan';
  import type { TurnierZustand } from '../../engine/zustand';
  import Stufenwechsel from './Stufenwechsel.svelte';
  import SpielKarte from './SpielKarte.svelte';

  let {
    z,
    leitung,
    ich = null,
    nurMeine = false,
    oeffnen,
    mitSchiri = false,
    stufeEintragen,
    tischLink = null,
  }: { z: TurnierZustand; leitung: boolean; tischLink?: string | null; stufeEintragen?: (art: string, daten: Record<string, unknown>) => Promise<unknown>; ich?: string | null; nurMeine?: boolean; mitSchiri?: boolean; oeffnen: (s: Spiel) => void } = $props();

  let filter = $state<'offen' | 'fertig' | 'alle'>('offen');
  let konkurrenz = $state('');

  const frei = $derived(tischLink ? tische(z).filter((t) => !t.spiel && !t.gesperrt).length : 0);
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
  /** Geschätzter Beginn je offenem Spiel (Zeitplan) */
  // Gedrosselt: bei großen Turnieren nicht bei jedem Eintrag neu rechnen (siehe zeitplanGedrosselt)
  // svelte-ignore state_referenced_locally
  let plan = $state.raw(zeitplanSofort(z, Date.now()));
  $effect(() => {
    const zz = z;
    const jj = Date.now();
    zeitplanGedrosselt(zz, jj, (p) => (plan = p));
  });
  function beginn(s: Spiel): number | null {
    const e = plan.spiele.get(`${s.konkurrenz}/${s.id}`);
    return e && !e.laeuft ? e.start : null;
  }
  /** Offen: laufende zuerst, dann nach geschätztem Beginn; wartende ohne Schätzung ans Ende */
  const sortiert = $derived(
    filter === 'offen'
      ? [...liste].sort((a, b) => {
          const la = a.tisch !== null ? 0 : 1;
          const lb = b.tisch !== null ? 0 : 1;
          return la - lb || (beginn(a) ?? Infinity) - (beginn(b) ?? Infinity) || Number(a.status === 'wartet') - Number(b.status === 'wartet');
        })
      : liste,
  );
  function zeitVon(s: Spiel): string | null {
    const b = beginn(s);
    return b === null ? null : uhrzeitText(b);
  }
</script>

{#if tischLink && frei}
  <a class="knopf zweit" href={linkZu(tischLink)}>{frei === 1 ? '1 freier Tisch' : `${frei} freie Tische`}</a>
{/if}
{#if pruef.length}
  <section class="karte pruef">
    <h2>{T.spiele.pruefliste} <span class="leise">({pruef.length})</span></h2>
    <p class="leise">{T.spiele.prueflisteText}</p>
    {#each pruef as s (s.konkurrenz + s.id)}
      <SpielKarte {z} k={z.konkurrenzen[s.konkurrenz]!} spiel={s} {mitSchiri} oeffnen={() => oeffnen(s)} />
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
  {#if stufeEintragen}
    {#each z.konkurrenzReihe.filter((id) => !konkurrenz || id === konkurrenz) as id (id)}
      <Stufenwechsel {z} k={z.konkurrenzen[id]!} eintragen={stufeEintragen} nurBereit />
    {/each}
  {/if}
  {#if sortiert.length === 0}
    <p class="leise">{T.spiele.leer}</p>
  {:else}
    {#each sortiert as s (s.konkurrenz + s.id)}
      <SpielKarte {z} k={z.konkurrenzen[s.konkurrenz]!} spiel={s} {ich} {mitSchiri} mitKonkurrenz={z.konkurrenzReihe.length > 1} zeit={zeitVon(s)} oeffnen={() => oeffnen(s)} />
    {/each}
  {/if}
{/if}

<style>
  .pruef { border-color: var(--orange); }
  .filter { margin-bottom: 12px; }
  .chips { display: flex; gap: 6px; }
  .chip { min-height: 44px; padding: 6px 14px; background: var(--flaeche); color: var(--text); border: 1px solid var(--linie); font-weight: 600; }
  .chip.aktiv { background: var(--blau); color: #fff; border-color: var(--blau); }
</style>
