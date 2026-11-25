<script lang="ts">
  /**
   * Glocke mit Posteingang (ab 0.18): Nachrichten der Turnierleitung an die eigene Kennung. Die Leitung mit Konto
   * sieht hier „Gesendet“. Abfrage alle 2 Minuten, solange die Seite sichtbar ist; neue Nachrichten melden sich
   * zusätzlich mit einem Hinweis (onNeu). Texte werden nur als Text angezeigt (kein HTML).
   */
  import { onDestroy, onMount } from 'svelte';
  import type { Nachricht, PostfachAntwort } from '@shared/protokoll';
  import { api } from '../../dienste';
  import { T } from '../../texte';
  import Hilfe from '../Hilfe.svelte';

  let { turnierId, token, onNeu }: { turnierId: string; token: string; onNeu?: (n: number) => void } = $props();

  let stand = $state<PostfachAntwort | null>(null);
  let offen = $state(false);
  let dialog: HTMLDialogElement | undefined = $state();
  let bekannt = -1;

  async function laden() {
    if (document.visibilityState !== 'visible') return;
    try {
      const s = await api.postfach(token, turnierId);
      const neueste = s.nachrichten[0]?.id ?? 0;
      if (bekannt >= 0 && neueste > bekannt && s.ungelesen > 0 && !s.gesendet) onNeu?.(s.ungelesen);
      bekannt = neueste;
      stand = s;
    } catch {
      /* kein Netz oder keine Berechtigung – später erneut */
    }
  }

  async function oeffnen() {
    offen = true;
    await laden();
    const bis = stand?.nachrichten[0]?.id;
    if (bis && stand && stand.ungelesen > 0 && !stand.gesendet) {
      try {
        await api.postfachGelesen(token, turnierId, bis);
      } catch {
        /* beim nächsten Öffnen erneut */
      }
    }
  }
  function schliessen() {
    offen = false;
    if (stand) stand = { ...stand, ungelesen: 0, nachrichten: stand.nachrichten.map((n) => ({ ...n, gelesen: true })) };
  }
  $effect(() => {
    if (offen) dialog?.showModal();
  });

  let takt: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    void laden();
    takt = setInterval(() => void laden(), 120_000);
  });
  onDestroy(() => clearInterval(takt));

  function zeit(iso: string) {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  }
  const ungelesen = $derived(stand && !stand.gesendet ? stand.ungelesen : 0);
  /** Für Tests und den Abgleich von außen (z. B. nach dem Senden einer Rundmail) */
  export function neuLaden() {
    return laden();
  }
</script>

{#if stand}
  <button
    class="glocke zweit klein"
    class:neu={ungelesen > 0}
    onclick={oeffnen}
    aria-label={ungelesen ? T.postfach.knopfZahl(ungelesen) : stand.gesendet ? T.postfach.gesendet : T.postfach.knopf}
    title={ungelesen ? T.postfach.knopfZahl(ungelesen) : T.postfach.knopf}
    data-testid="postfach-knopf"
  >
    <span aria-hidden="true">{stand.gesendet ? '✉' : '🔔'}</span>{#if ungelesen}<span class="zahl" data-testid="postfach-zahl">{ungelesen}</span>{/if}
  </button>
{/if}

{#if offen && stand}
  <dialog bind:this={dialog} onclose={schliessen} aria-labelledby="pf-titel" data-testid="postfach">
    <div class="kopf">
      <h2 id="pf-titel">{stand.gesendet ? T.postfach.gesendet : T.postfach.titel}<Hilfe text={stand.gesendet ? T.postfach.hilfeGesendet : T.postfach.hilfe} /></h2>
      <button class="zweit klein" onclick={() => dialog?.close()} aria-label={T.postfach.schliessen}>✕</button>
    </div>
    {#if stand.gesendet && stand.wartend > 0}<p class="meldung info">{T.postfach.wartend(stand.wartend)}</p>{/if}
    {#if !stand.nachrichten.length}
      <p class="leise">{stand.gesendet ? T.postfach.leerGesendet : T.postfach.leer}</p>
    {:else}
      <ul class="liste">
        {#each stand.nachrichten as n (n.id)}
          {@render eintrag(n)}
        {/each}
      </ul>
    {/if}
    <button class="breit" onclick={() => dialog?.close()}>{T.postfach.schliessen}</button>
  </dialog>
{/if}

{#snippet eintrag(n: Nachricht)}
  <li class:ungelesen={!n.gelesen && !stand?.gesendet}>
    <div class="zeile"><span class="marke">{T.postfach.arten[n.art] ?? n.art}</span> <span class="leise">{zeit(n.zeit)} · {n.von}</span></div>
    <strong class="betreff">{n.titel}</strong>
    <p class="text">{n.text}</p>
  </li>
{/snippet}

<style>
  .glocke { position: relative; min-width: 44px; padding: 6px 10px; }
  .glocke.neu { border-color: var(--orange); }
  .zahl {
    background: var(--orange);
    color: #1a1000;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 700;
    min-width: 1.4rem;
    padding: 0 6px;
    line-height: 1.4rem;
  }
  dialog {
    width: min(36rem, 100vw);
    max-height: 100dvh;
    border: 0;
    border-radius: var(--radius);
    padding: var(--abstand);
    background: var(--flaeche);
    color: var(--text);
    box-shadow: 0 10px 40px rgb(0 0 0 / 30%);
  }
  dialog::backdrop { background: rgb(0 0 0 / 45%); }
  @media (max-width: 600px) {
    dialog { margin: auto 0 0; width: 100vw; max-width: 100vw; border-radius: var(--radius) var(--radius) 0 0; padding-bottom: calc(var(--abstand) + env(safe-area-inset-bottom)); }
  }
  .kopf { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
  .kopf h2 { margin: 0; }
  .zeile { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 4px; }
  .betreff { display: block; overflow-wrap: anywhere; }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 0; }
  li.ungelesen { border-left: 4px solid var(--orange); padding-left: 10px; }
  ul.liste { margin-bottom: 12px; }
</style>
