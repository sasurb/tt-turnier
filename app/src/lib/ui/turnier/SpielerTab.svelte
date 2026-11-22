<script lang="ts">
  import { alsEineAktion } from '../../aktion';
  import { onMount } from 'svelte';
  import { ART, type PoolSpieler } from '@shared/protokoll';
  import { T } from '../../texte';
  import { linkZu } from '../../router.svelte';
  import { kurzId } from '../../engine/ids';
  import { spielerName, type Angabe, type SpielerDaten } from '../../engine/modell';
  import { begonnen, teilnehmerVon, type TurnierZustand } from '../../engine/zustand';
  import { meldbareEinzel, teilnahmen } from '../../engine/abfragen';
  import { hobbyStufe } from '../../engine/stufen';
  import { imPool, pool, poolLaden, poolSpeichern } from '../../pool.svelte';
  import { klassenLaden } from '../../klassen.svelte';
  import Hilfe from '../Hilfe.svelte';
  import SpielerForm from './SpielerForm.svelte';

  let { z, eintragen }: { z: TurnierZustand; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();

  let modus = $state<'' | 'pool' | 'neu'>('');
  let bearbeite = $state<string | null>(null);
  let suche = $state('');
  let gewaehlt = $state<string[]>([]);
  /** Einzel-Konkurrenzen, in die neue bzw. übernommene Spieler gleich gemeldet werden */
  let meldenIn = $state<string[]>([]);
  let meldung = $state('');

  onMount(() => {
    void poolLaden();
    void klassenLaden();
  });

  const angabenText: Record<Angabe, string> = { ttr: T.tspieler.ttr, klasse: T.tspieler.klasse, geschlecht: T.tspieler.geschlecht, jahrgang: T.tspieler.jahrgang };
  /** Vereine aus Turnier und Pool als Vorschläge beim Anlegen */
  const vereine = $derived([...z.spielerReihe.map((id) => z.spieler[id]!.verein), ...pool.liste.map((p) => p.verein)]);
  /** Paare und Mannschaften entstehen erst in der Konkurrenz – hier nur Einzel, die noch nicht begonnen haben */
  const offeneKonkurrenzen = $derived(meldbareEinzel(z));
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
    if (z.angaben.includes('ttr') && d.ttrGeschaetzt && typeof d.ttr === 'number') r.ttrGeschaetzt = true;
    if (d.pool) r.pool = d.pool;
    if (d.lizenz) r.lizenz = d.lizenz;
    return r;
  }

  async function melden(id: string) {
    for (const k of meldenIn) if (offeneKonkurrenzen.includes(k)) await eintragen(ART.teilnehmerGemeldet, { konkurrenz: k, id });
  }

  async function ausPoolUebernehmen() {
    let n = 0;
    await alsEineAktion(async () => {
      for (const pid of gewaehlt) {
        const p = pool.liste.find((x) => x.id === pid);
        if (!p || imTurnier.has(p.id)) continue;
        const id = kurzId();
        await eintragen(ART.spielerAngelegt, { id, ...fuersTurnier({ ...p, pool: p.id }) });
        await melden(id);
        n++;
      }
    });
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
    await alsEineAktion(async () => {
      await eintragen(ART.spielerAngelegt, { id, ...fuersTurnier({ ...d, pool: poolId }) });
      await melden(id);
    });
    meldung = `${spielerName(d)} ✓`;
  }

  /** Nur geänderte Felder senden: so überschreibt eine Bearbeitung nie Angaben, die das Gerät gar nicht kennt */
  async function aendern(id: string, d: SpielerDaten) {
    const alt = z.spieler[id]!;
    const neu = fuersTurnier({ ...d, pool: alt.pool });
    const geaendert: Record<string, unknown> = Object.fromEntries(Object.entries(neu).filter(([f, v]) => (alt as unknown as Record<string, unknown>)[f] !== v && !(v === null && (alt as unknown as Record<string, unknown>)[f] === undefined)));
    const geschaetzt = !!neu.ttrGeschaetzt;
    if (geschaetzt !== !!alt.ttrGeschaetzt) geaendert.ttrGeschaetzt = geschaetzt;
    else delete geaendert.ttrGeschaetzt;
    if (Object.keys(geaendert).length) await eintragen(ART.spielerGeaendert, { id, ...geaendert });
    bearbeite = null;
  }

  /** Spielt schon in einer begonnenen Konkurrenz (dann nur Rückzug, kein Entfernen – wie die Engine) */
  function spieltSchon(id: string): string | null {
    const k = Object.values(z.konkurrenzen).find((x) => begonnen(x) && teilnehmerVon(x, id));
    return k ? k.einst.name : null;
  }

  async function entfernen(id: string) {
    const laeuft = spieltSchon(id);
    if (laeuft) {
      alert(T.tspieler.entfernenLaeuft(laeuft));
      return;
    }
    if (confirm(T.tspieler.entfernenFrage)) await eintragen(ART.spielerEntfernt, { id });
  }

