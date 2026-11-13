<script lang="ts">
  /**
   * Kleine Hilfe neben einem Feld: am PC beim Darüberfahren, am Handy zum Antippen (ⓘ).
   * Die Bedienung soll ohne diese Hinweise verständlich sein – sie ergänzen nur.
   */
  import { T } from '../texte';

  let { text, label = T.app.hilfe }: { text: string; label?: string } = $props();
  let offen = $state(false);
  let wurzel: HTMLSpanElement | undefined = $state();
  const id = 'hilfe-' + Math.random().toString(36).slice(2, 9);

  function aussen(e: PointerEvent) {
    if (offen && wurzel && !wurzel.contains(e.target as Node)) offen = false;
  }
  function taste(e: KeyboardEvent) {
    if (e.key === 'Escape') offen = false;
  }
</script>

<svelte:window onpointerdown={aussen} onkeydown={taste} />

<span class="hilfe" class:offen bind:this={wurzel}>
  <button
    type="button"
    class="knopf-hilfe"
    aria-label={label}
    aria-expanded={offen}
    aria-describedby={id}
    onclick={(e) => {
      e.preventDefault();
      offen = !offen;
    }}>i</button
  >
  <span class="blase" role="tooltip" {id}>{text}</span>
</span>

<style>
  .hilfe { position: relative; display: inline-flex; vertical-align: middle; margin-left: 6px; }
  .knopf-hilfe {
    min-height: 0;
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 50%;
    font: 700 0.8rem/1 Georgia, serif;
    font-style: italic;
    background: transparent;
    color: var(--blau);
    border: 1.5px solid currentColor;
  }
  .knopf-hilfe:hover { background: var(--grund); }
  /* größere Tippfläche am Handy, ohne das Symbol zu vergrößern */
  .knopf-hilfe::after { content: ''; position: absolute; inset: -10px; }
  .blase {
    display: none;
    position: absolute;
    z-index: 20;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    width: max-content;
    max-width: min(18rem, 80vw);
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--text);
    color: var(--flaeche);
    font-size: 0.9rem;
    font-weight: 400;
    line-height: 1.4;
    box-shadow: 0 4px 16px rgb(0 0 0 / 20%);
    white-space: normal;
  }
  .offen .blase { display: block; }
  @media (hover: hover) {
    .hilfe:hover .blase, .knopf-hilfe:focus-visible + .blase { display: block; }
  }
</style>
