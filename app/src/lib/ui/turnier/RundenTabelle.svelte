<script lang="ts">
  import { T } from '../../texte';
  import { name } from '../../engine/abfragen';
  import { kaiserTabelle, letzteRunde, rundenZahl, schweizerTabelle } from '../../engine/runden';
  import type { KonkurrenzZustand } from '../../engine/modell';
  import { zurueckgezogen, type TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';

  /** Rangliste (Schweizer System) bzw. Rangleiter (Kaiserturnier) */
  let { z, k }: { z: TurnierZustand; k: KonkurrenzZustand } = $props();

  const zur = $derived(zurueckgezogen(k));
  const schweizer = $derived(k.einst.modus === 'schweizer' ? schweizerTabelle(k, zur) : []);
  const kaiser = $derived(k.einst.modus === 'kaiser' ? kaiserTabelle(k, zur) : null);
  const R = $derived(rundenZahl(k));
  const aktuell = $derived(letzteRunde(k));

  function verein(id: string) {
    return z.spieler[id]?.verein ?? '';
  }
</script>

<p class="leise stand" data-testid="runde-stand">
  {T.tab.rundeStand(aktuell, R)}{#if k.status !== 'beendet'} · {T.tab.naechsteRunde}{/if}
</p>

{#if k.einst.modus === 'schweizer'}
  <h3>{T.tab.rangliste}<Hilfe text={T.tab.schweizerHilfe} /></h3>
  <div class="rollen">
    <table data-testid="rangliste">
      <thead>
        <tr>
          <th class="z">{T.tab.platz}</th>
          <th>{T.tab.spieler}</th>
          <th class="z">{T.tab.punkte}</th>
          <th class="z"><abbr title={T.tab.buchholzLang}>{T.tab.buchholz}</abbr></th>
          <th class="z breit-nur">{T.tab.feinbuchholz}</th>
          <th class="z">{T.tab.saetze}</th>
        </tr>
      </thead>
      <tbody>
        {#each schweizer as r (r.id)}
          <tr class:raus={r.zurueckgezogen}>
            <td class="z">{r.platz}</td>
            <td>
              <span class="name">{name(z, r.id, k)}</span>
              {#if verein(r.id)}<span class="leise verein">{verein(r.id)}</span>{/if}
              {#if r.zurueckgezogen}<span class="marke">{T.tab.zurueckgezogen}</span>{/if}
            </td>
            <td class="z fett">{r.punkte}</td>
            <td class="z">{r.buchholz}</td>
            <td class="z breit-nur">{r.feinbuchholz}</td>
            <td class="z">{r.saetzeG}:{r.saetzeV}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else if kaiser}
  <h3>{T.tab.rangleiter} <span class="leise klein-text">{T.tab.nachRunde(kaiser.nachRunde)}</span><Hilfe text={T.tab.kaiserHilfe} /></h3>
  <div class="rollen">
    <table data-testid="rangleiter">
      <thead>
        <tr>
          <th class="z">{T.tab.platz}</th>
          <th>{T.tab.spieler}</th>
          <th class="z">{T.tab.sn}</th>
          <th class="z"><abbr title={T.tab.kaiserSiegeLang}>{T.tab.kaiserSiege}</abbr></th>
        </tr>
      </thead>
      <tbody>
        {#each kaiser.zeilen as r (r.id)}
          <tr class:raus={r.zurueckgezogen} class:kaiser={r.platz === 1 && !r.zurueckgezogen}>
            <td class="z">{r.platz === 1 && !r.zurueckgezogen ? '👑' : r.platz}</td>
            <td>
              <span class="name">{name(z, r.id, k)}</span>
              {#if r.platz === 1 && k.status === 'beendet'}<span class="marke">{T.tab.kaiser}</span>{/if}
              {#if verein(r.id)}<span class="leise verein">{verein(r.id)}</span>{/if}
              {#if r.zurueckgezogen}<span class="marke">{T.tab.zurueckgezogen}</span>{/if}
            </td>
            <td class="z">{r.siege}:{r.niederlagen}</td>
            <td class="z">{r.kaiserSiege}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .stand { margin: 4px 0 0; }
  h3 { margin-top: 16px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .klein-text { font-size: 0.85rem; font-weight: 400; }
  .rollen { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
  th, td { padding: 8px 6px; border-bottom: 1px solid var(--linie); text-align: left; vertical-align: top; }
  th { font-size: 0.8rem; color: var(--leise); font-weight: 600; }
  abbr { text-decoration: none; }
  .z { text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .fett { font-weight: 700; }
  .name { font-weight: 600; }
  .verein { display: block; font-size: 0.8rem; }
  tr.raus { opacity: 0.6; }
  tr.kaiser td:first-child { box-shadow: inset 3px 0 0 var(--gruen); }
  @media (max-width: 420px) {
    .breit-nur { display: none; }
  }
</style>
