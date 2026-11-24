<script lang="ts">
  import { onMount } from 'svelte';
  import type { SparteAntwort, SparteRolle, Einladung } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { anmeldungAbgelaufen, app, fehlerText, setzeSitzung } from '../app.svelte';
  import { aktiveSparte, meineSparten, setzeAktiveSparte, spartenName } from '../sparte.svelte';
  import Hilfe from './Hilfe.svelte';
  import PasswortFeld from './PasswortFeld.svelte';

  /**
   * #/sparte[/<id>] (ab 0.17): Verein und Sparte, Mitglieder (Spartenleitung, Turnierleitungen mit Recht
   * „Turniere anlegen“), Einladungen, Ausschüsse, Veranstaltungen (Platzhalter), weitere Sparte, Sparte löschen.
   * Die Mitgliederliste sieht nur die Spartenleitung.
   */
  let { id = null }: { id?: number | null } = $props();

  const sitzung = $derived(app.sitzung);
  const kurz = $derived(id ? (meineSparten().find((s) => s.id === id) ?? null) : aktiveSparte());
  const leitung = $derived(kurz?.rolle === 'spartenleitung' || sitzung?.konto.rolle === 'admin');
  let daten = $state<SparteAntwort | null>(null);
  let fehler = $state('');
  let meldung = $state('');
  let link = $state('');

  // Formulare
  let einName = $state('');
  let einMail = $state('');
  let einRolle = $state<SparteRolle>('turnierleitung');
  let einAnlegen = $state(false);
  let ausName = $state('');
  let verName = $state('');
  let verDatum = $state('');
  let verAusschuss = $state('');
  let neuVerein = $state('');
  let neuName = $state('');
  let loeschPw = $state('');
  let vereinWert = $state('');
  let sparteWert = $state('');

  onMount(() => {
    if (!app.sitzung) gehe('anmelden/sparte');
  });
  // Laden, sobald Server und Konto bereit sind (nach einem Neuladen der Seite erst nach der Serverprüfung)
  let geladenFuer = -1;
  $effect(() => {
    const sp = kurz;
    if (sp && leitung && geladenFuer !== sp.id) {
      geladenFuer = sp.id;
      void laden();
    }
  });

  async function laden() {
    const s = app.sitzung;
    const sp = kurz;
    if (!s || !sp) return;
    if (id) setzeAktiveSparte(id);
    if (!leitung) return;
    try {
      daten = await api.sparte(s.token, sp.id);
      vereinWert = daten.sparte.verein;
      sparteWert = daten.sparte.name;
      fehler = '';
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  }

  /** Nach Änderungen an Sparten (Anlegen, Löschen, Austritt) die Liste im Konto erneuern */
  async function kontoNeu() {
    const s = app.sitzung;
    if (!s) return;
    const ich = await api.ich(s.token);
    if (ich.konto) setzeSitzung({ token: s.token, konto: ich.konto });
  }

  async function aktion(f: () => Promise<unknown>, ok = '') {
    fehler = '';
    meldung = '';
    try {
      await f();
      meldung = ok;
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  }

  function datum(d: string | null) {
    return d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('de-DE') : '';
  }

  async function angabenSpeichern(e: SubmitEvent) {
    e.preventDefault();
    const s = app.sitzung;
    if (!s || !daten) return;
    await aktion(async () => {
      await api.sparteAendern(s.token, daten!.sparte.id, { verein: vereinWert.trim(), name: sparteWert.trim() });
      await kontoNeu();
      await laden();
    }, T.app.gespeichert);
  }

  async function avvZustimmen() {
    const s = app.sitzung;
    if (!s || !daten) return;
    await aktion(async () => {
      await api.sparteAendern(s.token, daten!.sparte.id, { avv: true });
      await laden();
    });
  }

  async function einladen(e: SubmitEvent) {
    e.preventDefault();
    const s = app.sitzung;
    if (!s || !daten) return;
    await aktion(async () => {
      const a = await api.sparteEinladen(s.token, daten!.sparte.id, einMail.trim(), einName.trim(), einRolle, einRolle === 'turnierleitung' && einAnlegen);
      link = a.gesendet ? '' : a.link;
      einName = einMail = '';
      einAnlegen = false;
      await laden();
    }, T.sparte.einladungGesendet);
  }

  async function zurueckziehen(e: Einladung) {
    const s = app.sitzung;
    if (!s) return;
    await aktion(async () => {
      await api.einladungZurueckziehen(s.token, e.id);
      await laden();
    });
  }

  async function rolleSetzen(konto: number, rolle: SparteRolle) {
    const s = app.sitzung;
    if (!s || !daten) return;
    await aktion(async () => {
      daten = await api.mitgliedAendern(s.token, daten!.sparte.id, konto, { rolle });
    });
  }
  async function anlegenSetzen(konto: number, anlegen: boolean) {
    const s = app.sitzung;
    if (!s || !daten) return;
    await aktion(async () => {
      daten = await api.mitgliedAendern(s.token, daten!.sparte.id, konto, { anlegen });
    });
  }
  async function entfernen(konto: number, name: string, ich: boolean) {
    const s = app.sitzung;
    if (!s || !kurz || !confirm(ich ? T.sparte.austretenFrage : T.sparte.entfernenFrage(name))) return;
    await aktion(async () => {
      await api.mitgliedEntfernen(s.token, kurz!.id, konto);
      if (ich) {
        await kontoNeu();
        gehe('turniere');
      } else await laden();
    });
  }

  async function ausschussAnlegen(e: SubmitEvent) {
    e.preventDefault();
    const s = app.sitzung;
    if (!s || !daten) return;
    await aktion(async () => {
      const a = await api.ausschussAnlegen(s.token, daten!.sparte.id, ausName.trim());
      ausName = '';
      await kontoNeu();
      gehe(`ausschuss/${a.ausschuss.id}`);
    });
  }

  async function veranstaltungAnlegen(e: SubmitEvent) {
    e.preventDefault();
    const s = app.sitzung;
    if (!s || !daten) return;
    await aktion(async () => {
      daten = await api.veranstaltungAnlegen(s.token, daten!.sparte.id, verName.trim(), verDatum || null, verAusschuss ? Number(verAusschuss) : null);
      verName = verDatum = verAusschuss = '';
    });
  }
  async function veranstaltungLoeschen(v: number) {
    const s = app.sitzung;
    if (!s || !daten) return;
    await aktion(async () => {
      daten = await api.veranstaltungLoeschen(s.token, daten!.sparte.id, v);
    });
  }

  async function neueSparte(e: SubmitEvent) {
    e.preventDefault();
    const s = app.sitzung;
    if (!s) return;
    await aktion(async () => {
      const a = await api.sparteAnlegen(s.token, neuVerein.trim(), neuName.trim());
      setzeSitzung({ token: s.token, konto: { ...s.konto, sparten: a.sparten, ausschuesse: a.ausschuesse } });
      setzeAktiveSparte(a.sparte.id);
      neuVerein = neuName = '';
      gehe(`sparte/${a.sparte.id}`);
    });
  }

  async function sparteLoeschen(e: SubmitEvent) {
    e.preventDefault();
    const s = app.sitzung;
    if (!s || !daten || !confirm(T.sparte.loeschenFrage)) return;
    await aktion(async () => {
      const a = await api.sparteLoeschen(s.token, daten!.sparte.id, loeschPw);
      setzeSitzung({ token: s.token, konto: { ...s.konto, sparten: a.sparten, ausschuesse: a.ausschuesse } });
      app.hinweis = T.sparte.geloescht;
      gehe('turniere');
    });
  }

  async function linkKopieren() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* Zwischenablage nicht erlaubt – Link steht im Feld */
    }
  }
