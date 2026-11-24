<script lang="ts">
  import { ALLE_AUFGABEN, HELFER_STANDARD, type Aufgabe, type CodeEintrag, type CodeRolle } from '@shared/protokoll';
  import { T } from '../../texte';
  import { api } from '../../dienste';
  import { codeAnzeige } from '../../code';
  import { kurzId } from '../../engine/ids';
  import { spielerName } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';
  import QrCode from './QrCode.svelte';
  import Hilfe from '../Hilfe.svelte';
  import { appBasis } from '../../zentrale.svelte';
  import KontoZugaenge from './KontoZugaenge.svelte';

  /**
   * Zugänge eines Online-Turniers: je Person eine 8-stellige Kennung.
   * Drei aufklappbare Abschnitte: Turnierleitung, Helfer, Spieler. Ein Spieler kann zusätzlich
   * Helfer sein („Aus Spielern wählen“) – er behält seine eine Kennung.
   */
  let { z, id, token, turnierName }: { z: TurnierZustand; id: string; token: string; turnierName: string } = $props();

  let codes = $state<CodeEintrag[]>([]);
  let fehler = $state('');
  let laedt = $state(true);
  let qrOffen = $state<string | null>(null);
  let kopiert = $state<string | null>(null);
  let leitungName = $state('');
  let helferName = $state('');
  let vorlage = $state(0);
  let aufgabenHinweis = $state('');
  let ausSpielern = $state(false);
  let spielerSuche = $state('');
  let spielerWahl = $state('');
  let offen = $state<{ leitung: boolean; helfer: boolean; spieler: boolean }>({ leitung: true, helfer: false, spieler: false });

  const basis = appBasis();
  const link = (c: string) => `${basis}#/c/${id}/${c}`;
  const leitungen = $derived(codes.filter((c) => c.rolle === 'leitung'));
  const helfer = $derived(codes.filter((c) => c.rolle === 'helfer'));
  const spielerHelfer = $derived(codes.filter((c) => c.rolle === 'spieler' && c.helfer));
  const spielerCodes = $derived(z.spielerReihe.map((sid) => ({ sid, c: codes.find((c) => c.rolle === 'spieler' && c.bezug === sid) })));
  const spielerOhneHelfer = $derived(
    z.spielerReihe
      .filter((sid) => !codes.some((c) => c.rolle === 'spieler' && c.bezug === sid && c.helfer))
      .map((sid) => ({ sid, name: spielerName(z.spieler[sid]) }))
      .filter((x) => !spielerSuche.trim() || x.name.toLowerCase().includes(spielerSuche.trim().toLowerCase())),
  );
  const letzteLeitung = $derived(leitungen.filter((c) => !c.gesperrt).length <= 1);

  async function laden() {
    try {
      codes = (await api.codes(token, id)).codes;
      fehler = '';
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    } finally {
      laedt = false;
    }
  }

  // Fehlende Spielerkennungen anlegen und geänderte Namen nachziehen
  let abgleich = '';
  $effect(() => {
    if (laedt) return;
    const soll = z.spielerReihe.map((sid) => ({ rolle: 'spieler' as const, bezug: sid, name: spielerName(z.spieler[sid]) }));
    const fehlt = soll.filter((s) => !codes.some((c) => c.rolle === 'spieler' && c.bezug === s.bezug && c.name === s.name));
    const schluessel = JSON.stringify(fehlt);
    if (!fehlt.length || schluessel === abgleich) return;
    abgleich = schluessel;
    api
      .codesAnlegen(token, id, fehlt)
      .then((a) => (codes = a.codes))
      .catch((x) => (fehler = x instanceof Error ? x.message : String(x)));
  });

  $effect(() => {
    void laden();
  });

  function ersetzen(c: CodeEintrag) {
    codes = codes.map((x) => (x.rolle === c.rolle && x.bezug === c.bezug ? c : x));
  }
  function melden(x: unknown) {
    fehler = x instanceof Error ? x.message : String(x);
  }
  async function neu(rolle: CodeRolle, bezug: string) {
    if (!confirm(T.codes.neuFrage)) return;
    try {
      ersetzen((await api.codeNeu(token, id, rolle, bezug)).code);
    } catch (x) {
      melden(x);
    }
  }
  async function sperren(c: CodeEintrag) {
    try {
      ersetzen((await api.codeSperren(token, id, c.rolle, c.bezug, !c.gesperrt)).code);
    } catch (x) {
      melden(x);
    }
  }
  async function anlegen(rolle: 'leitung' | 'helfer', n: string) {
    if (!n.trim()) return;
    try {
      const aufgaben = rolle === 'helfer' ? [...T.aufgaben.vorlagen[vorlage]!.aufgaben] : undefined;
      codes = (await api.codesAnlegen(token, id, [{ rolle, bezug: (rolle === 'leitung' ? 'l-' : 'h-') + kurzId(), name: n.trim(), ...(aufgaben ? { aufgaben } : {}) }])).codes;
      if (rolle === 'leitung') leitungName = '';
      else helferName = '';
    } catch (x) {
      melden(x);
    }
  }
  async function entfernen(c: CodeEintrag) {
    if (!confirm(T.codes.entfernenFrage)) return;
    try {
      await api.codeEntfernen(token, id, c.rolle, c.bezug);
      codes = codes.filter((x) => !(x.rolle === c.rolle && x.bezug === c.bezug));
    } catch (x) {
      melden(x);
    }
  }
  async function helferRecht(bezug: string, an: boolean) {
    if (!an && !confirm(T.codes.helferRechtFrage)) return;
    try {
      ersetzen((await api.codeHelfer(token, id, bezug, an)).code);
      spielerWahl = '';
      spielerSuche = '';
    } catch (x) {
      melden(x);
    }
  }
  /** Aufgabe einer Helferkennung an- oder abschalten (gilt sofort) */
  async function aufgabeUmschalten(c: CodeEintrag, a: Aufgabe) {
    const alt = c.aufgaben ?? [...HELFER_STANDARD];
    const neu = alt.includes(a) ? alt.filter((x) => x !== a) : [...alt, a];
    if (!neu.length) {
      aufgabenHinweis = T.aufgaben.mindestensEine;
      return;
    }
    try {
      ersetzen((await api.codeAufgaben(token, id, c.bezug, ALLE_AUFGABEN.filter((x) => neu.includes(x)))).code);
      aufgabenHinweis = T.aufgaben.geaendert;
    } catch (x) {
      melden(x);
    }
  }
  async function kopieren(c: string) {
    try {
      await navigator.clipboard.writeText(link(c));
      kopiert = c;
      setTimeout(() => (kopiert = null), 2000);
    } catch {
      prompt(T.codes.kopieren, link(c));
    }
  }
  function drucken(was: 'leitung' | 'helfer' | 'spieler' | 'alle') {
    druckAuswahl = was;
    setTimeout(() => print(), 50);
  }
  let druckAuswahl = $state<'leitung' | 'helfer' | 'spieler' | 'alle'>('alle');
  const druckZettel = $derived(
    [
      ...(druckAuswahl === 'alle' || druckAuswahl === 'leitung' ? leitungen.map((c) => ({ titel: `${c.name} (${T.codes.leitung})`, c })) : []),
      ...(druckAuswahl === 'alle' || druckAuswahl === 'helfer'
        ? [
            ...helfer.map((c) => ({ titel: `${c.name} (${(c.aufgaben ?? HELFER_STANDARD).map((a) => T.aufgaben.namen[a]).join(', ')})`, c })),
            ...spielerHelfer.map((c) => ({ titel: `${c.name} (${T.zugang.spielerHelfer})`, c })),
          ]
        : []),
      ...(druckAuswahl === 'alle' || druckAuswahl === 'spieler'
        ? spielerCodes.filter((x) => x.c && !x.c.helfer).map((x) => ({ titel: spielerName(z.spieler[x.sid]), c: x.c! }))
        : []),
    ].filter((e) => !e.c.gesperrt),
  );
