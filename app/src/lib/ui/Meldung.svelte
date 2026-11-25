<script lang="ts">
  import Einstufung from './Einstufung.svelte';
  import { onMount } from 'svelte';
  import type { AnmeldungInfo, AnmeldungStand } from '@shared/protokoll';
  import { T } from '../texte';
  import { api, serverPruefen } from '../dienste';
  import { fehlerText } from '../app.svelte';
  import { linkZu } from '../router.svelte';
  import { euro } from '../engine/modell';
  import { giroCode, ibanAnzeige } from '../engine/girocode';
  import Hilfe from './Hilfe.svelte';
  import QrCode from './turnier/QrCode.svelte';

  /**
   * Öffentliche Online-Anmeldung zu einem Turnier (#/meldung/<turnier>) und – mit dem Schlüssel aus
   * der Mail (#/meldung/<turnier>/<schlüssel>) – Bestätigung, Stand, Startgeld mit GiroCode und Abmelden.
   */
  let { turnier, schluessel = null }: { turnier: string; schluessel?: string | null } = $props();

  let laedt = $state(true);
  let fehler = $state('');
  let info = $state<AnmeldungInfo | null>(null);
  let stand = $state<AnmeldungStand | null>(null);
  let gesendet = $state(false);
  let sendet = $state(false);
  let abgemeldet = $state(false);

  let f = $state({ vorname: '', nachname: '', verein: '', email: '', ttr: '', klasse: '', geschlecht: '', jahrgang: '' });
  let wahl = $state<Record<string, { an: boolean; partner: string; partnerEmail: string }>>({});
  /** Q-TTR vorhanden (ja) oder Einstufung mit 4 Fragen (nein) */
  let hatTtr = $state<'ja' | 'nein' | ''>('');
  /** Ab 0.17 (Frage 8C): online nur ab 18 */
  let volljaehrig = $state(false);
  let datenschutz = $state(false);
  /** Ab 0.18: Ankündigungen künftiger Turniere (Verteiler der Sparte) */
  let verteiler = $state(false);
  let website = $state(''); // Fangfeld für Bots

  const pflicht = $derived(new Set(info?.einstellungen.angaben ?? []));
  const datum = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
  const gewaehlt = $derived(Object.entries(wahl).filter(([, w]) => w.an));
  const vollstaendig = $derived(
    !!f.vorname.trim() &&
      !!f.nachname.trim() &&
      /.+@.+\..+/.test(f.email.trim()) &&
      gewaehlt.length > 0 &&
      datenschutz &&
      volljaehrig &&
      gewaehlt.every(([, w]) => !w.partner.trim() || /.+@.+\..+/.test(w.partnerEmail.trim())) &&
      (!pflicht.has('ttr') || (hatTtr !== '' && f.ttr !== '')) &&
      (!pflicht.has('klasse') || !!f.klasse.trim()) &&
      (!pflicht.has('geschlecht') || !!f.geschlecht) &&
      (!pflicht.has('jahrgang') || f.jahrgang !== ''),
  );
  const giro = $derived(
    stand?.bank && stand.startgeld > 0 ? giroCode({ empfaenger: stand.bank.empfaenger, iban: stand.bank.iban, bic: stand.bank.bic, betrag: stand.startgeld, zweck: stand.zweck }) : null,
  );

  onMount(async () => {
    try {
      const s = await serverPruefen();
      if (s.art !== 'bereit') throw new Error(T.start.keinServer);
      // Nur ansehen – bestätigt wird per Knopf (Mail-Scanner öffnen Links, ohne dass jemand zustimmt)
      if (schluessel) stand = await api.anmeldungStand(turnier, schluessel);
      else {
        info = await api.anmeldungInfo(turnier);
        wahl = Object.fromEntries(info.einstellungen.konkurrenzen.map((k) => [k.id, { an: info!.einstellungen.konkurrenzen.length === 1, partner: '', partnerEmail: '' }]));
      }
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laedt = false;
    }
  });

  function frei(id: string): string {
    const k = info!.einstellungen.konkurrenzen.find((x) => x.id === id)!;
    const b = info!.belegung[id] ?? { plaetze: 0, warteliste: 0 };
    if (k.max === null) return T.meldung.unbegrenzt;
    const n = k.max - b.plaetze;
    return n > 0 && b.warteliste === 0 ? T.meldung.frei(n) : T.meldung.voll;
  }

  async function senden(e: SubmitEvent) {
    e.preventDefault();
    if (!vollstaendig) {
      fehler = T.meldung.fehlt;
      return;
    }
    sendet = true;
    fehler = '';
    try {
      const zahl = (t: string) => (t.trim() === '' ? null : Number(t));
      await api.anmeldungSenden({
        turnier,
        vorname: f.vorname.trim(),
        nachname: f.nachname.trim(),
        verein: f.verein.trim(),
        email: f.email.trim(),
        ttr: pflicht.has('ttr') ? zahl(f.ttr) : null,
        ...(pflicht.has('ttr') && hatTtr === 'nein' ? { ttrGeschaetzt: true } : {}),
        klasse: pflicht.has('klasse') ? f.klasse.trim() || null : null,
        geschlecht: pflicht.has('geschlecht') ? ((f.geschlecht || null) as 'm' | 'w' | 'd' | null) : null,
        jahrgang: pflicht.has('jahrgang') ? zahl(f.jahrgang) : null,
        konkurrenzen: gewaehlt.map(([id, w]) => ({ id, ...(w.partner.trim() ? { partner: w.partner.trim(), partnerEmail: w.partnerEmail.trim() } : {}) })),
        volljaehrig,
        datenschutz,
        ...(verteiler ? { verteiler: true } : {}),
        website,
      });
      gesendet = true;
      scrollTo(0, 0);
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      sendet = false;
    }
  }

  async function bestaetigen() {
    if (!schluessel) return;
    sendet = true;
    fehler = '';
    try {
      stand = await api.anmeldungBestaetigen(turnier, schluessel);
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      sendet = false;
    }
  }
  // Jahrgang unter 18: Hinweis statt Absenden (Minderjährige meldet der Verein bzw. eine Mannschaftsleitung)
  const zuJung = $derived(f.jahrgang.length === 4 && Number.isInteger(Number(f.jahrgang)) && new Date().getFullYear() - Number(f.jahrgang) < 18);

  async function abmelden(konkurrenz?: string) {
    if (!schluessel || !confirm(T.meldung.abmeldenFrage)) return;
    sendet = true;
    try {
      stand = await api.anmeldungAbmelden(turnier, schluessel, konkurrenz);
      abgemeldet = true;
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      sendet = false;
    }
  }
