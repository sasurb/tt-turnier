<script lang="ts">
  import { onMount } from 'svelte';
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { kurzId } from '../../engine/ids';
  import { standardEinstellungen, ttrBereichName, type KonkurrenzEinstellungen } from '../../engine/modell';
  import { begonnen, teilnehmerVon, type TurnierZustand } from '../../engine/zustand';
  import { pool, poolLaden } from '../../pool.svelte';
  import { klassenLaden } from '../../klassen.svelte';
  import Hilfe from '../Hilfe.svelte';
  import KonkurrenzDetail from './KonkurrenzDetail.svelte';
  import KonkurrenzForm from './KonkurrenzForm.svelte';
  import { alsEineAktion } from '../../aktion';

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

  /* ---------- Konkurrenzen zusammenlegen (vor dem Start) ---------- */
  const zusammenlegbar = $derived(z.konkurrenzReihe.map((id) => z.konkurrenzen[id]!).filter((k) => !begonnen(k)));
  let zlOffen = $state(false);
  let zlVon = $state('');
  let zlNach = $state('');
  let zlName = $state('');
  let zlHinweis = $state('');
  const zlZiele = $derived(zusammenlegbar.filter((k) => k.id !== zlVon && k.einst.art === z.konkurrenzen[zlVon]?.einst.art));
  /** Liste vereinen; ist eine leer (= keine Einschränkung), bleibt es ohne Einschränkung */
  function liste<W>(x: W[], y: W[]): W[] {
    return x.length && y.length ? [...new Set([...x, ...y])] : [];
  }
  function zulassungVereinen(a: KonkurrenzEinstellungen['zulassung'], b: KonkurrenzEinstellungen['zulassung']): KonkurrenzEinstellungen['zulassung'] {
    const min = (x: number | null, y: number | null) => (x === null || y === null ? null : Math.min(x, y));
    const max = (x: number | null, y: number | null) => (x === null || y === null ? null : Math.max(x, y));
    return {
      ttrMin: min(a.ttrMin, b.ttrMin),
      ttrMax: max(a.ttrMax, b.ttrMax),
      jahrgangVon: min(a.jahrgangVon, b.jahrgangVon),
      jahrgangBis: max(a.jahrgangBis, b.jahrgangBis),
      klassen: liste(a.klassen, b.klassen),
      geschlecht: liste(a.geschlecht, b.geschlecht),
    };
  }
  async function zusammenlegen() {
    const von = z.konkurrenzen[zlVon];
    const nach = z.konkurrenzen[zlNach];
    if (!von || !nach || begonnen(von) || begonnen(nach)) return;
    if (!confirm(T.konk.zusammenlegenFrage(von.einst.name, nach.einst.name))) return;
    laeuft = true;
    try {
      const name = zlName.trim() || nach.einst.name;
      await alsEineAktion(async () => {
        for (const tid of von.meldungen) {
          const p = von.paare[tid];
          if (p) {
            if (p.spieler.some((sp) => teilnehmerVon(nach, sp))) continue;
            await eintragen(ART.paarGemeldet, { konkurrenz: nach.id, id: nach.paare[tid] ? 'p-' + kurzId() : tid, spieler: [...p.spieler] });
          } else if (!nach.meldungen.includes(tid)) await eintragen(ART.teilnehmerGemeldet, { konkurrenz: nach.id, id: tid });
        }
        await eintragen(ART.konkurrenzGeaendert, { id: nach.id, einst: { ...$state.snapshot(nach.einst), name, zulassung: zulassungVereinen(nach.einst.zulassung, von.einst.zulassung) } });
        await eintragen(ART.konkurrenzEntfernt, { id: von.id });
      });
      zlHinweis = T.konk.zusammenlegenFertig(name);
      zlVon = zlNach = zlName = '';
      zlOffen = false;
    } finally {
      laeuft = false;
    }
  }

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
      await alsEineAktion(async () => {
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
      });
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
      {#if zusammenlegbar.length >= 2}<button class="zweit" onclick={() => (zlOffen = !zlOffen)} aria-expanded={zlOffen} data-testid="zusammenlegen">{T.konk.zusammenlegen}</button>{/if}
    </div>
    {#if zlOffen}
      <div class="zusammen" data-testid="zusammenlegen-form">
        <h3>{T.konk.zusammenlegen}<Hilfe text={T.konk.zusammenlegenHilfe} /></h3>
        <div class="zl-raster">
          <div>
            <label for="zlv">{T.konk.zusammenlegenVon}</label>
            <select id="zlv" bind:value={zlVon} onchange={() => (zlNach = '')}>
              <option value="">–</option>
              {#each zusammenlegbar as k (k.id)}<option value={k.id}>{k.einst.name} ({k.meldungen.length})</option>{/each}
            </select>
          </div>
          <div>
            <label for="zln">{T.konk.zusammenlegenNach}</label>
            <select id="zln" bind:value={zlNach} disabled={!zlVon}>
              <option value="">–</option>
              {#each zlZiele as k (k.id)}<option value={k.id}>{k.einst.name} ({k.meldungen.length})</option>{/each}
            </select>
          </div>
        </div>
        <label for="zlname">{T.konk.zusammenlegenName}</label>
        <input id="zlname" bind:value={zlName} maxlength="80" placeholder={z.konkurrenzen[zlNach]?.einst.name ?? ''} />
        <div class="reihe" style="margin-top:12px">
          <button disabled={!zlVon || !zlNach || laeuft} onclick={zusammenlegen} data-testid="zusammenlegen-knopf">{T.konk.zusammenlegenKnopf}</button>
          <button class="zweit" onclick={() => (zlOffen = false)}>{T.app.abbrechen}</button>
        </div>
      </div>
    {/if}
    {#if zlHinweis}<p class="meldung ok" role="status">{zlHinweis}</p>{/if}
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
  .zusammen { margin-top: 14px; border-top: 1px solid var(--linie); padding-top: 10px; }
  .zl-raster { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  @media (max-width: 480px) {
    .zl-raster { grid-template-columns: 1fr; }
  }
  .vorlage summary { font-size: 0.95rem; color: var(--blau); }
</style>
