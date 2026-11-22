<script lang="ts">
  /** Reiter „Teilnehmer“: App-Wertung der Hobbyspieler (geschätzte Werte) und Übernahme in den Spielerpool */
  import { onMount } from 'svelte';
  import { T } from '../../texte';
  import { spielerName } from '../../engine/modell';
  import { appWertungen, poolUebernahmePlanen } from '../../engine/appwertung';
  import { hobbyStufe } from '../../engine/stufen';
  import type { TurnierZustand } from '../../engine/zustand';
  import { pool, poolLaden, poolSpeichern } from '../../pool.svelte';
  import Hilfe from '../Hilfe.svelte';
  import { ART } from '@shared/protokoll';

  let {
    z,
    eintragen,
  }: {
    z: TurnierZustand;
    eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown>;
  } = $props();

  onMount(() => void poolLaden());

  const poolNachId = $derived(new Map(pool.liste.map((p) => [p.id, p])));
  const werte = $derived(appWertungen(z, (id) => poolNachId.get(z.spieler[id]?.pool ?? '')?.appSpiele ?? 0));
  const ids = $derived(z.spielerReihe.filter((id) => werte[id]));
  const geplant = $derived(poolUebernahmePlanen(z, pool.liste));
  let meldung = $state<{ ok: boolean; text: string } | null>(null);
  /** Aufgeklappt-Zustand selbst merken (Neuaufbau beim Abgleich); offen, solange es etwas zu übernehmen gibt */
  let auf = $state<boolean | null>(null);
  let laeuft = $state(false);

  async function uebernehmen() {
    laeuft = true;
    meldung = null;
    try {
      const plan = geplant;
      const n = plan.length;
      // Erst im Turnier vermerken (wirkt sofort auf diesem Gerät, gilt nach dem Abgleich überall, nicht
      // rückgängig zu machen), dann den Pool schreiben – so zählt kein Turnier doppelt
      await eintragen(ART.turnierDaten, { wertungUebernommen: new Date().toISOString() });
      await poolSpeichern(plan);
      meldung = { ok: true, text: T.appwertung.uebernommen(n) };
    } catch (x) {
      meldung = { ok: false, text: `${T.appwertung.fehler} ${x instanceof Error ? x.message : String(x)}` };
    } finally {
      laeuft = false;
    }
  }
</script>

{#if ids.length}
  <details class="karte abschnitt" data-testid="abschnitt-appwertung" open={auf ?? geplant.length > 0} ontoggle={(e) => (auf = e.currentTarget.open)}>
    <summary><span class="kopf"><h2 class="titel">{T.appwertung.titel}</h2><Hilfe text={T.appwertung.hilfe} /></span></summary>
    <ul class="liste">
      {#each ids as id (id)}
        {@const w = werte[id]!}
        {@const p = poolNachId.get(z.spieler[id]?.pool ?? '')}
        <li>
          <strong>{spielerName(z.spieler[id])}</strong>
          <span class="leise">{hobbyStufe(w.aktuell)?.id ?? ''}</span>
          <span data-testid="appwertung-zeile">{w.spiele ? T.appwertung.zeile(w.start, w.aktuell, w.spiele) : `${w.start} · ${T.appwertung.leer}`}</span>
          {#if !p}<span class="leise klein-text">{T.appwertung.ohnePool}</span>{:else if typeof p.ttr === 'number' && !p.ttrGeschaetzt}<span class="leise klein-text">{T.appwertung.amtlichImPool}</span>{/if}
        </li>
      {/each}
    </ul>
    {#if geplant.length}
      <button onclick={uebernehmen} disabled={laeuft} data-testid="appwertung-uebernehmen">{T.appwertung.uebernehmen(geplant.length)}</button>
    {:else if z.wertungUebernommen}
      <p class="leise">{T.appwertung.schonUebernommen}</p>
    {/if}
    {#if meldung}<p class="meldung" class:ok={meldung.ok} class:fehler={!meldung.ok} role="status">{meldung.text}</p>{/if}
  </details>
{/if}

<style>
  .kopf { flex: 1; display: flex; align-items: center; gap: 6px; }
  .abschnitt > summary .titel { font-size: 1.1rem; margin: 0; }
  .liste { list-style: none; padding: 0; margin: 8px 0 12px; }
  .liste li { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--linie); }
  .klein-text { font-size: 0.9rem; }
</style>
