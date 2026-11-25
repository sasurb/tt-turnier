<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ART, SICHERUNG_MAX_EMPFAENGER, SICHERUNG_TAKTE, UST_SAETZE, type KasseEinstellungen, type Sicherung, type SicherungTakt, type TurnierEinstellungen } from '@shared/protokoll';
  import { bicGueltig, ibanAnzeige, ibanGueltig, ibanNormal } from '../engine/girocode';
  import { T } from '../texte';
  import { api, speicher } from '../dienste';
  import { app, fehlerText } from '../app.svelte';
  import { gehe } from '../router.svelte';
  import { turnierVergessen } from '../einstellungen';
  import PasswortFeld from './PasswortFeld.svelte';
  import type { TurnierZustand } from '../engine/zustand';
  import { kannTeilen, lokaleSicherung, setzeLokaleSicherung, sicherungAusgeben } from '../sicherung';
  import Hilfe from './Hilfe.svelte';
  import { istZentrale } from '../zentrale.svelte';
  import KonkurrenzAuswahlWahl from './turnier/KonkurrenzAuswahlWahl.svelte';
  import Textbaustein from './turnier/Textbaustein.svelte';
  import { appWertungAn, minderjaehrigeLautJahrgang } from '../engine/zustand';
  import { aktiveSparte, aktiveSparteId } from '../sparte.svelte';
  import ErgebnisVersand from './turnier/ErgebnisVersand.svelte';

  let {
    id,
    lokal,
    abschnitt = null,
    token,
    einst = $bindable(),
    z,
    abgeschlossen,
    anzahl,
    eintragen,
    sicherung,
    protokoll,
  }: {
    id: string;
    lokal: boolean;
    /** Abschnitt, der aufgeklappt und angesprungen wird (z. B. „auswahl“) */
    abschnitt?: string | null;
    token: string | null;
    einst: TurnierEinstellungen | null;
    z: TurnierZustand;
    abgeschlossen: boolean;
    anzahl: number;
    eintragen: (art: string, daten?: Record<string, unknown>) => Promise<unknown>;
    sicherung: () => Promise<Sicherung>;
    protokoll: Snippet;
  } = $props();

  let meldung = $state<{ ok: boolean; text: string; wo: string } | null>(null);
  const zeige = (wo: string, ok: boolean, text: string) => (meldung = { wo, ok, text });

  /* Veröffentlichung der Stände */
  async function veroeffentlichung(tabellen: boolean, ko: boolean) {
    try {
      await eintragen(ART.turnierDaten, { veroeffentlichung: { tabellen, ko } });
      zeige('veroeff', true, T.app.gespeichert);
    } catch (x) {
      zeige('veroeff', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }
  async function allesVeroeffentlichen() {
    if (!confirm(T.einstellungen.veroeffentlichenFrage)) return;
    try {
      await eintragen(ART.turnierDaten, { veroeffentlichung: { tabellen: true, ko: true }, alleKonkurrenzen: true });
      zeige('veroeff', true, T.einstellungen.veroeffentlicht);
    } catch (x) {
      zeige('veroeff', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }
  const abweichend = $derived(Object.values(z.konkurrenzen).filter((k) => k.einst.veroeffentlichung !== null));

  /* Name und Datum */
  // svelte-ignore state_referenced_locally
  let tName = $state(z.name);
  // svelte-ignore state_referenced_locally
  let tDatum = $state(z.datum ?? '');
  async function kopfSpeichern(e: SubmitEvent) {
    e.preventDefault();
    const datum = /^\d{4}-\d{2}-\d{2}$/.test(tDatum) ? tDatum : null;
    try {
      if (!lokal && token) await api.einstellungenSetzen(token, { turnier: id, name: tName.trim(), datum });
      await eintragen(ART.turnierUmbenannt, { name: tName.trim(), datum });
      zeige('kopf', true, T.app.gespeichert);
    } catch (x) {
      zeige('kopf', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }

  /* Kasse und Quittung */
  const kasseLeer: KasseEinstellungen = { aussteller: '', anschrift: '', ust: 'keiner', ustSatz: 19, fusstext: '', empfaenger: '', iban: '', bic: '' };
  // svelte-ignore state_referenced_locally
  let kasse = $state<KasseEinstellungen>({ ...kasseLeer, ...(z.kasse ?? {}), iban: z.kasse?.iban ? ibanAnzeige(z.kasse.iban) : '' });
  let alsVorgabe = $state(false);
  const kontoDa = $derived(!lokal && !!app.sitzung && !istZentrale());
  async function kasseAusKonto() {
    if (!app.sitzung) return;
    try {
      const k = (await api.kontoEinstellungen(app.sitzung.token, aktiveSparteId())).kasse;
      if (k) kasse = { ...kasseLeer, ...k, iban: k.iban ? ibanAnzeige(k.iban) : '' };
    } catch (x) {
      zeige('kasse', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }
  async function kasseSpeichern(e: SubmitEvent) {
    e.preventDefault();
    if (kasse.iban.trim() && !ibanGueltig(kasse.iban)) return zeige('kasse', false, T.kasseEinst.ibanFalsch);
    if (!bicGueltig(kasse.bic)) return zeige('kasse', false, T.kasseEinst.bicFalsch);
    const k: KasseEinstellungen = { ...$state.snapshot(kasse), iban: ibanNormal(kasse.iban), bic: kasse.bic.replace(/\s+/g, '').toUpperCase() };
    try {
      await eintragen(ART.turnierDaten, { kasse: k });
      if (alsVorgabe && app.sitzung) await api.kontoEinstellungenSetzen(app.sitzung.token, { kasse: k }, aktiveSparteId());
      zeige('kasse', true, T.kasseEinst.gespeichert);
    } catch (x) {
      zeige('kasse', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }

  /* Namen für Zuschauer (Datenschutz) */
  async function namenSetzen(n: 'voll' | 'kurz') {
    if (n === z.namen) return;
    if (n === 'voll' && z.jugend && !confirm(T.jugend.vollWarnung)) return;
    try {
      await eintragen(ART.turnierDaten, { namen: n });
      zeige('namen', true, T.app.gespeichert);
    } catch (x) {
      zeige('namen', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }

  /* Jugendturnier und App-Wertung (Fragen 7A, 16A) */
  const unter18 = $derived(minderjaehrigeLautJahrgang(z));
  async function jugendSetzen(an: boolean) {
    try {
      await eintragen(ART.turnierDaten, an ? { jugend: true, namen: 'kurz' } : { jugend: false });
      zeige('jugend', true, T.app.gespeichert);
    } catch (x) {
      zeige('jugend', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }
  async function appWertungSetzen(an: boolean) {
    try {
      await eintragen(ART.turnierDaten, { appWertung: an });
      zeige('jugend', true, T.app.gespeichert);
    } catch (x) {
      zeige('jugend', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }

  /* Löschfrist (ab 0.17, nur online) */
  const loeschfristMoeglich = $derived(!lokal && !istZentrale() && !!einst && einst.loeschenNach !== undefined);
  async function loeschfristSetzen(n: 12 | 24) {
    if (!token) return;
    try {
      einst = await api.einstellungenSetzen(token, { turnier: id, loeschenNach: n });
      zeige('frist', true, T.loeschfrist.gespeichert);
    } catch (x) {
      zeige('frist', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }
  function tag(iso: string | null | undefined) {
    return iso ? new Date(iso).toLocaleDateString('de-DE') : '';
  }

  /* Turnier löschen: online über das Konto (mit Passwort), lokal/Zentrale nur vom Gerät */
  let loeschPw = $state('');
  const onlineLoeschbar = $derived(!lokal && !istZentrale() && !!app.sitzung);
  async function loeschen(e: SubmitEvent) {
    e.preventDefault();
    if (!confirm(T.einstellungen.loeschenFrage(z.name))) return;
    try {
      if (onlineLoeschbar && app.sitzung) await api.turnierLoeschen(app.sitzung.token, id, loeschPw);
      await speicher.loeschen(id);
      turnierVergessen(id);
      app.hinweis = T.einstellungen.geloescht;
      gehe('');
    } catch (x) {
      zeige('loeschen', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }

  /* Sicherung per Mail */
  // svelte-ignore state_referenced_locally
  let empfaenger = $state<string[]>(felder(einst?.sicherungAn ?? []));
  // svelte-ignore state_referenced_locally
  let takt = $state<SicherungTakt>(einst?.sicherungTakt ?? 30);
  function felder(l: string[]) {
    return Array.from({ length: SICHERUNG_MAX_EMPFAENGER }, (_, i) => l[i] ?? '');
  }
  $effect(() => {
    // Wenn die Einstellungen (neu) geladen sind, Felder füllen
    if (einst) {
      empfaenger = felder(einst.sicherungAn);
      takt = einst.sicherungTakt;
    }
  });

  async function sicherungSpeichern(e: SubmitEvent) {
    e.preventDefault();
    if (!token) return;
    try {
      einst = await api.einstellungenSetzen(token, { turnier: id, sicherungAn: empfaenger.map((x) => x.trim()).filter(Boolean), sicherungTakt: takt });
      zeige('mail', true, T.app.gespeichert);
    } catch (x) {
      zeige('mail', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }
  async function jetztSichern() {
    if (!token) return;
    try {
      const a = await api.sichern(token, id);
      if (a.wartend) {
        einst = einst ? { ...einst, wartend: true } : einst;
        zeige('mail', true, T.zentrale.sicherungWartet);
      } else {
        einst = einst ? { ...einst, letzteSicherung: a.zeit, wartend: false } : einst;
        zeige('mail', true, T.einstellungen.gesendet(a.gesendetAn.join(', ')));
      }
    } catch (x) {
      zeige('mail', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }

  function taktText(t: SicherungTakt) {
    if (t === 0) return T.einstellungen.taktAus;
    if (t === -1) return T.einstellungen.taktAbschluss;
    return T.einstellungen.taktMinuten(t);
  }

  /* Sicherungsdatei */
  const teilenMoeglich = kannTeilen();
  // svelte-ignore state_referenced_locally
  let lokalTakt = $state<SicherungTakt>(lokaleSicherung(id).takt);
  async function ausgeben(teilen: boolean) {
    try {
      const s = await sicherung();
      const r = await sicherungAusgeben(s, teilen);
      if (r === 'abgebrochen') return;
      if (lokal) setzeLokaleSicherung(id, { ...lokaleSicherung(id), zuletzt: new Date().toISOString(), anzahl });
      zeige('datei', true, r === 'geteilt' ? T.einstellungen.geteilt : T.einstellungen.heruntergeladen);
    } catch (x) {
      zeige('datei', false, fehlerText(x, T.app.fehlerAllgemein));
    }
  }
  function lokalTaktSetzen() {
    setzeLokaleSicherung(id, { ...lokaleSicherung(id), takt: lokalTakt });
  }

  async function abschliessen() {
    if (!abgeschlossen && !confirm(T.einstellungen.abschliessenFrage)) return;
    await eintragen(abgeschlossen ? ART.turnierWiedereroeffnet : ART.turnierAbgeschlossen);
  }

  function zeit(iso: string | null) {
    return iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : T.einstellungen.keine;
  }
</script>

{#snippet hinweis(wo: string)}
  {#if meldung && meldung.wo === wo}
    <div class="meldung" class:ok={meldung.ok} class:fehler={!meldung.ok} role="status">{meldung.text}</div>
  {/if}
{/snippet}

<details class="karte einstellungen" id="einstellungen" open>
  <summary>{T.einstellungen.titel}</summary>

  <section>
    <h3>{T.einstellungen.kopfTitel}</h3>
    <form onsubmit={kopfSpeichern} class="kopf-form">
      <label>{T.neu.name}<input bind:value={tName} minlength="2" maxlength="160" required /></label>
      <div class="label-zeile"><label for="te-datum">{T.neu.datum}</label><Hilfe text={T.einstellungen.datumHilfe} /></div>
      <input id="te-datum" type="date" bind:value={tDatum} data-testid="turnier-datum" />
      <button type="submit" class="zweit" disabled={tName.trim().length < 2}>{T.app.speichern}</button>
    </form>
    {@render hinweis('kopf')}
  </section>

  <section>
    <KonkurrenzAuswahlWahl {z} turnierId={id} offen={abschnitt === 'auswahl'} eintragen={(art, d) => eintragen(art, d)} />
  </section>

  <section>
    <h3>{T.einstellungen.veroeffTitel}<Hilfe text={T.einstellungen.veroeffHinweis} /></h3>
    <p class="leise">{T.einstellungen.veroeffText}</p>
    <label class="haken"><input type="checkbox" checked={z.veroeffentlichung.tabellen} onchange={(e) => veroeffentlichung(e.currentTarget.checked, z.veroeffentlichung.ko)} /> {T.einstellungen.veroeffTabellen}</label>
    <label class="haken"><input type="checkbox" checked={z.veroeffentlichung.ko} onchange={(e) => veroeffentlichung(z.veroeffentlichung.tabellen, e.currentTarget.checked)} /> {T.einstellungen.veroeffKo}</label>
    {#if !z.veroeffentlichung.tabellen || !z.veroeffentlichung.ko || abweichend.length}
      <button class="zweit" style="margin-top:8px" onclick={allesVeroeffentlichen} data-testid="alles-veroeffentlichen">{T.einstellungen.veroeffentlichen}</button>
    {/if}
    {@render hinweis('veroeff')}
  </section>

  <section>
    <h3>{T.einstellungen.namenTitel}<Hilfe text={T.einstellungen.namenHilfe} /></h3>
    <p class="leise">{T.einstellungen.namenText}</p>
    <fieldset>
      <legend class="sr">{T.einstellungen.namenTitel}</legend>
      {#each ['voll', 'kurz'] as const as n (n)}
        <label class="wahl" class:aktiv={z.namen === n}>
          <input type="radio" name="namen" value={n} checked={z.namen === n} onchange={() => namenSetzen(n)} data-testid="namen-{n}" />
          <span><strong>{T.einstellungen.namenWahl[n]}</strong><span class="leise">{T.einstellungen.namenWahlText[n]}</span></span>
        </label>
      {/each}
    </fieldset>
    {@render hinweis('namen')}
  </section>

  <section data-testid="abschnitt-jugend">
    <h3>{T.jugend.schalter}<Hilfe text={T.jugend.hilfe} /></h3>
    <label class="haken"><input type="checkbox" checked={z.jugend} onchange={(e) => jugendSetzen(e.currentTarget.checked)} data-testid="jugend-schalter" /> {T.jugend.schalter}</label>
    {#if !z.jugend && unter18 > 0}<div class="meldung info" data-testid="hinweis-unter18">{T.jugend.unter18(unter18)}</div>{/if}
    <label class="haken"><input type="checkbox" checked={appWertungAn(z)} onchange={(e) => appWertungSetzen(e.currentTarget.checked)} data-testid="appwertung-schalter" /> {T.appwertung.schalter}</label>
    <p class="leise">{T.appwertung.profiling}</p>
    {@render hinweis('jugend')}
    <Textbaustein verein={app.sitzung?.konto.sparten?.find((s) => s.id === aktiveSparteId())?.verein ?? ''} />
    {#if !lokal && app.server.art === 'bereit' && app.server.info.nachrichten && !app.server.info.zentrale}
      <p class="leise verteiler-link">{T.verteiler.link}<Hilfe text={T.verteiler.linkHilfe} />: <a href={`#/verteiler/${id}`} data-testid="verteiler-link">{location.origin + location.pathname}#/verteiler/{id}</a></p>
    {/if}
  </section>

  {#if loeschfristMoeglich && einst}
    <section data-testid="abschnitt-loeschfrist">
      <h3>{T.loeschfrist.titel}<Hilfe text={T.loeschfrist.hilfe} /></h3>
      <fieldset>
        <legend class="sr">{T.loeschfrist.titel}</legend>
        {#each [12, 24] as const as n (n)}
          <label class="wahl" class:aktiv={einst.loeschenNach === n}>
            <input type="radio" name="loeschfrist" value={n} checked={einst.loeschenNach === n} onchange={() => loeschfristSetzen(n)} data-testid="loeschfrist-{n}" />
            <span><strong>{T.loeschfrist.monate(n)}</strong></span>
          </label>
        {/each}
      </fieldset>
      {#if einst.loeschungAm}<p class="leise" data-testid="loeschung-am">{T.loeschfrist.am(tag(einst.loeschungAm))}</p>{/if}
      {@render hinweis('frist')}
    </section>
  {/if}

  {#if !lokal && einst}
    <section>
      <h3>{T.einstellungen.sicherungTitel}</h3>
      <p class="leise">{T.einstellungen.erklaerung}</p>
      {#if !einst.mail}
        <div class="meldung info">{istZentrale() ? T.zentrale.sicherungKeinKonto : T.einstellungen.keinMail}</div>
      {:else}
        <form onsubmit={sicherungSpeichern}>
          <label for="st">{T.einstellungen.takt}</label>
          <select id="st" bind:value={takt}>
            {#each SICHERUNG_TAKTE as t (t)}<option value={t}>{taktText(t)}</option>{/each}
          </select>
          <label for="se0">{T.einstellungen.empfaenger}</label>
          {#each empfaenger as _, i (i)}
            <input
              id={'se' + i}
              class="empf"
              type="email"
              bind:value={empfaenger[i]}
              placeholder={T.einstellungen.empfaengerPlatzhalter}
              inputmode="email"
              autocapitalize="off"
              autocomplete="off"
              aria-label={`${T.einstellungen.empfaenger} ${i + 1}`}
            />
          {/each}
          {#if einst.unbestaetigt?.length}
            <div class="meldung info" data-testid="sicherung-unbestaetigt">{T.einstellungen.unbestaetigt(einst.unbestaetigt.join(', '))}</div>
          {/if}
          <p class="leise">{T.einstellungen.ohneKontakt}</p>
          <p class="leise">{T.einstellungen.letzte}: {zeit(einst.letzteSicherung)}</p>
          <div class="reihe">
            <button type="submit">{T.app.speichern}</button>
            <button type="button" class="zweit" onclick={jetztSichern}>{T.einstellungen.jetzt}</button>
          </div>
        </form>
      {/if}
      {@render hinweis('mail')}
    </section>
  {/if}

  <section>
    <h3>{T.kasseEinst.titel}<Hilfe text={T.kasseEinst.hilfe} /></h3>
    <form onsubmit={kasseSpeichern} class="kasse-form" data-testid="kasse-einstellungen">
      {#if kontoDa}<button type="button" class="zweit klein" onclick={kasseAusKonto}>{T.kasseEinst.ausKonto}</button>{/if}
      <label>{T.kasseEinst.aussteller} <span class="leise">{T.kasseEinst.pflichtQuittung}</span><input bind:value={kasse.aussteller} maxlength="160" autocomplete="organization" /></label>
      <label>{T.kasseEinst.anschrift} <span class="leise">{T.kasseEinst.pflichtQuittung}</span><textarea bind:value={kasse.anschrift} maxlength="300" rows="2"></textarea></label>
      <label>{T.kasseEinst.ust}
        <select bind:value={kasse.ust}>
          {#each ['keiner', 'befreit', 'enthalten'] as u (u)}<option value={u}>{T.kasseEinst.ustArten[u]}</option>{/each}
        </select>
      </label>
      {#if kasse.ust === 'enthalten'}
        <label>{T.kasseEinst.ustSatz}<select bind:value={kasse.ustSatz}>{#each UST_SAETZE as u (u)}<option value={u}>{u} %</option>{/each}</select></label>
      {/if}
      <label>{T.kasseEinst.fusstext}<input bind:value={kasse.fusstext} maxlength="500" /></label>
      <label>{T.kasseEinst.empfaenger}<input bind:value={kasse.empfaenger} maxlength="70" /></label>
      <label>{T.kasseEinst.iban}<input bind:value={kasse.iban} maxlength="42" autocapitalize="characters" autocomplete="off" spellcheck="false" data-testid="kasse-iban" /></label>
      {#if kasse.iban.trim() && !ibanGueltig(kasse.iban)}<p class="leise">{T.kasseEinst.ibanFalsch}</p>{/if}
      <p class="leise" data-testid="iban-hinweis">{T.kasseEinst.ibanHinweis}</p>
      <label>{T.kasseEinst.bic}<input bind:value={kasse.bic} maxlength="11" autocapitalize="characters" autocomplete="off" spellcheck="false" /></label>
      {#if kontoDa && (!app.server.art || app.server.art !== 'bereit' || !app.server.info.sparten || aktiveSparte()?.rolle === 'spartenleitung')}<label class="haken"><input type="checkbox" bind:checked={alsVorgabe} /> {T.kasseEinst.alsVorgabe}</label>{/if}
      <button type="submit">{T.app.speichern}</button>
    </form>
    {@render hinweis('kasse')}
  </section>

  <section>
    <h3>{T.einstellungen.dateiTitel}</h3>
    <p class="leise">{lokal ? T.einstellungen.lokalErklaerung : T.einstellungen.dateiText}</p>
    {#if lokal}
      <label for="lt">{T.einstellungen.lokalTakt}</label>
      <select id="lt" bind:value={lokalTakt} onchange={lokalTaktSetzen}>
        {#each SICHERUNG_TAKTE.filter((t) => t !== -1) as t (t)}<option value={t}>{taktText(t)}</option>{/each}
      </select>
    {/if}
    <div class="reihe" style="margin-top:12px">
      {#if teilenMoeglich}<button onclick={() => ausgeben(true)}>{T.einstellungen.teilen}</button>{/if}
      <button class:zweit={teilenMoeglich} onclick={() => ausgeben(false)}>{T.einstellungen.herunterladen}</button>
    </div>
    {@render hinweis('datei')}
  </section>

  <section>
    <h3>{T.einstellungen.abschliessenTitel}</h3>
    <p class="leise">{T.einstellungen.abschliessenText}</p>
    <button class="zweit" onclick={abschliessen}>{abgeschlossen ? T.einstellungen.wiedereroeffnen : T.einstellungen.abschliessen}</button>
  </section>
  {#if abgeschlossen && !lokal && token && app.server.art === 'bereit' && app.server.info.nachrichten && !app.server.info.zentrale}
    <ErgebnisVersand {z} turnierId={id} {token} />
  {/if}

  {#if lokal || onlineLoeschbar}
    <section>
      <h3>{T.einstellungen.loeschenTitel}</h3>
      <p class="leise">{lokal ? T.einstellungen.loeschenLokal : T.einstellungen.loeschenText}</p>
      <form onsubmit={loeschen}>
        {#if onlineLoeschbar}
          <label for="lpw">{T.einstellungen.loeschenPasswort}</label>
          <PasswortFeld id="lpw" bind:wert={loeschPw} />
        {/if}
        <button type="submit" class="gefahr" style="margin-top:8px" disabled={onlineLoeschbar && !loeschPw} data-testid="turnier-loeschen">{T.einstellungen.loeschenKnopf}</button>
      </form>
      {@render hinweis('loeschen')}
    </section>
  {/if}

  <section>
    <details class="protokoll">
      <summary>{T.einstellungen.protokollTitel} <span class="leise">({anzahl})</span></summary>
      <p class="leise">{T.einstellungen.protokollText}</p>
      {@render protokoll()}
    </details>
  </section>
</details>

<style>
  .verteiler-link { overflow-wrap: anywhere; }
  .einstellungen section { border-top: 1px solid var(--linie); padding-top: 14px; margin-top: 14px; }
  .einstellungen section:first-of-type { border-top: 0; margin-top: 8px; padding-top: 0; }
  .empf + .empf { margin-top: 8px; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; margin: 8px 0; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .protokoll summary { font-size: 1.05rem; font-weight: 700; }
  .kasse-form, .kopf-form { display: flex; flex-direction: column; gap: 8px; }
  .kasse-form textarea { width: 100%; }
</style>
