<script lang="ts">
  /** Reiter „Teilnehmer“: je Konkurrenz ein aufklappbarer Abschnitt mit den Gemeldeten */
  import { onMount, tick } from 'svelte';
  import { T } from '../../texte';
  import { linkZu } from '../../router.svelte';
  import { begonnen, type TurnierZustand } from '../../engine/zustand';
  import { pool, poolLaden } from '../../pool.svelte';
  import Hilfe from '../Hilfe.svelte';
  import KonkurrenzMeldungen from './KonkurrenzMeldungen.svelte';
  import { istRundenModus } from '../../engine/runden';

  let {
    z,
    turnierId,
    offen = null,
    eintragen,
  }: {
    z: TurnierZustand;
    turnierId: string;
    /** Konkurrenz-ID aus der Adresse #/t/<id>/teilnehmer/<konkurrenz>: dieser Abschnitt ist aufgeklappt */
    offen?: string | null;
    eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown>;
  } = $props();

  onMount(() => void poolLaden());

  /** Aufgeklappt-Zustand selbst merken: der Turnierzustand wird bei jeder Änderung neu berechnet */
  let auf = $state<Record<string, boolean>>({});
  /** Link auf eine Konkurrenz: Abschnitt aufklappen und hinscrollen */
  $effect(() => {
    const id = offen;
    if (!id) return;
    auf[id] = true;
    void tick().then(() => document.querySelector(`[data-konkurrenz="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' }));
  });

  function zahl(id: string): string {
    const k = z.konkurrenzen[id]!;
    const n = k.meldungen.length;
    return k.einst.art === 'mannschaft' ? T.mannschaft.anzahl(n) : k.einst.art === 'einzel' ? T.konk.teilnehmer(n) : T.konk.paare(n);
  }
</script>

<h2 class="zwischen">{T.tspieler.jeKonkurrenz}<Hilfe text={T.tspieler.jeKonkurrenzHilfe} /></h2>
{#if z.konkurrenzReihe.length === 0}
  <p class="leise karte">{T.tspieler.keineKonkurrenz} <a href={linkZu(`t/${turnierId}/konkurrenzen`)}>{T.tspieler.konkurrenzAnlegen}</a></p>
{:else}
  {#each z.konkurrenzReihe as id (id)}
    {@const k = z.konkurrenzen[id]!}
    <details class="karte abschnitt" open={auf[id] ?? offen === id} ontoggle={(e) => (auf[id] = e.currentTarget.open)} data-testid="abschnitt-konkurrenz" data-konkurrenz={id}>
      <summary>
        <h3 class="titel">{k.einst.name}</h3>
        <span class="leise">{k.einst.art !== 'einzel' ? T.konk.arten[k.einst.art] + ' · ' : ''}{zahl(id)}</span>
        {#if begonnen(k)}<span class="marke">{T.konk.status[k.status === 'gruppen' && istRundenModus(k.einst.modus) ? 'runden' : k.status]}</span>{/if}
      </summary>
      <KonkurrenzMeldungen {z} {k} poolListe={pool.liste} {eintragen} liste />
      {#if !begonnen(k)}
        <p class="leise weiter">
          {k.meldungen.length >= 2 ? T.tspieler.weiterAuslosen : T.konk.zuWenige}
          <a href={linkZu(`t/${turnierId}/konkurrenzen`)}>{T.tspieler.zumAuslosen}</a>
        </p>
      {/if}
    </details>
  {/each}
{/if}

<style>
  .zwischen { font-size: 1.1rem; margin: 22px 0 8px; display: flex; align-items: center; gap: 6px; }
  .abschnitt > summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 44px; cursor: pointer; }
  .abschnitt > summary .titel { font-size: 1.1rem; margin: 0; overflow-wrap: anywhere; }
  .weiter { margin-top: 12px; }
</style>
