<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { anstehendeSpiele, automatischeAufrufe, beschaeftigt, freierTisch, name, rundeVon, tische, verliererAmTisch } from '../../engine/abfragen';
  import { spielerName, type Spiel } from '../../engine/modell';
  import { spielerVon, type TurnierZustand } from '../../engine/zustand';
  import { Ansager, ansageText, aufrufeVon, aufrufGeraet, neueAufrufe, setzeAufrufGeraet, type AufrufGeraet } from '../../ansage';
  import Hilfe from '../Hilfe.svelte';

  /**
   * Tische und Spielaufruf. Leitung und Helfer rufen Spiele an freie Tische, wählen einen
   * Schiedsrichter und sperren Tische; alle anderen sehen nur, was gerade läuft und was als Nächstes kommt.
   * Auf Wunsch belegt das Gerät freie Tische selbst und sagt Aufrufe an.
   */
  let {
    z,
    turnierId,
    leitung = false,
    ich = null,
    darfAufrufen,
    mitSchiri,
    eintragen,
    oeffnen,
  }: {
    z: TurnierZustand;
    turnierId: string;
    leitung?: boolean;
    /** Spieler mit Helfer-Recht: eigene Spiele werden nicht automatisch aufgerufen */
    ich?: string | null;
    darfAufrufen: boolean;
    /** Schiedsrichter-Namen nur für Angemeldete, nicht für Zuschauer (Datenminimierung) */
    mitSchiri: boolean;
    eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown>;
    oeffnen: (s: Spiel) => void;
  } = $props();

  let jetzt = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (jetzt = Date.now()), 15_000);
    return () => clearInterval(t);
  });

  const liste = $derived(tische(z));
  const naechste = $derived(anstehendeSpiele(z, jetzt));
  const frei = $derived(freierTisch(z));
  const belegt = $derived(beschaeftigt(z));

  let aufruf = $state<{ spiel: Spiel; tisch: number; schiri: string; schiriName: string } | null>(null);
  let fehler = $state('');

  function ort(s: Spiel) {
    const k = z.konkurrenzen[s.konkurrenz]!;
    return `${k.einst.name} · ${rundeVon(k, s)}`;
  }
  function minuten(t: string | null) {
    return t ? Math.max(0, Math.floor((jetzt - Date.parse(t)) / 60000)) : 0;
  }
  function beteiligte(s: Spiel) {
    const k = z.konkurrenzen[s.konkurrenz]!;
    return [...spielerVon(k, s.a), ...spielerVon(k, s.b)];
  }
  /** Schiedsrichter-Vorschläge: Spieler, die gerade weder spielen noch pfeifen (und nicht im Spiel) */
  function schiriVorschlaege(s: Spiel) {
    const b = beteiligte(s);
    return z.spielerReihe.filter((id) => !belegt.has(id) && !b.includes(id));
  }
  function vorbereiten(s: Spiel, tisch?: number) {
    fehler = '';
    const t = tisch ?? frei ?? 0;
    const v = t ? verliererAmTisch(z, t, beteiligte(s)) : null;
    aufruf = { spiel: s, tisch: t, schiri: v ?? '', schiriName: '' };
  }
  const verlierer = $derived(aufruf && aufruf.tisch ? verliererAmTisch(z, aufruf.tisch, beteiligte(aufruf.spiel)) : null);
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
  async function pauseSetzen(min: number) {
    await eintragen(ART.turnierDaten, { pause: min });
  }

  /* ---------- Einstellungen am Gerät: Ansage und automatisch belegen ---------- */
  // svelte-ignore state_referenced_locally
  let geraet = $state<AufrufGeraet>(aufrufGeraet(turnierId));
  function geraetSetzen(neu: Partial<AufrufGeraet>) {
    geraet = { ...geraet, ...neu };
    setzeAufrufGeraet(turnierId, geraet);
  }

  const ansager = new Ansager();
  let tonBereit = $state(false);
  let keineStimme = $state(false);
  const bekannt = new Set<string>();
  async function ansageEin(an: boolean) {
    geraetSetzen({ ansage: an });
    if (!an) {
      ansager.stoppen();
      return;
    }
    keineStimme = false;
    tonBereit = await ansager.freischalten();
    keineStimme = !tonBereit;
    for (const a of aufrufeVon(z)) bekannt.add(a.schluessel); // nur künftige Aufrufe ansagen
  }
  $effect(() => {
    const neu = neueAufrufe(bekannt, aufrufeVon(z));
    if (!tonBereit || !geraet.ansage) return;
    for (const a of neu) untrack(() => ansager.sagen(ansageText(z, a)));
  });
  function wiederholen(s: Spiel) {
    const a = aufrufeVon(z).find((x) => x.spiel.id === s.id && x.spiel.konkurrenz === s.konkurrenz);
    if (a) ansager.sagen(ansageText(z, a));
  }

  /**
   * Gerade gesendete automatische Aufrufe (Spiel → Tisch, Zeit), damit nichts doppelt rausgeht. Zeigt der
   * Stand einen Aufruf nach 10 s nicht (abgelehnt, z. B. weil ein anderes Gerät schneller war), wird das
   * Spiel 5 Minuten zurückgestellt – so entsteht keine Schleife aus abgelehnten Einträgen.
   */
  const unterwegs = new Map<string, { tisch: number; seit: number }>();
  const zurueckgestellt = new Map<string, number>();
  $effect(() => {
    if (!darfAufrufen || !geraet.automatisch) return;
    const zStand = z;
    void jetzt;
    untrack(() => {
      const t = Date.now();
      for (const [k, u] of unterwegs) {
        const [kid, sid] = k.split('/');
        const s = zStand.konkurrenzen[kid!]?.spiele[sid!];
        if (s && s.tisch === u.tisch && s.aufgerufen) unterwegs.delete(k);
        else if (t - u.seit > 10_000) {
          unterwegs.delete(k);
          zurueckgestellt.set(k, t + 5 * 60_000);
        }
      }
      for (const [k, bis] of zurueckgestellt) if (bis < t) zurueckgestellt.delete(k);
      const sperre = new Set([...zurueckgestellt.keys(), ...unterwegs.keys()]);
      const tischeUnterwegs = new Set([...unterwegs.values()].map((u) => u.tisch));
      for (const p of automatischeAufrufe(zStand, t, geraet.schiriVerlierer, ich, sperre)) {
        if (tischeUnterwegs.has(p.tisch)) continue;
        unterwegs.set(`${p.spiel.konkurrenz}/${p.spiel.id}`, { tisch: p.tisch, seit: t });
        tischeUnterwegs.add(p.tisch);
        void eintragen(ART.spielAufgerufen, { konkurrenz: p.spiel.konkurrenz, spiel: p.spiel.id, tisch: p.tisch, ...(p.schiri ? { schiri: { spieler: p.schiri } } : {}) }).catch(() => undefined);
      }
    });
  });
  onDestroy(() => ansager.stoppen());

  const PAUSEN = [0, 2, 3, 5, 8, 10, 15];
  function namen(ids: string[]) {
    return ids.map((id) => spielerName(z.spieler[id])).join(', ');
  }
