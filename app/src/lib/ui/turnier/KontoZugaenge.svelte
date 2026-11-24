<script lang="ts">
  import { onMount } from 'svelte';
  import type { TurnierKontenAntwort } from '@shared/protokoll';
  import { T } from '../../texte';
  import { api } from '../../dienste';
  import { app, fehlerText } from '../../app.svelte';
  import Hilfe from '../Hilfe.svelte';
  import { aktiveSparte } from '../../sparte.svelte';

  /**
   * Turnierleitung per Konto (ab 0.17): Konten einladen, die genau dieses Turnier leiten (ohne eigene Kennung).
   * Nur für die Leitung mit Konto – mit einer Leitungskennung allein lassen sich keine Konten einladen.
   */
  let { id }: { id: string } = $props();
  let daten = $state<TurnierKontenAntwort | null>(null);
  let name = $state('');
  let email = $state('');
  let link = $state('');
  let meldung = $state<{ ok: boolean; text: string } | null>(null);

  const moeglich = $derived(app.server.art === 'bereit' && !!app.server.info.sparten && !!app.sitzung);
  /** Einladen dürfen Spartenleitung und Turnierleitungen mit Recht „Turniere anlegen“ (die Einladung gibt Zugriff auf den Pool) */
  const einladenErlaubt = $derived(!!aktiveSparte()?.anlegen || app.sitzung?.konto.rolle === 'admin');

  onMount(async () => {
    if (!moeglich || !app.sitzung) return;
    try {
      daten = await api.turnierKonten(app.sitzung.token, id);
    } catch {
      daten = null; // keine Leitung per Konto: Abschnitt bleibt verborgen
    }
  });

  async function einladen(e: SubmitEvent) {
    e.preventDefault();
    if (!app.sitzung) return;
    meldung = null;
    try {
      const a = await api.turnierEinladen(app.sitzung.token, id, email.trim(), name.trim());
      daten = { konten: a.konten, einladungen: a.einladungen };
      link = a.gesendet ? '' : a.link;
      name = email = '';
      meldung = { ok: true, text: T.sparte.einladungGesendet };
    } catch (x) {
      meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    }
  }

  async function entfernen(konto: number, n: string) {
    if (!app.sitzung || !confirm(T.kontoZugang.entfernenFrage(n))) return;
    try {
      daten = await api.turnierKontoEntfernen(app.sitzung.token, id, konto);
    } catch (x) {
      meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    }
  }
</script>

{#if daten}
  <div class="konto-zugaenge" data-testid="konto-zugaenge">
    <div class="label-zeile"><h3>{T.kontoZugang.titel}</h3><Hilfe text={T.kontoZugang.hilfe} /></div>
    {#if daten.konten.length}
      <ul class="liste">
        {#each daten.konten as k (k.konto)}
          <li><span>{k.name}</span><button class="zweit klein" onclick={() => entfernen(k.konto, k.name)}>{T.app.entfernen}</button></li>
        {/each}
      </ul>
    {/if}
    {#if daten.einladungen.length}
      <p class="leise">{T.sparte.offeneEinladungen}: {daten.einladungen.map((x) => x.name).join(', ')}</p>
    {/if}
    {#if einladenErlaubt}
    <form onsubmit={einladen}>
      <div class="reihe">
        <input class="wachsen" bind:value={name} placeholder={T.sparte.einladungName} aria-label={T.sparte.einladungName} minlength="2" maxlength="120" required autocomplete="off" />
        <input class="wachsen" type="email" bind:value={email} placeholder={T.sparte.einladungEmail} aria-label={T.sparte.einladungEmail} required autocomplete="off" inputmode="email" autocapitalize="off" />
        <button type="submit" class="zweit">{T.kontoZugang.einladen}</button>
      </div>
    </form>
    {/if}
    {#if meldung}<div class="meldung" class:ok={meldung.ok} class:fehler={!meldung.ok} role="status">{meldung.text}</div>{/if}
    {#if link}
      <p class="leise">{T.sparte.einladungLink}</p>
      <input readonly value={link} aria-label={T.sparte.einladungLink} />
    {/if}
  </div>
{/if}

<style>
  .konto-zugaenge { border-top: 1px solid var(--linie); margin-top: 12px; padding-top: 8px; }
  h3 { margin: 0; font-size: 1rem; }
  .liste { list-style: none; padding: 0; margin: 8px 0; }
  .liste li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--linie); }
</style>
