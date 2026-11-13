<script lang="ts">
  import { onMount } from 'svelte';
  import type { Konto, TurnierInfo } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe } from '../router.svelte';
  import { api } from '../dienste';
  import { anmeldungAbgelaufen, app, fehlerText, kontoTurnierOeffnen } from '../app.svelte';
  import PasswortFeld from './PasswortFeld.svelte';

  const sitzung = $derived(app.sitzung);
  let konten = $state<Konto[]>([]);
  let turniere = $state<TurnierInfo[]>([]);
  let name = $state('');
  let email = $state('');
  let passwort = $state('');
  let meldung = $state<{ ok: boolean; text: string } | null>(null);
  let laeuft = $state(false);

  async function laden() {
    const s = app.sitzung;
    if (!s || s.konto.rolle !== 'admin') return;
    try {
      konten = (await api.konten(s.token)).konten;
      turniere = (await api.turniere(s.token, true)).turniere;
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    }
  }
  onMount(() => {
    if (!app.sitzung) gehe('anmelden');
    else void laden();
  });

  async function anlegen(e: SubmitEvent) {
    e.preventDefault();
    if (!sitzung) return;
    laeuft = true;
    meldung = null;
    try {
      await api.kontoAnlegen(sitzung.token, { name: name.trim(), email: email.trim(), passwort });
      meldung = { ok: true, text: T.admin.angelegt };
      name = email = passwort = '';
      await laden();
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    } finally {
      laeuft = false;
    }
  }

  async function umschalten(k: Konto) {
    if (!sitzung) return;
    try {
      await api.kontoSperren(sitzung.token, k.id, !k.gesperrt);
      await laden();
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    }
  }

  function wann(iso: string | null) {
    return iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : T.admin.nie;
  }
  function datumText(d: string | null) {
    return d ? new Date(d + 'T12:00:00').toLocaleDateString('de-DE') : '';
  }
</script>

<h1>{T.admin.titel}</h1>
{#if !sitzung || sitzung.konto.rolle !== 'admin'}
  <div class="meldung info">{T.admin.nurAdmin}</div>
{:else}
  <p class="leise">{T.admin.hinweis}</p>
  {#if meldung}<div class="meldung" class:ok={meldung.ok} class:fehler={!meldung.ok}>{meldung.text}</div>{/if}

  <section class="karte">
    <h2>{T.admin.konten} <span class="leise">({konten.length})</span></h2>
    <ul class="liste">
      {#each konten as k (k.id)}
        <li class="reihe">
          <div class="wachsen">
            <strong>{k.name}</strong>
            <span class="marke">{k.rolle === 'admin' ? T.admin.rolleAdmin : T.admin.rolleVeranstalter}</span>
            {#if k.gesperrt}<span class="marke gesperrt">{T.admin.gesperrt}</span>{/if}
            <br /><span class="leise">{k.email}</span>
            <br /><span class="leise">{T.admin.zuletztAktiv}: {wann(k.zuletztAktiv ?? k.letzteAnmeldung)} · {T.admin.turniere}: {k.turniere ?? 0}</span>
          </div>
          {#if k.id !== sitzung.konto.id}
            <button class="klein" class:gefahr={!k.gesperrt} class:zweit={k.gesperrt} onclick={() => umschalten(k)}>
              {k.gesperrt ? T.admin.entsperren : T.admin.sperren}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section class="karte">
    <h2>{T.admin.alleTurniere}</h2>
    {#if turniere.length === 0}
      <p class="leise">{T.admin.keineTurniere}</p>
    {:else}
      <ul class="liste">
        {#each turniere as t (t.id)}
          <li class="reihe">
            <div class="wachsen"><strong>{t.name}</strong><br /><span class="leise">{t.veranstalter} · {datumText(t.datum)}</span></div>
            <button class="zweit klein" onclick={() => kontoTurnierOeffnen(t, false)}>{T.admin.oeffnen}</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <details class="karte">
    <summary>{T.admin.neuesKonto}</summary>
    <form onsubmit={anlegen}>
      <label for="kn">{T.admin.name}</label>
      <input id="kn" bind:value={name} required minlength="2" autocomplete="off" />
      <label for="ke">{T.admin.email}</label>
      <input id="ke" type="email" bind:value={email} required autocomplete="off" />
      <label for="kp">{T.admin.passwort}</label>
      <PasswortFeld id="kp" bind:wert={passwort} neu min={8} />
      <button type="submit" style="margin-top:12px" disabled={laeuft}>{T.admin.anlegen}</button>
    </form>
  </details>
{/if}

<style>
  .marke.gesperrt { color: var(--rot); border-color: var(--rot); }
</style>
