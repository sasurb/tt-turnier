<script lang="ts">
  /**
   * Kleine Hilfe neben einem Feld: am PC beim Darüberfahren, am Handy zum Antippen (ⓘ).
   * Die Bedienung soll ohne diese Hinweise verständlich sein – sie ergänzen nur.
   */
  import { T } from '../texte';

  let { text, label = T.app.hilfe }: { text: string; label?: string } = $props();
  let offen = $state(false);
  /** nach Escape bleibt die Blase auch bei Maus darüber/Fokus zu, bis Maus bzw. Fokus das ⓘ verlassen */
  let unterdrueckt = $state(false);
  /** waagerechte Verschiebung, damit die Blase nicht über den Bildschirmrand ragt */
  let versatz = $state(0);
  let wurzel: HTMLSpanElement | undefined = $state();
  let blase: HTMLSpanElement | undefined = $state();
  const id = 'hilfe-' + Math.random().toString(36).slice(2, 9);

  function ausrichten() {
    requestAnimationFrame(() => {
      if (!blase) return;
      const b = blase.getBoundingClientRect();
      if (!b.width) return;
      const breite = document.documentElement.clientWidth;
      const rand = 8;
      const links = b.left - versatz;
      let d = 0;
      if (links + b.width > breite - rand) d = breite - rand - (links + b.width);
      if (links + d < rand) d = rand - links;
      versatz = Math.round(d);
    });
  }
  function aussen(e: PointerEvent) {
    if (offen && wurzel && !wurzel.contains(e.target as Node)) offen = false;
  }
  function taste(e: KeyboardEvent) {
    if (e.key === 'Escape' && (offen || (wurzel && (wurzel.matches(':hover') || wurzel.contains(document.activeElement))))) {
      offen = false;
      unterdrueckt = true;
    }
  }
</script>

<svelte:window onpointerdown={aussen} onkeydown={taste} />

<!-- Maus-/Fokus-Ereignisse nur für Lage und Sichtbarkeit der Blase, keine Bedienung: -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="hilfe"
  class:offen
  class:unterdrueckt
  bind:this={wurzel}
  style:--versatz="{versatz}px"
  onpointerenter={ausrichten}
  onfocusin={ausrichten}
  onpointerleave={() => {
    if (!wurzel?.contains(document.activeElement)) unterdrueckt = false;
  }}
  onfocusout={() => {
    if (!wurzel?.matches(':hover')) unterdrueckt = false;
  }}
>
  <button
    type="button"
    class="knopf-hilfe"
    aria-label={label}
    aria-expanded={offen}
    aria-describedby={id}
    onclick={(e) => {
      e.preventDefault();
      offen = !offen;
      unterdrueckt = false;
      if (offen) ausrichten();
    }}>i</button
  >
  <span class="blase" role="tooltip" {id} bind:this={blase}>{text}</span>
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
    z-index: 35; /* über dem Rückgängig-Hinweis (30), damit der Text lesbar bleibt */
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(calc(-50% + var(--versatz, 0px)));
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
    .hilfe:not(.unterdrueckt):hover .blase, .hilfe:not(.unterdrueckt) .knopf-hilfe:focus-visible + .blase { display: block; }
  }
</style>
