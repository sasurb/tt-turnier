<script lang="ts">
  import { T } from '../../texte';
  import { name, runden } from '../../engine/abfragen';
  import { PLATZ3_ID, baumRunden, rundenName } from '../../engine/ko';
  import type { Baum, KonkurrenzZustand, Spiel } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';

  /** Ein Baum des K.-o.-Teils: Hauptrunde (mit Spiel um Platz 3), Trostrunde, Verliererbaum oder Endspiele */
  let { z, k, baum = 'haupt', oeffnen }: { z: TurnierZustand; k: KonkurrenzZustand; baum?: Baum; oeffnen: (s: Spiel) => void } = $props();

  const R = $derived(baum === 'haupt' ? runden(k) : baumRunden(k, baum));
  const spalten = $derived(
    Array.from({ length: R }, (_, r) => k.reihenfolge.map((id) => k.spiele[id]!).filter((s) => s.phase === 'ko' && s.baum === baum && s.runde === r + 1 && !s.platz3)),
  );
  const p3 = $derived(baum === 'haupt' ? k.spiele[PLATZ3_ID] : undefined);

  function satz(s: Spiel, seite: 'a' | 'b') {
    if (!s.ergebnis) return '';
    return String(seite === 'a' ? s.ergebnis.satzA : s.ergebnis.satzB);
  }
</script>

{#snippet box(s: Spiel)}
  <button class="box" class:offen={s.status === 'offen'} class:strittig={s.stand === 'angefochten' || s.stand === 'konflikt'} class:entfallen={s.status === 'entfallen'} onclick={() => oeffnen(s)} disabled={s.status === 'freilos' || s.status === 'entfallen'}>
    {#if s.tisch !== null && s.status === 'offen'}<span class="tisch">{T.tische.tischKurz(s.tisch)}</span>{/if}
    {#each ['a', 'b'] as const as seite (seite)}
      {@const frei = seite === 'a' ? s.aFrei : s.bFrei}
      {@const id = seite === 'a' ? s.a : s.b}
      <span class="zeile" class:sieger={s.gewinner === seite}>
        <span class="n">{frei ? T.konk.freilos : id ? name(z, id) : '…'}</span>
        <span class="s">{satz(s, seite)}</span>
      </span>
    {/each}
  </button>
{/snippet}

<div class="baum" role="region" aria-label={T.konk.baeume[baum]} tabindex="-1">
  {#each spalten as spiele, r (r)}
    <div class="runde">
      <h3>{rundenName(r + 1, R, baum)}</h3>
      <div class="spiele">
        {#each spiele as s (s.id)}
          <div class="platz">{@render box(s)}</div>
        {/each}
      </div>
    </div>
  {/each}
</div>
{#if p3}
  <h3 class="p3">{T.konk.platz3}</h3>
  <div class="p3-box">{@render box(p3)}</div>
{/if}

<style>
  .baum { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; -webkit-overflow-scrolling: touch; }
  .runde { display: flex; flex-direction: column; min-width: 11rem; flex: 1 0 11rem; }
  .runde h3 { font-size: 0.85rem; color: var(--leise); margin-bottom: 6px; white-space: nowrap; }
  .spiele { display: flex; flex-direction: column; justify-content: space-around; flex: 1; gap: 8px; }
  .box {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    width: 100%;
    padding: 0;
    min-height: 0;
    background: var(--flaeche);
    color: var(--text);
    border: 1px solid var(--linie);
    border-radius: 8px;
    font-weight: 400;
    overflow: hidden;
  }
  .box:hover:not(:disabled) { border-color: var(--blau); background: var(--flaeche); }
  .box:disabled { opacity: 0.6; cursor: default; }
  .box.offen { border-color: var(--blau); }
  .box.strittig { border-color: var(--orange); }
  .box.entfallen { opacity: 0.45; }
  .tisch { font-size: 0.75rem; color: var(--blau); padding: 2px 8px 0; font-weight: 600; }
  .zeile { display: flex; justify-content: space-between; gap: 6px; padding: 6px 8px; font-size: 0.9rem; }
  .zeile + .zeile { border-top: 1px solid var(--linie); }
  .zeile.sieger { font-weight: 700; color: var(--gruen); }
  .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .s { font-variant-numeric: tabular-nums; }
  .p3 { font-size: 0.85rem; color: var(--leise); margin-top: 12px; }
  .p3-box { max-width: 14rem; }
</style>
