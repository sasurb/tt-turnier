<script lang="ts">
  import { T } from '../texte';
  import { api } from '../dienste';
  import { fehlerText } from '../app.svelte';

  /**
   * #/sicherung/<turnier>/<schlüssel>: neue Empfänger der Sicherungsmails bestätigen ihre Adresse (Frage 14A).
   * Bestätigt wird erst per Knopf – Mail-Scanner öffnen Links, ohne dass jemand zustimmt.
   */
  let { turnier, schluessel }: { turnier: string; schluessel: string } = $props();
  let text = $state<string>('');
  let ok = $state<boolean | null>(null);
  let laeuft = $state(false);

  async function bestaetigen() {
    laeuft = true;
    try {
      const a = await api.sicherungBestaetigen(turnier, schluessel);
      text = T.sicherungLink.ok(a.email, a.turnier);
      ok = true;
    } catch (x) {
      text = fehlerText(x, T.app.fehlerAllgemein);
      ok = false;
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.sicherungLink.titel}</h1>
{#if ok === null}
  <section class="karte">
    <p>{T.sicherungLink.frage}</p>
    <button class="breit" onclick={bestaetigen} disabled={laeuft} data-testid="sicherung-bestaetigen">{T.sicherungLink.knopf}</button>
    <p class="leise">{T.sicherungLink.nicht}</p>
  </section>
{:else}
  <div class="meldung" class:ok class:fehler={!ok} role="status" data-testid="sicherung-link">{text}</div>
{/if}
