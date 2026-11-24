<script lang="ts">
  import { onMount } from 'svelte';
  import { AUSSCHUSS_MAX_NACHRICHT, type AusschussAntwort } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { anmeldungAbgelaufen, app, fehlerText, setzeSitzung } from '../app.svelte';
  import Hilfe from './Hilfe.svelte';

  /**
   * #/ausschuss/<id> (ab 0.17): Mitglieder einladen und sperren, Nachrichten lesen und schreiben.
   * Neue Nachrichten holt die Seite alle 30 Sekunden, solange sie sichtbar ist.
   */
  let { id }: { id: number } = $props();
  let daten = $state<AusschussAntwort | null>(null);
  let fehler = $state('');
  let meldung = $state('');
  let text = $state('');
  let einName = $state('');
  let einMail = $state('');
  let link = $state('');

  onMount(() => {
    if (!app.sitzung) {
      gehe(`anmelden/ausschuss/${id}`);
      return;
    }
    void laden();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void laden();
    }, 30_000);
    return () => clearInterval(t);
  });

  async function laden() {
    const s = app.sitzung;
    if (!s) return;
    try {
      daten = await api.ausschuss(s.token, id);
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  }

  async function aktion(f: () => Promise<void>, ok = '') {
    fehler = '';
    meldung = '';
    try {
      await f();
      meldung = ok;
    } catch (x) {
      if (!anmeldungAbgelaufen(x)) fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  }

  async function senden(e: SubmitEvent) {
    e.preventDefault();
    const s = app.sitzung;
    if (!s || !text.trim()) return;
    await aktion(async () => {
      daten = await api.ausschussNachricht(s.token, id, text.trim());
      text = '';
    });
  }

  async function einladen(e: SubmitEvent) {
    e.preventDefault();
    const s = app.sitzung;
    if (!s) return;
    await aktion(async () => {
      const a = await api.ausschussEinladen(s.token, id, einMail.trim(), einName.trim());
      daten = a;
      link = a.gesendet ? '' : a.link;
      einName = einMail = '';
    }, T.sparte.einladungGesendet);
  }

  async function sperren(konto: number, name: string, gesperrt: boolean) {
    const s = app.sitzung;
    if (!s || (gesperrt && !confirm(T.ausschuss.sperrenFrage(name)))) return;
    await aktion(async () => {
      daten = await api.ausschussSperren(s.token, id, konto, gesperrt);
    });
  }

  async function verlassen() {
    const s = app.sitzung;
    if (!s || !confirm(T.ausschuss.verlassenFrage)) return;
    await aktion(async () => {
      const a = await api.ausschussVerlassen(s.token, id);
      setzeSitzung({ token: s.token, konto: { ...s.konto, sparten: a.sparten, ausschuesse: a.ausschuesse } });
      gehe('konto');
    });
  }

  async function loeschen() {
    const s = app.sitzung;
    if (!s || !daten || !confirm(T.ausschuss.loeschenFrage)) return;
    const sparte = daten.ausschuss.sparte;
    await aktion(async () => {
      await api.ausschussLoeschen(s.token, id);
      const ich = await api.ich(s.token);
      if (ich.konto) setzeSitzung({ token: s.token, konto: ich.konto });
      gehe(`sparte/${sparte}`);
    });
  }

  function zeit(iso: string) {
    return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
</script>

{#if daten}
  <h1>{daten.ausschuss.name}</h1>
  <p class="leise">{T.ausschuss.titel} · {daten.ausschuss.sparteName}</p>
{:else}
  <h1>{T.ausschuss.titel}</h1>
{/if}
{#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
{#if meldung}<div class="meldung ok" role="status">{meldung}</div>{/if}

{#if daten}
  <section class="karte" data-testid="nachrichten">
    <div class="label-zeile"><h2>{T.ausschuss.nachrichten}</h2><Hilfe text={T.ausschuss.nachrichtenHilfe} /></div>
    {#if daten.nachrichten.length === 0}
      <p class="leise">{T.ausschuss.leer}</p>
    {:else}
      <ol class="nachrichten">
        {#each daten.nachrichten as n (n.id)}
          <li class:ich={n.ich} data-testid="nachricht"><span class="leise">{n.von} · {zeit(n.zeit)}</span><p>{n.text}</p></li>
        {/each}
      </ol>
    {/if}
    <form onsubmit={senden}>
      <label for="nt">{T.ausschuss.schreiben}</label>
      <textarea id="nt" bind:value={text} rows="3" maxlength={AUSSCHUSS_MAX_NACHRICHT}></textarea>
      <div class="reihe">
        <button type="submit" disabled={!text.trim()}>{T.ausschuss.senden}</button>
        <button type="button" class="zweit" onclick={laden}>{T.ausschuss.aktualisieren}</button>
      </div>
    </form>
  </section>

  <section class="karte" data-testid="ausschuss-mitglieder">
    <div class="label-zeile"><h2>{T.ausschuss.mitglieder}</h2><Hilfe text={T.ausschuss.mitgliederHilfe} /></div>
    <ul class="liste">
      {#each daten.mitglieder as m (m.konto)}
        <li>
          <span>{m.name}{#if m.ich} <span class="leise">({T.sparte.ich})</span>{/if}{#if m.gesperrt} <span class="marke gesperrt">{T.ausschuss.gesperrt}</span>{/if}</span>
          {#if !m.ich}
            <button class="zweit klein" onclick={() => sperren(m.konto, m.name, !m.gesperrt)}>{m.gesperrt ? T.ausschuss.entsperren : T.ausschuss.sperren}</button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if daten.einladungen.length}
      <h3>{T.sparte.offeneEinladungen}</h3>
      <ul class="liste">
        {#each daten.einladungen as e (e.id)}<li><span>{e.name} <span class="leise">{e.email}</span></span></li>{/each}
      </ul>
    {/if}
    <details>
      <summary>{T.ausschuss.einladen}</summary>
      <p class="leise">{T.sparte.einladenHilfe}</p>
      <form onsubmit={einladen}>
        <label for="an">{T.sparte.einladungName}</label>
        <input id="an" bind:value={einName} minlength="2" maxlength="120" required autocomplete="off" />
        <label for="am">{T.sparte.einladungEmail}</label>
        <input id="am" type="email" bind:value={einMail} required autocomplete="off" inputmode="email" autocapitalize="off" />
        <button type="submit" style="margin-top:12px">{T.sparte.einladungSenden}</button>
      </form>
      {#if link}
        <p class="leise">{T.sparte.einladungLink}</p>
        <input readonly value={link} aria-label={T.sparte.einladungLink} />
      {/if}
    </details>
  </section>

  <section class="karte reihe">
    {#if daten.leitung}<a class="knopf zweit" href={linkZu(`sparte/${daten.ausschuss.sparte}`)}>{T.ausschuss.zurSparte}</a>{/if}
    <button class="zweit" onclick={verlassen}>{T.ausschuss.verlassen}</button>
    {#if daten.leitung}<button class="gefahr" onclick={loeschen}>{T.ausschuss.loeschen}</button>{/if}
  </section>
{/if}

<style>
  .nachrichten { list-style: none; padding: 0; margin: 0 0 12px; display: grid; gap: 8px; max-height: 60vh; overflow-y: auto; }
  .nachrichten li { padding: 8px 12px; border-radius: 10px; background: var(--grund); }
  .nachrichten li.ich { background: rgb(0 120 60 / 0.08); }
  .nachrichten p { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .liste { list-style: none; padding: 0; margin: 0 0 12px; }
  .liste li { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid var(--linie); }
  textarea { width: 100%; }
  .gesperrt { color: var(--rot); }
  h3 { margin: 12px 0 4px; font-size: 1rem; }
</style>