</script>

{#if sitzung}
  <h1>{T.sparte.titel}</h1>

  {#if meineSparten().length > 1}
    <section class="karte">
      <div class="label-zeile"><label for="sw">{T.sparte.wechseln}</label><Hilfe text={T.sparte.wechselnHilfe} /></div>
      <select id="sw" value={kurz?.id ?? ''} onchange={(e) => gehe(`sparte/${e.currentTarget.value}`)}>
        {#each meineSparten() as s (s.id)}<option value={s.id}>{spartenName(s)} ({T.sparte.rolle[s.rolle]})</option>{/each}
      </select>
    </section>
  {/if}

  {#if !kurz}
    <section class="karte"><p>{T.konto.keineSparte}</p></section>
  {:else}
    <section class="karte">
      <p><strong data-testid="sparte-name">{spartenName(kurz)}</strong></p>
      <p class="leise">{T.sparte.deineRolle(T.sparte.rolle[kurz.rolle] ?? '', kurz.anlegen && kurz.rolle !== 'spartenleitung')} <Hilfe text={T.sparte.rolleHilfe} /></p>
      {#if !leitung}
        <p class="leise">{T.sparte.keineLeitung}</p>
        <button class="zweit" onclick={() => entfernen(sitzung.konto.id, sitzung.konto.name, true)}>{T.sparte.austreten}</button>
      {/if}
    </section>
  {/if}

  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  {#if meldung}<div class="meldung ok" role="status">{meldung}</div>{/if}

  {#if daten && leitung}
    {#if !daten.sparte.avv}
      <div class="meldung info">{T.sparte.avvFehlt} <button class="klein" onclick={avvZustimmen}>{T.sparte.avvZustimmen}</button></div>
    {/if}

    <details class="karte">
      <summary>{T.sparte.angaben}</summary>
      <form onsubmit={angabenSpeichern}>
        <label for="sv">{T.sparte.vereinName}</label>
        <input id="sv" bind:value={vereinWert} minlength="2" maxlength="160" required />
        <label for="sn">{T.sparte.sparteName}</label>
        <input id="sn" bind:value={sparteWert} minlength="2" maxlength="120" required />
        {#if daten.sparte.avv}<p class="leise">{T.sparte.avv(datum(daten.sparte.avv))}</p>{/if}
        <button type="submit" style="margin-top:12px">{T.app.speichern}</button>
      </form>
    </details>

    <section class="karte" data-testid="mitglieder">
      <div class="label-zeile"><h2>{T.sparte.mitglieder}</h2><Hilfe text={T.sparte.mitgliederHilfe} /></div>
      <ul class="liste">
        {#each daten.mitglieder as m (m.konto)}
          <li data-testid="mitglied">
            <div>
              <strong>{m.name}</strong>{#if m.ich} <span class="leise">({T.sparte.ich})</span>{/if}<br />
              <span class="leise umbruch">{m.email}</span><br />
              <span class="marke">{T.sparte.rolle[m.rolle]}</span>
              {#if m.rolle === 'turnierleitung' && m.turniere.length}<span class="leise"> · {T.sparte.turniereMit(m.turniere.length)}</span>{/if}
            </div>
            {#if m.rolle === 'turnierleitung'}
              <div class="label-zeile">
                <label class="haken"><input type="checkbox" checked={m.anlegen} onchange={(e) => anlegenSetzen(m.konto, e.currentTarget.checked)} /> {T.sparte.anlegenRecht}</label>
                <Hilfe text={T.sparte.anlegenRechtHilfe} />
              </div>
            {/if}
            <div class="reihe">
              {#if m.rolle === 'turnierleitung'}
                <button class="zweit klein" onclick={() => rolleSetzen(m.konto, 'spartenleitung')}>{T.sparte.zurSpartenleitung}</button>
              {:else}
                <button class="zweit klein" onclick={() => rolleSetzen(m.konto, 'turnierleitung')}>{T.sparte.zurTurnierleitung}</button>
              {/if}
              <button class="zweit klein" onclick={() => entfernen(m.konto, m.name, m.ich)}>{m.ich ? T.sparte.austreten : T.sparte.entfernen}</button>
            </div>
          </li>
        {/each}
      </ul>

      {#if daten.einladungen.length}
        <h3>{T.sparte.offeneEinladungen}</h3>
        <ul class="liste">
          {#each daten.einladungen as e (e.id)}
            <li>
              <div><strong>{e.name}</strong> <span class="leise umbruch">{e.email}</span><br /><span class="leise">{e.art === 'turnier' ? `${T.sparte.rolle.turnierleitung} (${e.ziel})` : T.sparte.rolle[e.rolle]} · {T.sparte.bis(datum(e.ablauf))}</span></div>
              <button class="zweit klein" onclick={() => zurueckziehen(e)}>{T.sparte.zurueckziehen}</button>
            </li>
          {/each}
        </ul>
      {/if}

      <details class="unter" data-testid="einladen">
        <summary>{T.sparte.einladen}</summary>
        <p class="leise">{T.sparte.einladenHilfe}</p>
        <form onsubmit={einladen}>
          <label for="en">{T.sparte.einladungName}</label>
          <input id="en" bind:value={einName} minlength="2" maxlength="120" required autocomplete="off" />
          <label for="em">{T.sparte.einladungEmail}</label>
          <input id="em" type="email" bind:value={einMail} required autocomplete="off" inputmode="email" autocapitalize="off" />
          <label for="er">{T.sparte.einladungRolle}</label>
          <select id="er" bind:value={einRolle}>
            <option value="turnierleitung">{T.sparte.rolle.turnierleitung}</option>
            <option value="spartenleitung">{T.sparte.rolle.spartenleitung}</option>
          </select>
          {#if einRolle === 'turnierleitung'}
            <label class="haken"><input type="checkbox" bind:checked={einAnlegen} /> {T.sparte.anlegenRecht}</label>
          {/if}
          <button type="submit" style="margin-top:12px">{T.sparte.einladungSenden}</button>
        </form>
        {#if link}
          <p class="leise">{T.sparte.einladungLink}</p>
          <input readonly value={link} aria-label={T.sparte.einladungLink} data-testid="einladung-link" />
          <button class="zweit klein" onclick={linkKopieren}>{T.sparte.einladungKopieren}</button>
        {/if}
      </details>
    </section>

    <section class="karte" data-testid="ausschuesse">
      <div class="label-zeile"><h2>{T.sparte.ausschuesse}</h2><Hilfe text={T.sparte.ausschuesseHilfe} /></div>
      {#if daten.ausschuesse.length}
        <ul class="liste">
          {#each daten.ausschuesse as a (a.id)}
            <li><a href={linkZu(`ausschuss/${a.id}`)}>{a.name}</a> <span class="leise">{T.sparte.ausschussMitglieder(a.mitglieder)}</span></li>
          {/each}
        </ul>
      {/if}
      <form class="reihe" onsubmit={ausschussAnlegen}>
        <input class="wachsen" bind:value={ausName} placeholder={T.sparte.ausschussName} aria-label={T.sparte.ausschussName} minlength="2" maxlength="120" required />
        <button type="submit" class="zweit">{T.sparte.ausschussAnlegen}</button>
      </form>
    </section>

    <details class="karte" data-testid="veranstaltungen">
      <summary>{T.sparte.veranstaltungen}</summary>
      <p class="leise">{T.sparte.veranstaltungenHilfe}</p>
      {#if daten.veranstaltungen.length}
        <ul class="liste">
          {#each daten.veranstaltungen as v (v.id)}
            <li>
              <div><strong>{v.name}</strong>{#if v.datum} <span class="leise">{datum(v.datum)}</span>{/if}
                {#if v.ausschuss}<br /><span class="leise">{daten.ausschuesse.find((a) => a.id === v.ausschuss)?.name ?? ''}</span>{/if}</div>
              <button class="zweit klein" aria-label="{v.name}: {T.app.entfernen}" onclick={() => veranstaltungLoeschen(v.id)}>✕</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="leise">{T.sparte.veranstaltungLeer}</p>
      {/if}
      <form onsubmit={veranstaltungAnlegen}>
        <label for="vn">{T.sparte.veranstaltungName}</label>
        <input id="vn" bind:value={verName} minlength="2" maxlength="160" required />
        <label for="vd">{T.sparte.veranstaltungDatum}</label>
        <input id="vd" type="date" bind:value={verDatum} />
        <label for="va">{T.sparte.veranstaltungAusschuss}</label>
        <select id="va" bind:value={verAusschuss}>
          <option value="">{T.sparte.kein}</option>
          {#each daten.ausschuesse as a (a.id)}<option value={String(a.id)}>{a.name}</option>{/each}
        </select>
        <button type="submit" class="zweit" style="margin-top:12px">{T.sparte.veranstaltungAnlegen}</button>
      </form>
    </details>

    <details class="karte">
      <summary>{T.sparte.neueSparte}</summary>
      <p class="leise">{T.sparte.neueSparteHilfe}</p>
      <form onsubmit={neueSparte}>
        <label for="nv">{T.sparte.vereinName}</label>
        <input id="nv" bind:value={neuVerein} minlength="2" maxlength="160" required placeholder={daten.sparte.verein} />
        <label for="ns">{T.sparte.sparteName}</label>
        <input id="ns" bind:value={neuName} minlength="2" maxlength="120" required />
        <p class="leise">{T.registrieren.bedingungenVor} <a href={linkZu('bedingungen')}>{T.registrieren.bedingungenLink}</a> {T.registrieren.bedingungenNach}</p>
        <button type="submit" class="zweit">{T.sparte.neueSparteKnopf}</button>
      </form>
    </details>

    <details class="karte gefahrzone">
      <summary>{T.sparte.loeschen}</summary>
      <p class="leise">{T.sparte.loeschenText(daten.sparte.turniere ?? 0)}</p>
      <form onsubmit={sparteLoeschen}>
        <label for="sl">{T.sparte.loeschenPasswort}</label>
        <PasswortFeld id="sl" bind:wert={loeschPw} />
        <button type="submit" class="gefahr" style="margin-top:12px">{T.sparte.loeschenKnopf}</button>
      </form>
    </details>
  {/if}
{/if}

<style>
  .liste { list-style: none; padding: 0; margin: 0 0 12px; display: grid; gap: 10px; }
  .liste li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--linie); }
  .liste li > div:first-child { flex: 1 1 220px; min-width: 0; }
  .umbruch { overflow-wrap: anywhere; }
  .unter { margin-top: 8px; }
  .gefahrzone summary { color: var(--rot); }
  h3 { margin: 12px 0 4px; font-size: 1rem; }
</style>
