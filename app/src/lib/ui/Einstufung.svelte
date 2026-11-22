<script lang="ts">
  /** Einstufung für Hobbyspieler ohne TTR: 4 Fragen, je 0–3 Punkte → Hobby-Stufe und Startwert (engine/stufen.ts) */
  import { T } from '../texte';
  import { einstufen, EINSTUFUNG_FRAGEN, type Stufe } from '../engine/stufen';

  let {
    uebernehmen,
    sofort = false,
  }: {
    uebernehmen: (wert: number, stufe: Stufe) => void;
    /** Ohne Knopf: das Ergebnis wird übernommen, sobald alle Fragen beantwortet sind (Online-Anmeldung) */
    sofort?: boolean;
  } = $props();

  const id = Math.random().toString(36).slice(2, 7);
  let antworten = $state<(number | null)[]>(Array(EINSTUFUNG_FRAGEN).fill(null));
  const offen = $derived(antworten.filter((a) => a === null).length);
  const ergebnis = $derived(offen === 0 ? einstufen(antworten as number[]) : null);

  $effect(() => {
    if (sofort && ergebnis) uebernehmen(ergebnis.wert, ergebnis.stufe);
  });
</script>

<div class="einstufung" data-testid="einstufung">
  <p class="leise">{T.einstufung.text}</p>
  {#each T.einstufung.fragen as f, i (i)}
    <fieldset>
      <legend>{i + 1}. {f.frage}</legend>
      {#each f.antworten as a, p (p)}
        <label class="wahl"><input type="radio" name="es-{id}-{i}" value={p} checked={antworten[i] === p} onchange={() => (antworten[i] = p)} />{a}</label>
      {/each}
    </fieldset>
  {/each}
  {#if ergebnis}
    <div class="meldung ok" role="status">
      <p class="titel" data-testid="einstufung-ergebnis">{T.einstufung.ergebnis(ergebnis.stufe.name, ergebnis.wert)}</p>
      <p class="text" data-testid="einstufung-text">{T.einstufung.ergebnisTexte[ergebnis.stufe.id]}</p>
    </div>
    {#if !sofort}<button type="button" class="zweit" onclick={() => uebernehmen(ergebnis.wert, ergebnis.stufe)}>{T.einstufung.uebernehmen}</button>{/if}
  {:else}
    <p class="leise">{T.einstufung.offen(offen)}</p>
  {/if}
</div>

<style>
  .einstufung { border: 1px solid var(--linie); border-radius: 10px; padding: 8px 12px 12px; margin: 8px 0; }
  fieldset { border: 0; padding: 0; margin: 12px 0 0; }
  legend { font-weight: 700; padding: 0; margin-bottom: 4px; }
  .wahl { display: flex; gap: 10px; align-items: center; padding: 4px 0; line-height: 1.35; font-weight: 400; min-height: 44px; margin: 0; }
  .meldung p { margin: 0; }
  .meldung .titel { font-weight: 700; }
  .meldung .text { margin-top: 4px; color: var(--text); }
  .wahl input { width: 22px; height: 22px; min-height: 0; flex: none; }
</style>
