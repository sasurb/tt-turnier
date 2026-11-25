<script lang="ts">
  import { wertungVorlaeufig } from '../../engine/modell';
  import { alsEineAktion } from '../../aktion';
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { gruppenKlassen, name, platzierungen, sichtbar, tabelle, trostPlaetze } from '../../engine/abfragen';
  import { baumRunden } from '../../engine/ko';
  import { gruppeTitel, gruppenName, type Spiel } from '../../engine/modell';
  import { mischen, neuerZufallswert, zufallAus } from '../../engine/zufall';
  import type { TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';
  import KoBaum from './KoBaum.svelte';
  import RundenTabelle from './RundenTabelle.svelte';
  import { istRundenModus } from '../../engine/runden';
  import WertungInfo from './WertungInfo.svelte';

  let {
    z,
    leitung,
    eintragen,
    oeffnen,
  }: { z: TurnierZustand; leitung: boolean; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown>; oeffnen: (s: Spiel) => void } = $props();

  const gestartete = $derived(z.konkurrenzReihe.filter((id) => z.konkurrenzen[id]!.gestartet.gruppen || z.konkurrenzen[id]!.gestartet.ko));
  let wahl = $state('');
  const kid = $derived(gestartete.includes(wahl) ? wahl : (gestartete[0] ?? ''));
  const k = $derived(kid ? z.konkurrenzen[kid] : undefined);
  /** Was Spieler und Zuschauer sehen; die Leitung sieht immer alles */
  const zeige = $derived(k ? (leitung ? { tabellen: true, ko: true } : sichtbar(z, k)) : { tabellen: true, ko: true });
  const klassen = $derived(k?.auslosungGruppen ? gruppenKlassen(z, k, k.auslosungGruppen.gruppen) : []);

  async function los(nr: number, gruppen: string[][]) {
    if (!k || !confirm(T.tab.losFrage)) return;
    const zf = zufallAus(neuerZufallswert());
    await alsEineAktion(async () => {
      for (const g of gruppen) await eintragen(ART.gruppeLos, { konkurrenz: k.id, gruppe: nr, reihenfolge: mischen(g, zf) });
    });
  }
</script>

{#if !k}
  <p class="meldung info">{T.tab.keine}</p>
{:else}
  {#if gestartete.length > 1}
    <div class="wahl-konk" role="tablist" aria-label={T.konk.titel}>
      {#each gestartete as id (id)}
        <button role="tab" aria-selected={id === kid} class:aktiv={id === kid} onclick={() => (wahl = id)}>{z.konkurrenzen[id]!.einst.name}</button>
      {/each}
    </div>
  {/if}

  <section class="karte">
    <h2>{k.einst.name}{#if wertungVorlaeufig(k)} <span class="marke">Wertung vorläufig</span>{/if} <span class="marke">{T.konk.status[istRundenModus(k.einst.modus) && k.status === 'gruppen' ? 'runden' : k.status]}</span></h2>
    {#if !zeige.tabellen && k.gruppen.length}
      <p class="meldung info" data-testid="verdeckt">{T.tab.verdeckt}</p>
    {/if}
    {#if istRundenModus(k.einst.modus) && zeige.tabellen}
      <RundenTabelle {z} {k} />
    {/if}
    {#each zeige.tabellen && !istRundenModus(k.einst.modus) ? k.gruppen : [] as g (g.nr)}
      {@const t = tabelle(k, g.nr)}
      {@const ms = k.einst.art === 'mannschaft'}
      {@const platzGruppe = typeof g.platzAb === 'number'}
      {#if k.einst.modus === 'gruppen_platz' && (g.nr === 0 || (platzGruppe && typeof k.gruppen[g.nr - 1]?.platzAb !== 'number'))}
        <h3 class="stufe">{platzGruppe ? T.konk.platzRunde : T.konk.vorrunde}</h3>
      {/if}
      <h3>{platzGruppe || k.gruppen.length > 1 ? gruppeTitel(k, g.nr) : T.konk.modi.jgj}{#if klassen[g.nr]}<span class="marke klasse">{klassen[g.nr]}</span>{/if}<Hilfe text={ms ? T.mannschaft.systemHilfe : T.wertung.kurz[k.einst.wertung] + '. ' + T.wertung[k.einst.wertung]} /></h3>
      <div class="rollen">
        <table data-testid="tabelle-{gruppenName(g.nr)}">
          <thead>
            <tr>
              <th class="z">{T.tab.platz}</th>
              <th>{T.tab.spieler}</th>
              <th class="z">{ms ? T.mannschaft.tabelleKopf.begegnungen : T.tab.sp}</th>
              {#if ms}
                <th class="z">{T.mannschaft.tabelleKopf.punkte}</th>
                <th class="z">{T.mannschaft.tabelleKopf.spiele}</th>
              {:else}
                <th class="z">{T.tab.sn}</th>
              {/if}
              {#if k.einst.wertung === 'ittf' && !ms}<th class="z">{T.tab.punkte}</th>{/if}
              <th class="z">{T.tab.saetze}</th>
              {#if k.einst.eingabe === 'punkte'}<th class="z breit-nur">{T.tab.baelle}</th>{/if}
            </tr>
          </thead>
          <tbody>
            {#each t.zeilen as r (r.id)}
              <tr class:raus={r.zurueckgezogen} class:weiter={k.einst.modus === 'gruppen_ko' && !r.zurueckgezogen && r.platz <= k.einst.aufsteiger}>
                <td class="z">{platzGruppe ? g.platzAb! + r.platz - 1 : r.platz}{r.losNoetig && t.fertig ? '*' : ''}</td>
                <td>
                  <span class="name">{name(z, r.id, k)}</span>
                  {#if z.spieler[r.id]?.verein}<span class="leise verein">{z.spieler[r.id]!.verein}</span>{:else if k.mannschaften[r.id]?.verein}<span class="leise verein">{k.mannschaften[r.id]!.verein}</span>{/if}
                  {#if r.zurueckgezogen}<span class="marke">{T.tab.zurueckgezogen}</span>{/if}
                </td>
                <td class="z">{r.spiele}</td>
                {#if ms}
                  <td class="z" data-testid="punkte">{r.punkte}:{r.minuspunkte ?? 0}</td>
                  <td class="z">{r.spieleG ?? 0}:{r.spieleV ?? 0}</td>
                {:else}
                  <td class="z">{r.siege}:{r.niederlagen}</td>
                {/if}
                {#if k.einst.wertung === 'ittf' && !ms}<td class="z">{r.punkte}</td>{/if}
                <td class="z">{r.saetzeG}:{r.saetzeV}</td>
                {#if k.einst.eingabe === 'punkte'}<td class="z breit-nur">{r.baelleG}:{r.baelleV}</td>{/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if t.losGruppen.length && t.fertig}
        <div class="meldung info reihe">
          <span class="wachsen">* {T.tab.los}</span>
          {#if leitung}<button class="klein" onclick={() => los(g.nr, t.losGruppen)}>{T.tab.losZiehen}</button>{/if}
        </div>
      {/if}
    {/each}
    {#if k.gruppen.length && zeige.tabellen && !istRundenModus(k.einst.modus) && k.einst.art !== 'mannschaft'}<WertungInfo aktiv={k.einst.wertung} />{/if}

    {#if k.einst.modus === 'gruppen_ko' && !k.gestartet.ko}
      <p class="meldung info">{T.tab.endrundeWartet}</p>
    {/if}
    {#if k.einst.modus === 'gruppen_platz'}
      {@const gp = zeige.tabellen ? platzierungen(k) : []}
      {#if !k.gestartet.ko}
        <p class="meldung info">{T.konk.platzRundeText}</p>
      {:else if gp.length}
        <h3>{T.konk.gesamtPlatzierung}<Hilfe text={T.konk.gesamtPlatzierungText} /></h3>
        <ol class="plaetze" data-testid="gesamtplatzierung">
          {#each gp as x (x.id)}
            <li><span class="pl">{x.bezeichnung}</span> {name(z, x.id, k)}</li>
          {/each}
        </ol>
      {/if}
    {:else if k.gestartet.ko && !zeige.ko}
      <p class="meldung info" data-testid="verdeckt-ko">{T.tab.verdecktKo}</p>
    {:else if k.gestartet.ko}
      <h3>{k.einst.modus === 'gruppen_ko' ? T.konk.endrunde : T.konk.modi.ko}</h3>
      <KoBaum {z} {k} {oeffnen} />
      {#if baumRunden(k, 'verlierer')}
        <h3>{T.konk.baeume.verlierer}</h3>
        <KoBaum {z} {k} baum="verlierer" {oeffnen} />
        <h3>{T.konk.baeume.finale}</h3>
        <KoBaum {z} {k} baum="finale" {oeffnen} />
      {/if}
      {@const p = zeige.tabellen ? platzierungen(k) : []}
      {#if p.length}
        <h3>{T.tab.platzierungen}</h3>
        <ol class="plaetze">
          {#each p as x (x.id)}
            <li><span class="pl">{x.bezeichnung}</span> {name(z, x.id, k)}</li>
          {/each}
        </ol>
      {/if}
      {#if baumRunden(k, 'trost')}
        <h3>{T.konk.baeume.trost}</h3>
        <KoBaum {z} {k} baum="trost" {oeffnen} />
        {@const tp = zeige.tabellen ? trostPlaetze(k) : []}
        {#if tp.length}
          <h3>{T.konk.trostPlatzierungen}</h3>
          <ol class="plaetze">
            {#each tp as x (x.id)}
              <li><span class="pl">{x.bezeichnung}</span> {name(z, x.id, k)}</li>
            {/each}
          </ol>
        {/if}
      {/if}
    {/if}
  </section>
{/if}

<style>
  .wahl-konk { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 12px; }
  .wahl-konk button { min-height: 44px; background: var(--flaeche); color: var(--text); border: 1px solid var(--linie); white-space: nowrap; }
  .wahl-konk button.aktiv { background: var(--blau); color: #fff; border-color: var(--blau); }
  h3 { margin-top: 16px; display: flex; align-items: center; gap: 8px; }
  h3.stufe { font-size: 1.15rem; border-bottom: 2px solid var(--linie); padding-bottom: 4px; margin-top: 22px; }
  .klasse { font-weight: 500; }
  .rollen { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
  th, td { padding: 8px 6px; border-bottom: 1px solid var(--linie); text-align: left; vertical-align: top; }
  th { font-size: 0.8rem; color: var(--leise); font-weight: 600; }
  .z { text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .name { font-weight: 600; }
  .verein { display: block; font-size: 0.8rem; }
  tr.weiter td:first-child { box-shadow: inset 3px 0 0 var(--gruen); }
  tr.raus { opacity: 0.6; }
  @media (max-width: 420px) {
    .breit-nur { display: none; }
  }
  .plaetze { list-style: none; padding: 0; margin: 0; }
  .plaetze li { padding: 6px 0; border-bottom: 1px solid var(--linie); }
  .pl { display: inline-block; min-width: 3.5rem; font-weight: 700; font-variant-numeric: tabular-nums; }
</style>
