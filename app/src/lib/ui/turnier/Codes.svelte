<script lang="ts">
  import type { CodeEintrag, CodeRolle } from '@shared/protokoll';
  import { T } from '../../texte';
  import { api } from '../../dienste';
  import { codeAnzeige } from '../../code';
  import { kurzId } from '../../engine/ids';
  import { spielerName } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';
  import QrCode from './QrCode.svelte';

  let { z, id, token, turnierName }: { z: TurnierZustand; id: string; token: string; turnierName: string } = $props();

  let codes = $state<CodeEintrag[]>([]);
  let fehler = $state('');
  let laedt = $state(true);
  let qrOffen = $state<string | null>(null);
  let kopiert = $state<string | null>(null);
  let helferName = $state('');

  const basis = `${location.origin}${location.pathname}`;
  const link = (c: string) => `${basis}#/c/${id}/${c}`;
  const spielerCodes = $derived(z.spielerReihe.map((sid) => ({ sid, c: codes.find((c) => c.rolle === 'spieler' && c.bezug === sid) })));
  const helfer = $derived(codes.filter((c) => c.rolle === 'helfer'));

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

  // Fehlende Spieler-Codes anlegen und geänderte Namen nachziehen
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
  async function neu(rolle: CodeRolle, bezug: string) {
    if (!confirm(T.codes.neuFrage)) return;
    try {
      ersetzen((await api.codeNeu(token, id, rolle, bezug)).code);
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    }
  }
  async function sperren(c: CodeEintrag) {
    try {
      ersetzen((await api.codeSperren(token, id, c.rolle, c.bezug, !c.gesperrt)).code);
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    }
  }
  async function helferAnlegen(e: SubmitEvent) {
    e.preventDefault();
    const n = helferName.trim();
    if (!n) return;
    try {
      codes = (await api.codesAnlegen(token, id, [{ rolle: 'helfer', bezug: 'h-' + kurzId(), name: n }])).codes;
      helferName = '';
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    }
  }
  async function helferEntfernen(c: CodeEintrag) {
    if (!confirm(T.codes.entfernenFrage)) return;
    await api.codeEntfernen(token, id, 'helfer', c.bezug);
    codes = codes.filter((x) => !(x.rolle === 'helfer' && x.bezug === c.bezug));
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
</script>

{#snippet zeile(c: CodeEintrag | undefined, titel: string, entfernbar: boolean)}
  <li class="code-zeile" class:gesperrt={c?.gesperrt}>
    <div class="oben">
      <span class="wachsen"><strong>{titel}</strong></span>
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
        <button class="zweit klein" onclick={() => sperren(c)}>{c.gesperrt ? T.codes.entsperren : T.codes.sperren}</button>
        {#if entfernbar}<button class="gefahr klein" onclick={() => helferEntfernen(c)}>{T.codes.entfernen}</button>{/if}
      </div>
      {#if qrOffen === c.code}
        <div class="qr-gross"><QrCode text={link(c.code)} groesse={220} label="{titel}: {codeAnzeige(c.code)}" /></div>
      {/if}
    {/if}
  </li>
{/snippet}

<section class="karte">
  <h2>{T.codes.titel}</h2>
  <p class="leise">{T.codes.text}</p>
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  {#if laedt}
    <p class="leise">{T.app.laden}</p>
  {:else if z.spielerReihe.length === 0}
    <p class="leise">{T.codes.leer}</p>
  {:else}
    <button onclick={() => print()} disabled={spielerCodes.some((x) => !x.c)}>{T.codes.drucken}</button>
    <h3>{T.codes.spieler}</h3>
    <ul class="liste">
      {#each spielerCodes as x (x.sid)}
        {@render zeile(x.c, spielerName(z.spieler[x.sid]), false)}
      {/each}
    </ul>
  {/if}

  <h3>{T.codes.helfer}</h3>
  <p class="leise">{T.codes.helferText}</p>
  {#if helfer.length}
    <ul class="liste">
      {#each helfer as c (c.bezug)}
        {@render zeile(c, c.name, true)}
      {/each}
    </ul>
  {/if}
  <form class="reihe" onsubmit={helferAnlegen}>
    <input class="wachsen" bind:value={helferName} placeholder={T.codes.helferName} aria-label={T.codes.helferName} maxlength="120" />
    <button type="submit" class="zweit" disabled={!helferName.trim()}>{T.codes.helferAnlegen}</button>
  </form>
</section>

<!-- Druckbogen: nur beim Drucken sichtbar -->
<div class="druckbogen" aria-hidden="true">
  {#each [...spielerCodes.filter((x) => x.c && !x.c.gesperrt).map((x) => ({ titel: spielerName(z.spieler[x.sid]), c: x.c! })), ...helfer.filter((c) => !c.gesperrt).map((c) => ({ titel: `${c.name} (${T.codes.helfer})`, c }))] as e (e.c.rolle + e.c.bezug)}
    <div class="zettel">
      <QrCode text={link(e.c.code)} groesse={120} />
      <div>
        <div class="zt">{turnierName}</div>
        <div class="zn">{e.titel}</div>
        <div class="zc">{codeAnzeige(e.c.code)}</div>
        <div class="zl">{link(e.c.code)}</div>
        <div class="zh">{T.codes.druckText}</div>
      </div>
    </div>
  {/each}
</div>

<style>
  h3 { margin-top: 18px; }
  .code-zeile .oben { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .code { font-family: ui-monospace, monospace; font-size: 1.3rem; letter-spacing: 0.1em; color: var(--blau); }
  .gesperrt .code { text-decoration: line-through; color: var(--leise); }
  .knoepfe { margin-top: 8px; }
  .qr-gross { margin-top: 10px; }
  .druckbogen { display: none; }
  @media print {
    :global(body *) { visibility: hidden; }
    .druckbogen, .druckbogen :global(*) { visibility: visible; }
    .druckbogen { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; position: absolute; left: 0; top: 0; width: 100%; padding: 8mm; background: #fff; color: #000; }
    .zettel { display: flex; gap: 4mm; border: 1px dashed #999; padding: 4mm; break-inside: avoid; font-size: 10pt; }
    .zt { font-size: 9pt; color: #444; }
    .zn { font-weight: 700; font-size: 12pt; }
    .zc { font-family: ui-monospace, monospace; font-size: 18pt; letter-spacing: 0.1em; margin: 2mm 0; }
    .zl { font-size: 7pt; word-break: break-all; color: #444; }
    .zh { font-size: 8pt; margin-top: 2mm; }
  }
</style>
