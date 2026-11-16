<script lang="ts">
  import { ART, type PoolSpieler } from '@shared/protokoll';
  import { T } from '../../texte';
  import { auslosungErstellen, endrundeErstellen, gruppenKlassen, gruppenZahlVorschlag, klassenDerMeldungen, name, nameLang, qualifikanten, teilnehmerDaten, zulassungsHinweise } from '../../engine/abfragen';
  import { setzreihe } from '../../engine/auslosung';
  import { kurzId } from '../../engine/ids';
  import { gruppenName, spielerName, type KonkurrenzEinstellungen, type KonkurrenzZustand } from '../../engine/modell';
  import { mischen, zufallAus } from '../../engine/zufall';
  import { neuerZufallswert } from '../../engine/zufall';
  import {
    auslosungAktuell,
    begonnen,
    erstePhase,
    gruppenAenderungPruefen,
    koPlaetzePruefen,
    nachmeldePlaetzeKo,
    teilnehmerVon,
    zurueckgezogen,
    type TurnierZustand,
  } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';
  import AuslosungVorschau from './AuslosungVorschau.svelte';
  import { istRundenModus } from '../../engine/runden';
  import KonkurrenzForm from './KonkurrenzForm.svelte';
  import { alsEineAktion } from '../../aktion';

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
  const reihe = $derived(setzreihe(k.meldungen, teilnehmerDaten(z, k), k.einst, k.setzliste));
  const doppel = $derived(k.einst.art !== 'einzel');
  /** Spieler, die in dieser Konkurrenz noch in keinem Paar stehen */
  const freieSpieler = $derived(z.spielerReihe.filter((id) => !teilnehmerVon(k, id)));
  let paar1 = $state('');
  let paar2 = $state('');
  const quali = $derived(k.einst.modus === 'gruppen_ko' && k.gestartet.gruppen && !k.gestartet.ko ? qualifikanten(k) : null);
  const aktive = $derived(k.meldungen.filter((id) => !zurueckgezogen(k).includes(id)));
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
    await alsEineAktion(async () => {
      for (const id of z.spielerReihe) if (!k.meldungen.includes(id)) await melden(id, true);
    });
  }
  async function paarMelden(a: string, b: string) {
    if (!a || !b || a === b) return;
    if (k.einst.art === 'mixed') {
      const ga = z.spieler[a]?.geschlecht;
      const gb = z.spieler[b]?.geschlecht;
      if (ga && gb && ga === gb && ga !== 'd') {
        fehler = T.konk.mixedFalsch;
        return;
      }
    }
    await los(ART.paarGemeldet, { konkurrenz: k.id, id: 'p-' + kurzId(), spieler: [a, b] });
    paar1 = '';
    paar2 = '';
  }
  /** Übrige Spieler zufällig zu Paaren losen; Mixed: Frau + Mann, soweit bekannt */
  function paareLosen() {
    return alsEineAktion(paareLosenIntern);
  }
  async function paareLosenIntern() {
    const zuf = zufallAus(neuerZufallswert());
    let frei = mischen(freieSpieler, zuf);
    if (k.einst.art === 'mixed') {
      const w = frei.filter((id) => z.spieler[id]!.geschlecht === 'w');
      const m = frei.filter((id) => z.spieler[id]!.geschlecht === 'm');
      const rest = frei.filter((id) => !w.includes(id) && !m.includes(id));
      const paare: [string, string][] = [];
      while (w.length && m.length) paare.push([w.shift()!, m.shift()!]);
      frei = [...w, ...m, ...rest];
      for (const [a, b] of paare) await paarMelden(a, b);
    }
    for (let i = 0; i + 1 < frei.length; i += 2) await paarMelden(frei[i]!, frei[i + 1]!);
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
  /* ---------- Laufendes Turnier: Nachmelden und Auslosung ändern ---------- */
  const rundenModus = $derived(istRundenModus(k.einst.modus));
  /** Nachmelden geht in Gruppen (bis zur Endrunde), im K.-o. auf Freilose, in Runden-Systemen immer */
  const nachmeldenArt = $derived<'gruppe' | 'ko' | 'runde' | null>(
    !gestartet || k.status === 'beendet' ? null : rundenModus ? 'runde' : k.gestartet.ko ? (phase1 === 'ko' ? 'ko' : null) : 'gruppe',
  );
  const koFrei = $derived(nachmeldenArt === 'ko' ? nachmeldePlaetzeKo(k) : []);
  let nachWer = $state('');
  let nachWer2 = $state('');
  let nachGruppe = $state<number | null>(null);
  let nachPlatz = $state<number | null>(null);
  let nachHinweis = $state('');
  const kleinsteGruppe = $derived(k.gruppen.length ? k.gruppen.reduce((m, g) => (g.mitglieder.length < k.gruppen[m]!.mitglieder.length ? g.nr : m), 0) : 0);
  function gegnerVonPlatz(i: number) {
    const p = k.auslosungKo?.plaetze ?? [];
    const g = p[i % 2 ? i - 1 : i + 1];
    return g ? name(z, g) : T.konk.freilos;
  }
  async function nachmelden() {
    nachHinweis = '';
    const ort = nachmeldenArt === 'gruppe' ? { gruppe: nachGruppe ?? kleinsteGruppe } : nachmeldenArt === 'ko' ? { platz: nachPlatz ?? koFrei[0] } : {};
    if (doppel) {
      if (!nachWer || !nachWer2 || nachWer === nachWer2) return;
      await los(ART.paarGemeldet, { konkurrenz: k.id, id: 'p-' + kurzId(), spieler: [nachWer, nachWer2], ...ort });
      nachHinweis = T.konk.nachmeldenFertig(`${spielerName(z.spieler[nachWer])} / ${spielerName(z.spieler[nachWer2])}`);
    } else {
      if (!nachWer) return;
      await los(ART.teilnehmerGemeldet, { konkurrenz: k.id, id: nachWer, ...ort });
      nachHinweis = T.konk.nachmeldenFertig(spielerName(z.spieler[nachWer]));
    }
    nachWer = '';
    nachWer2 = '';
    nachPlatz = null;
  }

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
    !gestartet || k.status === 'beendet' || rundenModus ? null : k.gestartet.ko ? 'ko' : phase1 === 'gruppen' && k.gruppen.length > 1 ? 'gruppen' : null,
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

<details class="karte konk" open={k.status !== 'beendet'} data-testid="konkurrenz">
  <summary>
    <span>{k.einst.name} <span class="leise">· {doppel ? T.konk.arten[k.einst.art] + ' · ' : ''}{T.konk.modi[k.einst.modus]} · {doppel ? T.konk.paare(n) : T.konk.teilnehmer(n)}</span></span>
    <span class="marke">{T.konk.status[istRundenModus(k.einst.modus) && k.status === 'gruppen' ? 'runden' : k.status]}</span>
  </summary>

  {#if bearbeiten}
    <KonkurrenzForm start={k.einst} {gestartet} mitMeldungen={n > 0} knopf={T.konk.speichern} {speichern} abbrechen={() => (bearbeiten = false)} />
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
    {:else if doppel}
      <p class="leise">{T.konk.paarHinweis}</p>
      {#if k.meldungen.length}
        <ul class="meldeliste">
          {#each k.meldungen as pid (pid)}
            <li class="reihe">
              <span class="wachsen">{nameLang(z, pid, k)} <span class="leise">{teilnehmerDaten(z, k)[pid]?.verein ?? ''}{teilnehmerDaten(z, k)[pid]?.ttr ? ` · ${teilnehmerDaten(z, k)[pid]!.ttr}` : ''}</span></span>
              <button class="zweit klein" aria-label="{nameLang(z, pid, k)}: {T.app.entfernen}" onclick={() => melden(pid, false)}>✕</button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if freieSpieler.length >= 2}
        <div class="paar-form">
          <select bind:value={paar1} aria-label={T.konk.paarErster}>
            <option value="">{T.konk.paarErster}</option>
            {#each freieSpieler.filter((id) => id !== paar2) as id (id)}<option value={id}>{spielerName(z.spieler[id])}{z.spieler[id]!.geschlecht ? ` (${z.spieler[id]!.geschlecht})` : ''}</option>{/each}
          </select>
          <select bind:value={paar2} aria-label={T.konk.paarZweiter}>
            <option value="">{T.konk.paarZweiter}</option>
            {#each freieSpieler.filter((id) => id !== paar1) as id (id)}<option value={id}>{spielerName(z.spieler[id])}{z.spieler[id]!.geschlecht ? ` (${z.spieler[id]!.geschlecht})` : ''}</option>{/each}
          </select>
          <button class="zweit" disabled={!paar1 || !paar2} onclick={() => paarMelden(paar1, paar2)} data-testid="paar-melden">{T.konk.paarMelden}</button>
        </div>
        <div class="reihe"><button class="zweit klein" onclick={paareLosen}>{T.konk.paarZufall}</button><Hilfe text={T.konk.paarZufallHilfe} /></div>
      {/if}
    {:else}
      <div class="reihe"><button class="zweit klein" onclick={alleMelden}>{T.konk.alleMelden}</button></div>
      <ul class="meldeliste">
        {#each z.spielerReihe as id (id)}
          {@const h = zulassungsHinweise(daten(id), k.einst.zulassung)}
          <!-- Einzel -->
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
      {#if klassenTrennung}
        <p class="leise">{T.konk.trennungWahl[k.einst.klassenTrennung]}: {klassenListe.map((kl) => `${kl.name} (${kl.mitglieder.length})`).join(' · ')}</p>
      {:else if k.einst.modus === 'gruppen_ko'}
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

    {#if nachmeldenArt}
      <h3>{T.konk.nachmelden}<Hilfe text={T.konk.nachmeldenHilfe} /></h3>
      {#if freieSpieler.length === 0 || (doppel && freieSpieler.length < 2)}
        <p class="leise">{T.konk.nachmeldenKeine}</p>
      {:else if nachmeldenArt === 'ko' && koFrei.length === 0}
        <p class="leise">{T.konk.nachmeldenKeinPlatz}</p>
      {:else}
        <div class="nach-form" data-testid="nachmelden">
          <div>
            <label for="nw-{k.id}">{doppel ? T.konk.paarErster : T.konk.nachmeldenWer}</label>
            <select id="nw-{k.id}" bind:value={nachWer}>
              <option value="">–</option>
              {#each freieSpieler.filter((id) => id !== nachWer2) as id (id)}<option value={id}>{spielerName(z.spieler[id])}</option>{/each}
            </select>
          </div>
          {#if doppel}
            <div>
              <label for="nw2-{k.id}">{T.konk.paarZweiter}</label>
              <select id="nw2-{k.id}" bind:value={nachWer2}>
                <option value="">–</option>
                {#each freieSpieler.filter((id) => id !== nachWer) as id (id)}<option value={id}>{spielerName(z.spieler[id])}</option>{/each}
              </select>
            </div>
          {/if}
          {#if nachmeldenArt === 'gruppe'}
            <div>
              <label for="ng-{k.id}">{T.konk.nachmeldenGruppe}</label>
              <select id="ng-{k.id}" value={nachGruppe ?? kleinsteGruppe} onchange={(e) => (nachGruppe = Number(e.currentTarget.value))}>
                {#each k.gruppen as g (g.nr)}<option value={g.nr}>{T.konk.gruppe(gruppenName(g.nr))} ({g.mitglieder.length})</option>{/each}
              </select>
            </div>
          {:else if nachmeldenArt === 'ko'}
            <div>
              <label for="np-{k.id}">{T.konk.nachmeldenPlatz}</label>
              <select id="np-{k.id}" value={nachPlatz ?? koFrei[0]} onchange={(e) => (nachPlatz = Number(e.currentTarget.value))}>
                {#each koFrei as i (i)}<option value={i}>{T.konk.nachmeldenPlatzGegen(i, gegnerVonPlatz(i))}</option>{/each}
              </select>
            </div>
          {/if}
          <button class="zweit" disabled={!nachWer || (doppel && !nachWer2)} onclick={nachmelden} data-testid="nachmelden-knopf">{T.konk.nachmeldenKnopf}</button>
        </div>
        {#if nachmeldenArt === 'runde'}<p class="leise">{T.konk.nachmeldenRunde}</p>{/if}
      {/if}
      {#if nachHinweis}<p class="meldung ok" role="status">{nachHinweis}</p>{/if}
    {/if}

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
  h3 { margin-top: 18px; display: flex; align-items: center; gap: 6px; }
  .haken { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; margin: 0; padding: 8px 0; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; margin-top: 1px; }
  .meldeliste { list-style: none; padding: 0; margin: 8px 0; max-height: 26rem; overflow-y: auto; }
  .meldeliste li.reihe { padding: 6px 0; border-bottom: 1px solid var(--linie); }
  .paar-form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: end; margin: 8px 0; }
  @media (max-width: 560px) {
    .paar-form { grid-template-columns: 1fr; }
  }
  .meldeliste li { border-bottom: 1px solid var(--linie); }
  .marke.warn { color: var(--orange); border-color: var(--orange); margin-left: 6px; white-space: normal; }
  .setzliste { list-style: none; padding: 0; margin: 0; }
  .setzliste li { display: flex; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--linie); }
  .nr { width: 2rem; font-variant-numeric: tabular-nums; color: var(--leise); }
  .knoepfe { margin: 12px 0; }
  .nach-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 8px; align-items: end; margin: 8px 0; }
  .aendern { margin-top: 16px; }
  .aendern summary { font-weight: 700; }
  .start { margin-top: 16px; background: var(--gruen); }
</style>
