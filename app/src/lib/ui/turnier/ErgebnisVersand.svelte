<script lang="ts">
  /** Ergebnisse nach dem Abschluss in den Posteingang und per Mail verschicken (ab 0.18, nur online). */
  import { api } from '../../dienste';
  import { fehlerText } from '../../app.svelte';
  import { T } from '../../texte';
  import type { TurnierZustand } from '../../engine/zustand';
  import { ergebnisNachricht } from '../../ergebnisnachricht';
  import Hilfe from '../Hilfe.svelte';

  let { z, turnierId, token }: { z: TurnierZustand; turnierId: string; token: string } = $props();

  const n = $derived(ergebnisNachricht(z));
  let laeuft = $state(false);
  let meldung = $state<{ ok: boolean; text: string } | null>(null);

  async function senden() {
    if (!confirm(T.ergebnisMail.frage(n.plaetze.length))) return;
    laeuft = true;
    meldung = null;
    try {
      const r = await api.ergebnisSenden(token, { turnier: turnierId, liste: n.liste, plaetze: n.plaetze });
      meldung = { ok: true, text: T.ergebnisMail.gesendet(r.postfach, r.mails, Math.max(0, r.verbleibend)) };
    } catch (x) {
      meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    } finally {
      laeuft = false;
    }
  }
</script>

<section data-testid="ergebnis-versand">
  <h3>{T.ergebnisMail.titel}<Hilfe text={T.ergebnisMail.hilfe} /></h3>
  {#if !n.mitStand}
    <p class="leise">{T.ergebnisMail.keineListe}</p>
  {:else}
    {#if n.verdeckt}<p class="meldung info">{T.ergebnisMail.verdeckt}</p>{/if}
    <details>
      <summary>{T.ergebnisMail.vorschau}</summary>
      <pre class="vorschau">{n.liste}</pre>
    </details>
    <button onclick={senden} disabled={laeuft} data-testid="ergebnis-senden">{T.ergebnisMail.knopf}</button>
  {/if}
  {#if meldung}<div class="meldung" class:ok={meldung.ok} class:fehler={!meldung.ok} role="status">{meldung.text}</div>{/if}
</section>

<style>
  .vorschau { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 0.92rem; background: var(--grund); padding: 10px 12px; border-radius: 10px; max-height: 18rem; overflow-y: auto; }
  details > summary { font-size: 1rem; }
</style>
