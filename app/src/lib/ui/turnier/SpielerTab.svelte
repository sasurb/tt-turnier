<script lang="ts">
  import { onMount } from 'svelte';
  import { ART, type PoolSpieler } from '@shared/protokoll';
  import { T } from '../../texte';
  import { linkZu } from '../../router.svelte';
  import { kurzId } from '../../engine/ids';
  import { ALLE_ANGABEN, spielerName, type Angabe, type SpielerDaten } from '../../engine/modell';
  import { begonnen, type TurnierZustand } from '../../engine/zustand';
  import { imPool, pool, poolLaden, poolSpeichern } from '../../pool.svelte';
  import { klassenLaden } from '../../klassen.svelte';
  import Hilfe from '../Hilfe.svelte';
  import SpielerForm from './SpielerForm.svelte';

  let { z, eintragen }: { z: TurnierZustand; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();

  let modus = $state<'' | 'pool' | 'neu'>('');
  let bearbeite = $state<string | null>(null);
  let suche = $state('');
  let gewaehlt = $state<string[]>([]);
  let meldenIn = $state('');
  let meldung = $state('');

  onMount(() => {
    void poolLaden();
    void klassenLaden();
  });

  const angabenText: Record<Angabe, string> = { ttr: T.tspieler.ttr, klasse: T.tspieler.klasse, geschlecht: T.tspieler.geschlecht, jahrgang: T.tspieler.jahrgang };
  const offeneKonkurrenzen = $derived(z.konkurrenzReihe.filter((id) => !begonnen(z.konkurrenzen[id]!)));
  const imTurnier = $derived(new Set(z.spielerReihe.map((id) => z.spieler[id]!.pool).filter(Boolean)));
  const treffer = $derived(
    pool.liste.filter((p) => {
      const q = suche.trim().toLowerCase();
      return !q || `${p.vorname} ${p.nachname} ${p.verein}`.toLowerCase().includes(q);
    }),
  );

  /** Nur die gewählten Angaben ins (öffentliche) Turnier übernehmen */
  function fuersTurnier(d: Partial<SpielerDaten>): Record<string, unknown> {
    const r: Record<string, unknown> = { vorname: d.vorname ?? '', nachname: d.nachname ?? '', verein: d.verein ?? '' };
    for (const a of z.angaben) r[a] = d[a] ?? null;
    if (d.pool) r.pool = d.pool;
    return r;
  }

  async function melden(id: string) {
    if (meldenIn) await eintragen(ART.teilnehmerGemeldet, { konkurrenz: meldenIn, id });
  }

  async function ausPoolUebernehmen() {
    let n = 0;
    for (const pid of gewaehlt) {
      const p = pool.liste.find((x) => x.id === pid);
      if (!p || imTurnier.has(p.id)) continue;
      const id = kurzId();
      await eintragen(ART.spielerAngelegt, { id, ...fuersTurnier({ ...p, pool: p.id }) });
      await melden(id);
      n++;
    }
    meldung = T.tspieler.anzahl(n) + ' ✓';
    gewaehlt = [];
    modus = '';
  }

  async function neuAnlegen(d: SpielerDaten, inPool: boolean) {
    if (z.spielerReihe.some((id) => {
      const s = z.spieler[id]!;
      return s.vorname.toLowerCase() === d.vorname.toLowerCase() && s.nachname.toLowerCase() === d.nachname.toLowerCase() && s.verein.toLowerCase() === d.verein.toLowerCase();
    })) throw new Error(T.tspieler.doppelt);
    let poolId: string | null = null;
    if (inPool) {
      const vorhanden = imPool(pool.liste, d.vorname, d.nachname, d.verein);
      const [p] = await poolSpeichern([{ ...(vorhanden ?? {}), ...(d as PoolSpieler), id: vorhanden?.id ?? '' }]);
      poolId = p!.id;
    }
    const id = kurzId();
    await eintragen(ART.spielerAngelegt, { id, ...fuersTurnier({ ...d, pool: poolId }) });
    await melden(id);
    meldung = `${spielerName(d)} ✓`;
  }

  async function aendern(id: string, d: SpielerDaten) {
    await eintragen(ART.spielerGeaendert, { id, ...fuersTurnier({ ...d, pool: z.spieler[id]!.pool }) });
    bearbeite = null;
  }

  async function entfernen(id: string) {
    if (confirm(T.tspieler.entfernenFrage)) await eintragen(ART.spielerEntfernt, { id });
  }

  // Angaben, Ort, Tische
  // svelte-ignore state_referenced_locally
  let ort = $state(z.ort);
  // svelte-ignore state_referenced_locally
  let tische = $state(z.tische ? String(z.tische) : '');
  // svelte-ignore state_referenced_locally
  let angaben = $state<Angabe[]>([...z.angaben]);
  let gespeichert = $state(false);
  async function datenSpeichern(e: SubmitEvent) {
    e.preventDefault();
    const t = parseInt(tische, 10);
    await eintragen(ART.turnierDaten, { ort: ort.trim(), tische: Number.isFinite(t) && t > 0 ? t : null, angaben: [...angaben] });
    gespeichert = true;
    setTimeout(() => (gespeichert = false), 2000);
  }
</script>

<section class="karte">
  <details>
    <summary>{T.tspieler.angabenTitel}</summary>
    <form onsubmit={datenSpeichern}>
      <p class="leise">{T.tspieler.angabenText}</p>
      <div class="angaben">
        {#each ALLE_ANGABEN as a (a)}
          <label class="haken"><input type="checkbox" value={a} bind:group={angaben} /> {angabenText[a]}</label>
        {/each}
      </div>
      <div class="raster">
        <div><label for="ort">{T.tspieler.ort}</label><input id="ort" bind:value={ort} /></div>
        <div><label for="tische">{T.tspieler.tische}</label><input id="tische" bind:value={tische} inputmode="numeric" maxlength="3" /></div>
      </div>
      <div class="reihe" style="margin-top:12px">
        <button type="submit">{T.app.speichern}</button>
        {#if gespeichert}<span class="leise">{T.app.gespeichert}</span>{/if}
      </div>
    </form>
  </details>
</section>

<section class="karte">
  <h2>{T.tspieler.titel} <span class="leise">({z.spielerReihe.length})</span></h2>
  <div class="reihe">
    <button class:zweit={modus !== 'pool'} onclick={() => (modus = modus === 'pool' ? '' : 'pool')} aria-expanded={modus === 'pool'}>{T.tspieler.ausPool}</button>
    <button class:zweit={modus !== 'neu'} onclick={() => (modus = modus === 'neu' ? '' : 'neu')} aria-expanded={modus === 'neu'}>+ {T.tspieler.neu}</button>
  </div>
  {#if meldung}<div class="meldung ok" role="status">{meldung}</div>{/if}

  {#if modus && offeneKonkurrenzen.length}
    <label for="melden-in">{T.tspieler.meldenIn}</label>
    <select id="melden-in" bind:value={meldenIn}>
      <option value="">–</option>
      {#each offeneKonkurrenzen as id (id)}<option value={id}>{z.konkurrenzen[id]!.einst.name}</option>{/each}
    </select>
  {/if}

  {#if modus === 'pool'}
    <div class="pool">
      <input type="search" bind:value={suche} placeholder={T.tspieler.suchen} aria-label={T.tspieler.suchen} />
      {#if pool.fehler}<p class="leise">{T.pool.offline}</p>{/if}
      {#if pool.liste.length === 0}
        <p class="leise">{T.tspieler.poolLeer} <a href={linkZu('pool')}>{T.tspieler.zumPool}</a></p>
      {:else}
        <ul class="auswahl">
          {#each treffer as p (p.id)}
            {@const drin = imTurnier.has(p.id)}
            <li>
              <label class="haken" class:aus={drin}>
                <input type="checkbox" value={p.id} bind:group={gewaehlt} disabled={drin} />
                <span><strong>{p.vorname} {p.nachname}</strong> <span class="leise">{p.verein}{p.ttr ? ` · ${p.ttr}` : ''}{drin ? ` · ${T.tspieler.schonDrin}` : ''}</span></span>
              </label>
            </li>
          {/each}
        </ul>
        <div class="reihe">
          <button disabled={!gewaehlt.length} onclick={ausPoolUebernehmen}>{T.tspieler.uebernehmen} ({gewaehlt.length})</button>
          <a href={linkZu('pool')} class="leise">{T.tspieler.zumPool}</a>
        </div>
      {/if}
    </div>
  {:else if modus === 'neu'}
    <SpielerForm angaben={z.angaben} mitPool knopf={T.tspieler.hinzufuegen} speichern={neuAnlegen} abbrechen={() => (modus = '')} />
  {/if}

  {#if z.spielerReihe.length === 0}
    <p class="leise">{T.tspieler.leer}</p>
  {:else}
    <ul class="liste spieler">
      {#each z.spielerReihe as id (id)}
        {@const s = z.spieler[id]!}
        <li>
          {#if bearbeite === id}
            <SpielerForm angaben={z.angaben} start={s} knopf={T.tspieler.speichern} speichern={(d) => aendern(id, d)} abbrechen={() => (bearbeite = null)} />
          {:else}
            <div class="zeile">
              <span class="wachsen">
                <strong>{spielerName(s)}</strong>
                <span class="leise">
                  {s.verein}{#each z.angaben as a (a)}{#if s[a] != null && s[a] !== ''} · {a === 'geschlecht' ? T.tspieler.geschlechter[String(s[a])] : s[a]}{/if}{/each}
                </span>
              </span>
              <button class="zweit klein" onclick={() => (bearbeite = id)}>{T.tspieler.bearbeiten}</button>
              <button class="gefahr klein" aria-label="{T.tspieler.entfernen}: {spielerName(s)}" onclick={() => entfernen(id)}>✕</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="leise">{T.tspieler.angabenTitel}: Name, Verein{#each z.angaben as a (a)}, {angabenText[a]}{/each}<Hilfe text={T.tspieler.angabenText} /></p>
</section>

<style>
  .angaben { display: flex; flex-wrap: wrap; gap: 4px 18px; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; margin: 6px 0; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .haken.aus { opacity: 0.55; }
  .raster { display: grid; grid-template-columns: 2fr 1fr; gap: 0 12px; }
  .pool { margin-top: 12px; }
  .auswahl { list-style: none; padding: 0; margin: 8px 0; max-height: 22rem; overflow-y: auto; border: 1px solid var(--linie); border-radius: 10px; }
  .auswahl li { padding: 2px 12px; border-bottom: 1px solid var(--linie); }
  .spieler { margin-top: 12px; }
  .zeile { display: flex; align-items: center; gap: 8px; }
  .zeile .wachsen { flex: 1; display: flex; flex-direction: column; min-width: 0; }
</style>
