<script lang="ts">
  import { T } from '../../texte';

  /** Textbaustein „Datenschutz“ für die Ausschreibung (Frage 10A) mit Kopierknopf */
  let { verein = '' }: { verein?: string } = $props();
  let kopiert = $state(false);
  const text = $derived(T.textbaustein.text(verein));

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(text);
      kopiert = true;
      setTimeout(() => (kopiert = false), 2000);
    } catch {
      /* Zwischenablage nicht erlaubt – Text lässt sich markieren */
    }
  }
</script>

<details class="textbaustein" data-testid="textbaustein">
  <summary>{T.textbaustein.titel}</summary>
  <p class="leise">{T.textbaustein.hilfe}</p>
  <textarea readonly rows="7" aria-label={T.textbaustein.titel} value={text}></textarea>
  <button class="zweit klein" onclick={kopieren}>{kopiert ? T.textbaustein.kopiert : T.textbaustein.kopieren}</button>
</details>

<style>
  textarea { width: 100%; font-size: 0.95rem; }
  .textbaustein { margin-top: 12px; }
</style>
