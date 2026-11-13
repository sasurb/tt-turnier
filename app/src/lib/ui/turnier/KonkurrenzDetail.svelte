<script lang="ts">
  import { ART, type PoolSpieler } from '@shared/protokoll';
  import { T } from '../../texte';
  import { auslosungErstellen, endrundeErstellen, gruppenZahlVorschlag, name, qualifikanten, zulassungsHinweise } from '../../engine/abfragen';
  import { setzreihe } from '../../engine/auslosung';
  import { spielerName, type KonkurrenzEinstellungen, type KonkurrenzZustand } from '../../engine/modell';
  import { neuerZufallswert } from '../../engine/zufall';
  import { auslosungAktuell, begonnen, erstePhase, zurueckgezogen, type TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';
  import AuslosungVorschau from './AuslosungVorschau.svelte';
  import KonkurrenzForm from './KonkurrenzForm.svelte';

  let {
    z,
    k,
    poolListe,
    eintragen,
  }: { z: TurnierZustand; k: KonkurrenzZustand; poolListe: PoolSpieler[]; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();

  let bearbeiten = $state(false);
  let gruppenZahl = $state<number | null>(null);
  let rueckzugWer = $state('');
  let fehler = $state('');

  const gestartet = $derived(begonnen(k));
  const phase1 = $derived(erstePhase(k));
  const aktuell = $derived(auslosungAktuell(k));
  const n = $derived(k.meldungen.length);
  const vorschlagGruppen = $derived(gruppenZahlVorschlag(k));
  const gZahl = $derived(gruppenZahl ?? vorschlagGruppen);
  const reihe = $derived(setzreihe(k.meldungen, z.spieler, k.einst, k.setzliste));
  const quali = $derived(k.einst.modus === 'gruppen_ko' && k.gestartet.gruppen && !k.gestartet.ko ? qualifikanten(k) : null);
  const aktive = $derived(k.meldungen.filter((id) => !zurueckgezogen(k).includes(id)));
  const hatErgebnisse = $derived(Object.values(k.spiele).some((s) => s.eintrag));

  async function los(art: string, d: Record<string, unknown>) {
    fehler = '';
    try {
      await eintragen(art, d);
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    }
  }

  /** Spielerdaten aus Turnier und Pool (für Zulassungshinweise auch mit Angaben, die nicht im Turnier stehen) */
  function daten(id: string) {
    const s = z.spieler[id];
    const p = s?.pool ? poolListe.find((x) => x.id === s.pool) : undefined;
    return { ...(p ?? {}), ...Object.fromEntries(Object.entries(s ?? {}).filter(([, v]) => v !== null && v !== undefined)) };
  }

  async function melden(id: string, an: boolean) {
    await los(an ? ART.teilnehmerGemeldet : ART.teilnehmerAbgemeldet, { konkurrenz: k.id, id });
  }
  async function alleMelden() {
    for (const id of z.spielerReihe) if (!k.meldungen.includes(id)) await melden(id, true);
  }

  async function setzlisteVerschieben(i: number, um: number) {
    const l = [...reihe];
    const j = i + um;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j]!, l[i]!];
    await los(ART.setzliste, { konkurrenz: k.id, liste: l });
  }

  async function auslosen() {
    await los(ART.auslosung, auslosungErstellen(z, k, neuerZufallswert(), gZahl));
  }

  async function tauschenGruppen(a: string, b: string) {
    const g = k.auslosungGruppen!.gruppen.map((x) => [...x]);
    const [, ga, ia] = a.split(':').map(Number);
    const [, gb, ib] = b.split(':').map(Number);
    const x = g[ga!]![ia!]!;
    g[ga!]![ia!] = g[gb!]![ib!]!;
    g[gb!]![ib!] = x;
    await los(ART.auslosung, { konkurrenz: k.id, phase: 'gruppen', zufall: k.auslosungGruppen!.zufall, gruppen: g });
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
  async function zuruecknehmen() {
    if (confirm(T.konk.zurueckFrage)) await los(ART.phaseZurueck, { konkurrenz: k.id, phase: k.gestartet.ko ? 'ko' : 'gruppen' });
  }
  async function endrundeAuslosen() {
    const d = endrundeErstellen(z, k, neuerZufallswert());
    if (d) await los(ART.auslosung, d);
  }
  async function zurueckziehen() {
    if (rueckzugWer && confirm(T.konk.rueckzugFrage(name(z, rueckzugWer)))) {
      await los(ART.teilnehmerAbgemeldet, { konkurrenz: k.id, id: rueckzugWer });
      rueckzugWer = '';
    }
  }
  async function speichern(e: KonkurrenzEinstellungen) {
    await eintragen(ART.konkurrenzGeaendert, { id: k.id, einst: e });
    bearbeiten = false;
  }
  async function loeschen() {
    if (confirm(T.konk.entfernenFrage)) await los(ART.konkurrenzEntfernt, { id: k.id });
  }
</script>

<details class="karte konk" open={k.status !== 'beendet'} data-testid="konkurrenz">
  <summary>
    <span>{k.einst.name} <span class="leise">· {T.konk.modi[k.einst.modus]} · {T.konk.teilnehmer(n)}</span></span>
    <span class="marke">{T.konk.status[k.status]}</span>
  </summary>

  {#if bearbeiten}
    <KonkurrenzForm start={k.einst} {gestartet} knopf={T.konk.speichern} {speichern} abbrechen={() => (bearbeiten = false)} />
  {:else}
    <div class="reihe">
      <button class="zweit klein" onclick={() => (bearbeiten = true)}>{T.tspieler.bearbeiten}</button>
      {#if !hatErgebnisse}<button class="gefahr klein" onclick={loeschen}>{T.konk.entfernen}</button>{/if}
    </div>
  {/if}
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}

  {#if !gestartet}
    <h3>{T.konk.meldungen} <span class="leise">({n})</span></h3>
    {#if z.spielerReihe.length === 0}
      <p class="leise">{T.konk.keineSpieler}</p>
    {:else}
      <div class="reihe"><button class="zweit klein" onclick={alleMelden}>{T.konk.alleMelden}</button></div>
      <ul class="meldeliste">
        {#each z.spielerReihe as id (id)}
          {@const h = zulassungsHinweise(daten(id), k.einst.zulassung)}
          <li>
            <label class="haken">
              <input type="checkbox" checked={k.meldungen.includes(id)} onchange={(e) => melden(id, e.currentTarget.checked)} />
              <span>
                {spielerName(z.spieler[id])} <span class="leise">{z.spieler[id]!.verein}{z.spieler[id]!.ttr ? ` · ${z.spieler[id]!.ttr}` : ''}</span>
                {#if h.length}<span class="marke warn" title={h.join(', ')}>⚠ {h.join(', ')}</span>{/if}
              </span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    {#if k.einst.setzung === 'manuell' && n > 1}
      <h3>{T.konk.setzliste}<Hilfe text={T.konk.setzlisteText} /></h3>
      <ol class="setzliste">
        {#each reihe as id, i (id)}
          <li>
            <span class="nr">{i + 1}.</span>
            <span class="wachsen">{name(z, id)}</span>
            <button class="zweit klein" aria-label="{name(z, id)} {T.konk.hoch}" disabled={i === 0} onclick={() => setzlisteVerschieben(i, -1)}>↑</button>
            <button class="zweit klein" aria-label="{name(z, id)} {T.konk.runter}" disabled={i === reihe.length - 1} onclick={() => setzlisteVerschieben(i, 1)}>↓</button>
          </li>
        {/each}
      </ol>
    {/if}

    {#if n >= 2}
      <h3>{T.konk.auslosung}</h3>
      <p class="leise">{T.konk.auslosungText}</p>
      {#if k.einst.modus === 'gruppen_ko'}
        <label for="gz-{k.id}">{T.konk.anzahlGruppen}</label>
        <select id="gz-{k.id}" value={gZahl} onchange={(e) => (gruppenZahl = Number(e.currentTarget.value))}>
          {#each Array.from({ length: Math.max(1, Math.floor(n / 2)) }, (_, i) => i + 1) as g (g)}
            <option value={g}>{g} ({Math.ceil(n / g)}er)</option>
          {/each}
        </select>
      {/if}
      <div class="reihe knoepfe">
        <button class:zweit={aktuell} onclick={auslosen}>{k.auslosungGruppen || k.auslosungKo ? T.konk.neuAuslosen : T.konk.auslosen}</button>
      </div>
      {#if (k.auslosungGruppen || k.auslosungKo) && !aktuell}<p class="meldung info">{T.konk.veraltet}</p>{/if}
      {#if aktuell}
        {#if phase1 === 'gruppen'}
          <AuslosungVorschau {z} gruppen={k.auslosungGruppen!.gruppen} tauschen={tauschenGruppen} />
        {:else}
          <AuslosungVorschau {z} plaetze={k.auslosungKo!.plaetze} tauschen={tauschenKo} />
        {/if}
        <button class="breit start" onclick={() => starten(phase1)} data-testid="starten">{T.konk.starten}</button>
      {/if}
    {:else}
      <p class="leise">{T.konk.zuWenige}</p>
    {/if}
  {:else}
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

    {#if k.status !== 'beendet' && aktive.length}
      <h3>{T.konk.rueckzugTitel}<Hilfe text={T.konk.rueckzugText} /></h3>
      <div class="reihe">
        <select class="wachsen" bind:value={rueckzugWer} aria-label={T.konk.rueckzugTitel}>
          <option value="">–</option>
          {#each aktive as id (id)}<option value={id}>{name(z, id)}</option>{/each}
        </select>
        <button class="gefahr" disabled={!rueckzugWer} onclick={zurueckziehen}>{T.konk.rueckzugKnopf}</button>
      </div>
    {/if}

    {#if !Object.values(k.spiele).some((s) => s.eintrag && s.phase === (k.gestartet.ko ? 'ko' : 'gruppen'))}
      <div class="reihe" style="margin-top:16px"><button class="zweit klein" onclick={zuruecknehmen}>{T.konk.zurueck}</button></div>
    {/if}
  {/if}
</details>

<style>
  .konk summary { font-size: 1.05rem; }
  .konk summary > span:first-child { overflow-wrap: anywhere; }
  h3 { margin-top: 18px; display: flex; align-items: center; }
  .haken { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; margin: 0; padding: 8px 0; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; margin-top: 1px; }
  .meldeliste { list-style: none; padding: 0; margin: 8px 0; max-height: 26rem; overflow-y: auto; }
  .meldeliste li { border-bottom: 1px solid var(--linie); }
  .marke.warn { color: var(--orange); border-color: var(--orange); margin-left: 6px; white-space: normal; }
  .setzliste { list-style: none; padding: 0; margin: 0; }
  .setzliste li { display: flex; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--linie); }
  .nr { width: 2rem; font-variant-numeric: tabular-nums; color: var(--leise); }
  .knoepfe { margin: 12px 0; }
  .start { margin-top: 16px; background: var(--gruen); }
</style>
