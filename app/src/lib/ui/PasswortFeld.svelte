<script lang="ts">
  import { T } from '../texte';

  let {
    id,
    wert = $bindable(''),
    neu = false,
    min = 0,
  }: { id: string; wert?: string; neu?: boolean; min?: number } = $props();
  let sichtbar = $state(false);
</script>

<div class="pw">
  <input
    {id}
    type={sichtbar ? 'text' : 'password'}
    bind:value={wert}
    autocomplete={neu ? 'new-password' : 'current-password'}
    minlength={min || undefined}
    autocapitalize="off"
    spellcheck="false"
    required
  />
  <button
    type="button"
    class="zeigen"
    aria-label={sichtbar ? T.app.passwortVerbergen : T.app.passwortZeigen}
    title={sichtbar ? T.app.passwortVerbergen : T.app.passwortZeigen}
    aria-pressed={sichtbar}
    onclick={() => (sichtbar = !sichtbar)}
  >
    {#if sichtbar}
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.8 9.8 0 0112 5c5 0 9 4.5 10 7-0.4 1-1.3 2.4-2.6 3.7M6.3 6.3C4.3 7.7 2.8 9.8 2 12c1 2.5 5 7 10 7 1.6 0 3.1-0.4 4.4-1.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    {:else}
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
    {/if}
  </button>
</div>

<style>
  .pw { position: relative; }
  .pw input { padding-right: 52px; }
  .zeigen {
    position: absolute;
    right: 2px;
    top: 50%;
    transform: translateY(-50%);
    min-height: 44px;
    width: 46px;
    padding: 0;
    background: transparent;
    color: var(--leise);
    border: 0;
  }
  .zeigen:hover { background: transparent; color: var(--text); }
</style>
