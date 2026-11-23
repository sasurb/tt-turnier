<script lang="ts">
  import { seiteVon } from '../../engine/zustand';
  import { ART, type Aufgabe, type Rolle } from '@shared/protokoll';
  import { T } from '../../texte';
  import { name, vorgabeVon } from '../../engine/abfragen';
  import { istRundenModus } from '../../engine/runden';
  import { ergebnisText, ergebnisWerten, gewinnSaetze, satzAusVerliererpunkten } from '../../engine/ergebnis';
  import { einstFuer, festeSaetzeVon, type ErgebnisEingabe, type ErgebnisEintrag, type KonkurrenzZustand, type Seite, type Spiel } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';

  let {
    z,
    k,
    spiel,
    rolle,
    ich,
    helfer = false,
    aufgaben = [],
    eintragen,
    schliessen,
    namen = null,
    seite = undefined,
    untertitel = null,
  }: {
    z: TurnierZustand;
    k: KonkurrenzZustand;
    spiel: Spiel;
    rolle: Rolle;
    ich: string | null;
    /** Spieler mit Helfer-Recht: fremde Spiele amtlich, eigene wie ein Spieler */
    helfer?: boolean;
    /** Aufgaben der Helferkennung (Ergebnisse, Oberschiedsrichter …); Leitung hat alle */
    aufgaben?: readonly Aufgabe[];
    eintragen: (art: string, daten: Record<string, unknown>) => Promise<unknown>;
    schliessen: () => void;
    /** Teilspiel einer Mannschafts-Begegnung: Anzeigenamen der Seiten (Spieler) statt der Teilnehmer */
    namen?: [string, string] | null;
    /** Teilspiel: eigene Seite (null = nicht beteiligt); fehlt = aus der Meldung ermitteln */
    seite?: Seite | null;
    untertitel?: string | null;
  } = $props();

  const leitung = $derived(rolle === 'leitung' || rolle === 'admin' || rolle === 'veranstalter');
  const meineSeite = $derived<Seite | null>(seite !== undefined ? seite : rolle === 'spieler' ? seiteVon(k, spiel, ich) : null);
  /** Anfechtungen entscheiden und Ergebnisse löschen: Leitung und Oberschiedsrichter */
  const entscheidet = $derived(leitung || aufgaben.includes('oberschiri'));
  const amtlich = $derived(leitung || (rolle === 'helfer' && (aufgaben.includes('ergebnisse') || aufgaben.includes('oberschiri'))) || (helfer && meineSeite === null));
  const darf = $derived(amtlich || meineSeite !== null);
  const nurSaetze = $derived(k.einst.eingabe === 'saetze');
  /** Feste Satzzahl (Schweizer/Cup): alle Sätze werden gespielt, Unentschieden möglich */
  const feste = $derived(festeSaetzeVon(k.einst));
  /** Gewinnsätze dieses Spiels (zweite Stufe ggf. abweichend) */
  const bestOf = $derived(einstFuer(k, spiel).bestOf);
  const gewinn = $derived(gewinnSaetze(bestOf));
  const vorgabe = $derived(namen ? null : vorgabeVon(z, k, spiel));
  const nameA = $derived((namen ? namen[0] : name(z, spiel.a)) + (meineSeite === 'a' ? ` (${T.erg.du})` : ''));
  const nameB = $derived((namen ? namen[1] : name(z, spiel.b)) + (meineSeite === 'b' ? ` (${T.erg.du})` : ''));
  const kannEintragen = $derived(darf && (spiel.status === 'offen' || spiel.status === 'gespielt') && !spiel.gestrichen && !spiel.gesperrt && !(spiel.kampflosDurchRueckzug && !spiel.eintrag));

  // Formular
  type Zeile = { gewinner: Seite | null; verlierer: string };
  // svelte-ignore state_referenced_locally
  const vorlage = spiel.eintrag?.eingabe;
  let art = $state<'normal' | 'kampflos' | 'aufgabe'>(vorlage?.kampflos ? 'kampflos' : vorlage?.aufgabe ? 'aufgabe' : 'normal');
  let zeilen = $state<Zeile[]>(
    vorlage?.saetze?.map(([a, b]) => ({ gewinner: a > b ? 'a' : 'b', verlierer: String(Math.min(a, b)) })) ?? [{ gewinner: null, verlierer: '' }],
  );
  let stand = $state<[number, number] | null>(vorlage?.stand ?? null);
  let wer = $state<Seite | null>(vorlage?.kampflos ?? vorlage?.aufgabe ?? null);
  let laufendA = $state(String(vorlage?.laufend?.[0] ?? ''));
  let laufendB = $state(String(vorlage?.laufend?.[1] ?? ''));
  // svelte-ignore state_referenced_locally
  let formOffen = $state(!spiel.eintrag);
  let fehler = $state('');
  let sendet = $state(false);

  function saetzeAusZeilen(): [number, number][] {
    const l: [number, number][] = [];
    for (const z of zeilen) {
      if (!z.gewinner || z.verlierer === '') break;
      const v = Number(z.verlierer);
      if (!Number.isInteger(v) || v < 0) break;
      l.push(satzAusVerliererpunkten(z.gewinner, v));
    }
    return l;
  }

  const eingabe = $derived.by((): ErgebnisEingabe => {
    if (art === 'kampflos') return wer ? { kampflos: wer } : {};
    if (art === 'aufgabe') {
      if (!wer) return {};
      if (nurSaetze) return { aufgabe: wer, stand: stand ?? [0, 0] };
      return { aufgabe: wer, saetze: saetzeAusZeilen(), laufend: [Number(laufendA) || 0, Number(laufendB) || 0] };
    }
    return nurSaetze ? (stand ? { stand } : {}) : { saetze: saetzeAusZeilen() };
  });
  const wertung = $derived(ergebnisWerten(eingabe, bestOf, k.einst.eingabe, feste));

  /** Wie viele Satzzeilen zeigen: bis entschieden, höchstens Best of */
  const satzStand = $derived.by(() => {
    let a = 0;
    let b = 0;
    for (const s of saetzeAusZeilen()) s[0] > s[1] ? a++ : b++;
    return [a, b] as const;
  });
  $effect(() => {
    if (art !== 'normal' && art !== 'aufgabe') return;
    const voll = zeilen.every((z) => z.gewinner && z.verlierer !== '');
    const entschieden = feste ? saetzeAusZeilen().length >= feste : satzStand[0] >= gewinn || satzStand[1] >= gewinn;
    if (voll && !entschieden && zeilen.length < (feste ?? bestOf)) zeilen.push({ gewinner: null, verlierer: '' });
    // überflüssige leere Zeilen nach der Entscheidung entfernen
    if (entschieden && zeilen.length > saetzeAusZeilen().length) zeilen = zeilen.slice(0, saetzeAusZeilen().length);
  });

  const standWahl = $derived.by(() => {
    const l: [number, number][] = [];
    if (feste) {
      for (let a = feste; a >= 0; a--) l.push([a, feste - a]);
      return l;
    }
    for (let v = 0; v < gewinn; v++) l.push([gewinn, v]);
    for (let v = gewinn - 1; v >= 0; v--) l.push([v, gewinn]);
    return l;
  });

  /** Satzstand im Moment der Aufgabe: beide noch unter der Gewinnzahl */
  const standAufgabe = $derived.by(() => {
    const l: [number, number][] = [];
    if (feste) {
      for (let a = 0; a < feste; a++) for (let b = 0; a + b < feste; b++) l.push([a, b]);
      return l;
    }
    for (let a = 0; a < gewinn; a++) for (let b = 0; b < gewinn; b++) l.push([a, b]);
    return l;
  });

  async function senden(art: string, daten: Record<string, unknown>) {
    fehler = '';
    sendet = true;
    try {
      await eintragen(art, { konkurrenz: k.id, spiel: spiel.id, ...daten });
      schliessen();
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    } finally {
      sendet = false;
    }
  }

  function speichern(e: SubmitEvent) {
    e.preventDefault();
    if (!wertung.ok) {
      fehler = wertung.fehler;
      return;
    }
    void senden(ART.spielErgebnis, { a: spiel.a, b: spiel.b, ergebnis: $state.snapshot(eingabe) });
  }

  function zeit(iso: string) {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  function vonText(x: ErgebnisEintrag) {
    return T.erg.von(x.von?.name ?? '–', zeit(x.zeit));
  }

  let dialog: HTMLDialogElement | undefined = $state();
  $effect(() => {
    dialog?.showModal();
  });

  const gegnerHatEingetragen = $derived(!!spiel.eintrag && !spiel.eintrag.amtlich && meineSeite !== null && spiel.eintrag.seite !== meineSeite);
</script>

<dialog bind:this={dialog} onclose={schliessen} aria-labelledby="erg-titel">
  <div class="kopf">
    <div>
      <div class="leise">{untertitel ?? k.einst.name}</div>
      <h2 id="erg-titel">{nameA} <span class="leise">–</span> {nameB}</h2>
      {#if vorgabe}<p class="vorgabe" data-testid="vorgabe">{T.spiele.vorgabe(name(z, vorgabe.seite === 'a' ? spiel.a : spiel.b), vorgabe.punkte)}</p>{/if}
    </div>
    <button class="zweit klein" onclick={() => dialog?.close()} aria-label={T.app.schliessen}>✕</button>
  </div>

  {#if spiel.ergebnis}
    <div class="aktuell">
      <strong class="gross">{ergebnisText(spiel.ergebnis)}</strong>
      {#if spiel.stand}<span class="marke stand-{spiel.stand}">{T.spiele[spiel.stand]}</span>{/if}
      {#if spiel.kampflosDurchRueckzug}<span class="marke">{T.spiele.kampflosRueckzug}</span>{/if}
      {#if spiel.gestrichen}<span class="marke">{T.spiele.gestrichen}</span>{/if}
      {#if spiel.eintrag}<div class="leise">{vonText(spiel.eintrag)}</div>{/if}
      {#if spiel.angefochtenVon}<div class="leise">{T.erg.angefochtenVon(spiel.angefochtenVon.name)}</div>{/if}
    </div>
  {/if}

  {#if entscheidet && spiel.alternativen.length}
    <p>{T.erg.entscheidenText}</p>
    <ul class="liste">
      {#each spiel.alternativen as alt (alt.ereignis)}
        <li class="reihe zwischen">
          <span><strong>{ergebnisText(alt.ergebnis)}</strong><br /><span class="leise">{vonText(alt)}</span></span>
          <button class="klein" disabled={sendet} onclick={() => senden(ART.spielEntschieden, { ereignis: alt.ereignis })}>{T.erg.entscheiden}</button>
        </li>
      {/each}
    </ul>
  {:else if entscheidet && spiel.stand === 'angefochten' && spiel.eintrag}
    <p>{T.erg.entscheidenText}</p>
    <button class="breit" disabled={sendet} onclick={() => senden(ART.spielEntschieden, { ereignis: spiel.eintrag!.ereignis })}>{T.erg.entscheiden}: {ergebnisText(spiel.eintrag.ergebnis)}</button>
  {/if}

  {#if gegnerHatEingetragen && spiel.stand === 'eingetragen' && !formOffen}
    <div class="stapel">
      <button class="breit" disabled={sendet} onclick={() => senden(ART.spielBestaetigt, { ereignis: spiel.eintrag!.ereignis })}>{T.erg.bestaetigen}</button>
      <p class="leise">{T.erg.anfechtenText}</p>
      <div class="reihe">
        <button class="zweit" onclick={() => (formOffen = true)}>{T.spiele.eintragen}</button>
        <button
          class="gefahr"
          disabled={sendet}
          onclick={() => confirm(T.erg.anfechtenFrage) && senden(ART.spielAngefochten, { ereignis: spiel.eintrag!.ereignis })}>{T.erg.anfechten}</button
        >
      </div>
    </div>
  {:else if meineSeite && spiel.eintrag?.amtlich && spiel.stand === 'bestaetigt'}
    <p class="meldung info">{T.erg.leitungHat}</p>
  {:else if !darf && rolle === 'spieler'}
    <p class="meldung info">{T.erg.nurEigene}</p>
  {:else if !darf && rolle === 'helfer'}
    <p class="meldung info">{T.aufgaben.keineErgebnisse}</p>
  {:else if kannEintragen && !formOffen}
    <button class="zweit breit" onclick={() => (formOffen = true)}>{T.spiele.eintragen}</button>
  {/if}

  {#if kannEintragen && formOffen}
    <form onsubmit={speichern}>
      <div class="arten" role="radiogroup" aria-label="Art">
        {#each ['normal', 'kampflos', 'aufgabe'] as const as a (a)}
          <button type="button" role="radio" aria-checked={art === a} class="chip" class:aktiv={art === a} onclick={() => (art = a)}>{T.erg.art[a]}</button>
        {/each}
      </div>

      {#if art !== 'normal'}
        <fieldset>
          <legend>{art === 'kampflos' ? T.erg.werKampflos : T.erg.werAufgabe}</legend>
          <div class="seiten">
            <button type="button" class="chip" class:aktiv={wer === 'a'} aria-pressed={wer === 'a'} onclick={() => (wer = 'a')}>{nameA}</button>
            <button type="button" class="chip" class:aktiv={wer === 'b'} aria-pressed={wer === 'b'} onclick={() => (wer = 'b')}>{nameB}</button>
          </div>
        </fieldset>
        {#if spiel.phase === 'gruppen' && k.einst.rueckzug === 'wo' && !istRundenModus(k.einst.modus)}<p class="leise">{T.erg.woHinweis}</p>{/if}
      {/if}

      {#if art !== 'kampflos'}
        {#if nurSaetze}
          <fieldset>
            <legend>{T.erg.stand}{art === 'aufgabe' ? ' bei Aufgabe' : ''}</legend>
            <div class="stand-wahl">
              {#each art === 'aufgabe' ? standAufgabe : standWahl as s (s.join(':'))}
                <button type="button" class="chip" class:aktiv={stand?.[0] === s[0] && stand?.[1] === s[1]} onclick={() => (stand = s)}>{s[0]}:{s[1]}</button>
              {/each}
            </div>
          </fieldset>
        {:else}
          <p class="leise">{T.erg.verliererHilfe}</p>
          {#if feste}<p class="leise" data-testid="feste-hinweis">{T.erg.festText(feste)}</p>{/if}
          {#each zeilen as zeile, i (i)}
            <div class="satz" data-testid="satz-{i + 1}">
              <span class="satz-nr">{T.erg.satz(i + 1)}</span>
              <div class="seiten" role="radiogroup" aria-label="{T.erg.satzGewinner} {i + 1}">
                <button type="button" role="radio" class="chip" class:aktiv={zeile.gewinner === 'a'} aria-checked={zeile.gewinner === 'a'} onclick={() => (zeile.gewinner = 'a')}>{name(z, spiel.a)}</button>
                <button type="button" role="radio" class="chip" class:aktiv={zeile.gewinner === 'b'} aria-checked={zeile.gewinner === 'b'} onclick={() => (zeile.gewinner = 'b')}>{name(z, spiel.b)}</button>
              </div>
              <input
                class="punkte"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="2"
                aria-label="{T.erg.verliererPunkte} {T.erg.satz(i + 1)}"
                placeholder={T.erg.verliererPunkte}
                bind:value={zeile.verlierer}
                oninput={(e) => (zeile.verlierer = e.currentTarget.value.replace(/\D/g, ''))}
              />
              {#if zeile.gewinner && zeile.verlierer !== ''}
                {@const s = satzAusVerliererpunkten(zeile.gewinner, Number(zeile.verlierer))}
                <span class="satz-erg">{s[0]}:{s[1]}</span>
              {/if}
              {#if zeilen.length > 1 && i === zeilen.length - 1}
                <button type="button" class="zweit klein" aria-label={T.erg.satzEntfernen} onclick={() => (zeilen = zeilen.slice(0, -1))}>✕</button>
              {/if}
            </div>
          {/each}
          {#if art === 'aufgabe'}
            <fieldset>
              <legend>{T.erg.laufend}</legend>
              <div class="reihe">
                <input class="punkte" inputmode="numeric" aria-label="{T.erg.laufend} {name(z, spiel.a)}" bind:value={laufendA} placeholder={name(z, spiel.a)} />
                <span>:</span>
                <input class="punkte" inputmode="numeric" aria-label="{T.erg.laufend} {name(z, spiel.b)}" bind:value={laufendB} placeholder={name(z, spiel.b)} />
              </div>
            </fieldset>
          {/if}
        {/if}
      {/if}

      <div class="vorschau" aria-live="polite">
        {#if wertung.ok}
          <strong>{ergebnisText(wertung.ergebnis)}</strong> – {wertung.ergebnis.gewinner === null ? T.erg.unentschieden : T.erg.gewinnt(wertung.ergebnis.gewinner === 'a' ? name(z, spiel.a) : name(z, spiel.b))}
        {:else}
          <span class="leise">{wertung.fehler}</span>
        {/if}
      </div>
      {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
      <button type="submit" class="breit" disabled={!wertung.ok || sendet}>{T.erg.speichern}</button>
    </form>
  {/if}

  {#if entscheidet && spiel.eintrag}
    <button class="gefahr breit unten" disabled={sendet} onclick={() => confirm(T.erg.zuruecksetzenFrage) && senden(ART.spielZurueckgesetzt, {})}>{T.erg.zuruecksetzen}</button>
  {/if}
  {#if fehler && !formOffen}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
</dialog>

<style>
  dialog {
    width: min(34rem, 100vw);
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
  .kopf { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
  .kopf h2 { margin: 0; overflow-wrap: anywhere; }
  .aktuell { padding: 10px 12px; border-radius: 10px; background: var(--grund); margin-bottom: 12px; }
  .gross { font-size: 1.15rem; margin-right: 8px; }
  .arten, .seiten, .stand-wahl { display: flex; gap: 8px; flex-wrap: wrap; }
  .arten { margin: 4px 0 8px; }
  .chip {
    min-height: 44px;
    background: var(--grund);
    color: var(--text);
    border: 2px solid var(--linie);
    font-weight: 600;
    padding: 6px 14px;
    flex: 1 1 auto;
  }
  .chip:hover { background: var(--grund); border-color: var(--blau); }
  .chip.aktiv { background: color-mix(in srgb, var(--blau) 14%, var(--flaeche)); border-color: var(--blau); color: var(--blau); }
  .satz { display: grid; grid-template-columns: 4.2rem 1fr 5.5rem auto auto; gap: 8px; align-items: center; margin-bottom: 10px; }
  .satz .seiten { flex-wrap: nowrap; }
  .satz .chip { padding: 6px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  @media (max-width: 480px) {
    .satz { grid-template-columns: 1fr 4.5rem auto auto; }
    .satz-nr { grid-column: 1 / -1; font-weight: 600; }
    .satz .seiten { grid-column: 1 / 2; }
  }
  .satz-erg { font-variant-numeric: tabular-nums; color: var(--leise); }
  input.punkte { text-align: center; font-size: 1.2rem; padding: 8px; max-width: 6rem; }
  .vorschau { margin: 14px 0 10px; padding: 10px 12px; border-radius: 10px; border: 1px dashed var(--linie); }
  .zwischen { justify-content: space-between; }
  .unten { margin-top: 14px; }
  .marke.stand-angefochten, .marke.stand-konflikt { color: var(--rot); border-color: var(--rot); }
  .marke.stand-bestaetigt { color: var(--gruen); border-color: var(--gruen); }
  .vorgabe { margin: 4px 0 0; font-weight: 600; color: var(--blau); }
</style>
