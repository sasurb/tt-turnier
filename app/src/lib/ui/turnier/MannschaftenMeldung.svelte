<script lang="ts">
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { kurzId } from '../../engine/ids';
  import { spielerName } from '../../engine/modell';
  import { mindestSpieler, staerkeVon, systemVon, type Mannschaft } from '../../engine/mannschaft';
  import { begonnen, type TurnierZustand } from '../../engine/zustand';
  import type { KonkurrenzZustand } from '../../engine/modell';
  import { vereinMerken, vereinsVorschlaege } from '../../vereine';
  import Hilfe from '../Hilfe.svelte';

  /** Mannschaften einer Konkurrenz melden und bearbeiten (nur Leitung) */
  let { z, k, eintragen }: { z: TurnierZustand; k: KonkurrenzZustand; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();

  const fid = Math.random().toString(36).slice(2, 7);
  const sys = $derived(systemVon(k.einst));
  const staerke = $derived(staerkeVon(k.einst));
  const mindest = $derived(Math.max(mindestSpieler(sys), staerke.min));
  /** Begleitpersonen (ab 0.18): können die Mannschaft führen, ohne selbst zu spielen */
  const begleitpersonen = $derived(z.spielerReihe.filter((id) => z.spieler[id]?.begleitung));
  const liste = $derived(k.meldungen.map((id) => k.mannschaften[id]).filter((m): m is Mannschaft => !!m));
  let offen = $state<string | null>(null); // 'neu' oder Mannschafts-ID
  let name = $state('');
  let verein = $state('');
  let spieler = $state<string[]>([]);
  let fuehrer = $state('');
  let wechsler = $state<string[]>([]);
  let suche = $state('');
  let fehler = $state('');
  let sendet = $state(false);

  /** Spieler, die in einer anderen Mannschaft dieser Konkurrenz stehen */
  const vergeben = $derived(new Set(Object.values(k.mannschaften).filter((m) => m.id !== offen).flatMap((m) => m.spieler)));
  const auswahl = $derived(
    z.spielerReihe.filter((id) => {
      if (vergeben.has(id) || z.spieler[id]?.begleitung) return false;
      const q = suche.trim().toLowerCase();
      const s = z.spieler[id]!;
      // Bei gesetztem Verein zuerst dessen Spieler; die Suche findet alle
      return !q || `${s.vorname} ${s.nachname} ${s.verein}`.toLowerCase().includes(q);
    }),
  );
  const sortiert = $derived(
    [...auswahl].sort((a, b) => {
      const v = verein.trim().toLowerCase();
      const x = Number(z.spieler[a]!.verein.trim().toLowerCase() !== v);
      const y = Number(z.spieler[b]!.verein.trim().toLowerCase() !== v);
      return x - y;
    }),
  );
  const vorschlaege = $derived(vereinsVorschlaege(z.spielerReihe.map((id) => z.spieler[id]!.verein)));

  function oeffnen(m: Mannschaft | null) {
    fehler = '';
    suche = '';
    offen = m ? m.id : 'neu';
    name = m?.name ?? '';
    verein = m?.verein ?? '';
    spieler = m ? [...m.spieler] : [];
    fuehrer = m?.fuehrer ?? '';
    wechsler = m ? [...(m.wechsler ?? [])] : [];
  }

  async function speichern(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (spieler.length < mindest) {
      fehler = T.mannschaft.zuWenig(mindest);
      return;
    }
    if (spieler.length > staerke.max) {
      fehler = T.mannschaft.zuViele(staerke.max);
      return;
    }
    sendet = true;
    fehler = '';
    try {
      await eintragen(ART.mannschaftGemeldet, {
        konkurrenz: k.id,
        id: offen === 'neu' || !offen ? `m-${kurzId()}` : offen,
        name: name.trim(),
        verein: verein.trim(),
        spieler: [...spieler],
        fuehrer: fuehrer && (spieler.includes(fuehrer) || begleitpersonen.includes(fuehrer)) ? fuehrer : null,
        wechsler: wechsler.filter((x) => spieler.includes(x)),
      });
      vereinMerken(verein);
      offen = null;
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    } finally {
      sendet = false;
    }
  }

  async function abmelden(m: Mannschaft) {
    await eintragen(ART.teilnehmerAbgemeldet, { konkurrenz: k.id, id: m.id });
  }
</script>

{#if liste.length === 0 && offen === null}<p class="leise">{T.mannschaft.keineMannschaften}</p>{/if}
<ul class="liste mannschaften" data-testid="mannschaften">
  {#each liste as m (m.id)}
    <li>
      <div class="zeile">
        <span class="wachsen">
          <strong>{m.name}</strong>
          <span class="leise">
            {m.verein ? `${m.verein} · ` : ''}{m.spieler.map((id) => spielerName(z.spieler[id]) + (id === m.fuehrer ? ' (MF)' : '') + ((m.wechsler ?? []).includes(id) ? ` (${T.mannschaft.wechslerKurz})` : '')).join(', ')}{m.fuehrer && !m.spieler.includes(m.fuehrer) ? ` · MF: ${spielerName(z.spieler[m.fuehrer])} (${T.mannschaft.begleitung})` : ''}
          </span>
        </span>
        <button class="zweit klein" onclick={() => oeffnen(m)}>{T.mannschaft.bearbeiten}</button>
        {#if !begonnen(k)}<button class="gefahr klein" aria-label="{m.name}: {T.app.entfernen}" onclick={() => abmelden(m)}>✕</button>{/if}
      </div>
    </li>
  {/each}
</ul>

{#if offen === null}
  {#if !begonnen(k)}<button class="zweit" onclick={() => oeffnen(null)} data-testid="mannschaft-neu">+ {T.mannschaft.melden}</button>{/if}
{:else}
  <form class="mform" onsubmit={speichern} data-testid="mannschaft-form">
    <div class="raster">
      <div><label for="mn-{fid}">{T.mannschaft.name}</label><input id="mn-{fid}" bind:value={name} maxlength="60" placeholder={T.mannschaft.namePlatzhalter} required /></div>
      <div><label for="mv-{fid}">{T.mannschaft.verein}</label><input id="mv-{fid}" bind:value={verein} maxlength="80" list="mv-liste-{fid}" autocomplete="off" /></div>
    </div>
    <datalist id="mv-liste-{fid}">{#each vorschlaege as v (v)}<option value={v}></option>{/each}</datalist>
    <div class="label-zeile"><span class="feldname">{T.mannschaft.spieler} ({spieler.length})</span><Hilfe text={T.mannschaft.spielerHilfe(mindest)} /></div>
    <input type="search" bind:value={suche} placeholder={T.mannschaft.spielerSuche} aria-label={T.mannschaft.spielerSuche} />
    <ul class="auswahl">
      {#each sortiert as id (id)}
        {@const s = z.spieler[id]!}
        <li><label class="haken"><input type="checkbox" value={id} bind:group={spieler} /> <span>{spielerName(s)} <span class="leise">{s.verein}{s.ttr ? ` · ${s.ttr}` : ''}</span></span></label></li>
      {/each}
    </ul>
    <div class="label-zeile"><label for="mfu-{fid}">{T.mannschaft.fuehrer}</label><Hilfe text={T.mannschaft.fuehrerHilfe} /></div>
    <select id="mfu-{fid}" bind:value={fuehrer}>
      <option value="">{T.mannschaft.keinFuehrer}</option>
      {#each spieler as id (id)}<option value={id}>{spielerName(z.spieler[id])}</option>{/each}
      {#each begleitpersonen as id (id)}<option value={id}>{spielerName(z.spieler[id])} ({T.mannschaft.begleitung})</option>{/each}
    </select>
    {#if spieler.length > staerke.min}
      <div class="label-zeile"><span class="feldname">{T.mannschaft.wechsler}</span><Hilfe text={T.mannschaft.wechslerHilfe} /></div>
      <ul class="auswahl" data-testid="wechsler">
        {#each spieler as id (id)}<li><label class="haken"><input type="checkbox" value={id} bind:group={wechsler} /> {spielerName(z.spieler[id])}</label></li>{/each}
      </ul>
    {/if}
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <div class="reihe knoepfe">
      <button type="submit" disabled={sendet || !name.trim()}>{T.mannschaft.speichern}</button>
      <button type="button" class="zweit" onclick={() => (offen = null)}>{T.app.abbrechen}</button>
    </div>
  </form>
{/if}

<style>
  .zeile { display: flex; align-items: center; gap: 8px; }
  .zeile .wachsen { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .mform { margin: 8px 0 12px; }
  .raster { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  @media (max-width: 420px) {
    .raster { grid-template-columns: 1fr; }
  }
  .feldname { font-weight: 700; }
  .auswahl { list-style: none; padding: 0; margin: 8px 0; max-height: 18rem; overflow-y: auto; border: 1px solid var(--linie); border-radius: 10px; }
  .auswahl li { padding: 0 12px; border-bottom: 1px solid var(--linie); }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .knoepfe { margin-top: 12px; }
</style>
