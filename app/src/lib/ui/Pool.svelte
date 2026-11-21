<script lang="ts">
  import { onMount } from 'svelte';
  import type { PoolSpieler } from '@shared/protokoll';
  import { T } from '../texte';
  import { app } from '../app.svelte';
  import { ALLE_ANGABEN, type SpielerDaten } from '../engine/modell';
  import { csvAusgeben, csvLesen, geraetInsKonto, geraetePool, imPool, pool, poolLaden, poolLoeschen, poolSpeichern } from '../pool.svelte';
  import SpielerForm from './turnier/SpielerForm.svelte';
  import { klassenLaden } from '../klassen.svelte';

  let neu = $state(false);
  let bearbeite = $state<string | null>(null);
  let suche = $state('');
  let meldung = $state<{ ok: boolean; text: string } | null>(null);
  let geraetAnzahl = $state(0);

  onMount(async () => {
    void klassenLaden();
    await poolLaden();
    geraetAnzahl = pool.quelle === 'konto' ? geraetePool().length : 0;
  });

  const treffer = $derived(
    pool.liste.filter((p) => {
      const q = suche.trim().toLowerCase();
      return !q || `${p.vorname} ${p.nachname} ${p.verein} ${p.klasse ?? ''}`.toLowerCase().includes(q);
    }),
  );

  async function schritt(f: () => Promise<string>) {
    meldung = null;
    try {
      meldung = { ok: true, text: await f() };
    } catch (x) {
      meldung = { ok: false, text: x instanceof Error ? x.message : String(x) };
    }
  }

  async function anlegen(d: SpielerDaten) {
    await poolSpeichern([{ id: '', ...d } as PoolSpieler]);
    neu = false;
    meldung = { ok: true, text: T.pool.gespeichert };
  }
  async function aendern(p: PoolSpieler, d: SpielerDaten) {
    await poolSpeichern([{ ...p, ...d }]);
    bearbeite = null;
  }
  function loeschen(p: PoolSpieler) {
    if (confirm(T.pool.loeschenFrage)) void schritt(async () => (await poolLoeschen([p.id]), T.pool.gespeichert));
  }

  async function einlesen(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!f) return;
    await schritt(async () => {
      const { spieler, uebersprungen } = csvLesen(await f.text());
      const neue = spieler.filter((s) => !imPool(pool.liste, s.vorname, s.nachname, s.verein));
      await poolSpeichern(neue);
      return T.pool.eingelesen(neue.length, uebersprungen) + (neue.length < spieler.length ? ' ' + T.pool.doppelte(spieler.length - neue.length) : '');
    });
  }

  function exportieren() {
    const blob = new Blob(['﻿' + csvAusgeben(pool.liste)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'spielerpool.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function uebernehmen() {
    await schritt(async () => {
      const n = await geraetInsKonto();
      geraetAnzahl = 0;
      return T.pool.uebernommen(n);
    });
  }
</script>

<h1>{T.pool.titel}</h1>
<p class="leise">{T.pool.text}</p>
<p class="meldung info">{pool.quelle === 'konto' && app.sitzung ? T.pool.quelleKonto : T.pool.quelleGeraet}</p>
{#if pool.fehler}<p class="meldung fehler">{T.pool.offline}</p>{/if}
{#if meldung}<div class="meldung" class:ok={meldung.ok} class:fehler={!meldung.ok} role="status">{meldung.text}</div>{/if}
{#if geraetAnzahl}
  <button class="zweit" onclick={uebernehmen}>{T.pool.geraetUebernehmen(geraetAnzahl)}</button>
{/if}

<section class="karte">
  <div class="reihe">
    <button onclick={() => (neu = !neu)} aria-expanded={neu}>+ {T.pool.neu}</button>
    <label class="knopf zweit datei">
      {T.pool.importieren}
      <input type="file" accept=".csv,text/csv,text/plain" onchange={einlesen} />
    </label>
    {#if pool.liste.length}<button class="zweit" onclick={exportieren}>{T.pool.exportieren}</button>{/if}
  </div>
  <p class="leise">{T.pool.importText}</p>
  {#if neu}
    <SpielerForm angaben={[...ALLE_ANGABEN]} vereine={pool.liste.map((x) => x.verein)} knopf={T.tspieler.hinzufuegen} speichern={anlegen} abbrechen={() => (neu = false)} />
  {/if}
</section>

<section class="karte">
  <h2>{T.pool.titel} <span class="leise">({pool.liste.length})</span></h2>
  {#if pool.liste.length === 0}
    <p class="leise">{pool.laedt ? T.app.laden : T.pool.leer}</p>
  {:else}
    <input type="search" bind:value={suche} placeholder={T.tspieler.suchen} aria-label={T.tspieler.suchen} />
    <ul class="liste">
      {#each treffer as p (p.id)}
        <li>
          {#if bearbeite === p.id}
            <SpielerForm angaben={[...ALLE_ANGABEN]} vereine={pool.liste.map((x) => x.verein)} start={p} knopf={T.tspieler.speichern} speichern={(d) => aendern(p, d)} abbrechen={() => (bearbeite = null)} />
          {:else}
            <div class="zeile">
              <span class="wachsen">
                <strong>{p.vorname} {p.nachname}</strong>
                <span class="leise">
                  {p.verein}{p.ttr ? ` · TTR ${p.ttr}` : ''}{p.klasse ? ` · ${p.klasse}` : ''}{p.geschlecht ? ` · ${T.tspieler.geschlechter[p.geschlecht]}` : ''}{p.jahrgang ? ` · ${p.jahrgang}` : ''}
                </span>
              </span>
              <button class="zweit klein" onclick={() => (bearbeite = p.id)}>{T.tspieler.bearbeiten}</button>
              <button class="gefahr klein" aria-label="{T.pool.loeschen}: {p.vorname} {p.nachname}" onclick={() => loeschen(p)}>✕</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .datei { position: relative; overflow: hidden; }
  .datei input { position: absolute; inset: 0; opacity: 0; cursor: pointer; min-height: 0; }
  .zeile { display: flex; align-items: center; gap: 8px; }
  .zeile .wachsen { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  ul.liste { margin-top: 12px; }
</style>
