<script lang="ts">
  import { T } from '../../texte';
  import { linkZu } from '../../router.svelte';
  import { DRUCK_ARTEN } from '../../druck';
  import { dateiAusgeben, kannTeilen } from '../../sicherung';
  import { dateiStamm, endstandCsv, spieleCsv, teilnehmerCsv } from '../../export';
  import type { TurnierZustand } from '../../engine/zustand';

  /** Reiter „Drucken“: Druckvorlagen öffnen, CSV-Export (nur Leitung), Live-Anzeige */
  let { z, id, leitung, lokal }: { z: TurnierZustand; id: string; leitung: boolean; lokal: boolean } = $props();

  let meldung = $state('');
  const teilen = kannTeilen();

  async function exportieren(was: 'teilnehmer' | 'spiele' | 'endstand') {
    const inhalt = was === 'teilnehmer' ? teilnehmerCsv(z) : was === 'spiele' ? spieleCsv(z) : endstandCsv(z);
    const r = await dateiAusgeben(`${dateiStamm(z)}-${was}.csv`, inhalt, 'text/csv', teilen);
    if (r !== 'abgebrochen') meldung = T.druck.csvFertig;
  }
</script>

<section class="karte">
  <h2>{T.druck.reiterTitel}</h2>
  <p class="leise">{T.druck.reiterText}</p>
  <ul class="vorlagen">
    {#each DRUCK_ARTEN.filter((a) => !(lokal && a === 'aushang')) as a (a)}
      <li>
        <a class="vorlage" href={linkZu(`druck/${id}/${a}`)} data-testid="vorlage-{a}">
          <strong>{T.druck.arten[a]}</strong>
          <span class="leise">{T.druck.beschreibung[a]}</span>
        </a>
      </li>
    {/each}
  </ul>
</section>

<section class="karte">
  <h2>{T.live.beamerTitel}</h2>
  <p class="leise">{T.live.beamerText}</p>
  <a class="knopf" href={linkZu(`live/${id}`)} data-testid="live-oeffnen">{T.live.oeffnen}</a>
</section>

<section class="karte">
  <h2>{T.druck.csvTitel}</h2>
  {#if leitung}
    <p class="leise">{T.druck.csvText}</p>
    <div class="reihe">
      <button class="zweit" onclick={() => exportieren('teilnehmer')} data-testid="csv-teilnehmer">{T.druck.csvTeilnehmer}</button>
      <button class="zweit" onclick={() => exportieren('spiele')} data-testid="csv-spiele">{T.druck.csvSpiele}</button>
      <button class="zweit" onclick={() => exportieren('endstand')} data-testid="csv-endstand">{T.druck.csvEndstand}</button>
    </div>
    {#if meldung}<p class="meldung ok" role="status">{meldung}</p>{/if}
  {:else}
    <p class="leise">{T.druck.nurLeitungCsv}</p>
  {/if}
</section>

<style>
  .vorlagen { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: 10px; }
  .vorlage { display: flex; flex-direction: column; gap: 4px; min-height: 44px; padding: 12px 14px; border: 1px solid var(--linie); border-radius: 10px; text-decoration: none; color: var(--text); background: var(--grund); height: 100%; }
  .vorlage:hover { border-color: var(--blau); }
  .vorlage strong { color: var(--blau); }
</style>
