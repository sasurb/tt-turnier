<script lang="ts">
  import { T } from '../../texte';
  import type { Wertung } from '../../engine/modell';

  let { aktiv }: { aktiv: Wertung } = $props();
</script>

<details class="wertung">
  <summary>{T.wertung.titel}</summary>
  <p><strong>{T.konk.wertungWahl[aktiv]}</strong></p>
  <p>{T.wertung[aktiv]}</p>
  <p class="leise">{T.wertung.unterschied}</p>
  <p class="leise">{aktiv === 'dttb' ? T.wertung.ittf : T.wertung.dttb}</p>
</details>

<style>
  .wertung { margin-top: 8px; }
  .wertung summary { font-size: 0.95rem; color: var(--blau); }
  .wertung p { font-size: 0.92rem; }
</style>
