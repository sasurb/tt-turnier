<script lang="ts">
  /**
   * Teilnehmer einer Konkurrenz: Meldungen (Einzel, Paare, Mannschaften) vor dem Start,
   * Nachmelden und Zurückziehen im laufenden Betrieb. Wird im Reiter „Teilnehmer“ (je Konkurrenz
   * ein Abschnitt, mit Liste) und in der Konkurrenz-Karte unter „Konkurrenzen“ benutzt.
   */
  import MannschaftenMeldung from './MannschaftenMeldung.svelte';
  import { systemVon } from '../../engine/mannschaft';
  import { ART, type PoolSpieler } from '@shared/protokoll';
  import { T } from '../../texte';
  import { name, nameLang, teilnehmerDaten, zulassungsHinweise } from '../../engine/abfragen';
  import { kurzId } from '../../engine/ids';
  import { gruppenName, spielerName, type KonkurrenzZustand } from '../../engine/modell';
  import { mischen, zufallAus, neuerZufallswert } from '../../engine/zufall';
  import { begonnen, erstePhase, nachmeldePlaetzeKo, teilnehmerVon, zurueckgezogen, type TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';
  import { istRundenModus } from '../../engine/runden';
  import { alsEineAktion } from '../../aktion';

  let {
    z,
    k,
    poolListe,
    eintragen,
    liste = false,
  }: {
    z: TurnierZustand;
    k: KonkurrenzZustand;
    poolListe: PoolSpieler[];
    eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown>;
    /** Im Reiter „Teilnehmer“: laufende Konkurrenzen zeigen auch die Liste der Teilnehmer */
    liste?: boolean;
  } = $props();

  let fehler = $state('');
  let suche = $state('');
  let nurGemeldet = $state(false);
  let rueckzugWer = $state('');

  const gestartet = $derived(begonnen(k));
  const phase1 = $derived(erstePhase(k));
  const n = $derived(k.meldungen.length);
  const doppel = $derived(k.einst.art === 'doppel' || k.einst.art === 'mixed');
  const mannschaft = $derived(k.einst.art === 'mannschaft');
  /** Spieler, die in dieser Konkurrenz noch nicht mitspielen (auch in keinem Paar) */
  const freieSpieler = $derived(z.spielerReihe.filter((id) => !teilnehmerVon(k, id)));
  const raus = $derived(new Set(zurueckgezogen(k)));
  const aktive = $derived(k.meldungen.filter((id) => !raus.has(id)));
  const td = $derived(teilnehmerDaten(z, k));
  let paar1 = $state('');
  let paar2 = $state('');

  /** Suche ab 9 Spielern, damit lange Listen bedienbar bleiben */
  const mitSuche = $derived(z.spielerReihe.length > 8);
  const sichtbar = $derived(
    z.spielerReihe.filter((id) => {
      if (nurGemeldet && !k.meldungen.includes(id)) return false;
      const q = suche.trim().toLowerCase();
      const s = z.spieler[id]!;
      return !q || `${s.vorname} ${s.nachname} ${s.verein}`.toLowerCase().includes(q);
    }),
  );

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
    return alsEineAktion(async () => {
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
    });
  }

  /* ---------- Laufender Betrieb: Nachmelden und Zurückziehen ---------- */
  const rundenModus = $derived(istRundenModus(k.einst.modus));
  /** Nachmelden geht in Gruppen (bis zur Endrunde), im K.-o. auf Freilose, in Runden-Systemen immer */
  const nachmeldenArt = $derived<'gruppe' | 'ko' | 'runde' | null>(
    !gestartet || k.status === 'beendet' || mannschaft ? null : rundenModus ? 'runde' : k.gestartet.ko ? (phase1 === 'ko' ? 'ko' : null) : 'gruppe',
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
  async function zurueckziehen() {
    if (rueckzugWer && confirm(T.konk.rueckzugFrage(name(z, rueckzugWer)))) {
      await los(ART.teilnehmerAbgemeldet, { konkurrenz: k.id, id: rueckzugWer });
      rueckzugWer = '';
    }
  }
</script>

{#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}

{#if !gestartet}
  <h3>{T.konk.meldungen} <span class="leise">({n})</span></h3>
  {#if z.spielerReihe.length === 0}
    <p class="leise">{T.konk.keineSpieler}</p>
  {:else if mannschaft}
    <p class="leise">{systemVon(k.einst).name}</p>
    <MannschaftenMeldung {z} {k} {eintragen} />
  {:else if doppel}
    <p class="leise">{T.konk.paarHinweis}</p>
    {#if k.meldungen.length}
      <ul class="meldeliste">
        {#each k.meldungen as pid (pid)}
          <li class="reihe">
            <span class="wachsen">{nameLang(z, pid, k)} <span class="leise">{td[pid]?.verein ?? ''}{td[pid]?.ttr ? ` · ${td[pid]!.ttr}` : ''}</span></span>
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
    <div class="reihe">
      <button class="zweit klein" onclick={alleMelden} disabled={freieSpieler.length === 0}>{T.konk.alleMelden}</button>
      {#if mitSuche}
        <label class="haken klein-haken"><input type="checkbox" bind:checked={nurGemeldet} />{T.konk.nurGemeldet}</label>
      {/if}
    </div>
    {#if mitSuche}<input type="search" bind:value={suche} placeholder={T.tspieler.suchen} aria-label="{T.tspieler.suchen}: {k.einst.name}" />{/if}
    <ul class="meldeliste">
      {#each sichtbar as id (id)}
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
      {:else}
        <li class="leise leer">{T.konk.keineTreffer}</li>
      {/each}
    </ul>
  {/if}
{:else}
  {#if liste}
    <h3>{mannschaft ? T.mannschaft.anzahl(n) : doppel ? T.konk.paare(n) : T.konk.teilnehmer(n)}</h3>
    <ol class="meldeliste nummeriert" data-testid="teilnehmerliste">
      {#each k.meldungen as id (id)}
        <li class:raus={raus.has(id)}>
          <span class="wachsen">{nameLang(z, id, k)} <span class="leise">{td[id]?.verein ?? ''}{td[id]?.ttr ? ` · ${td[id]!.ttr}` : ''}</span></span>
          {#if raus.has(id)}<span class="marke">{T.konk.zurueckgezogen}</span>{/if}
        </li>
      {/each}
    </ol>
  {/if}

  {#if mannschaft}
    <details class="aendern">
      <summary>{T.mannschaft.bearbeitenTitel} ({T.mannschaft.anzahl(n)})</summary>
      <MannschaftenMeldung {z} {k} {eintragen} />
    </details>
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
          <label for="nw-{k.id}{liste ? '-t' : ''}">{doppel ? T.konk.paarErster : T.konk.nachmeldenWer}</label>
          <select id="nw-{k.id}{liste ? '-t' : ''}" bind:value={nachWer}>
            <option value="">–</option>
            {#each freieSpieler.filter((id) => id !== nachWer2) as id (id)}<option value={id}>{spielerName(z.spieler[id])}</option>{/each}
          </select>
        </div>
        {#if doppel}
          <div>
            <label for="nw2-{k.id}{liste ? '-t' : ''}">{T.konk.paarZweiter}</label>
            <select id="nw2-{k.id}{liste ? '-t' : ''}" bind:value={nachWer2}>
              <option value="">–</option>
              {#each freieSpieler.filter((id) => id !== nachWer) as id (id)}<option value={id}>{spielerName(z.spieler[id])}</option>{/each}
            </select>
          </div>
        {/if}
        {#if nachmeldenArt === 'gruppe'}
          <div>
            <label for="ng-{k.id}{liste ? '-t' : ''}">{T.konk.nachmeldenGruppe}</label>
            <select id="ng-{k.id}{liste ? '-t' : ''}" value={nachGruppe ?? kleinsteGruppe} onchange={(e) => (nachGruppe = Number(e.currentTarget.value))}>
              {#each k.gruppen as g (g.nr)}<option value={g.nr}>{T.konk.gruppe(gruppenName(g.nr))} ({g.mitglieder.length})</option>{/each}
            </select>
          </div>
        {:else if nachmeldenArt === 'ko'}
          <div>
            <label for="np-{k.id}{liste ? '-t' : ''}">{T.konk.nachmeldenPlatz}</label>
            <select id="np-{k.id}{liste ? '-t' : ''}" value={nachPlatz ?? koFrei[0]} onchange={(e) => (nachPlatz = Number(e.currentTarget.value))}>
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
{/if}

<style>
  h3 { margin-top: 18px; display: flex; align-items: center; gap: 6px; }
  .haken { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; margin: 0; padding: 8px 0; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; margin-top: 1px; }
  .klein-haken { align-items: center; min-height: 44px; padding: 0; }
  .meldeliste { list-style: none; padding: 0; margin: 8px 0; max-height: 26rem; overflow-y: auto; }
  .meldeliste li { border-bottom: 1px solid var(--linie); }
  .meldeliste li.reihe { padding: 6px 0; }
  .meldeliste li.leer { padding: 10px 0; border: 0; }
  .nummeriert { list-style: decimal; padding-left: 2.2rem; }
  .nummeriert li { padding: 8px 0; }
  .nummeriert li > * { vertical-align: middle; }
  .nummeriert li.raus .wachsen { text-decoration: line-through; opacity: 0.7; }
  .nummeriert .marke { margin-left: 8px; }
  .paar-form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: end; margin: 8px 0; }
  @media (max-width: 560px) {
    .paar-form { grid-template-columns: 1fr; }
  }
  .marke.warn { color: var(--orange); border-color: var(--orange); margin-left: 6px; white-space: normal; }
  .nach-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 8px; align-items: end; margin: 8px 0; }
  .aendern { margin-top: 16px; }
  .aendern summary { font-weight: 700; }
</style>
