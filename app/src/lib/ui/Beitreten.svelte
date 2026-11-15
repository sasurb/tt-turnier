<script lang="ts">
  import type { TurnierInfo } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { app, fehlerText } from '../app.svelte';
  import { ApiFehler } from '../engine/api';
  import { codeAnzeige, turnierKennungLesen } from '../code';
  import Hilfe from './Hilfe.svelte';
  import KennungFeld from './KennungFeld.svelte';

  /**
   * Schritt 1: Turnierkennung (8 Ziffern) oder Link → Turnier wird gesucht und angezeigt.
   * Schritt 2: eigene Kennung (Leitung, Helfer, Spieler) oder „Nur zuschauen“.
   */
  let kennung = $state('');
  let link = $state('');
  let linkOffen = $state(false);
  let turnier = $state<TurnierInfo | null>(null);
  let eigene = $state('');
  let fehler = $state('');
  let sucht = $state(false);

  function datum(d: string | null) {
    return d ? new Date(d + 'T12:00:00').toLocaleDateString('de-DE') : '';
  }

  async function suchen(e?: SubmitEvent) {
    e?.preventDefault();
    fehler = '';
    const ziel = linkOffen && link.trim() ? turnierKennungLesen(link) : turnierKennungLesen(kennung);
    if (!ziel) {
      fehler = T.beitreten.kennungHinweis;
      return;
    }
    if (ziel.code) {
      gehe(`c/${ziel.turnier}/${ziel.code}`);
      return;
    }
    sucht = true;
    try {
      turnier = (await api.turnier(ziel.turnier)).turnier;
      kennung = turnier.id;
    } catch (x) {
      fehler = x instanceof ApiFehler && x.code === 'nicht_gefunden' ? T.beitreten.nichtGefunden : fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      sucht = false;
    }
  }

  function mitKennung(e: SubmitEvent) {
    e.preventDefault();
    if (!turnier || eigene.length !== 8) return;
    gehe(`c/${turnier.id}/${eigene}`);
  }
  function zuschauen() {
    if (turnier) gehe('t/' + turnier.id);
  }
</script>

<h1>{T.beitreten.titel}</h1>

{#if app.server.art !== 'bereit'}
  <div class="meldung info">{T.app.keinServer}</div>
{/if}

<form class="karte" onsubmit={suchen}>
  <h2>{T.beitreten.schritt1}</h2>
  {#if turnier}
    <p class="gefunden">
      <strong>{turnier.name}</strong><br />
      <span class="leise">{datum(turnier.datum)}{turnier.datum ? ' · ' : ''}{turnier.veranstalter} · <span class="kennung">{codeAnzeige(turnier.id)}</span></span>
    </p>
    <button type="button" class="zweit klein" onclick={() => (turnier = null)}>{T.beitreten.zurueck}</button>
  {:else}
    <div class="label-zeile"><label for="tk">{T.beitreten.kennung}</label><Hilfe text={T.beitreten.kennungHilfe} /></div>
    <KennungFeld id="tk" bind:wert={kennung} label={T.beitreten.kennung} autofocus />
    <details class="link" bind:open={linkOffen}>
      <summary>{T.beitreten.linkEinfuegen}</summary>
      <input bind:value={link} autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…/#/t/…" aria-label={T.beitreten.linkEinfuegen} />
    </details>
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <div class="reihe" style="margin-top:12px">
      <button type="submit" disabled={sucht || (!(linkOffen && link.trim()) && kennung.length !== 8)}>{T.beitreten.weiter}</button>
      <a class="knopf zweit" href={linkZu('')}>{T.app.abbrechen}</a>
    </div>
  {/if}
</form>

{#if turnier}
  <form class="karte" onsubmit={mitKennung}>
    <h2>{T.beitreten.schritt2}</h2>
    <p class="leise">{T.beitreten.eigeneHilfe}</p>
    <label for="ek">{T.beitreten.eigene}</label>
    <KennungFeld id="ek" bind:wert={eigene} label={T.beitreten.eigene} autofocus />
    <div class="reihe" style="margin-top:12px">
      <button type="submit" disabled={eigene.length !== 8} data-testid="mit-kennung">{T.beitreten.mitKennung}</button>
      <button type="button" class="zweit" onclick={zuschauen} data-testid="zuschauen">{T.beitreten.zuschauen}</button>
    </div>
  </form>
{/if}

<style>
  .gefunden { margin: 6px 0 12px; }
  .kennung { font-family: ui-monospace, monospace; letter-spacing: 0.05em; }
  .link { margin-top: 10px; }
  .link summary { font-size: 0.95rem; color: var(--blau); }
  .link input { margin-top: 6px; }
</style>
