<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ART, SICHERUNG_MAX_EMPFAENGER, SICHERUNG_TAKTE, type Sicherung, type SicherungTakt, type TurnierEinstellungen } from '@shared/protokoll';
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

  let {
    id,
    lokal,
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
    <h3>{T.einstellungen.veroeffTitel}<Hilfe text={T.einstellungen.veroeffHinweis} /></h3>
    <p class="leise">{T.einstellungen.veroeffText}</p>
    <label class="haken"><input type="checkbox" checked={z.veroeffentlichung.tabellen} onchange={(e) => veroeffentlichung(e.currentTarget.checked, z.veroeffentlichung.ko)} /> {T.einstellungen.veroeffTabellen}</label>
    <label class="haken"><input type="checkbox" checked={z.veroeffentlichung.ko} onchange={(e) => veroeffentlichung(z.veroeffentlichung.tabellen, e.currentTarget.checked)} /> {T.einstellungen.veroeffKo}</label>
    {#if !z.veroeffentlichung.tabellen || !z.veroeffentlichung.ko || abweichend.length}
      <button class="zweit" style="margin-top:8px" onclick={allesVeroeffentlichen} data-testid="alles-veroeffentlichen">{T.einstellungen.veroeffentlichen}</button>
    {/if}
    {@render hinweis('veroeff')}
  </section>

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
  .einstellungen section { border-top: 1px solid var(--linie); padding-top: 14px; margin-top: 14px; }
  .einstellungen section:first-of-type { border-top: 0; margin-top: 8px; padding-top: 0; }
  .empf + .empf { margin-top: 8px; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; margin: 8px 0; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .protokoll summary { font-size: 1.05rem; font-weight: 700; }
</style>
