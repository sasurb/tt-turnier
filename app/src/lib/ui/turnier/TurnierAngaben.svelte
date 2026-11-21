<script lang="ts">
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { ALLE_ANGABEN, type Angabe } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';

  /** Angaben im Turnier (welche Felder neben Name und Verein), Ort und Anzahl Tische – erster Punkt unter „Konkurrenzen“ */
  let { z, eintragen }: { z: TurnierZustand; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();

  const angabenText: Record<Angabe, string> = { ttr: T.tspieler.ttr, klasse: T.tspieler.klasse, geschlecht: T.tspieler.geschlecht, jahrgang: T.tspieler.jahrgang };
  // svelte-ignore state_referenced_locally
  let ort = $state(z.ort);
  // svelte-ignore state_referenced_locally
  let tische = $state(z.tische ? String(z.tische) : '');
  // svelte-ignore state_referenced_locally
  let angaben = $state<Angabe[]>([...z.angaben]);
  let gespeichert = $state(false);
  async function datenSpeichern(e: SubmitEvent) {
    e.preventDefault();
    const t = parseInt(tische, 10);
    await eintragen(ART.turnierDaten, { ort: ort.trim(), tische: Number.isFinite(t) && t > 0 ? t : null, angaben: [...angaben] });
    gespeichert = true;
    setTimeout(() => (gespeichert = false), 2000);
  }
</script>

<details class="karte abschnitt" data-testid="abschnitt-angaben">
  <summary>
    <h2 class="titel">{T.tspieler.angabenTitel}</h2>
    <span class="leise">Name, Verein{#each z.angaben as a (a)}, {angabenText[a]}{/each}{z.tische ? ` · ${T.tspieler.tischeKurz(z.tische)}` : ''}</span>
  </summary>
  <form onsubmit={datenSpeichern}>
    <p class="leise">{T.tspieler.angabenText}<Hilfe text={T.tspieler.angabenOrt} /></p>
    <div class="angaben">
      {#each ALLE_ANGABEN as a (a)}
        <label class="haken"><input type="checkbox" value={a} bind:group={angaben} /> {angabenText[a]}</label>
      {/each}
    </div>
    <div class="raster">
      <div><label for="ort">{T.tspieler.ort}</label><input id="ort" bind:value={ort} /></div>
      <div><label for="tische">{T.tspieler.tische}</label><input id="tische" bind:value={tische} inputmode="numeric" maxlength="3" /></div>
    </div>
    <div class="reihe" style="margin-top:12px">
      <button type="submit">{T.app.speichern}</button>
      {#if gespeichert}<span class="leise">{T.app.gespeichert}</span>{/if}
    </div>
  </form>
</details>

<style>
  .abschnitt > summary { display: flex; align-items: baseline; gap: 4px 10px; flex-wrap: wrap; min-height: 44px; cursor: pointer; padding-top: 8px; }
  .abschnitt > summary .titel { font-size: 1.2rem; margin: 0; }
  .angaben { display: flex; flex-wrap: wrap; gap: 4px 18px; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .raster { display: grid; grid-template-columns: 2fr 1fr; gap: 0 12px; }
</style>