</script>

{#snippet zeile(c: CodeEintrag | undefined, titel: string, entfernbar: boolean, zusatz: string | null = null)}
  <li class="code-zeile" class:gesperrt={c?.gesperrt}>
    <div class="oben">
      <span class="wachsen"><strong>{titel}</strong>{#if zusatz}<span class="marke">{zusatz}</span>{/if}</span>
      {#if c}
        <strong class="code" data-testid="code">{codeAnzeige(c.code)}</strong>
        {#if c.gesperrt}<span class="marke">{T.codes.gesperrt}</span>{/if}
      {:else}
        <span class="leise">…</span>
      {/if}
    </div>
    {#if c}
      <div class="reihe knoepfe">
        <button class="zweit klein" aria-expanded={qrOffen === c.code} onclick={() => (qrOffen = qrOffen === c.code ? null : c.code)}>{T.codes.qr}</button>
        <button class="zweit klein" onclick={() => kopieren(c.code)}>{kopiert === c.code ? T.codes.kopiert : T.codes.kopieren}</button>
        <button class="zweit klein" onclick={() => neu(c.rolle, c.bezug)}>{T.codes.neu}</button>
        <button class="zweit klein" disabled={c.rolle === 'leitung' && !c.gesperrt && letzteLeitung} title={c.rolle === 'leitung' && letzteLeitung ? T.codes.leitungLetzte : undefined} onclick={() => sperren(c)}>{c.gesperrt ? T.codes.entsperren : T.codes.sperren}</button>
        {#if entfernbar}<button class="gefahr klein" disabled={c.rolle === 'leitung' && letzteLeitung} onclick={() => entfernen(c)}>{T.codes.entfernen}</button>{/if}
        {#if c.rolle === 'spieler' && c.helfer}<button class="gefahr klein" onclick={() => helferRecht(c.bezug, false)}>{T.codes.helferRechtEntfernen}</button>{/if}
      </div>
      {#if c.rolle === 'helfer'}
        <div class="aufgaben" role="group" aria-label={T.aufgaben.titel} data-testid="aufgaben">
          <span class="leise">{T.aufgaben.titel}:</span>
          {#each ALLE_AUFGABEN as a (a)}
            {@const an = (c.aufgaben ?? HELFER_STANDARD).includes(a)}
            <button class="chip" class:aktiv={an} aria-pressed={an} onclick={() => aufgabeUmschalten(c, a)}>{an ? '✓ ' : ''}{T.aufgaben.namen[a]}</button>
          {/each}
        </div>
      {/if}
      {#if qrOffen === c.code}
        <div class="qr-gross"><QrCode text={link(c.code)} groesse={220} label="{titel}: {codeAnzeige(c.code)}" /></div>
      {/if}
    {/if}
  </li>
{/snippet}

<p class="leise">{T.codes.text}</p>
{#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
{#if laedt}
  <p class="leise">{T.app.laden}</p>
{:else}
  <details class="karte" bind:open={offen.leitung} data-testid="zugaenge-leitung">
    <summary>{T.codes.leitung} <span class="leise">({T.codes.anzahl(leitungen.length)})</span></summary>
    <p class="leise">{T.codes.leitungText}</p>
    {#if letzteLeitung}<p class="leise">{T.codes.leitungLetzte}</p>{/if}
    <ul class="liste">
      {#each leitungen as c (c.bezug)}
        {@render zeile(c, c.name, true)}
      {/each}
    </ul>
    <form class="reihe" onsubmit={(e) => (e.preventDefault(), anlegen('leitung', leitungName))}>
      <input class="wachsen" bind:value={leitungName} placeholder={T.codes.leitungName} aria-label={T.codes.leitungName} maxlength="120" autocomplete="off" />
      <button type="submit" class="zweit" disabled={!leitungName.trim()}>{T.codes.leitungAnlegen}</button>
    </form>
    {#if leitungen.length}<button class="zweit klein drucken" onclick={() => drucken('leitung')}>{T.codes.drucken}</button>{/if}
    <KontoZugaenge {id} />
  </details>

  <details class="karte" bind:open={offen.helfer} data-testid="zugaenge-helfer">
    <summary>{T.codes.helfer} <span class="leise">({T.codes.anzahl(helfer.length + spielerHelfer.length)})</span></summary>
    <p class="leise">{T.codes.helferText} <Hilfe text={T.aufgaben.hilfe} /></p>
    {#if aufgabenHinweis}<p class="meldung ok" role="status">{aufgabenHinweis}</p>{/if}
    {#if helfer.length || spielerHelfer.length}
      <ul class="liste">
        {#each helfer as c (c.bezug)}
          {@render zeile(c, c.name, true)}
        {/each}
        {#each spielerHelfer as c (c.bezug)}
          {@render zeile(c, c.name, false, T.zugang.spielerHelfer)}
        {/each}
      </ul>
    {/if}
    <label class="haken"><input type="checkbox" bind:checked={ausSpielern} disabled={!z.spielerReihe.length} /> {T.codes.ausSpielern}</label>
    {#if ausSpielern}
      <div class="auswahl">
        <input class="wachsen" bind:value={spielerSuche} placeholder={T.codes.spielerSuchen} aria-label={T.codes.spielerSuchen} autocomplete="off" />
        <select bind:value={spielerWahl} aria-label={T.codes.spielerWahl} size={Math.min(6, Math.max(2, spielerOhneHelfer.length))}>
          {#each spielerOhneHelfer as s (s.sid)}<option value={s.sid}>{s.name}</option>{/each}
        </select>
        <button class="zweit" disabled={!spielerWahl || !codes.some((c) => c.rolle === 'spieler' && c.bezug === spielerWahl)} onclick={() => helferRecht(spielerWahl, true)}>{T.codes.helferAnlegen}</button>
      </div>
    {:else}
      <form class="reihe" onsubmit={(e) => (e.preventDefault(), anlegen('helfer', helferName))}>
        <input class="wachsen" bind:value={helferName} placeholder={T.codes.helferName} aria-label={T.codes.helferName} maxlength="120" autocomplete="off" />
        <select bind:value={vorlage} aria-label={T.aufgaben.vorlage} data-testid="helfer-vorlage">
          {#each T.aufgaben.vorlagen as v, i (v.name)}<option value={i}>{v.name}</option>{/each}
        </select>
        <button type="submit" class="zweit" disabled={!helferName.trim()}>{T.codes.helferAnlegen}</button>
      </form>
    {/if}
    {#if helfer.length || spielerHelfer.length}<button class="zweit klein drucken" onclick={() => drucken('helfer')}>{T.codes.drucken}</button>{/if}
  </details>

  <details class="karte" bind:open={offen.spieler} data-testid="zugaenge-spieler">
    <summary>{T.codes.spieler} <span class="leise">({T.codes.anzahl(z.spielerReihe.length)})</span></summary>
    <p class="leise">{T.codes.spielerText}</p>
    {#if z.spielerReihe.length === 0}
      <p class="leise">{T.codes.leer}</p>
    {:else}
      <div class="reihe">
        <button onclick={() => drucken('spieler')} disabled={spielerCodes.some((x) => !x.c)}>{T.codes.drucken}</button>
        <button class="zweit" onclick={() => drucken('alle')} disabled={spielerCodes.some((x) => !x.c)}>{T.codes.druckenAlle}</button>
      </div>
      <ul class="liste">
        {#each spielerCodes as x (x.sid)}
          {@render zeile(x.c, spielerName(z.spieler[x.sid]), false, x.c?.helfer ? T.codes.helferRecht : null)}
        {/each}
      </ul>
    {/if}
  </details>
{/if}

<!-- Druckbogen: nur beim Drucken sichtbar -->
<div class="druckbogen" aria-hidden="true">
  {#each druckZettel as e (e.c.rolle + e.c.bezug)}
    <div class="zettel">
      <QrCode text={link(e.c.code)} groesse={120} />
      <div>
        <div class="zt">{turnierName}</div>
        <div class="zn">{e.titel}</div>
        <div class="zk">{T.codes.turnierKennung}: {codeAnzeige(id)}</div>
        <div class="zc">{T.codes.deineKennung}: <strong>{codeAnzeige(e.c.code)}</strong></div>
        <div class="zl">{link(e.c.code)}</div>
        <div class="zh">{T.codes.druckText}</div>
      </div>
    </div>
  {/each}
</div>

<style>
  details.karte > summary { font-size: 1.1rem; font-weight: 700; }
  .code-zeile .oben { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .code-zeile .oben .marke { margin-left: 8px; }
  .code { font-family: ui-monospace, monospace; font-size: 1.3rem; letter-spacing: 0.1em; color: var(--blau); }
  .gesperrt .code { text-decoration: line-through; color: var(--leise); }
  .knoepfe { margin-top: 8px; }
  .aufgaben { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
  .chip { min-height: 44px; border-radius: 999px; padding: 0 12px; background: var(--flaeche); color: var(--text); border: 1px solid var(--linie); font-weight: 600; }
  .chip.aktiv { background: var(--blau); color: #fff; border-color: var(--blau); }
  .qr-gross { margin-top: 10px; }
  .drucken { margin-top: 10px; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; margin: 12px 0 6px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .auswahl { display: flex; flex-direction: column; gap: 8px; }
  .auswahl select { min-height: 0; }
  .druckbogen { display: none; }
  @media print {
    :global(body *) { visibility: hidden; }
    .druckbogen, .druckbogen :global(*) { visibility: visible; }
    .druckbogen { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; position: absolute; left: 0; top: 0; width: 100%; padding: 8mm; background: #fff; color: #000; }
    .zettel { display: flex; gap: 4mm; border: 1px dashed #999; padding: 4mm; break-inside: avoid; font-size: 10pt; }
    .zt { font-size: 9pt; color: #444; }
    .zn { font-weight: 700; font-size: 12pt; }
    .zk { font-family: ui-monospace, monospace; font-size: 10pt; margin-top: 2mm; }
    .zc { font-family: ui-monospace, monospace; font-size: 14pt; letter-spacing: 0.08em; margin: 1mm 0 2mm; }
    .zl { font-size: 7pt; word-break: break-all; color: #444; }
    .zh { font-size: 8pt; margin-top: 2mm; }
  }
</style>
