<script lang="ts">
  import { onMount } from 'svelte';
  import { T } from '../texte';
  import { api } from '../dienste';
  import { fehlerText } from '../app.svelte';

  /** #/sicherung/<turnier>/<schlüssel>: neue Empfänger der Sicherungsmails bestätigen ihre Adresse (Frage 14A) */
  let { turnier, schluessel }: { turnier: string; schluessel: string } = $props();
  let text = $state<string>(T.sicherungLink.pruefe);
  let ok = $state<boolean | null>(null);

  onMount(async () => {
    try {
      const a = await api.sicherungBestaetigen(turnier, schluessel);
      text = T.sicherungLink.ok(a.email, a.turnier);
      ok = true;
    } catch (x) {
      text = fehlerText(x, T.app.fehlerAllgemein);
      ok = false;
    }
  });
</script>

<h1>{T.sicherungLink.titel}</h1>
<div class="meldung" class:ok={ok === true} class:fehler={ok === false} class:info={ok === null} role="status" data-testid="sicherung-link">{text}</div>
