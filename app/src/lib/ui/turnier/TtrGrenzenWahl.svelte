<script lang="ts">
  /** TTR-Grenzen eingeben – frei oder aus einer Klassen-Vorlage (Hobby H1–H4, DTTB E–A, beides) */
  import { T } from '../../texte';
  import { DAMEN_ABZUEGE, KLASSEN_VORLAGEN, vorlageErkennen, vorlageGrenzen, type KlassenVorlage } from '../../engine/stufen';
  import { ttrBereichName } from '../../engine/modell';
  import Hilfe from '../Hilfe.svelte';

  let { wert = $bindable(), id, disabled = false }: { wert: string; id: string; disabled?: boolean } = $props();

  const liste = $derived([...new Set(wert.split(',').map((t) => parseInt(t.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0 && n <= 4000))].sort((a, b) => a - b));
  // svelte-ignore state_referenced_locally
  const erkannt = vorlageErkennen(liste);
  let vorlage = $state<KlassenVorlage | 'eigen'>(erkannt?.vorlage ?? 'eigen');
  let damen = $state<number>(erkannt?.damenAbzug ?? 0);

  function anwenden() {
    if (vorlage !== 'eigen') wert = vorlageGrenzen(vorlage, vorlage === 'hobby' ? 0 : damen).grenzen.join(', ');
  }
  const namen = $derived(liste.length ? Array.from({ length: liste.length + 1 }, (_, i) => ttrBereichName(i, liste)) : []);
</script>

<div class="label-zeile"><label for="tv-{id}">{T.vorlagen.label}</label><Hilfe text={T.vorlagen.hilfe} /></div>
<select id="tv-{id}" bind:value={vorlage} onchange={anwenden} {disabled}>
  {#each ['eigen', ...KLASSEN_VORLAGEN] as v (v)}<option value={v}>{T.vorlagen.wahl[v]}</option>{/each}
</select>
{#if vorlage === 'dttb' || vorlage === 'gemischt'}
  <div class="label-zeile"><label for="td-{id}">{T.vorlagen.damen}</label><Hilfe text={T.vorlagen.damenHilfe} /></div>
  <select id="td-{id}" bind:value={damen} onchange={anwenden} {disabled}>
    {#each DAMEN_ABZUEGE as a (a)}<option value={a}>{a === 0 ? '–' : `${a} Punkte`}</option>{/each}
  </select>
{/if}
<div class="label-zeile"><label for="tg-{id}">{T.konk.ttrGrenzen}</label><Hilfe text={T.konk.ttrGrenzenHilfe} /></div>
<input id="tg-{id}" bind:value={wert} inputmode="numeric" placeholder="1200, 1500" {disabled} oninput={() => (vorlage = 'eigen')} />
{#if namen.length}<p class="leise bereiche" data-testid="ttr-bereiche">{T.vorlagen.bereiche(namen.join(' · '))}</p>{/if}

<style>
  .bereiche { margin-top: 4px; }
</style>
