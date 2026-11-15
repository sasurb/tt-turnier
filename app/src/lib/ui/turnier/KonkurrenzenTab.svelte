<script lang="ts">
  import { onMount } from 'svelte';
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { kurzId } from '../../engine/ids';
  import { standardEinstellungen, ttrBereichName, type KonkurrenzEinstellungen } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';
  import { pool, poolLaden } from '../../pool.svelte';
  import { klassenLaden } from '../../klassen.svelte';
  import Hilfe from '../Hilfe.svelte';
  import KonkurrenzDetail from './KonkurrenzDetail.svelte';
  import KonkurrenzForm from './KonkurrenzForm.svelte';

  let { z, eintragen }: { z: TurnierZustand; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();
  // svelte-ignore state_referenced_locally
  let neu = $state(z.konkurrenzReihe.length === 0);
  let assistent = $state(false);
  let nach = $state<'klasse' | 'ttr'>('klasse');
  let grenzen = $state('1200, 1500');
  let vorlage = $state<KonkurrenzEinstellungen>(standardEinstellungen());
  let vorlageOffen = $state(false);
  let laeuft = $state(false);

  onMount(() => {
    void poolLaden();
    void klassenLaden();
  });

  async function anlegen(e: KonkurrenzEinstellungen) {
    await eintragen(ART.konkurrenzAngelegt, { id: kurzId(), einst: e });
    neu = false;
  }

  /** Vorschau des Assistenten: je Klasse die Spieler */
  const grenzenListe = $derived([...new Set(grenzen.split(',').map((t) => parseInt(t.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0 && n <= 4000))].sort((a, b) => a - b));
  const vorschau = $derived.by(() => {
    const gruppen = new Map<string, { name: string; zulassung: Partial<KonkurrenzEinstellungen['zulassung']>; spieler: string[] }>();
    for (const id of z.spielerReihe) {
      const s = z.spieler[id]!;
      let schluessel: string;
      let name: string;
      let zulassung: Partial<KonkurrenzEinstellungen['zulassung']> = {};
      if (nach === 'klasse') {
        const kl = (s.klasse ?? '').trim();
        schluessel = kl.toLowerCase();
        name = kl || T.konk.klassenOhne;
        if (kl) zulassung = { klassen: [kl] };
      } else {
        if (typeof s.ttr !== 'number') {
          schluessel = '';
          name = T.konk.klassenOhne;
        } else {
          let stufe = 0;
          for (const g of grenzenListe) if (s.ttr >= g) stufe++;
          schluessel = `ttr${stufe}`;
          name = `TTR ${ttrBereichName(stufe, grenzenListe)}`;
          zulassung = { ttrMin: stufe === 0 ? null : grenzenListe[stufe - 1]!, ttrMax: stufe >= grenzenListe.length ? null : grenzenListe[stufe]! - 1 };
        }
      }
      const g = gruppen.get(schluessel) ?? { name, zulassung, spieler: [] };
      g.spieler.push(id);
      gruppen.set(schluessel, g);
    }
    return [...gruppen.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : nach === 'ttr' ? Number(a.slice(3)) - Number(b.slice(3)) : a.localeCompare(b, 'de')))
      .map(([, g]) => g);
  });
  const angabeFehlt = $derived(vorschau.length === 1 && vorschau[0]!.name === T.konk.klassenOhne);

  async function klassenAnlegen() {
    laeuft = true;
    try {
      for (const g of vorschau) {
        const id = kurzId();
        const einst: KonkurrenzEinstellungen = {
          ...JSON.parse(JSON.stringify($state.snapshot(vorlage))),
          name: g.name,
          zulassung: { ...standardEinstellungen().zulassung, ...g.zulassung },
        };
        await eintragen(ART.konkurrenzAngelegt, { id, einst });
        for (const sid of g.spieler) await eintragen(ART.teilnehmerGemeldet, { konkurrenz: id, id: sid });
      }
      assistent = false;
      neu = false;
    } finally {
      laeuft = false;
    }
  }
</script>

<section class="karte">
  <h2>{T.konk.titel}</h2>
  <p class="leise">{T.konk.text}</p>
  {#if neu}
    <KonkurrenzForm knopf={T.konk.anlegen} speichern={anlegen} abbrechen={() => (neu = false)} />
    {#if z.spielerReihe.length}
      <p class="oder"><span class="leise">{T.app.oder}</span> <button class="zweit klein" onclick={() => { neu = false; assistent = true; }} data-testid="klassen-assistent">{T.konk.klassenAssistent}</button></p>
    {/if}
  {:else if assistent}
    <h3>{T.konk.klassenAssistent}</h3>
    <p class="leise">{T.konk.klassenAssistentText}</p>
    <label for="kn">{T.konk.klassenNach}</label>
    <select id="kn" bind:value={nach}>
      {#each ['klasse', 'ttr'] as w (w)}<option value={w}>{T.konk.klassenNachWahl[w]}</option>{/each}
    </select>
    {#if nach === 'ttr'}
      <div class="label-zeile"><label for="kg">{T.konk.ttrGrenzen}</label><Hilfe text={T.konk.ttrGrenzenHilfe} /></div>
      <input id="kg" bind:value={grenzen} inputmode="numeric" />
    {/if}
    {#if z.spielerReihe.length === 0}
      <p class="meldung info">{T.konk.keineSpieler}</p>
    {:else if angabeFehlt}
      <p class="meldung info">{nach === 'klasse' ? T.konk.klassenKeine : T.konk.klassenKeinTtr}</p>
    {:else}
      <h4>{T.konk.klassenVorschau}</h4>
      <ul class="liste" data-testid="klassen-vorschau">
        {#each vorschau as g (g.name)}
          <li><strong>{g.name}</strong> <span class="leise">· {T.konk.teilnehmer(g.spieler.length)}</span></li>
        {/each}
      </ul>
    {/if}
    <details class="vorlage" bind:open={vorlageOffen}>
      <summary>{T.konk.klassenVorlage}</summary>
      {#if vorlageOffen}
        <KonkurrenzForm start={vorlage} knopf={T.app.speichern} speichern={async (e) => { vorlage = e; vorlageOffen = false; }} abbrechen={() => (vorlageOffen = false)} />
      {/if}
    </details>
    <div class="reihe" style="margin-top:12px">
      <button disabled={laeuft || angabeFehlt || !z.spielerReihe.length} onclick={klassenAnlegen} data-testid="klassen-anlegen">{T.konk.klassenAnlegen(vorschau.length)}</button>
      <button class="zweit" onclick={() => (assistent = false)}>{T.app.abbrechen}</button>
    </div>
  {:else}
    <div class="reihe">
      <button onclick={() => (neu = true)}>+ {T.konk.neu}</button>
      <button class="zweit" onclick={() => (assistent = true)} data-testid="klassen-assistent">{T.konk.klassenAssistent}</button>
    </div>
  {/if}
</section>

{#each z.konkurrenzReihe as id (id)}
  <KonkurrenzDetail {z} k={z.konkurrenzen[id]!} poolListe={pool.liste} {eintragen} />
{/each}

<style>
  h3 { display: flex; align-items: center; margin-top: 8px; }
  h4 { margin: 12px 0 4px; }
  .oder { margin-top: 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .vorlage { margin-top: 12px; }
  .vorlage summary { font-size: 0.95rem; color: var(--blau); }
</style>
