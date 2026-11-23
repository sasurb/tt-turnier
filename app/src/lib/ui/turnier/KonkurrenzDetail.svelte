<script module lang="ts">
  /**
   * Auf-/Zugeklappt je Konkurrenz für die ganze Sitzung merken (auch beim Reiterwechsel).
   * Nur Abweichungen vom Standard (offen, solange nicht beendet) werden gespeichert.
   */
  const aufgeklappt = new Map<string, boolean>();
</script>

<script lang="ts">
  import KonkurrenzMeldungen from './KonkurrenzMeldungen.svelte';
  import { ART, type PoolSpieler } from '@shared/protokoll';
  import { T } from '../../texte';
  import { auslosungErstellen, endrundeErstellen, gruppenKlassen, gruppenZahlVorschlag, klassenDerMeldungen, name, qualifikanten, teilnehmerDaten } from '../../engine/abfragen';
  import { setzreihe } from '../../engine/auslosung';
  import { inEndrunde, type KonkurrenzEinstellungen, type KonkurrenzZustand } from '../../engine/modell';
  import { angeboten } from '../../engine/auswahl';
  import { neuerZufallswert } from '../../engine/zufall';
  import {
    auslosungAktuell,
    begonnen,
    erstePhase,
    gruppenAenderungPruefen,
    koPlaetzePruefen,
    platzGruppenBilden,
    type TurnierZustand,
  } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';
  import AuslosungVorschau from './AuslosungVorschau.svelte';
  import { istRundenModus } from '../../engine/runden';
  import KonkurrenzForm from './KonkurrenzForm.svelte';

  let {
    z,
    k,
    poolListe,
    eintragen,
  }: { z: TurnierZustand; k: KonkurrenzZustand; poolListe: PoolSpieler[]; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();

  let bearbeiten = $state(false);

  /*
   * Nicht open={k.status !== 'beendet'} schreiben: Der Turnierzustand wird bei jeder Änderung
   * (auch beim Abgleich) neu berechnet, dann klappte Svelte die Karte sofort wieder auf.
   */
  const standardOffen = $derived(k.status !== 'beendet');
  // svelte-ignore state_referenced_locally
  let auf = $state<boolean | null>(aufgeklappt.get(k.id) ?? null);
  function umgeschaltet(e: Event & { currentTarget: HTMLDetailsElement }) {
    const o = e.currentTarget.open;
    auf = o === standardOffen ? null : o;
    if (auf === null) aufgeklappt.delete(k.id);
    else aufgeklappt.set(k.id, auf);
  }
  let gruppenZahl = $state<number | null>(null);
  let fehler = $state('');

  const gestartet = $derived(begonnen(k));
  const phase1 = $derived(erstePhase(k));
  const aktuell = $derived(auslosungAktuell(k));
  const n = $derived(k.meldungen.length);
  const vorschlagGruppen = $derived(gruppenZahlVorschlag(k));
  const gZahl = $derived(gruppenZahl ?? vorschlagGruppen);
  const reihe = $derived(setzreihe(k.meldungen, teilnehmerDaten(z, k), k.einst, k.setzliste));
  const doppel = $derived(k.einst.art === 'doppel' || k.einst.art === 'mixed');
  const mannschaft = $derived(k.einst.art === 'mannschaft');
  const quali = $derived(k.einst.modus === 'gruppen_ko' && k.gestartet.gruppen && !k.gestartet.ko ? qualifikanten(k) : null);
  const platzPlan = $derived(k.einst.modus === 'gruppen_platz' && k.gestartet.gruppen && !k.gestartet.ko ? platzGruppenBilden(k) : null);
  /** Hat die laufende Stufe schon Ergebnisse? (dann lässt sich ihr Start nicht zurücknehmen) */
  const stufeMitErgebnis = $derived(
    Object.values(k.spiele).some((s) => {
      if (!s.eintrag && !(k.begegnungen[s.id] && Object.keys(k.begegnungen[s.id]!.teile).length)) return false;
      if (k.einst.modus === 'gruppen_platz') return k.gestartet.ko ? inEndrunde(k, s) : true;
      return s.phase === (k.gestartet.ko ? 'ko' : 'gruppen');
    }),
  );
  async function platzRundeStarten() {
    if (!platzPlan?.ok || !confirm(T.konk.startenFrage)) return;
    await los(ART.phaseGestartet, { konkurrenz: k.id, phase: 'ko', gruppen: platzPlan.gruppen.map((g) => g.mitglieder) });
  }
  const hatErgebnisse = $derived(Object.values(k.spiele).some((s) => s.eintrag));
  const klassenTrennung = $derived(k.einst.modus === 'gruppen_ko' && k.einst.klassenTrennung !== 'keine');
  const klassenListe = $derived(klassenTrennung ? klassenDerMeldungen(z, k) : []);

  async function los(art: string, d: Record<string, unknown>) {
    fehler = '';
    try {
      await eintragen(art, d);
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    }
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
  const rundenModus = $derived(istRundenModus(k.einst.modus));
  /** Teilnehmer mit Ergebnis oder Aufruf in der laufenden Phase (lassen sich nicht mehr bewegen) */
  const festeTeilnehmer = $derived.by(() => {
    const aus = new Set<string>();
    const phase = k.gestartet.ko ? 'ko' : 'gruppen';
    for (const s of Object.values(k.spiele)) {
      if (s.phase !== phase || !(s.eintrag || (s.tisch !== null && s.status === 'offen'))) continue;
      if (s.a) aus.add(s.a);
      if (s.b) aus.add(s.b);
    }
    return aus;
  });
  const aendernArt = $derived<'gruppen' | 'ko' | null>(
    !gestartet || k.status === 'beendet' || rundenModus ? null : k.gestartet.ko ? (k.einst.modus === 'gruppen_platz' ? null : 'ko') : phase1 === 'gruppen' && k.gruppen.length > 1 ? 'gruppen' : null,
  );
  let aendernFehler = $state('');
  async function laufendTauschenGruppen(a: string, b: string) {
    aendernFehler = '';
    const g = k.gruppen.map((x) => [...x.mitglieder]);
    const [, ga, ia] = a.split(':');
    const [, gb, ib] = b.split(':');
    const x = g[Number(ga)]![Number(ia)]!;
    if (ib === 'leer') {
      g[Number(ga)]!.splice(Number(ia), 1);
      g[Number(gb)]!.push(x);
    } else {
      g[Number(ga)]![Number(ia)] = g[Number(gb)]![Number(ib)]!;
      g[Number(gb)]![Number(ib)] = x;
    }
    const f = gruppenAenderungPruefen(k, g);
    if (f) {
      aendernFehler = T.konk.aendernNicht(f);
      return;
    }
    await los(ART.auslosungGeaendert, { konkurrenz: k.id, phase: 'gruppen', gruppen: g });
  }
  async function laufendTauschenKo(a: string, b: string) {
    aendernFehler = '';
    const p = [...k.auslosungKo!.plaetze];
    const ia = Number(a.split(':')[1]);
    const ib = Number(b.split(':')[1]);
    [p[ia], p[ib]] = [p[ib] ?? null, p[ia] ?? null];
    const f = koPlaetzePruefen(k, p);
    if (f) {
      aendernFehler = T.konk.aendernNicht(f);
      return;
    }
    await los(ART.auslosungGeaendert, { konkurrenz: k.id, phase: 'ko', plaetze: p });
  }

  async function speichern(e: KonkurrenzEinstellungen) {
    await eintragen(ART.konkurrenzGeaendert, { id: k.id, einst: e });
    bearbeiten = false;
  }
  async function loeschen() {
    if (confirm(T.konk.entfernenFrage)) await los(ART.konkurrenzEntfernt, { id: k.id });
  }
</script>

<details class="karte konk" open={auf ?? standardOffen} ontoggle={umgeschaltet} data-testid="konkurrenz">
  <summary>
    <span>{k.einst.name} <span class="leise">· {doppel || mannschaft ? T.konk.arten[k.einst.art] + ' · ' : ''}{T.konk.modi[k.einst.modus]} · {mannschaft ? T.mannschaft.anzahl(n) : doppel ? T.konk.paare(n) : T.konk.teilnehmer(n)}</span></span>
    <span class="marke">{T.konk.status[istRundenModus(k.einst.modus) && k.status === 'gruppen' ? 'runden' : k.status]}</span>
  </summary>

  {#if bearbeiten}
    <KonkurrenzForm start={k.einst} {gestartet} endrundeGestartet={k.gestartet.ko} mitMeldungen={n > 0} auswahl={angeboten(z)} knopf={T.konk.speichern} {speichern} abbrechen={() => (bearbeiten = false)} />
  {:else}
    <div class="reihe">
      <button class="zweit klein" onclick={() => (bearbeiten = true)}>{T.tspieler.bearbeiten}</button>
      {#if !hatErgebnisse}<button class="gefahr klein" onclick={loeschen}>{T.konk.entfernen}</button>{/if}
    </div>
  {/if}
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}

  {#if !gestartet}
    <KonkurrenzMeldungen {z} {k} {poolListe} {eintragen} />

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
      {#if klassenTrennung}
        <p class="leise">{T.konk.trennungWahl[k.einst.klassenTrennung]}: {klassenListe.map((kl) => `${kl.name} (${kl.mitglieder.length})`).join(' · ')}</p>
      {:else if k.einst.modus === 'gruppen_ko' || k.einst.modus === 'gruppen_platz'}
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
          {#if istRundenModus(k.einst.modus)}<p class="leise">{T.konk.startlisteText}</p>{/if}
          <AuslosungVorschau {z} gruppen={k.auslosungGruppen!.gruppen} startliste={istRundenModus(k.einst.modus)} klassen={klassenTrennung ? gruppenKlassen(z, k, k.auslosungGruppen!.gruppen) : null} tauschen={tauschenGruppen} />
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

    {#if platzPlan}
      <h3>{T.konk.platzRunde}<Hilfe text={T.konk.aufsteigerPlatzHilfe} /></h3>
      <p class="leise">{T.konk.platzRundeText}</p>
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

    <KonkurrenzMeldungen {z} {k} {poolListe} {eintragen} />

    {#if aendernArt}
      <details class="aendern" data-testid="auslosung-aendern">
        <summary>{T.konk.aendern}</summary>
        <p class="leise">{T.konk.aendernHilfe}</p>
        {#if aendernFehler}<div class="meldung fehler" role="alert">{aendernFehler}</div>{/if}
        {#if aendernArt === 'gruppen'}
          <AuslosungVorschau {z} gruppen={k.gruppen.map((g) => g.mitglieder)} tauschen={laufendTauschenGruppen} gesperrt={festeTeilnehmer} verschieben />
        {:else if k.auslosungKo}
          <AuslosungVorschau {z} plaetze={k.auslosungKo.plaetze} tauschen={laufendTauschenKo} gesperrt={festeTeilnehmer} />
        {/if}
      </details>
    {/if}

    {#if !stufeMitErgebnis}
      <div class="reihe" style="margin-top:16px"><button class="zweit klein" onclick={zuruecknehmen}>{T.konk.zurueck}</button></div>
    {/if}
  {/if}
</details>

<style>
  .konk summary { font-size: 1.05rem; }
  .konk summary > span:first-child { overflow-wrap: anywhere; }
  h3 { margin-top: 18px; display: flex; align-items: center; gap: 6px; }
  h4 { margin: 10px 0 4px; }
  .setzliste { list-style: none; padding: 0; margin: 0; }
  .setzliste li { display: flex; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--linie); }
  .nr { width: 2rem; font-variant-numeric: tabular-nums; color: var(--leise); }
  .knoepfe { margin: 12px 0; }
  .aendern { margin-top: 16px; }
  .aendern summary { font-weight: 700; }
  .start { margin-top: 16px; background: var(--gruen); }
</style>
