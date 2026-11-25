<script lang="ts">
  /** Verteiler der Sparte (ab 0.18, nur Spartenleitung): Liste, Austragen, Ankündigung senden. */
  import type { VerteilerAntwort } from '@shared/protokoll';
  import { NACHRICHT_MAX_TEXT, NACHRICHT_MAX_TITEL } from '@shared/protokoll';
  import { api } from '../dienste';
  import { fehlerText } from '../app.svelte';
  import { T } from '../texte';
  import Hilfe from './Hilfe.svelte';

  let { sparte, token, frei }: { sparte: number; token: string; frei: boolean } = $props();

  let daten = $state<VerteilerAntwort | null>(null);
  let offen = $state(false);
  let betreff = $state('');
  let text = $state('');
  let meldung = $state<{ ok: boolean; text: string } | null>(null);
  let laeuft = $state(false);

  async function laden() {
    try {
      daten = await api.verteiler(token, sparte);
    } catch (x) {
      meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    }
  }
  $effect(() => {
    if (offen && !daten) void laden();
  });

  async function entfernen(id: string, name: string) {
    if (!confirm(T.verteiler.entfernenFrage(name))) return;
    try {
      daten = await api.verteilerEntfernen(token, sparte, id);
    } catch (x) {
      meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    }
  }
  async function senden(e: SubmitEvent) {
    e.preventDefault();
    laeuft = true;
    meldung = null;
    try {
      const r = await api.verteilerSenden(token, sparte, betreff.trim(), text.trim());
      meldung = { ok: true, text: T.verteiler.gesendetZahl(r.mails) };
      betreff = '';
      text = '';
      await laden();
    } catch (x) {
      meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    } finally {
      laeuft = false;
    }
  }
  const bestaetigt = $derived(daten?.eintraege.filter((e) => e.bestaetigt).length ?? 0);
</script>

<details class="karte" bind:open={offen} data-testid="sparte-verteiler">
  <summary>{T.verteiler.sparteTitel}</summary>
  <p class="leise">{T.verteiler.sparteHilfe}</p>
  {#if daten}
    <p><strong>{T.verteiler.bestaetigtZahl(bestaetigt)}</strong></p>
    {#if !daten.eintraege.length}
      <p class="leise">{T.verteiler.leer}</p>
    {:else}
      <ul class="liste">
        {#each daten.eintraege as e (e.id)}
          <li class="reihe">
            <span class="wachsen"
              >{e.name}<br /><span class="leise">{e.email}{#if !e.bestaetigt} · {T.verteiler.offen}{/if}{#if e.jugend} · {T.verteiler.jugend}{/if}</span></span
            >
            <button class="gefahr klein" onclick={() => entfernen(e.id, e.name)}>{T.verteiler.entfernen}</button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if !frei}
      <p class="meldung info">{T.verteiler.nichtFrei}</p>
    {:else if bestaetigt}
      <form onsubmit={senden}>
        <h3>{T.verteiler.ankuendigen}<Hilfe text={T.verteiler.hilfe} /></h3>
        <label for="va-betreff">{T.verteiler.betreff}</label>
        <input id="va-betreff" bind:value={betreff} maxlength={NACHRICHT_MAX_TITEL} required />
        <label for="va-text">{T.verteiler.text}</label>
        <textarea id="va-text" bind:value={text} rows="5" maxlength={NACHRICHT_MAX_TEXT} required></textarea>
        <button type="submit" class="breit" disabled={laeuft || betreff.trim().length < 2 || text.trim().length < 2 || daten.gesendetHeute >= daten.jeTag}>{T.verteiler.ankuendigen}</button>
      </form>
    {/if}
  {/if}
  {#if meldung}<div class="meldung" class:ok={meldung.ok} class:fehler={!meldung.ok} role="status">{meldung.text}</div>{/if}
</details>

<style>
  textarea { resize: vertical; }
  li .wachsen { overflow-wrap: anywhere; }
</style>
