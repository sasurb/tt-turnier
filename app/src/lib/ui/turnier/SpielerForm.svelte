<script lang="ts">
  import { T } from '../../texte';
  import type { Angabe, Geschlecht, SpielerDaten } from '../../engine/modell';
  import { klassen, klassenMerken } from '../../klassen.svelte';
  import { vereinMerken, vereinsVorschlaege } from '../../vereine';
  import { hobbyStufe } from '../../engine/stufen';
  import Einstufung from '../Einstufung.svelte';
  import Hilfe from '../Hilfe.svelte';

  let {
    angaben,
    start = {},
    mitPool = false,
    vereine = [],
    knopf,
    speichern,
    abbrechen,
  }: {
    angaben: Angabe[];
    start?: Partial<SpielerDaten>;
    mitPool?: boolean;
    /** Weitere Vereine für die Vorschläge (z. B. aus Pool und Turnier) */
    vereine?: (string | null | undefined)[];
    knopf: string;
    speichern: (d: SpielerDaten, inPool: boolean) => Promise<void>;
    abbrechen: () => void;
  } = $props();

  const id = Math.random().toString(36).slice(2, 7);
  /** Neuer Spieler (kein Bearbeiten): nach dem Speichern leeren, damit gleich der nächste folgen kann */
  // svelte-ignore state_referenced_locally
  const neu = !start.vorname && !start.nachname;
  function leer(verein = '') {
    return {
      vorname: start.vorname ?? '',
      nachname: start.nachname ?? '',
      verein: start.verein ?? verein,
      ttr: start.ttr != null ? String(start.ttr) : '',
      geschaetzt: !!start.ttrGeschaetzt,
      klasse: start.klasse ?? '',
      geschlecht: (start.geschlecht ?? '') as Geschlecht | '',
      jahrgang: start.jahrgang != null ? String(start.jahrgang) : '',
    };
  }
  let d = $state(leer());
  let gleicherVerein = $state(false);
  let inPool = $state(true);
  let einstufen = $state(false);
  let erstesFeld = $state<HTMLInputElement | null>(null);
  const vorschlaege = $derived(vereinsVorschlaege(vereine));
  let fehler = $state('');
  let sendet = $state(false);

  async function absenden(e: SubmitEvent) {
    e.preventDefault();
    if (!d.vorname.trim() && !d.nachname.trim()) return;
    const zahl = (t: string) => (t.trim() === '' ? null : parseInt(t, 10));
    const ttr = zahl(d.ttr);
    const jg = zahl(d.jahrgang);
    const daten: SpielerDaten = { vorname: d.vorname.trim(), nachname: d.nachname.trim(), verein: d.verein.trim() };
    if (angaben.includes('ttr')) {
      daten.ttr = Number.isFinite(ttr) ? ttr : null;
      if (daten.ttr !== null && d.geschaetzt) daten.ttrGeschaetzt = true;
    }
    if (angaben.includes('klasse')) daten.klasse = d.klasse.trim() || null;
    if (angaben.includes('geschlecht')) daten.geschlecht = d.geschlecht || null;
    if (angaben.includes('jahrgang')) daten.jahrgang = Number.isFinite(jg) ? jg : null;
    sendet = true;
    fehler = '';
    try {
      await speichern(daten, mitPool && inPool);
      if (angaben.includes('klasse')) klassenMerken(daten.klasse);
      vereinMerken(daten.verein);
      if (neu) {
        // Felder leeren; mit Häkchen „gleicher Verein“ bleibt der Verein stehen
        d = leer(gleicherVerein ? daten.verein : '');
        erstesFeld?.focus();
      }
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    } finally {
      sendet = false;
    }
  }
</script>

<form class="spielerform" onsubmit={absenden}>
  <div class="raster">
    <div><label for="vn-{id}">{T.tspieler.vorname}</label><input id="vn-{id}" bind:this={erstesFeld} bind:value={d.vorname} autocomplete="off" required={!d.nachname} /></div>
    <div><label for="nn-{id}">{T.tspieler.nachname}</label><input id="nn-{id}" bind:value={d.nachname} autocomplete="off" /></div>
    <div class="ganz"><label for="ve-{id}">{T.tspieler.verein}</label><input id="ve-{id}" bind:value={d.verein} autocomplete="off" list="vereine-{id}" /></div>
    {#if angaben.includes('ttr')}
      <div>
        <label for="tt-{id}">{T.tspieler.ttr}</label><input id="tt-{id}" bind:value={d.ttr} inputmode="numeric" maxlength="4" />
        {#if d.geschaetzt && /^\d+$/.test(d.ttr.trim())}<span class="leise stufe">{T.einstufung.stufe(Number(d.ttr), hobbyStufe(Number(d.ttr))?.name ?? null)}</span>{/if}
      </div>
      <div class="ganz ttr-zusatz">
        <label class="haken"><input type="checkbox" bind:checked={d.geschaetzt} /> {T.einstufung.geschaetzt}</label><Hilfe text={T.einstufung.geschaetztHilfe} />
        <button type="button" class="zweit klein" aria-expanded={einstufen} onclick={() => (einstufen = !einstufen)}>{T.einstufung.knopf}</button>
      </div>
      {#if einstufen}
        <div class="ganz">
          <Einstufung uebernehmen={(wert) => { d.ttr = String(wert); d.geschaetzt = true; einstufen = false; }} />
        </div>
      {/if}
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
  <datalist id="vereine-{id}">
    {#each vorschlaege as v (v)}<option value={v}></option>{/each}
  </datalist>
  {#if neu}
    <label class="haken"><input type="checkbox" bind:checked={gleicherVerein} /> {T.tspieler.gleicherVerein}</label>
  {/if}
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
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; }
  .haken input { width: 22px; height: 22px; min-height: 0; }
  .reihe { margin-top: 12px; }
  .ttr-zusatz { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
  .stufe { display: block; font-size: 0.9rem; margin-top: -6px; }
</style>
