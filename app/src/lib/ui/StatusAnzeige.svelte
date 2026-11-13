<script lang="ts">
  import type { AbgleichStatus } from '../engine/abgleich';
  import { T } from '../texte';

  let { status, lokal }: { status: AbgleichStatus | null; lokal: boolean } = $props();

  const art = $derived(lokal ? 'lokal' : (status?.verbindung ?? 'unbekannt'));
  const text = $derived(lokal ? T.status.lokal : T.status[status?.verbindung ?? 'unbekannt']);
</script>

<div class="status {art}" role="status" aria-live="polite">
  <span class="punkt" aria-hidden="true"></span>
  <span>{text}</span>
  {#if status && status.ausstehend > 0}
    <span class="marke">{T.status.ausstehend(status.ausstehend)}</span>
  {/if}
</div>

<style>
  .status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.92rem; color: var(--leise); }
  .punkt { width: 10px; height: 10px; border-radius: 50%; background: var(--leise); flex: none; }
  .verbunden .punkt { background: var(--gruen); }
  .offline .punkt, .nicht_angemeldet .punkt { background: var(--orange); }
  .fehler .punkt { background: var(--rot); }
  .lokal .punkt { background: var(--blau); }
  .unbekannt .punkt { animation: blinken 1s infinite alternate; }
  @keyframes blinken { to { opacity: 0.2; } }
</style>
