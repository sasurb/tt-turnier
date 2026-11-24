<script lang="ts">
  import { onMount } from 'svelte';
  import type { TurnierInfo } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { app, anmeldungAbgelaufen, fehlerText, kontoTurnierOeffnen } from '../app.svelte';
  import { codeAnzeige } from '../code';
  import { istZentrale } from '../zentrale.svelte';
  import { darfAnlegen, meineSparten, spartenName } from '../sparte.svelte';

  /** Alle Turniere des angemeldeten Kontos (Konto-Menü → „Meine Turniere“). */
  let liste = $state<TurnierInfo[] | null>(null);
  let fehler = $state('');
  let suche = $state('');
  const zentrale = $derived(istZentrale());
  const gefiltert = $derived((liste ?? []).filter((t) => !suche.trim() || t.name.toLowerCase().includes(suche.trim().toLowerCase()) || t.id.includes(suche.replace(/\s/g, '').toUpperCase())));
  /** Mehrere Sparten: Name der Sparte am Turnier */
  const mehrereSparten = $derived(meineSparten().length > 1);
  function sparteVon(t: TurnierInfo) {
    const s = meineSparten().find((x) => x.id === t.sparte);
    return s ? spartenName(s) : '';
  }

  onMount(async () => {
    if (!app.sitzung) {
      gehe('anmelden');
      return;
    }
    try {
      liste = (await api.turniere(app.sitzung.token)).turniere;
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  });

  function datum(d: string | null) {
    return d ? new Date(d + 'T12:00:00').toLocaleDateString('de-DE') : '';
  }
</script>

<h1>{T.start.meineTurniere}</h1>
{#if darfAnlegen()}
  <a class="knopf" href={linkZu('neu')} data-testid="neues-turnier">+ {T.start.neuesTurnier}</a>
{/if}

<section class="karte">
  {#if fehler}
    <div class="meldung fehler" role="alert">{fehler}</div>
  {:else if !liste}
    <p class="leise">{T.app.laden}</p>
  {:else if liste.length === 0}
    <p class="leise">{darfAnlegen() ? T.start.keineTurniere : T.start.keineTurniereEingeladen}</p>
  {:else}
    {#if liste.length > 6}
      <input bind:value={suche} placeholder={T.tspieler.suchen} aria-label={T.tspieler.suchen} autocomplete="off" />
    {/if}
    <ul class="liste">
      {#each gefiltert as t (t.id)}
        <li>
          <button class="zeile" onclick={() => kontoTurnierOeffnen(t)}>
            <strong>{t.name}</strong>
            <span class="leise">
              {datum(t.datum)}{t.datum ? ' · ' : ''}<span class="kennung">{codeAnzeige(t.id)}</span>{#if mehrereSparten && sparteVon(t)} · {sparteVon(t)}{/if}
              {#if t.zentrale}<span class="marke">{T.zentrale.liegtAndere(t.zentrale)}</span>{:else}<span class="marke online">{zentrale ? T.zentrale.modus : T.start.modusOnline}</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .knopf { margin-bottom: var(--abstand); }
  .kennung { font-family: ui-monospace, monospace; letter-spacing: 0.05em; }
  .zeile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 2px;
    width: 100%;
    min-height: 52px;
    padding: 4px 0;
    color: var(--text);
    background: transparent;
    border: 0;
    text-align: left;
    font-weight: 400;
  }
  .zeile:hover { background: transparent; }
  .zeile:hover strong { color: var(--blau); }
</style>
