<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { OnlineTurnier, TurnierInfo, ZentraleStatus } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { app, fehlerText, serverLaden } from '../app.svelte';
  import { ApiFehler } from '../engine/api';
  import { amGeraetDerZentrale, wlanQr } from '../zentrale.svelte';
  import { turnierMerken } from '../einstellungen';
  import QrCode from './turnier/QrCode.svelte';
  import PasswortFeld from './PasswortFeld.svelte';

  let status = $state<ZentraleStatus | null>(null);
  let fehler = $state('');
  let meldung = $state<{ ok: boolean; text: string } | null>(null);
  let laeuft = $state('');

  // WLAN von Hand
  let ssid = $state('');
  let wlanPw = $state('');
  let wlanGeladen = false;

  // Online-Konto
  let email = $state('');
  let onlinePw = $state('');
  let onlineUrl = $state('');

  let onlineTurniere = $state<OnlineTurnier[] | null>(null);
  let hier = $state<TurnierInfo[]>([]);
  let adresseWahl = $state(0);

  const adresse = $derived(status?.adressen[adresseWahl] ?? status?.adressen[0] ?? null);
  /** Für den WLAN-Code: laufender App-Hotspot vor den eingetragenen Daten */
  const wlan = $derived(
    status?.hotspot.aktiv && status.hotspot.ssid
      ? { ssid: status.hotspot.ssid, passwort: status.hotspot.passwort }
      : status?.wlan.ssid
        ? { ssid: status.wlan.ssid, passwort: status.wlan.passwort }
        : null,
  );

  async function laden() {
    try {
      const s = await api.zentraleStatus();
      status = s;
      if (!wlanGeladen) {
        ssid = s.wlan.ssid ?? '';
        wlanPw = s.wlan.passwort ?? '';
        onlineUrl = s.online.url;
        wlanGeladen = true;
      }
      fehler = '';
      if (app.sitzung) hier = (await api.turniere(app.sitzung.token)).turniere;
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  // Erst entscheiden, wenn der Server bekannt ist (beim direkten Aufruf von #/zentrale läuft die Prüfung noch)
  let gestartet = false;
  $effect(() => {
    if (gestartet || app.server.art === 'pruefe') return;
    gestartet = true;
    if (!amGeraetDerZentrale()) {
      gehe('');
      return;
    }
    void laden();
    timer = setInterval(() => void laden(), 5000);
  });
  onDestroy(() => clearInterval(timer));

  /** Führt eine Aktion aus, zeigt Erfolg oder Fehler an und lädt den Status neu. */
  async function tun(name: string, f: () => Promise<string | void>) {
    laeuft = name;
    meldung = null;
    try {
      const text = await f();
      if (text) meldung = { ok: true, text };
    } catch (x) {
      meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    } finally {
      laeuft = '';
      void laden();
    }
  }

  function wlanSpeichern(e: SubmitEvent) {
    e.preventDefault();
    void tun('wlan', async () => {
      status = await api.zentraleWlan(ssid, wlanPw);
      return T.app.gespeichert;
    });
  }

  function hotspot(an: boolean) {
    void tun('hotspot', async () => {
      const s = await api.zentraleHotspot(an);
      status = s;
      if (s.meldung) throw new Error(s.meldung);
    });
  }

  function oeffnen(ziel: 'hotspot' | 'akku') {
    void tun('oeffnen', async () => {
      await api.zentraleOeffnen(ziel);
    });
  }

  function onlineVerbinden(e: SubmitEvent) {
    e.preventDefault();
    void tun('online', async () => {
      status = await api.zentraleOnlineAnmelden(email.trim(), onlinePw, onlineUrl.trim() || undefined);
      onlinePw = '';
      await serverLaden(true);
      await turniereLaden();
    });
  }

  function onlineTrennen() {
    if (!confirm(T.zentrale.onlineAbmeldenFrage)) return;
    void tun('online', async () => {
      status = await api.zentraleOnlineAbmelden();
      onlineTurniere = null;
      await serverLaden(true);
    });
  }

  async function turniereLaden() {
    try {
      onlineTurniere = (await api.zentraleOnlineTurniere()).turniere;
    } catch (x) {
      meldung = { ok: false, text: fehlerText(x, T.app.fehlerAllgemein) };
    }
  }

  function uebernehmen(t: OnlineTurnier, erzwingen = false) {
    if (erzwingen && !confirm(T.zentrale.trotzdemFrage)) return;
    void tun('ueb-' + t.id, async () => {
      try {
        const r = await api.zentraleUebernehmen(t.id, erzwingen);
        await turniereLaden();
        return T.zentrale.uebernommen(r.turnier.name, r.neu);
      } catch (x) {
        if (x instanceof ApiFehler && x.code === 'konflikt') await turniereLaden();
        throw x;
      }
    });
  }

  function rueckgabe(t: TurnierInfo) {
    if (!confirm(t.herkunft === 'zentrale' ? T.zentrale.hochladenFrage : T.zentrale.rueckgabeFrage)) return;
    void tun('rueck-' + t.id, async () => {
      const r = await api.zentraleRueckgabe(t.id);
      if (onlineTurniere) await turniereLaden();
      return T.zentrale.rueckgabeOk(r.turnier.name, r.gesendet);
    });
  }

  function loeschen(t: TurnierInfo) {
    if (!confirm(T.zentrale.loeschenFrage)) return;
    void tun('loe-' + t.id, async () => {
      await api.zentraleTurnierLoeschen(t.id);
    });
  }

  function oeffnenTurnier(t: TurnierInfo) {
    if (!app.sitzung) return;
    turnierMerken({ id: t.id, name: t.name, datum: t.datum, modus: 'online', rolle: 'leitung', token: app.sitzung.token });
    gehe('t/' + t.id);
  }

  function datum(d: string | null) {
    return d ? new Date(d + 'T12:00:00').toLocaleDateString('de-DE') : '';
  }
</script>

<h1>{T.zentrale.titel}</h1>
<p class="leise">{T.zentrale.einleitung}</p>

{#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
{#if meldung}<div class="meldung" class:ok={meldung.ok} class:fehler={!meldung.ok} role="status">{meldung.text}</div>{/if}

{#if status}
  <section class="karte" data-testid="beitritt">
    <h2>{T.zentrale.beitrittTitel}</h2>
    <div class="schritte">
      <div class="schritt">
        <h3>{T.zentrale.schritt1}</h3>
        {#if wlan}
          <QrCode text={wlanQr(wlan.ssid, wlan.passwort)} groesse={190} label={T.zentrale.schritt1} />
          <p><span class="leise">{T.zentrale.netz}:</span> <strong>{wlan.ssid}</strong>
            {#if wlan.passwort}<br /><span class="leise">{T.zentrale.passwort}:</span> <strong class="mono">{wlan.passwort}</strong>{/if}</p>
          <p class="leise">{T.zentrale.schritt1Text}</p>
        {:else}
          <p class="meldung info">{T.zentrale.wlanFehlt}</p>
        {/if}
      </div>
      <div class="schritt">
        <h3>{T.zentrale.schritt2}</h3>
        {#if adresse}
          <QrCode text={adresse} groesse={190} label={T.zentrale.schritt2} />
          <p><strong class="mono" data-testid="adresse">{adresse}</strong></p>
          <p class="leise">{T.zentrale.schritt2Text}</p>
        {:else}
          <p class="meldung info">{T.zentrale.keineAdresse}</p>
        {/if}
      </div>
    </div>
    {#if status.adressen.length > 1}
      <label for="adr">{T.zentrale.andereAdressen}</label>
      <select id="adr" bind:value={adresseWahl}>
        {#each status.adressen as a, i (a)}<option value={i}>{a}</option>{/each}
      </select>
    {/if}
    <p class="leise geraete">{T.zentrale.geraete(status.geraete)}</p>
  </section>

  <section class="karte">
    <h2>{T.zentrale.wlanTitel}</h2>
    <h3>{T.zentrale.wlanHandTitel}</h3>
    <p class="leise">{T.zentrale.wlanHandText}</p>
    <button class="zweit" onclick={() => oeffnen('hotspot')} disabled={laeuft !== ''}>{T.zentrale.hotspotEinstellungen}</button>
    <form onsubmit={wlanSpeichern} class="stapel">
      <label for="ssid">{T.zentrale.wlanName}</label>
      <input id="ssid" bind:value={ssid} autocomplete="off" autocapitalize="off" />
      <label for="wpw">{T.zentrale.wlanPasswort}</label>
      <input id="wpw" bind:value={wlanPw} autocomplete="off" autocapitalize="off" />
      <button type="submit" disabled={laeuft !== ''}>{T.zentrale.wlanSpeichern}</button>
    </form>

    <h3>{T.zentrale.lokalTitel}</h3>
    <p class="leise">{T.zentrale.lokalText}</p>
    {#if status.hotspot.aktiv}
      <p class="meldung ok">{T.zentrale.lokalAktiv}</p>
      <button class="zweit" onclick={() => hotspot(false)} disabled={laeuft !== ''}>{T.zentrale.lokalStoppen}</button>
    {:else if status.hotspot.moeglich === false}
      <p class="leise">{T.zentrale.lokalNichtMoeglich}</p>
    {:else}
      <button class="zweit" onclick={() => hotspot(true)} disabled={laeuft !== ''}>{T.zentrale.lokalStarten}</button>
    {/if}
    <p class="leise">{T.zentrale.hallenWlan}</p>
  </section>

  <section class="karte">
    <h2>{T.zentrale.geraetTitel}</h2>
    {#if status.akkuAusnahme}
      <p class="meldung ok">{T.zentrale.akkuOk}</p>
    {:else}
      <p class="meldung info">{T.zentrale.akkuNein}</p>
      <button onclick={() => oeffnen('akku')} disabled={laeuft !== ''}>{T.zentrale.akkuKnopf}</button>
    {/if}
    <p class="leise">{T.zentrale.netzHinweis}</p>
    <p class="leise">{status.internet ? T.zentrale.internetJa : T.zentrale.internetNein}</p>
  </section>

  <section class="karte">
    <h2>{T.zentrale.onlineTitel}</h2>
    {#if status.online.verbunden && status.online.konto}
      <p>{T.zentrale.onlineVerbunden(status.online.konto.name, status.online.konto.email)}</p>
      {#if !status.online.mail}<p class="meldung info">{T.zentrale.onlineKeineMail}</p>{/if}
      <div class="reihe">
        <button
          class="zweit"
          disabled={laeuft !== ''}
          onclick={() =>
            void tun('pool', async () => {
              const r = await api.zentralePoolAbgleichen();
              return T.zentrale.poolErgebnis(r.anzahl, r.hochgeladen);
            })}>{T.zentrale.poolAbgleichen}</button
        >
        <button class="gefahr" disabled={laeuft !== ''} onclick={onlineTrennen}>{T.zentrale.onlineAbmelden}</button>
      </div>
    {:else}
      <p class="leise">{T.zentrale.onlineText}</p>
      {#if status.online.fehler}<p class="meldung fehler">{status.online.fehler}</p>{/if}
      <form onsubmit={onlineVerbinden} class="stapel">
        <label for="om">{T.zentrale.onlineEmail}</label>
        <input id="om" type="email" bind:value={email} autocomplete="username" autocapitalize="off" />
        <label for="opw">{T.zentrale.onlinePasswort}</label>
        <PasswortFeld id="opw" bind:wert={onlinePw} />
        <details>
          <summary>{T.zentrale.onlineAdresse}</summary>
          <input id="ourl" bind:value={onlineUrl} autocapitalize="off" aria-label={T.zentrale.onlineAdresse} />
          <p class="leise">{T.zentrale.onlineAdresseHilfe}</p>
        </details>
        <button type="submit" disabled={laeuft !== '' || !email || !onlinePw}>{laeuft === 'online' ? T.app.laden : T.zentrale.onlineVerbinden}</button>
        <p class="leise">{T.zentrale.onlineVerbindenHinweis}</p>
      </form>
    {/if}
  </section>

  {#if status.online.verbunden}
    <section class="karte">
      <h2>{T.zentrale.onlineTurniereTitel}</h2>
      <p class="leise">{T.zentrale.onlineTurniereText}</p>
      {#if onlineTurniere === null}
        <button class="zweit" onclick={turniereLaden}>{T.zentrale.onlineTurniereLaden}</button>
      {:else if onlineTurniere.length === 0}
        <p class="leise">{T.zentrale.onlineKeine}</p>
      {:else}
        <ul class="liste">
          {#each onlineTurniere as t (t.id)}
            <li class="zeile-t">
              <div class="wachsen">
                <strong>{t.name}</strong>
                <span class="leise">{datum(t.datum)}</span>
                {#if t.aufDieserZentrale}<span class="marke online">{T.zentrale.liegtHier}</span>
                {:else if t.zentrale && !t.vonDieserZentrale}<span class="marke">{T.zentrale.liegtAndere(t.zentrale)}</span>{/if}
              </div>
              {#if !t.aufDieserZentrale}
                {#if t.zentrale && !t.vonDieserZentrale}
                  <button class="zweit klein" disabled={laeuft !== ''} onclick={() => uebernehmen(t, true)}>{T.zentrale.trotzdem}</button>
                {:else}
                  <button class="klein" disabled={laeuft !== ''} onclick={() => uebernehmen(t)}>
                    {laeuft === 'ueb-' + t.id ? T.app.laden : T.zentrale.uebernehmen}
                  </button>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <section class="karte">
    <h2>{T.zentrale.hierTitel}</h2>
    {#if hier.length === 0}
      <p class="leise">{T.zentrale.hierKeine}</p>
    {:else}
      {#if !status.online.verbunden}<p class="leise">{T.zentrale.rueckgabeBrauchtKonto}</p>{/if}
      <ul class="liste">
        {#each hier as t (t.id)}
          <li class="zeile-t">
            <button class="zeile wachsen" onclick={() => oeffnenTurnier(t)}>
              <strong>{t.name}</strong>
              <span class="leise">
                {datum(t.datum)}
                <span class="marke">{t.herkunft === 'online' ? T.zentrale.herkunftOnline : T.zentrale.herkunftZentrale}</span>
                {#if t.abgegeben}<span class="marke">{T.zentrale.zurueckgegeben}</span>{/if}
              </span>
            </button>
            {#if status.online.verbunden && !t.abgegeben}
              <button class="zweit klein" disabled={laeuft !== ''} onclick={() => rueckgabe(t)}>
                {laeuft === 'rueck-' + t.id ? T.app.laden : t.herkunft === 'zentrale' ? T.zentrale.hochladen : T.zentrale.rueckgabe}
              </button>
            {/if}
            {#if t.abgegeben}
              <button class="gefahr klein" disabled={laeuft !== ''} onclick={() => loeschen(t)} aria-label={T.zentrale.loeschen} title={T.zentrale.loeschen}>✕</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if status.warteschlange.length > 0}
    <section class="karte">
      <h2>{T.zentrale.warteTitel}</h2>
      <p class="leise">{T.zentrale.warteText}</p>
      <ul class="liste">
        {#each status.warteschlange as w (w.turnier)}
          <li>
            <strong>{w.name ?? w.turnier}</strong> <span class="leise">– {w.anlass}</span>
            {#if w.fehler}<br /><span class="leise">{w.fehler}</span>{/if}
          </li>
        {/each}
      </ul>
      <button
        class="zweit"
        disabled={laeuft !== '' || !status.online.verbunden}
        onclick={() => void tun('warte', async () => void (status = await api.zentraleSicherungenSenden()))}>{T.zentrale.warteSenden}</button
      >
    </section>
  {/if}
{:else if !fehler}
  <p class="leise">{T.app.laden}</p>
{/if}

<p><a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a></p>

<style>
  .schritte {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }
  .schritt { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; }
  .schritt h3 { margin: 0; }
  .mono { font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
  .geraete { margin-top: 10px; text-align: center; }
  h3 { font-size: 1rem; margin: 14px 0 4px; }
  .stapel { margin: 10px 0; }
  .zeile-t { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
  .wachsen { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .zeile {
    min-height: 48px;
    background: transparent;
    border: 0;
    color: var(--text);
    text-align: left;
    padding: 4px 0;
    font-weight: 400;
    justify-content: flex-start;
  }
  .zeile:hover { background: transparent; }
  .zeile:hover strong { color: var(--blau); }
  select { width: 100%; }
</style>
