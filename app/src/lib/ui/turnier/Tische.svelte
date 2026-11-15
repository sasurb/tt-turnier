<script lang="ts">
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { anstehendeSpiele, beschaeftigt, freierTisch, name, rundeVon, tische } from '../../engine/abfragen';
  import { spielerName, type Spiel } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';

  /**
   * Tische und Spielaufruf. Leitung und Helfer rufen Spiele an freie Tische, wählen einen
   * Schiedsrichter und sperren Tische; alle anderen sehen nur, was gerade läuft und was als Nächstes kommt.
   */
  let {
    z,
    darfAufrufen,
    mitSchiri,
    eintragen,
    oeffnen,
  }: {
    z: TurnierZustand;
    darfAufrufen: boolean;
    /** Schiedsrichter-Namen nur für Angemeldete, nicht für Zuschauer (Datenminimierung) */
    mitSchiri: boolean;
    eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown>;
    oeffnen: (s: Spiel) => void;
  } = $props();

  let jetzt = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (jetzt = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  const liste = $derived(tische(z));
  const naechste = $derived(anstehendeSpiele(z));
  const frei = $derived(freierTisch(z));
  const belegt = $derived(beschaeftigt(z));
  /** Schiedsrichter-Vorschläge: Spieler, die gerade weder spielen noch pfeifen */
  const schiriVorschlag = $derived(z.spielerReihe.filter((id) => !belegt.has(id)));

  let aufruf = $state<{ spiel: Spiel; tisch: number; schiri: string; schiriName: string } | null>(null);
  let fehler = $state('');

  function ort(s: Spiel) {
    const k = z.konkurrenzen[s.konkurrenz]!;
    return `${k.einst.name} · ${rundeVon(k, s)}`;
  }
  function minuten(t: string | null) {
    return t ? Math.max(0, Math.floor((jetzt - Date.parse(t)) / 60000)) : 0;
  }
  function vorbereiten(s: Spiel, tisch?: number) {
    fehler = '';
    aufruf = { spiel: s, tisch: tisch ?? frei ?? 0, schiri: '', schiriName: '' };
  }
  async function aufrufen(e: SubmitEvent) {
    e.preventDefault();
    if (!aufruf || !aufruf.tisch) return;
    const schiri = aufruf.schiri === '_name' ? (aufruf.schiriName.trim() ? { name: aufruf.schiriName.trim() } : null) : aufruf.schiri ? { spieler: aufruf.schiri } : null;
    try {
      await eintragen(ART.spielAufgerufen, { konkurrenz: aufruf.spiel.konkurrenz, spiel: aufruf.spiel.id, tisch: aufruf.tisch, ...(schiri ? { schiri } : {}) });
      aufruf = null;
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    }
  }
  async function zurueck(s: Spiel) {
    await eintragen(ART.spielAufrufZurueck, { konkurrenz: s.konkurrenz, spiel: s.id });
  }
  async function sperren(nr: number, gesperrt: boolean) {
    await eintragen(ART.tischGesperrt, { nr, gesperrt });
  }
</script>

<section class="karte">
  <h2>{T.tische.titel}<Hilfe text={T.tische.anzahlHilfe} /></h2>
  <p class="leise">{darfAufrufen ? T.tische.text : T.tische.zuschauerText}</p>
  <ul class="tische" data-testid="tische">
    {#each liste as t (t.nr)}
      <li class="tisch" class:frei={!t.spiel && !t.gesperrt} class:gesperrt={t.gesperrt}>
        <div class="kopf">
          <strong>{T.tische.tisch(t.nr)}</strong>
          {#if t.gesperrt}<span class="marke">{T.tische.gesperrt}</span>{:else if !t.spiel}<span class="marke frei">{T.tische.frei}</span>{:else}<span class="leise">{T.tische.seit(minuten(t.spiel.aufgerufen))}</span>{/if}
        </div>
        {#if t.spiel}
          {@const s = t.spiel}
          <div class="paarung">{name(z, s.a)} – {name(z, s.b)}</div>
          <div class="leise klein">{ort(s)}{mitSchiri && s.schiri ? ` · ${T.spiele.schiri(s.schiri.name)}` : ''}</div>
          {#if darfAufrufen}
            <div class="reihe knoepfe">
              <button class="klein" onclick={() => oeffnen(s)}>{T.tische.ergebnis}</button>
              <button class="zweit klein" onclick={() => zurueck(s)}>{T.tische.zurueck}</button>
            </div>
          {/if}
        {:else if darfAufrufen}
          <div class="reihe knoepfe">
            {#if !t.gesperrt && naechste.length}
              <button class="klein" onclick={() => vorbereiten(naechste[0]!.spiel, t.nr)} data-testid="tisch-belegen">{T.tische.aufrufen}</button>
            {/if}
            <button class="zweit klein" onclick={() => sperren(t.nr, !t.gesperrt)} title={T.tische.sperrenHilfe}>{t.gesperrt ? T.tische.freigeben : T.tische.sperren}</button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>

{#if aufruf}
  <form class="karte aufruf" onsubmit={aufrufen} data-testid="aufruf">
    <h2>{T.tische.aufrufTitel}</h2>
    <p><strong>{name(z, aufruf.spiel.a)} – {name(z, aufruf.spiel.b)}</strong><br /><span class="leise">{ort(aufruf.spiel)}</span></p>
    <label for="at">{T.tische.tischWahl}</label>
    <select id="at" bind:value={aufruf.tisch}>
      {#each liste.filter((t) => !t.spiel && !t.gesperrt) as t (t.nr)}<option value={t.nr}>{T.tische.tisch(t.nr)}</option>{/each}
    </select>
    {#if !liste.some((t) => !t.spiel && !t.gesperrt)}<p class="meldung info">{T.tische.keinTisch}</p>{/if}
    <div class="label-zeile"><label for="as">{T.tische.schiri}</label><Hilfe text={T.tische.schiriHilfe} /></div>
    <select id="as" bind:value={aufruf.schiri}>
      <option value="">{T.tische.schiriKeiner}</option>
      <optgroup label={T.tische.schiriFrei}>
        {#each schiriVorschlag.filter((id) => !(z.konkurrenzen[aufruf!.spiel.konkurrenz]?.paare[aufruf!.spiel.a ?? '']?.spieler.includes(id) || z.konkurrenzen[aufruf!.spiel.konkurrenz]?.paare[aufruf!.spiel.b ?? '']?.spieler.includes(id) || id === aufruf!.spiel.a || id === aufruf!.spiel.b)) as id (id)}
          <option value={id}>{spielerName(z.spieler[id])}</option>
        {/each}
      </optgroup>
      <option value="_name">{T.tische.schiriName}</option>
    </select>
    {#if aufruf.schiri === '_name'}
      <input bind:value={aufruf.schiriName} maxlength="80" aria-label={T.tische.schiri} autocomplete="off" />
    {/if}
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <div class="reihe" style="margin-top:12px">
      <button type="submit" disabled={!aufruf.tisch} data-testid="aufrufen">{T.tische.aufrufen}</button>
      <button type="button" class="zweit" onclick={() => (aufruf = null)}>{T.app.abbrechen}</button>
    </div>
  </form>
{/if}

<section class="karte">
  <h2>{T.tische.naechste}<Hilfe text={T.tische.naechsteText} /></h2>
  {#if naechste.length === 0}
    <p class="leise">{T.tische.keineNaechsten}</p>
  {:else}
    <ul class="liste" data-testid="naechste">
      {#each naechste.slice(0, 20) as a (a.spiel.konkurrenz + a.spiel.id)}
        <li class="naechstes" class:wartet={!a.bereit}>
          <div class="wachsen">
            <strong>{name(z, a.spiel.a)} – {name(z, a.spiel.b)}</strong>
            <div class="leise klein">{ort(a.spiel)}{!a.bereit ? ` · ${T.tische.wartetAuf(a.wartetAuf.map((id) => spielerName(z.spieler[id])).join(', '))}` : ''}</div>
          </div>
          {#if darfAufrufen}
            <button class="klein" class:zweit={!a.bereit || !frei} onclick={() => vorbereiten(a.spiel)} disabled={!frei}>{frei ? T.tische.aufrufenAn(frei) : T.tische.aufrufen}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  h2 { display: flex; align-items: center; }
  .tische { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 10px; }
  .tisch { border: 1px solid var(--linie); border-left: 5px solid var(--gruen); border-radius: 10px; padding: 10px 12px; background: var(--flaeche); min-width: 0; }
  .tisch.frei { border-left-color: var(--blau); }
  .tisch.gesperrt { border-left-color: var(--linie); opacity: 0.7; }
  .kopf { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .kopf strong { font-size: 1.15rem; }
  .marke.frei { color: var(--blau); border-color: var(--blau); }
  .paarung { font-weight: 600; margin-top: 4px; overflow-wrap: anywhere; }
  .klein { font-size: 0.9rem; }
  .knoepfe { margin-top: 8px; }
  .naechstes { display: flex; gap: 10px; align-items: center; }
  .naechstes.wartet strong { color: var(--leise); }
  .aufruf { border: 2px solid var(--blau); }
</style>
