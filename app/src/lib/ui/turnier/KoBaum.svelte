<script lang="ts">
  import { T } from '../../texte';
  import { name, runden } from '../../engine/abfragen';
  import { PLATZ3_ID, koSpielId, rundenName } from '../../engine/ko';
  import type { KonkurrenzZustand, Spiel } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';

  let { z, k, oeffnen }: { z: TurnierZustand; k: KonkurrenzZustand; oeffnen: (s: Spiel) => void } = $props();

  const R = $derived(runden(k));
  const spalten = $derived(
    Array.from({ length: R }, (_, r) => {
      const anzahl = (k.auslosungKo?.plaetze.length ?? 0) / 2 ** (r + 1);
      return Array.from({ length: anzahl }, (_, i) => k.spiele[koSpielId(r + 1, i)]).filter((s): s is Spiel => !!s);
    }),
  );
  const p3 = $derived(k.spiele[PLATZ3_ID]);

  function satz(s: Spiel, seite: 'a' | 'b') {
    if (!s.ergebnis) return '';
    return String(seite === 'a' ? s.ergebnis.satzA : s.ergebnis.satzB);
  }
</script>

{#snippet box(s: Spiel)}
  <button class="box" class:offen={s.status === 'offen'} class:strittig={s.stand === 'angefochten' || s.stand === 'konflikt'} onclick={() => oeffnen(s)} disabled={s.status === 'freilos'}>
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

<div class="baum" role="region" aria-label={T.konk.endrunde} tabindex="-1">
  {#each spalten as spiele, r (r)}
    <div class="runde">
      <h3>{rundenName(r + 1, R)}</h3>
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
  .zeile { display: flex; justify-content: space-between; gap: 6px; padding: 6px 8px; font-size: 0.9rem; }
  .zeile + .zeile { border-top: 1px solid var(--linie); }
  .zeile.sieger { font-weight: 700; color: var(--gruen); }
  .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .s { font-variant-numeric: tabular-nums; }
  .p3 { font-size: 0.85rem; color: var(--leise); margin-top: 12px; }
  .p3-box { max-width: 14rem; }
</style>