</script>

{#if darfAufrufen}
  <details class="karte geraet" data-testid="aufruf-einstellungen">
    <summary>{T.tische.einstellungen}{#if geraet.automatisch}<span class="marke an">{T.tische.automatischAn}</span>{/if}{#if geraet.ansage && tonBereit}<span class="marke an">🔊</span>{/if}</summary>
    <label class="haken"><input type="checkbox" checked={geraet.automatisch} onchange={(e) => geraetSetzen({ automatisch: e.currentTarget.checked })} data-testid="automatisch" /> <span>{T.tische.automatisch}<Hilfe text={T.tische.automatischHilfe} /></span></label>
    {#if geraet.automatisch}
      <label class="haken eingerueckt"><input type="checkbox" checked={geraet.schiriVerlierer} onchange={(e) => geraetSetzen({ schiriVerlierer: e.currentTarget.checked })} /> {T.tische.schiriVerlierer}</label>
    {/if}
    <label class="haken"><input type="checkbox" checked={geraet.ansage} onchange={(e) => ansageEin(e.currentTarget.checked)} data-testid="ansage" /> <span>{T.tische.ansage}<Hilfe text={T.tische.ansageHilfe} /></span></label>
    {#if geraet.ansage && !tonBereit && !keineStimme}
      <button class="zweit klein eingerueckt" onclick={() => ansageEin(true)}>{T.tische.tonAn}</button>
    {/if}
    {#if keineStimme}<p class="meldung info">{T.tische.keineStimme}</p>{/if}
    {#if leitung}
      <div class="label-zeile"><label for="pause">{T.tische.pause}</label><Hilfe text={T.tische.pauseHilfe} /></div>
      <select id="pause" value={z.pause} onchange={(e) => pauseSetzen(Number(e.currentTarget.value))} data-testid="pause">
        {#each PAUSEN.includes(z.pause) ? PAUSEN : [...PAUSEN, z.pause].sort((a, b) => a - b) as p (p)}<option value={p}>{p === 0 ? T.tische.pauseAus : T.tische.pauseMin(p)}</option>{/each}
      </select>
    {/if}
  </details>
{/if}

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
              {#if tonBereit && geraet.ansage}<button class="zweit klein" onclick={() => wiederholen(s)} aria-label={T.tische.wiederholen}>🔊</button>{/if}
            </div>
          {/if}
        {:else if darfAufrufen}
          <div class="reihe knoepfe">
            {#if !t.gesperrt && naechste.length}
              <button class="klein" onclick={() => vorbereiten(naechste[0]!.spiel, t.nr)} data-testid="tisch-belegen">{T.tische.aufrufen}</button>
            {/if}
            {#if leitung}
              <button class="zweit klein" onclick={() => sperren(t.nr, !t.gesperrt)} title={T.tische.sperrenHilfe}>{t.gesperrt ? T.tische.freigeben : T.tische.sperren}</button>
            {/if}
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
      {#if verlierer}<option value={verlierer}>{spielerName(z.spieler[verlierer])} ({T.tische.verliererVorher})</option>{/if}
      <optgroup label={T.tische.schiriFrei}>
        {#each schiriVorschlaege(aufruf.spiel).filter((id) => id !== verlierer) as id (id)}
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
            <div class="leise klein">
              {ort(a.spiel)}{a.wartetAuf.length ? ` · ${T.tische.wartetAuf(namen(a.wartetAuf))}` : ''}{a.inPause.length ? ` · ${T.tische.inPause(namen(a.inPause))}` : ''}
            </div>
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
  .geraet summary .marke { margin-left: 8px; }
  .marke.an { color: var(--gruen); border-color: var(--gruen); }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; margin: 10px 0; min-height: 44px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .haken span { display: inline-flex; align-items: center; }
  .eingerueckt { margin-left: 32px; }
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
  .knoepfe button { min-height: 44px; }
  .naechstes { display: flex; gap: 10px; align-items: center; }
  .naechstes button { min-height: 44px; }
  .naechstes.wartet strong { color: var(--leise); }
  .aufruf { border: 2px solid var(--blau); }
</style>
