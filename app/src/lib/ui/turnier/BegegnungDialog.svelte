<script lang="ts">
  import { ART, type Aufgabe, type Rolle } from '@shared/protokoll';
  import { T } from '../../texte';
  import { linkZu } from '../../router.svelte';
  import { name } from '../../engine/abfragen';
  import { ergebnisText } from '../../engine/ergebnis';
  import { einstFuer, spielerName, type KonkurrenzZustand, type Seite, type Spiel } from '../../engine/modell';
  import { aufstellungenKomplett, begegnungAuswerten, folgeFuer, positionsName, systemVon, teileVon, zwischenstand, type TeilSpiel } from '../../engine/mannschaft';
  import type { TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';
  import ErgebnisDialog from './ErgebnisDialog.svelte';

  /**
   * Begegnung zweier Mannschaften: Aufstellungen (verdeckt, bis beide abgegeben haben), Teilspiele mit
   * Ergebnissen, Losentscheid und Spielbericht.
   */
  let {
    z,
    k,
    spiel,
    turnierId,
    rolle,
    ich,
    helfer = false,
    aufgaben = [],
    eintragen,
    schliessen,
  }: {
    z: TurnierZustand;
    k: KonkurrenzZustand;
    spiel: Spiel;
    turnierId: string;
    rolle: Rolle;
    ich: string | null;
    helfer?: boolean;
    aufgaben?: readonly Aufgabe[];
    eintragen: (art: string, daten: Record<string, unknown>) => Promise<unknown>;
    schliessen: () => void;
  } = $props();

  const leitung = $derived(rolle === 'leitung' || rolle === 'admin' || rolle === 'veranstalter');
  const sys = $derived(systemVon(einstFuer(k, spiel)));
  const teams = $derived({ a: spiel.a ? k.mannschaften[spiel.a] : undefined, b: spiel.b ? k.mannschaften[spiel.b] : undefined });
  /** Eigene Mannschaft (Spielerkennung) */
  // ab 0.18 gehört auch die Begleitperson (Führung ohne eigene Meldung) zur Mannschaft
  const gehoert = (m: (typeof teams)['a'], x: string) => !!m && (m.spieler.includes(x) || m.fuehrer === x);
  const meineSeite = $derived<Seite | null>(ich ? (gehoert(teams.a, ich) ? 'a' : gehoert(teams.b, ich) ? 'b' : null) : null);
  const mEinst = $derived(einstFuer(k, spiel).mannschaft);
  const amtlich = $derived(leitung || (rolle === 'helfer' && (aufgaben.includes('ergebnisse') || aufgaben.includes('oberschiri'))) || (helfer && meineSeite === null));
  const fuehrung = $derived(!!ich && meineSeite !== null && teams[meineSeite]?.fuehrer === ich);
  const daten = $derived(k.begegnungen[spiel.id]);
  const komplett = $derived(aufstellungenKomplett(k, spiel));
  const teile = $derived(teileVon(k, spiel));
  const st = $derived(zwischenstand(teile));
  const losNoetig = $derived(begegnungAuswerten(k, spiel).losNoetig);
  const spielbar = $derived(spiel.status === 'offen' || spiel.status === 'gespielt');

  function aufstellungVon(s: Seite) {
    const id = s === 'a' ? spiel.a : spiel.b;
    return id ? daten?.aufstellung[id] : undefined;
  }
  /** Aufstellung sehen: Leitung, eigene Mannschaft, alle sobald beide abgegeben haben */
  const sichtbar = (s: Seite) => leitung || komplett || meineSeite === s;
  /** Aufstellung abgeben/ändern */
  const darfAufstellen = (s: Seite) => spielbar && (leitung || ((amtlich || (fuehrung && meineSeite === s)) && !komplett));

  // ---------- Aufstellungsformular ----------
  let form = $state<Seite | null>(null);
  let einzel = $state<string[]>([]);
  let doppel = $state<[string, string][]>([]);
  /** Wechsel je Teilspiel (ab 0.18): Nummer → Spieler ('' = wie aufgestellt) */
  let wechsel = $state<Record<string, string>>({});
  let fehler = $state('');
  const wechselTeile = $derived(form && mEinst?.wechsel ? folgeFuer(sys, form === 'a' ? { einzel: einzel.map((x) => x || null) } : undefined, form === 'b' ? { einzel: einzel.map((x) => x || null) } : undefined).map((f, i) => ({ ...f, nr: i + 1 })).filter((f) => f.art === 'einzel') : []);
  let hinweis = $state('');
  function formOeffnen(s: Seite) {
    const a = aufstellungVon(s);
    einzel = Array.from({ length: sys.einzel }, (_, i) => a?.einzel[i] ?? '');
    doppel = Array.from({ length: sys.doppel }, (_, i) => [a?.doppel[i]?.[0] ?? '', a?.doppel[i]?.[1] ?? ''] as [string, string]);
    wechsel = { ...(a?.wechsel ?? {}) };
    fehler = '';
    hinweis = '';
    form = s;
  }
  async function aufstellungSenden(e: SubmitEvent) {
    e.preventDefault();
    if (!form) return;
    const team = form === 'a' ? spiel.a : spiel.b;
    const voll = einzel.filter(Boolean);
    const ersatz = mEinst?.ersatz ?? 0;
    if (voll.length - new Set(voll).size > ersatz || voll.some((x) => voll.filter((y) => y === x).length > 2)) {
      fehler = ersatz ? T.mannschaft.ersatzZuViel(ersatz) : T.mannschaft.doppeltEinzel;
      return;
    }
    const w = Object.fromEntries(Object.entries(wechsel).filter(([nr, x]) => !!x && wechselTeile.some((t) => String(t.nr) === nr)));
    const imDoppel = doppel.flat().filter(Boolean);
    if (new Set(imDoppel).size !== imDoppel.length || doppel.some(([x, y]) => x && x === y)) {
      fehler = T.mannschaft.doppeltDoppel;
      return;
    }
    try {
      await eintragen(ART.mannschaftAufgestellt, {
        konkurrenz: k.id,
        spiel: spiel.id,
        mannschaft: team,
        gegner: form === 'a' ? spiel.b : spiel.a,
        einzel: einzel.map((x) => x || null),
        doppel: doppel.map(([x, y]) => (x && y ? [x, y] : null)),
        ...(Object.keys(w).length ? { wechsel: w } : {}),
      });
      // Wer nicht zur Mannschaft gehört (Helfer), sieht die Aufstellung erst nach dem Aufdecken wieder
      hinweis = !leitung && meineSeite !== form && !komplett ? T.mannschaft.gespeichertVerdeckt : T.mannschaft.gespeichert;
      form = null;
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    }
  }

  // ---------- Teilspiele ----------
  let teilOffen = $state<number | null>(null);
  const offenesTeil = $derived(teilOffen ? teile[teilOffen - 1] : undefined);
  function namenVon(t: TeilSpiel, s: Seite): string {
    const ids = s === 'a' ? t.a : t.b;
    if (!ids.length) return positionsName(sys, t.art, s, s === 'a' ? t.posA : t.posB);
    return ids.map((id) => spielerName(z.spieler[id])).join(' / ');
  }
  /** Eigene Seite im Teilspiel: wer selbst spielt oder die Mannschaft führt */
  function seiteIm(t: TeilSpiel): Seite | null {
    if (!ich || leitung) return null;
    if (t.a.includes(ich) || (meineSeite === 'a' && fuehrung)) return 'a';
    if (t.b.includes(ich) || (meineSeite === 'b' && fuehrung)) return 'b';
    return null;
  }
  const darfTeil = (t: TeilSpiel) => amtlich || seiteIm(t) !== null;
  function pseudo(t: TeilSpiel): Spiel {
    return {
      ...spiel,
      id: t.id,
      status: t.status === 'offen' || t.status === 'gespielt' || (t.status === 'entfallen' && t.a.length > 0 && t.b.length > 0) ? (t.eintrag ? 'gespielt' : 'offen') : 'wartet',
      ergebnis: t.ergebnis,
      stand: t.stand,
      eintrag: t.eintrag,
      alternativen: t.alternativen,
      angefochtenVon: t.angefochtenVon,
      gewinner: t.gewinner,
      gestrichen: false,
      gesperrt: false,
      kampflosDurchRueckzug: null,
    };
  }

  async function losen(sieger: string) {
    if (!confirm(T.mannschaft.losFrage(name(z, sieger, k)))) return;
    await eintragen(ART.mannschaftLos, { konkurrenz: k.id, spiel: spiel.id, sieger });
  }
  async function zuruecksetzen() {
    if (!confirm(T.mannschaft.zuruecksetzenFrage)) return;
    await eintragen(ART.spielZurueckgesetzt, { konkurrenz: k.id, spiel: spiel.id });
  }

  let dialog: HTMLDialogElement | undefined = $state();
  $effect(() => {
    dialog?.showModal();
  });
</script>

<dialog bind:this={dialog} onclose={schliessen} aria-labelledby="beg-titel" data-testid="begegnung">
  <div class="kopf">
    <div>
      <div class="leise">{k.einst.name} · {sys.name}</div>
      <h2 id="beg-titel">{name(z, spiel.a, k)} <span class="leise">–</span> {name(z, spiel.b, k)}</h2>
      <p class="stand" data-testid="begegnung-stand"><strong>{T.mannschaft.stand(st.siegeA, st.siegeB)}</strong>{#if spiel.ergebnis} · {ergebnisText(spiel.ergebnis)}{/if}</p>
    </div>
    <button class="zweit klein" onclick={() => dialog?.close()} aria-label={T.app.schliessen}>✕</button>
  </div>
  {#if hinweis}<div class="meldung ok" role="status">{hinweis}</div>{/if}

  <h3>{T.mannschaft.aufstellung}<Hilfe text={T.mannschaft.aufstellungHilfe} /></h3>
  <div class="aufstellungen">
    {#each ['a', 'b'] as const as s (s)}
      {@const a = aufstellungVon(s)}
      <div class="auf" data-testid="aufstellung-{s}">
        <strong>{name(z, s === 'a' ? spiel.a : spiel.b, k)}</strong>
        <span class="leise">
          {#if a && sichtbar(s)}{T.mannschaft.abgegeben}{:else if a}{T.mannschaft.verdeckt}{:else if !leitung && meineSeite !== s && !komplett}{T.mannschaft.nochVerdeckt}{:else}{T.mannschaft.fehlt}{/if}
        </span>
        {#if a && sichtbar(s)}
          <ol class="pos">
            {#each a.einzel as id, i (i)}<li><span class="leise">{positionsName(sys, 'einzel', s, i + 1)}</span> {id ? spielerName(z.spieler[id]) : T.mannschaft.leer}</li>{/each}
            {#each a.doppel as d, i (i)}<li><span class="leise">D{i + 1}</span> {d ? d.map((x) => spielerName(z.spieler[x])).join(' / ') : T.mannschaft.leer}</li>{/each}
          </ol>
        {/if}
        {#if darfAufstellen(s) && form !== s}
          <button class="zweit klein" onclick={() => formOeffnen(s)} data-testid="aufstellen-{s}">{a ? T.mannschaft.aendern : T.mannschaft.abgeben}</button>
        {/if}
      </div>
    {/each}
  </div>

  {#if form}
    {@const team = form === 'a' ? teams.a : teams.b}
    <form class="aufform" onsubmit={aufstellungSenden} data-testid="aufstellung-form">
      <h4>{T.mannschaft.aufstellungAbgeben(team?.name ?? '')}</h4>
      {#if sys.id === 'braunschweig'}<p class="leise">{T.mannschaft.braunschweigHinweis}</p>{/if}
      {#each einzel as _, i (i)}
        <label class="zeile"><span class="pos-name">{positionsName(sys, 'einzel', form, i + 1)}</span>
          <select bind:value={einzel[i]} aria-label="{T.mannschaft.position} {positionsName(sys, 'einzel', form, i + 1)}">
            <option value="">{T.mannschaft.leer}</option>
            {#each team?.spieler ?? [] as id (id)}<option value={id}>{spielerName(z.spieler[id])}</option>{/each}
          </select>
        </label>
      {/each}
      {#each doppel as _, i (i)}
        <div class="zeile"><span class="pos-name">D{i + 1}</span>
          {#each [0, 1] as j (j)}
            <select bind:value={doppel[i]![j]} aria-label="{T.mannschaft.doppel(i + 1)}, {j + 1}">
              <option value="">{T.mannschaft.leer}</option>
              {#each team?.spieler ?? [] as id (id)}<option value={id}>{spielerName(z.spieler[id])}</option>{/each}
            </select>
          {/each}
        </div>
      {/each}
      {#if mEinst?.ersatz}<p class="leise">{T.mannschaft.ersatzWahl(mEinst.ersatz)}</p>{/if}
      {#if wechselTeile.length}
        <details class="wechsel" data-testid="wechsel-teile">
          <summary>{T.mannschaft.wechselTitel}</summary>
          {#each wechselTeile as t (t.nr)}
            {@const pos = form === 'a' ? t.a : t.b}
            <label class="zeile"><span class="pos-name">{T.mannschaft.wechselSpiel(t.nr, positionsName(sys, 'einzel', form, pos))}</span>
              <select bind:value={wechsel[String(t.nr)]} aria-label={T.mannschaft.wechselSpiel(t.nr, positionsName(sys, 'einzel', form, pos))}>
                <option value="">{T.mannschaft.wechselKeiner}</option>
                {#each team?.spieler ?? [] as id (id)}<option value={id}>{spielerName(z.spieler[id])}</option>{/each}
              </select>
            </label>
          {/each}
        </details>
      {/if}
      {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
      <div class="reihe">
        <button type="submit" data-testid="aufstellung-senden">{T.mannschaft.abgeben}</button>
        <button type="button" class="zweit" onclick={() => (form = null)}>{T.app.abbrechen}</button>
      </div>
    </form>
  {/if}

  <h3>{T.mannschaft.spiele}</h3>
  <ol class="teile" data-testid="teilspiele">
    {#each teile as t (t.id)}
      <li class:fertig={!!t.ergebnis}>
        <button class="teil" disabled={!darfTeil(t) || (t.status !== 'offen' && t.status !== 'gespielt')} onclick={() => (teilOffen = t.nr)} data-testid="teil">
          <span class="nr">{t.nr}</span>
          <span class="wer">
            <span class="leise">{positionsName(sys, t.art, 'a', t.posA)}–{positionsName(sys, t.art, 'b', t.posB)}</span>
            <span><span class:sieger={t.gewinner === 'a'}>{komplett || leitung ? namenVon(t, 'a') : '…'}</span> – <span class:sieger={t.gewinner === 'b'}>{komplett || leitung ? namenVon(t, 'b') : '…'}</span></span>
          </span>
          <span class="erg">
            {#if t.ergebnis}<strong>{ergebnisText(t.ergebnis)}</strong>{:else}<span class="leise">{T.mannschaft.status[t.status]}</span>{/if}
            {#if t.stand === 'eingetragen'}<span class="marke">{T.spiele.eingetragen}</span>{:else if t.stand === 'angefochten' || t.stand === 'konflikt'}<span class="marke warn">{T.spiele[t.stand]}</span>{/if}
          </span>
        </button>
      </li>
    {/each}
  </ol>

  {#if losNoetig}
    <div class="meldung info" role="status">
      {T.mannschaft.losNoetig}
      {#if leitung}
        <div class="reihe">
          {#each [spiel.a, spiel.b] as id (id)}{#if id}<button class="zweit" onclick={() => losen(id)}>{T.mannschaft.losSieger(name(z, id, k))}</button>{/if}{/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="reihe fuss">
    <a class="knopf zweit" href={linkZu(`druck/${turnierId}/spielbericht/${encodeURIComponent(`${k.id}~${spiel.id}`)}`)}>{T.mannschaft.spielbericht}</a>
    {#if (leitung || aufgaben.includes('oberschiri')) && daten && Object.keys(daten.teile).length}
      <button class="gefahr" onclick={zuruecksetzen}>{T.mannschaft.zuruecksetzen}</button>
    {/if}
  </div>
</dialog>

{#if offenesTeil}
  <ErgebnisDialog
    {z}
    {k}
    spiel={pseudo(offenesTeil)}
    {rolle}
    {ich}
    helfer={helfer && meineSeite === null}
    {aufgaben}
    {eintragen}
    namen={[namenVon(offenesTeil, 'a'), namenVon(offenesTeil, 'b')]}
    seite={seiteIm(offenesTeil)}
    untertitel={`${name(z, spiel.a, k)} – ${name(z, spiel.b, k)} · ${T.mannschaft.spielNr(offenesTeil.nr)}`}
    schliessen={() => (teilOffen = null)}
  />
{/if}

<style>
  dialog {
    width: min(40rem, 100vw);
    max-height: 100dvh;
    border: 0;
    border-radius: var(--radius);
    padding: var(--abstand);
    background: var(--flaeche);
    color: var(--text);
    box-shadow: 0 10px 40px rgb(0 0 0 / 30%);
  }
  dialog::backdrop { background: rgb(0 0 0 / 45%); }
  @media (max-width: 600px) {
    dialog { margin: auto 0 0; width: 100vw; max-width: 100vw; border-radius: var(--radius) var(--radius) 0 0; padding-bottom: calc(var(--abstand) + env(safe-area-inset-bottom)); }
  }
  .kopf { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .kopf h2 { margin: 0; overflow-wrap: anywhere; }
  .stand { margin: 4px 0 0; font-variant-numeric: tabular-nums; }
  h3 { display: flex; align-items: center; gap: 4px; margin: 16px 0 8px; }
  .aufstellungen { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 480px) {
    .aufstellungen { grid-template-columns: 1fr; }
  }
  .auf { background: var(--grund); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
  .pos { margin: 4px 0; padding-left: 0; list-style: none; }
  .aufform { margin: 12px 0; padding: 12px; border: 1px solid var(--linie); border-radius: 10px; }
  .aufform h4 { margin: 0 0 8px; }
  .zeile { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; font-weight: 400; }
  .zeile select { flex: 1; min-width: 0; }
  .pos-name { width: 2.5rem; flex: none; font-weight: 700; }
  .teile { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .teil { width: 100%; display: grid; grid-template-columns: 2rem 1fr auto; gap: 8px; align-items: center; text-align: left; background: var(--flaeche); color: var(--text); border: 1px solid var(--linie); border-radius: 10px; padding: 8px 10px; font-weight: 400; min-height: 44px; }
  .teil:disabled { opacity: 1; cursor: default; }
  .fertig .teil { background: var(--grund); }
  .nr { font-weight: 700; color: var(--leise); }
  .wer { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
  .erg { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-variant-numeric: tabular-nums; text-align: right; }
  .sieger { color: var(--gruen); font-weight: 700; }
  .marke.warn { color: var(--orange-text); border-color: var(--orange); }
  .fuss { margin-top: 16px; }
</style>
