<script lang="ts">
  import { T } from '../../texte';
  import type { TischAnzeige } from '../../engine/tischanzeige';

  /**
   * Ein Tisch als stilisierter Tischtennistisch (V-010): Fläche mit Kantenlinie, Mittellinie und Netz,
   * Tischnummer am Netz, je Seite Name, gewonnene Sätze (bzw. Teilspiele) und Satzergebnisse, unten die
   * Spielzeit. Größen in em, damit die Live-Anzeige (Beamer) den Tisch mit ihrer Schrift skaliert.
   * Mit `aktion` ist der ganze Tisch ein Knopf; ohne ist er nur Anzeige.
   */
  let {
    anzeige: a,
    label,
    aktion = null,
    leerText = null,
  }: {
    anzeige: TischAnzeige;
    /** Vorlesetext (und Knopfname, wenn antippbar) */
    label: string;
    aktion?: (() => void) | null;
    /** Text auf einem freien Tisch ohne letztes Spiel, z. B. „Spiel aufrufen“ für Leitung/Helfer */
    leerText?: string | null;
  } = $props();

  const zeitText = $derived(a.minuten === null ? '' : a.zuletzt ? T.tische.vorMinuten(a.minuten) : T.tische.minuten(a.minuten));
  const seiten = $derived(a.a && a.b ? [a.a, a.b] : null);
  const unten = $derived(
    a.teilspiel ? [a.teilspiel.a, a.teilspiel.b] : a.aufstellungFehlt ? [T.tische.aufstellungFehlt, ''] : null,
  );
</script>

{#snippet inhalt()}
  <span class="nr">{a.nr}</span>
  <span class="netz" aria-hidden="true"></span>
  {#if seiten}
    {#each seiten as s, i (i)}
      <span class="seite" class:rechts={i === 1}>
        <span class="nm">{s.name}</span>
        <span class="zahl">{s.zahl ?? ''}</span>
        <span class="saetze">{unten ? unten[i] : s.saetze.join(' · ')}</span>
      </span>
    {/each}
  {:else}
    <span class="mitte">{a.zustand === 'gesperrt' ? `🔒 ${T.tische.gesperrt}` : (leerText ?? T.tische.frei)}</span>
  {/if}
  {#if zeitText}<span class="zeit">{zeitText}</span>{/if}
{/snippet}

{#if aktion}
  <button type="button" class="tt" class:frei={a.zustand === 'frei'} class:gesperrt={a.zustand === 'gesperrt'} class:strittig={a.hinweis === 'strittig'} class:bestaetigen={a.hinweis === 'zu_bestaetigen'} onclick={aktion} aria-label={label} data-testid="tischflaeche">
    {@render inhalt()}
  </button>
{:else}
  <div class="tt" class:frei={a.zustand === 'frei'} class:gesperrt={a.zustand === 'gesperrt'} class:strittig={a.hinweis === 'strittig'} class:bestaetigen={a.hinweis === 'zu_bestaetigen'} role="img" aria-label={label} data-testid="tischflaeche">
    {@render inhalt()}
  </div>
{/if}

<style>
  .tt {
    --tt-flaeche: #14577b;
    --tt-linie: #ffffff;
    --tt-linie-halb: rgb(255 255 255 / 55%);
    --tt-schrift: #ffffff;
    --tt-schrift-leise: #d4e6f2;
    --tt-kante: var(--tt-linie);
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: stretch;
    justify-content: stretch;
    gap: 0;
    width: 100%;
    aspect-ratio: 12 / 5;
    min-height: 6.6em;
    margin: 0.35em 0;
    padding: 0;
    border: 0.18em solid var(--tt-kante);
    outline: 1px solid var(--tt-flaeche);
    border-radius: 0.25em;
    background: var(--tt-flaeche);
    color: var(--tt-schrift);
    font: inherit;
    font-weight: 400;
    text-align: left;
    overflow: hidden;
  }
  button.tt { cursor: pointer; min-height: 6.6em; }
  button.tt:hover { background: var(--tt-flaeche); filter: brightness(1.08); }
  button.tt:focus-visible { outline: 3px solid var(--fokus); outline-offset: 2px; }
  /* Mittellinie (längs) */
  .tt::after { content: ''; position: absolute; left: 0; right: 0; top: 50%; border-top: 0.07em solid var(--tt-linie-halb); pointer-events: none; }
  /* Netz (quer), ragt über die Kanten hinaus */
  .netz { position: absolute; top: -0.2em; bottom: -0.2em; left: 50%; width: 0.28em; margin-left: -0.14em; background: var(--tt-linie); z-index: 1; }
  .nr { position: absolute; top: 0.3em; left: 50%; transform: translateX(-50%); z-index: 2; background: var(--tt-linie); color: var(--tt-flaeche); font-weight: 800; line-height: 1.3; border-radius: 0.3em; padding: 0 0.45em; font-size: 0.85em; }
  .seite { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: space-between; gap: 0.1em; min-width: 0; padding: 0.4em 0.75em 0.45em 0.55em; }
  .seite.rechts { align-items: flex-end; text-align: right; padding: 0.4em 0.55em 0.45em 0.75em; }
  .nm { font-weight: 700; font-size: 0.92em; line-height: 1.2; max-width: 100%; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .seite:first-child .nm { padding-right: 0.9em; }
  .seite.rechts .nm { padding-left: 0.9em; }
  .zahl { font-size: 1.9em; font-weight: 800; line-height: 1; min-height: 1em; }
  .saetze { font-size: 0.74em; line-height: 1.25; color: var(--tt-schrift-leise); max-width: 100%; overflow-wrap: anywhere; min-height: 1.25em; }
  .zeit { position: absolute; bottom: 0.3em; left: 50%; transform: translateX(-50%); z-index: 2; background: var(--tt-flaeche); color: var(--tt-schrift-leise); padding: 0 0.4em; border-radius: 0.3em; font-size: 0.72em; white-space: nowrap; }
  .mitte { grid-column: span 2; align-self: end; justify-self: center; z-index: 2; margin-bottom: 0.45em; background: var(--tt-flaeche); padding: 0 0.5em; border-radius: 0.3em; font-weight: 600; }

  .tt.frei { --tt-flaeche: var(--flaeche); --tt-linie: var(--blau); --tt-linie-halb: color-mix(in srgb, var(--blau) 35%, transparent); --tt-schrift: var(--text); --tt-schrift-leise: var(--leise); border-style: dashed; }
  .tt.frei .mitte { color: var(--blau); }
  .tt.gesperrt { --tt-flaeche: var(--grund); --tt-linie: var(--linie); --tt-linie-halb: var(--linie); --tt-schrift: var(--leise); --tt-schrift-leise: var(--leise); }
  .tt.gesperrt .nr { color: var(--leise); }
  .tt.bestaetigen { --tt-kante: var(--orange); border-width: 0.24em; }
  .tt.strittig { --tt-kante: var(--rot); border-width: 0.24em; }

  @media (prefers-color-scheme: dark) {
    .tt { --tt-flaeche: #194766; --tt-linie: #e8edf3; --tt-linie-halb: rgb(232 237 243 / 45%); --tt-schrift: #f3f6fa; --tt-schrift-leise: #c6d6e6; }
  }
</style>