</script>

<h1>{stand?.turnier.name ?? info?.turnier.name ?? T.meldung.titel}</h1>
{#if laedt}
  <p class="leise">{T.meldung.laden}</p>
{:else if stand}
  {#if stand.turnier.datum}<p class="leise">{datum(stand.turnier.datum)}</p>{/if}
  {#if !stand.bestaetigt}
    <div class="meldung info" role="status">{T.meldung.bitteBestaetigen}</div>
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <button class="breit" disabled={sendet} onclick={bestaetigen} data-testid="meldung-jetzt-bestaetigen">{T.meldung.jetztBestaetigen}</button>
  {:else}
    <div class="meldung ok" role="status" data-testid="meldung-bestaetigt">{abgemeldet ? T.meldung.abgemeldetText : T.meldung.bestaetigt}</div>
  {/if}
  <section class="karte">
    <h2>{T.meldung.stand}</h2>
    <p><strong>{stand.vorname} {stand.nachname}</strong></p>
    <ul class="liste" data-testid="meldung-stand">
      {#each stand.konkurrenzen as k (k.id)}
        <li class="reihe zwischen">
          <span class="wachsen">{k.name}{#if k.partner} <span class="leise">({T.meldung.mit(k.partner)}{k.partnerStatus ? ` · ${T.meldung.partnerStatus[k.partnerStatus]}` : ''})</span>{/if}: <strong class="st-{k.status}">{k.status === null ? T.meldung.unbestaetigt : k.status === 'platz' ? T.meldung.platzSicher : k.status === 'warteliste' ? T.meldung.warteliste(k.position) : T.meldung.abgemeldet}</strong></span>
          {#if stand.bestaetigt && stand.abmeldbar && k.status !== 'abgemeldet' && stand.konkurrenzen.filter((x) => x.status !== 'abgemeldet').length > 1}
            <button class="zweit klein" disabled={sendet} onclick={() => abmelden(k.id)}>{T.meldung.abmelden}</button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if !stand.bestaetigt}
      <!-- erst bestätigen -->
    {:else if stand.abmeldbar && stand.konkurrenzen.some((x) => x.status !== 'abgemeldet')}
      <button class="gefahr" disabled={sendet} onclick={() => abmelden()} data-testid="meldung-abmelden">{T.meldung.abmeldenAlle}</button>
    {:else if !stand.abmeldbar}
      <p class="leise">{T.meldung.nichtAbmeldbar}</p>
    {/if}
  </section>
  {#if stand.startgeld > 0}
    <section class="karte">
      <h2>{T.meldung.startgeldSumme(euro(stand.startgeld))}</h2>
      {#if stand.bank}
        <p>{T.meldung.ueberweisung}: {stand.bank.empfaenger}<br />IBAN {ibanAnzeige(stand.bank.iban)}{#if stand.bank.bic}<br />BIC {stand.bank.bic}{/if}<br />{stand.zweck}</p>
        {#if giro}
          <p class="leise">{T.kasse.giroCodeText}</p>
          <QrCode text={giro} groesse={200} label={T.kasse.giroCode} />
        {/if}
      {:else}
        <p>{T.meldung.kasse}</p>
      {/if}
    </section>
  {/if}
  <p class="leise">{T.meldung.linkAufheben}</p>
{:else if fehler && !info}
  <div class="meldung fehler" role="alert">{fehler}</div>
  <a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a>
{:else if info}
  <p class="leise">
    {[datum(info.turnier.datum), info.einstellungen.ort, info.turnier.veranstalter].filter(Boolean).join(' · ')}
  </p>
  {#if info.einstellungen.hinweis}<p class="hinweis">{info.einstellungen.hinweis}</p>{/if}
  {#if info.einstellungen.schluss}<p class="leise">{T.meldung.schluss(new Date(info.einstellungen.schluss).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }))}</p>{/if}
  {#if gesendet}
    <div class="meldung ok" role="status" data-testid="meldung-gesendet">{T.meldung.gesendet}</div>
  {:else if info.jugend}
    <div class="meldung info" role="status" data-testid="meldung-jugend">{T.meldung.jugend}</div>
  {:else if !info.moeglich}
    <div class="meldung info" role="status">{T.meldung.geschlossen}</div>
  {:else}
    <form class="karte" onsubmit={senden} novalidate>
      <label>{T.meldung.vorname}<input bind:value={f.vorname} autocomplete="given-name" maxlength="80" required /></label>
      <label>{T.meldung.nachname}<input bind:value={f.nachname} autocomplete="family-name" maxlength="80" required /></label>
      <label>{T.meldung.verein}<input bind:value={f.verein} autocomplete="organization" maxlength="120" /></label>
      <div class="label-zeile"><label for="m-email">{T.meldung.email}</label><Hilfe text={T.meldung.emailHilfe} /></div>
      <input id="m-email" type="email" bind:value={f.email} autocomplete="email" maxlength="190" required />
      {#if pflicht.has('ttr')}
        <fieldset class="ttr-frage">
          <legend>{T.einstufung.hatTtr}</legend>
          <label class="wahl"><input type="radio" name="hat-ttr" value="ja" bind:group={hatTtr} onchange={() => (f.ttr = '')} />{T.einstufung.ja}</label>
          <label class="wahl"><input type="radio" name="hat-ttr" value="nein" bind:group={hatTtr} onchange={() => (f.ttr = '')} />{T.einstufung.nein}</label>
        </fieldset>
        {#if hatTtr === 'ja'}<label>{T.einstufung.qttr}<input bind:value={f.ttr} inputmode="numeric" maxlength="4" /></label>{/if}
        {#if hatTtr === 'nein'}<Einstufung sofort uebernehmen={(wert) => (f.ttr = String(wert))} />{/if}
      {/if}
      {#if pflicht.has('klasse')}<label>{T.meldung.klasse}<input bind:value={f.klasse} maxlength="40" /></label>{/if}
      {#if pflicht.has('geschlecht')}
        <label>{T.meldung.geschlecht}
          <select bind:value={f.geschlecht}>
            <option value=""></option><option value="w">{T.tspieler.geschlechter.w}</option><option value="m">{T.tspieler.geschlechter.m}</option><option value="d">{T.tspieler.geschlechter.d}</option>
          </select>
        </label>
      {/if}
      {#if pflicht.has('jahrgang')}<label>{T.meldung.jahrgang}<input bind:value={f.jahrgang} inputmode="numeric" maxlength="4" /></label>{/if}

      <fieldset>
        <legend>{T.meldung.konkurrenzen}</legend>
        {#each info.einstellungen.konkurrenzen as k (k.id)}
          <label class="haken">
            <input type="checkbox" bind:checked={wahl[k.id]!.an} data-testid="meldung-konkurrenz" />
            <span>{k.name} <span class="leise">· {frei(k.id)}{k.startgeld ? ` · ${T.meldung.startgeld(euro(k.startgeld))}` : ''}</span></span>
          </label>
          {#if k.art !== 'einzel' && wahl[k.id]!.an}
            <label class="einzug">{T.meldung.partner}<input bind:value={wahl[k.id]!.partner} maxlength="80" /></label>
            {#if wahl[k.id]!.partner.trim()}
              <div class="einzug">
                <div class="label-zeile"><label for="pm-{k.id}">{T.meldung.partnerEmail}</label><Hilfe text={T.meldung.partnerEmailHilfe} /></div>
                <input id="pm-{k.id}" type="email" bind:value={wahl[k.id]!.partnerEmail} maxlength="190" autocomplete="off" inputmode="email" />
              </div>
            {/if}
          {/if}
        {/each}
      </fieldset>

      <div class="label-zeile">
        <label class="haken"><input type="checkbox" bind:checked={volljaehrig} data-testid="meldung-volljaehrig" /> {T.meldung.volljaehrig}</label>
        <Hilfe text={T.meldung.volljaehrigHilfe} />
      </div>
      {#if zuJung}<div class="meldung info">{T.meldung.zuJung}</div>{/if}
      <p class="leise textbaustein">{T.textbaustein.text(info.turnier.veranstalter)}</p>
      <label class="haken"><input type="checkbox" bind:checked={datenschutz} data-testid="meldung-datenschutz" /> <span>{T.meldung.datenschutz} <a href={linkZu('datenschutz')} target="_blank" rel="noopener">{T.meldung.datenschutzLink}</a></span></label>
      <div class="label-zeile">
        <label class="haken"><input type="checkbox" bind:checked={verteiler} data-testid="meldung-verteiler" /> {T.verteiler.ausAnmeldung}</label>
        <Hilfe text={T.verteiler.hilfe} />
      </div>
      <div class="fang" aria-hidden="true"><label for="mw">Website</label><input id="mw" bind:value={website} tabindex="-1" autocomplete="off" /></div>
      {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
      <button type="submit" class="breit" disabled={sendet || !vollstaendig} data-testid="meldung-senden">{T.meldung.senden}</button>
    </form>
  {/if}
{/if}

<style>
  h1 { overflow-wrap: anywhere; }
  .hinweis { white-space: pre-line; }
  fieldset { border: 0; padding: 0; margin: 12px 0; }
  legend { font-weight: 700; margin-bottom: 4px; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .einzug { margin-left: 32px; }
  .st-platz { color: var(--gruen); }
  .st-warteliste { color: var(--orange-text); }
  .st-abgemeldet { color: var(--leise); }
  .fang { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
  .ttr-frage { border: 0; padding: 0; margin: 12px 0 0; }
  .ttr-frage legend { font-weight: 700; padding: 0; }
  .ttr-frage .wahl { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; margin: 0; }
  .ttr-frage .wahl input { width: 22px; height: 22px; min-height: 0; flex: none; }
</style>
