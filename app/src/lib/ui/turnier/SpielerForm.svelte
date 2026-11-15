<script lang="ts">
  import { T } from '../../texte';
  import type { Angabe, Geschlecht, SpielerDaten } from '../../engine/modell';
  import { klassen, klassenMerken } from '../../klassen.svelte';

  let {
    angaben,
    start = {},
    mitPool = false,
    knopf,
    speichern,
    abbrechen,
  }: {
    angaben: Angabe[];
    start?: Partial<SpielerDaten>;
    mitPool?: boolean;
    knopf: string;
    speichern: (d: SpielerDaten, inPool: boolean) => Promise<void>;
    abbrechen: () => void;
  } = $props();

  const id = Math.random().toString(36).slice(2, 7);
  // svelte-ignore state_referenced_locally
  let d = $state({
    vorname: start.vorname ?? '',
    nachname: start.nachname ?? '',
    verein: start.verein ?? '',
    ttr: start.ttr != null ? String(start.ttr) : '',
    klasse: start.klasse ?? '',
    geschlecht: (start.geschlecht ?? '') as Geschlecht | '',
    jahrgang: start.jahrgang != null ? String(start.jahrgang) : '',
  });
  let inPool = $state(true);
  let fehler = $state('');
  let sendet = $state(false);

  async function absenden(e: SubmitEvent) {
    e.preventDefault();
    if (!d.vorname.trim() && !d.nachname.trim()) return;
    const zahl = (t: string) => (t.trim() === '' ? null : parseInt(t, 10));
    const ttr = zahl(d.ttr);
    const jg = zahl(d.jahrgang);
    const daten: SpielerDaten = { vorname: d.vorname.trim(), nachname: d.nachname.trim(), verein: d.verein.trim() };
    if (angaben.includes('ttr')) daten.ttr = Number.isFinite(ttr) ? ttr : null;
    if (angaben.includes('klasse')) daten.klasse = d.klasse.trim() || null;
    if (angaben.includes('geschlecht')) daten.geschlecht = d.geschlecht || null;
    if (angaben.includes('jahrgang')) daten.jahrgang = Number.isFinite(jg) ? jg : null;
    sendet = true;
    fehler = '';
    try {
      await speichern(daten, mitPool && inPool);
      if (angaben.includes('klasse')) klassenMerken(daten.klasse);
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    } finally {
      sendet = false;
    }
  }
</script>

<form class="spielerform" onsubmit={absenden}>
  <div class="raster">
    <div><label for="vn-{id}">{T.tspieler.vorname}</label><input id="vn-{id}" bind:value={d.vorname} autocomplete="off" required={!d.nachname} /></div>
    <div><label for="nn-{id}">{T.tspieler.nachname}</label><input id="nn-{id}" bind:value={d.nachname} autocomplete="off" /></div>
    <div class="ganz"><label for="ve-{id}">{T.tspieler.verein}</label><input id="ve-{id}" bind:value={d.verein} autocomplete="off" /></div>
    {#if angaben.includes('ttr')}
      <div><label for="tt-{id}">{T.tspieler.ttr}</label><input id="tt-{id}" bind:value={d.ttr} inputmode="numeric" maxlength="4" /></div>
    {/if}
    {#if angaben.includes('klasse')}
      <div><label for="kl-{id}">{T.tspieler.klasse}</label><input id="kl-{id}" bind:value={d.klasse} list="klassen-vorschlag" title={T.tspieler.klasseHilfe} /></div>
    {/if}
    {#if angaben.includes('geschlecht')}
      <div>
        <label for="ge-{id}">{T.tspieler.geschlecht}</label>
        <select id="ge-{id}" bind:value={d.geschlecht}>
          <option value="">{T.tspieler.keineAngabe}</option>
          {#each ['m', 'w', 'd'] as g (g)}<option value={g}>{T.tspieler.geschlechter[g]}</option>{/each}
        </select>
      </div>
    {/if}
    {#if angaben.includes('jahrgang')}
      <div><label for="jg-{id}">{T.tspieler.jahrgang}</label><input id="jg-{id}" bind:value={d.jahrgang} inputmode="numeric" maxlength="4" /></div>
    {/if}
  </div>
  <datalist id="klassen-vorschlag">
    {#each klassen.liste.length ? klassen.liste : ['Anfänger', 'Fortgeschritten', 'A', 'B', 'C'] as k (k)}<option value={k}></option>{/each}
  </datalist>
  {#if mitPool}
    <label class="haken"><input type="checkbox" bind:checked={inPool} /> {T.tspieler.auchInPool}</label>
  {/if}
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <div class="reihe">
    <button type="submit" disabled={sendet || (!d.vorname.trim() && !d.nachname.trim())}>{knopf}</button>
    <button type="button" class="zweit" onclick={abbrechen}>{T.app.abbrechen}</button>
  </div>
</form>

<style>
  .spielerform { margin: 8px 0 12px; }
  .raster { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  .raster .ganz { grid-column: 1 / -1; }
  @media (max-width: 420px) {
    .raster { grid-template-columns: 1fr; }
  }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; }
  .haken input { width: 22px; height: 22px; min-height: 0; }
  .reihe { margin-top: 12px; }
</style>
