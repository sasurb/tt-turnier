<script lang="ts">
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { name, endrundeErstellen, qualifikanten } from '../../engine/abfragen';
  import { neuerZufallswert } from '../../engine/zufall';
  import { platzGruppenBilden, type TurnierZustand } from '../../engine/zustand';
  import type { KonkurrenzZustand } from '../../engine/modell';
  import AuslosungVorschau from './AuslosungVorschau.svelte';
  import Hilfe from '../Hilfe.svelte';
  let { z, k, eintragen, nurBereit = false }: {
    z: TurnierZustand; k: KonkurrenzZustand; nurBereit?: boolean;
    eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown>;
  } = $props();
  let fehler = $state('');
  let sendet = $state(false);
  async function los(art: string, daten: Record<string, unknown>) {
    if (sendet) return;
    sendet = true;
    fehler = '';
    try { await eintragen(art, daten); }
    catch (x) { fehler = x instanceof Error ? x.message : String(x); }
    finally { sendet = false; }
  }
  const quali = $derived(k.einst.modus === 'gruppen_ko' && k.gestartet.gruppen && !k.gestartet.ko ? qualifikanten(k) : null);
  let vakanz = $state(false);
  const platzPlan = $derived(k.einst.modus === 'gruppen_platz' && k.gestartet.gruppen && !k.gestartet.ko ? platzGruppenBilden(k, vakanz) : null);
  async function platzRundeStarten() {
    if (!platzPlan?.ok || !confirm(T.konk.startenFrage)) return;
    await los(ART.phaseGestartet, { konkurrenz: k.id, phase: 'ko', rueckzugUebergang: vakanz ? 'vakanz' : 'nachruecken', gruppen: platzPlan.gruppen.map((g) => g.mitglieder) });
  }
  async function tauschenKo(a: string, b: string) {
    const p = [...k.auslosungKo!.plaetze];
    const ia = Number(a.split(':')[1]);
    const ib = Number(b.split(':')[1]);
    [p[ia], p[ib]] = [p[ib] ?? null, p[ia] ?? null];
    await los(ART.auslosung, { konkurrenz: k.id, phase: 'ko', zufall: k.auslosungKo!.zufall, plaetze: p });
  }

  async function starten(phase: 'gruppen' | 'ko') {
    if (confirm(T.konk.startenFrage)) await los(ART.phaseGestartet, { konkurrenz: k.id, phase });
  }
  async function endrundeAuslosen() {
    const d = endrundeErstellen(z, k, neuerZufallswert());
    if (d) await los(ART.auslosung, d);
  }
</script>
{#if fehler}<p class="meldung fehler" role="alert">{fehler}</p>{/if}
{#if !nurBereit || quali?.ok || platzPlan?.ok || (platzPlan && k.vorHauptrunde?.length)}
  {#if nurBereit}<strong>{k.einst.name}</strong>{/if}
    {#if quali}
      <h3>{T.konk.endrunde}</h3>
      <p class="leise">{T.konk.endrundeText}</p>
      {#if !quali.ok}
        <p class="meldung info">{quali.grund}</p>
      {:else}
        <button class:zweit={!!k.auslosungKo} onclick={endrundeAuslosen}>{k.auslosungKo ? T.konk.neuAuslosen : T.konk.endrundeAuslosen}</button>
        {#if k.auslosungKo}
          <AuslosungVorschau {z} plaetze={k.auslosungKo.plaetze} tauschen={tauschenKo} />
          <button class="breit start" onclick={() => starten('ko')}>{T.konk.endrundeStarten}</button>
        {/if}
      {/if}
    {/if}

    {#if platzPlan}
      <h3>{T.konk.platzRunde}<Hilfe text={T.konk.aufsteigerPlatzHilfe} /></h3>
      <p class="leise">{T.konk.platzRundeText}</p>
      {#if k.vorHauptrunde?.length}
        <div class="label-zeile">
          <label for="vakanz-{k.id}">{T.konk.rueckzugUebergang}</label>
          <Hilfe text={T.konk.rueckzugUebergangHilfe} />
        </div>
        <select id="vakanz-{k.id}" bind:value={vakanz}>
          <option value={false}>{T.konk.nachruecken}</option>
          <option value={true}>{T.konk.platzFrei}</option>
        </select>
      {/if}
      {#if !platzPlan.ok}
        <p class="meldung info">{platzPlan.grund}</p>
      {:else}
        <h4>{T.konk.platzRundeVorschau}</h4>
        <ul class="liste" data-testid="platz-vorschau">
          {#each platzPlan.gruppen as g (g.platzAb)}
            <li><strong>{g.mitglieder.length > 1 ? `Plätze ${g.platzAb}–${g.platzAb + g.mitglieder.length - 1}` : `Platz ${g.platzAb}`}:</strong> {g.mitglieder.map((id) => name(z, id, k)).join(', ')}</li>
          {/each}
        </ul>
        {#if platzPlan.gruppen.some((g) => g.mitglieder.length > 8)}<p class="meldung info" data-testid="platz-gross">{T.konk.platzGross(Math.max(...platzPlan.gruppen.map((g) => g.mitglieder.length)))}</p>{/if}
        <button class="breit start" onclick={platzRundeStarten} data-testid="platz-starten">{T.konk.platzRundeStarten}</button>
      {/if}
    {/if}

{/if}