</script>

<details class="karte abschnitt" open data-testid="abschnitt-spieler">
  <summary><h2 class="titel">{T.tspieler.titel} <span class="leise">({z.spielerReihe.length})</span></h2></summary>
  <div class="reihe">
    <button class:zweit={modus !== 'pool'} onclick={() => (modus = modus === 'pool' ? '' : 'pool')} aria-expanded={modus === 'pool'}>{T.tspieler.ausPool}</button>
    <button class:zweit={modus !== 'neu'} onclick={() => (modus = modus === 'neu' ? '' : 'neu')} aria-expanded={modus === 'neu'}>+ {T.tspieler.neu}</button>
  </div>
  {#if meldung}<div class="meldung ok" role="status">{meldung}</div>{/if}

  {#if modus && offeneKonkurrenzen.length}
    <fieldset class="melden-in">
      <legend>{T.tspieler.meldenIn}<Hilfe text={T.tspieler.meldenInHilfe} /></legend>
      {#each offeneKonkurrenzen as id (id)}
        <label class="haken"><input type="checkbox" value={id} bind:group={meldenIn} />{z.konkurrenzen[id]!.einst.name}</label>
      {/each}
    </fieldset>
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
                <span><strong>{p.vorname} {p.nachname}</strong> <span class="leise">{p.verein}{p.ttr ? ` · ${p.ttrGeschaetzt ? T.einstufung.kurz : ''}${p.ttr}` : ''}{drin ? ` · ${T.tspieler.schonDrin}` : ''}</span></span>
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
    <SpielerForm angaben={z.angaben} mitPool {vereine} knopf={T.tspieler.hinzufuegen} speichern={neuAnlegen} abbrechen={() => (modus = '')} />
  {/if}

  {#if z.spielerReihe.length === 0}
    <p class="leise">{T.tspieler.leer}</p>
  {:else}
    <ul class="liste spieler">
      {#each z.spielerReihe as id (id)}
        {@const s = z.spieler[id]!}
        <li>
          {#if bearbeite === id}
            <SpielerForm angaben={z.angaben} {vereine} start={s} knopf={T.tspieler.speichern} speichern={(d) => aendern(id, d)} abbrechen={() => (bearbeite = null)} />
          {:else}
            <div class="zeile">
              <span class="wachsen">
                <strong>{spielerName(s)}</strong>
                <span class="leise">
                  {s.verein}{#each z.angaben as a (a)}{#if s[a] != null && s[a] !== ''}{' · '}{a === 'geschlecht' ? T.tspieler.geschlechter[String(s[a])] : a === 'ttr' && s.ttrGeschaetzt ? T.einstufung.stufe(s.ttr!, hobbyStufe(s.ttr!)?.id ?? null) : s[a]}{/if}{/each}
                </span>
                {#if z.konkurrenzReihe.length}
                  {@const t = teilnahmen(z, id)}
                  <span class="leise teilnahmen" class:keine={!t.length} data-testid="teilnahmen">{t.length ? T.tspieler.spieltIn(t.map((k) => z.konkurrenzen[k]!.einst.name).join(', ')) : T.tspieler.spieltNirgends}</span>
                {/if}
              </span>
              <button class="zweit klein" onclick={() => (bearbeite = id)}>{T.tspieler.bearbeiten}</button>
              {#if !spieltSchon(id)}
                <button class="gefahr klein" aria-label="{T.tspieler.entfernen}: {spielerName(s)}" onclick={() => entfernen(id)}>✕</button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="leise">{T.tspieler.angabenTitel}: Name, Verein{#each z.angaben as a (a)}, {angabenText[a]}{/each}<Hilfe text={T.tspieler.angabenOrt} /></p>
</details>

<style>
  .abschnitt > summary { display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer; }
  .abschnitt > summary .titel { font-size: 1.2rem; margin: 0; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; margin: 6px 0; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .haken.aus { opacity: 0.55; }
  .pool { margin-top: 12px; }
  .melden-in { border: 0; padding: 0; margin: 12px 0 0; }
  .melden-in legend { font-weight: 700; display: flex; align-items: center; gap: 6px; padding: 0; }
  .melden-in .haken { min-height: 44px; margin: 0; }
  .auswahl { list-style: none; padding: 0; margin: 8px 0; max-height: 22rem; overflow-y: auto; border: 1px solid var(--linie); border-radius: 10px; }
  .auswahl li { padding: 2px 12px; border-bottom: 1px solid var(--linie); }
  .spieler { margin-top: 12px; }
  .teilnahmen { font-size: 0.9rem; }
  .teilnahmen.keine { color: var(--orange); }
  .zeile { display: flex; align-items: center; gap: 8px; }
  .zeile .wachsen { flex: 1; display: flex; flex-direction: column; min-width: 0; }
</style>
