<script lang="ts">
  import { onMount } from 'svelte';
  import type { TurnierInfo } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe } from '../router.svelte';
  import { api } from '../dienste';
  import { ApiFehler } from '../engine/api';
  import { gemerktesTurnier, kontoSitzung, setzeKontoSitzung, turnierMerken } from '../einstellungen';
  import Verwaltung from './Verwaltung.svelte';

  const sitzung = kontoSitzung();
  let turniere = $state<TurnierInfo[]>([]);
  let alle = $state<TurnierInfo[]>([]);
  let laedt = $state(true);
  let fehler = $state('');

  let name = $state('');
  let datum = $state(new Date().toISOString().slice(0, 10));
  let leitungsPasswort = $state('');
  let anlegenFehler = $state('');
  let laeuft = $state(false);

  let pwAlt = $state('');
  let pwNeu = $state('');
  let pwMeldung = $state<{ ok: boolean; text: string } | null>(null);

  function abgelaufen(x: unknown) {
    if (x instanceof ApiFehler && (x.code === 'nicht_angemeldet' || x.code === 'gesperrt')) {
      setzeKontoSitzung(null);
      gehe('anmelden');
      return true;
    }
    return false;
  }

  async function laden() {
    if (!sitzung) return;
    laedt = true;
    try {
      turniere = (await api.turniere(sitzung.token)).turniere;
      if (sitzung.konto.rolle === 'admin') alle = (await api.turniere(sitzung.token, true)).turniere;
      fehler = '';
    } catch (x) {
      if (!abgelaufen(x)) fehler = x instanceof Error ? x.message : T.app.fehlerAllgemein;
    } finally {
      laedt = false;
    }
  }

  onMount(() => {
    if (!sitzung) gehe('anmelden');
    else void laden();
  });

  async function anlegen(e: SubmitEvent) {
    e.preventDefault();
    if (!sitzung) return;
    anlegenFehler = '';
    laeuft = true;
    try {
      const a = await api.turnierAnlegen(sitzung.token, { name: name.trim(), datum: datum || null, leitungsPasswort });
      turnierMerken({ id: a.turnier.id, name: a.turnier.name, datum: a.turnier.datum, modus: 'online', rolle: 'leitung', token: a.token });
      gehe('t/' + a.turnier.id);
    } catch (x) {
      if (!abgelaufen(x)) anlegenFehler = x instanceof Error ? x.message : T.app.fehlerAllgemein;
    } finally {
      laeuft = false;
    }
  }

  function oeffnen(t: TurnierInfo, eigenes: boolean) {
    const g = gemerktesTurnier(t.id);
    // Eigene Turniere darf das Konto direkt beschreiben; fremde (Admin-Übersicht) nur ansehen.
    const token = g?.token ?? (eigenes && sitzung ? sitzung.token : null);
    turnierMerken({ id: t.id, name: t.name, datum: t.datum, modus: 'online', rolle: token ? 'leitung' : 'zuschauer', token });
    gehe('t/' + t.id);
  }

  async function abmelden() {
    if (sitzung) await api.logout(sitzung.token).catch(() => undefined);
    setzeKontoSitzung(null);
    gehe('');
  }

  async function passwortAendern(e: SubmitEvent) {
    e.preventDefault();
    if (!sitzung) return;
    try {
      await api.passwortAendern(sitzung.token, pwAlt, pwNeu);
      pwMeldung = { ok: true, text: T.konto.passwortGeaendert };
      pwAlt = pwNeu = '';
    } catch (x) {
      if (!abgelaufen(x)) pwMeldung = { ok: false, text: x instanceof Error ? x.message : T.app.fehlerAllgemein };
    }
  }

  function datumText(d: string | null) {
    return d ? new Date(d + 'T12:00:00').toLocaleDateString('de-DE') : '';
  }
</script>

{#if sitzung}
  <div class="reihe kopf">
    <h1 class="wachsen">{T.konto.titel}</h1>
    <button class="zweit klein" onclick={abmelden}>{T.konto.abmelden}</button>
  </div>
  <p class="leise">{sitzung.konto.name} · {sitzung.konto.email}</p>

  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}

  <form class="karte" onsubmit={anlegen}>
    <h2>{T.konto.neuesTurnier}</h2>
    <label for="tn">{T.konto.name}</label>
    <input id="tn" bind:value={name} required minlength="2" autocomplete="off" />
    <label for="td">{T.konto.datum}</label>
    <input id="td" type="date" bind:value={datum} />
    <label for="tp">{T.konto.leitungsPasswort}</label>
    <input id="tp" bind:value={leitungsPasswort} required minlength="6" autocomplete="off" />
    <p class="leise">{T.konto.leitungsPasswortHinweis}</p>
    {#if anlegenFehler}<div class="meldung fehler" role="alert">{anlegenFehler}</div>{/if}
    <button type="submit" disabled={laeuft}>{T.konto.anlegen}</button>
  </form>

  <section class="karte">
    <h2>{T.konto.turniere}</h2>
    {#if laedt}
      <p class="leise">{T.app.laden}</p>
    {:else if turniere.length === 0}
      <p class="leise">{T.konto.keineTurniere}</p>
    {:else}
      <ul class="liste">
        {#each turniere as t (t.id)}
          <li class="reihe">
            <div class="wachsen"><strong>{t.name}</strong><br /><span class="leise">{datumText(t.datum)} · {t.id}</span></div>
            <button class="zweit klein" onclick={() => oeffnen(t, true)}>{T.konto.oeffnen}</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if sitzung.konto.rolle === 'admin'}
    <Verwaltung token={sitzung.token} eigeneId={sitzung.konto.id} beiAblauf={abgelaufen} />
    <section class="karte">
      <h2>{T.konto.alleTurniere}</h2>
      <ul class="liste">
        {#each alle as t (t.id)}
          <li class="reihe">
            <div class="wachsen"><strong>{t.name}</strong><br /><span class="leise">{t.veranstalter} · {datumText(t.datum)}</span></div>
            <button class="zweit klein" onclick={() => oeffnen(t, turniere.some((x) => x.id === t.id))}>{T.konto.oeffnen}</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <details class="karte">
    <summary>{T.konto.passwortAendern}</summary>
    <form onsubmit={passwortAendern}>
      <label for="pa">{T.konto.passwortAlt}</label>
      <input id="pa" type="password" bind:value={pwAlt} autocomplete="current-password" required />
      <label for="pn">{T.konto.passwortNeu}</label>
      <input id="pn" type="password" bind:value={pwNeu} autocomplete="new-password" minlength="8" required />
      {#if pwMeldung}<div class="meldung" class:ok={pwMeldung.ok} class:fehler={!pwMeldung.ok}>{pwMeldung.text}</div>{/if}
      <button type="submit" style="margin-top:12px">{T.app.speichern}</button>
    </form>
  </details>
{/if}

<style>
  .kopf h1 { margin: 0; }
</style>
