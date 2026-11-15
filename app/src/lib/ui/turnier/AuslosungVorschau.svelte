<script lang="ts">
  import { T } from '../../texte';
  import { name } from '../../engine/abfragen';
  import { gruppenName } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';

  /**
   * Vorschau einer Auslosung. Mit `tauschen` lassen sich zwei Plätze durch Antippen tauschen.
   * Gruppen: Plätze „g:i“; K.-o.: Plätze „p:i“.
   */
  let {
    z,
    gruppen = null,
    klassen = null,
    plaetze = null,
    tauschen = null,
  }: {
    z: TurnierZustand;
    gruppen?: string[][] | null;
    /** Klassenname je Gruppe (bei Klassentrennung) */
    klassen?: string[] | null;
    plaetze?: (string | null)[] | null;
    tauschen?: ((a: string, b: string) => Promise<void>) | null;
  } = $props();

  let erster = $state<string | null>(null);
  let hinweis = $state('');

  async function tippen(platz: string, wer: string) {
    if (!tauschen) return;
    if (!erster) {
      erster = platz;
      hinweis = T.konk.gewaehlt(wer);
      return;
    }
    if (erster === platz) {
      erster = null;
      hinweis = '';
      return;
    }
    const a = erster;
    erster = null;
    await tauschen(a, platz);
    hinweis = T.konk.getauscht;
  }

  function verein(id: string | null) {
    if (!id) return '';
    if (z.spieler[id]) return z.spieler[id]!.verein ?? '';
    const p = Object.values(z.konkurrenzen).map((k) => k.paare[id]).find(Boolean);
    return p ? [...new Set(p.spieler.map((x) => z.spieler[x]?.verein ?? '').filter(Boolean))].join(' / ') : '';
  }
</script>

{#if tauschen}<p class="leise">{T.konk.tauschenText}</p>{/if}
{#if hinweis}<p class="hinweis" aria-live="polite">{hinweis}</p>{/if}

{#if gruppen}
  <div class="gruppen">
    {#each gruppen as g, nr (nr)}
      <div class="gruppe">
        <h4>{T.konk.gruppe(gruppenName(nr))}{#if klassen?.[nr]}<span class="marke">{klassen[nr]}</span>{/if}</h4>
        <ol>
          {#each g as id, i (id)}
            <li>
              <button class="platz" class:gewaehlt={erster === `g:${nr}:${i}`} disabled={!tauschen} onclick={() => tippen(`g:${nr}:${i}`, name(z, id))}>
                <span>{name(z, id)}</span><span class="leise">{verein(id)}</span>
              </button>
            </li>
          {/each}
        </ol>
      </div>
    {/each}
  </div>
{:else if plaetze}
  <ol class="ko">
    {#each Array.from({ length: plaetze.length / 2 }, (_, i) => i) as i (i)}
      <li class="paar">
        {#each [2 * i, 2 * i + 1] as p (p)}
          {@const id = plaetze[p] ?? null}
          <button class="platz" class:frei={!id} class:gewaehlt={erster === `p:${p}`} disabled={!tauschen} onclick={() => tippen(`p:${p}`, id ? name(z, id) : T.konk.freilos)}>
            <span>{id ? name(z, id) : T.konk.freilos}</span><span class="leise">{verein(id)}</span>
          </button>
        {/each}
      </li>
    {/each}
  </ol>
{/if}

<style>
  .gruppen { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: 12px; }
  .gruppe h4 { margin: 0 0 6px; display: flex; align-items: center; gap: 8px; }
  ol { margin: 0; padding: 0; list-style: none; }
  .gruppe li { margin-bottom: 6px; }
  .platz {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    width: 100%;
    min-height: 44px;
    padding: 6px 10px;
    background: var(--grund);
    color: var(--text);
    border: 2px solid var(--linie);
    font-weight: 600;
    text-align: left;
  }
  .platz:disabled { opacity: 1; cursor: default; }
  .platz:hover:not(:disabled) { background: var(--grund); border-color: var(--blau); }
  .platz.gewaehlt { border-color: var(--orange); background: color-mix(in srgb, var(--orange) 12%, var(--flaeche)); }
  .platz.frei { color: var(--leise); font-style: italic; }
  .platz .leise { font-weight: 400; font-size: 0.8rem; }
  .ko { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: 10px; }
  .paar { display: flex; flex-direction: column; gap: 4px; padding: 6px; border: 1px solid var(--linie); border-radius: 10px; }
  .hinweis { color: var(--orange); font-weight: 600; }
</style>
