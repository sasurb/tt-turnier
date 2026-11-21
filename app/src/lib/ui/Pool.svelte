<script lang="ts">
  import { T } from '../texte';
  import PoolVerwaltung from './PoolVerwaltung.svelte';
</script>

<h1>{T.pool.titel}</h1>
<p class="leise">{T.pool.text}</p>
<PoolVerwaltung />
