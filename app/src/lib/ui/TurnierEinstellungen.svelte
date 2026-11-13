<script lang="ts">
  import { ART, SICHERUNG_MAX_EMPFAENGER, SICHERUNG_TAKTE, type Sicherung, type SicherungTakt, type TurnierEinstellungen } from '@shared/protokoll';
  import { T } from '../texte';
  import { api } from '../dienste';
  import { fehlerText } from '../app.svelte';
  import { codeAnzeige, codeEingabe, codeGueltig } from '../code';
  import { kannTeilen, lokaleSicherung, setzeLokaleSicherung, sicherungAusgeben } from '../sicherung';
  import Hilfe from './Hilfe.svelte';

  let {
    id,
    lokal,
    token,
    einst = $bindable(),
    abgeschlossen,
    anzahl,
    eintragen,
    sicherung,
  }: {
    id: string;
    lokal: boolean;
    token: string | null;
    einst: TurnierEinstellungen | null;
    abgeschlossen: boolean;
    anzahl: number;
    eintragen: (art: string) => Promise<unknown>;
    sicherung: () => Promise<Sicherung>;
  } = $props();

  let meldung = $state<{ ok: boolean; text: string; wo: string } | null>(null);
  const zeige = (wo: string, ok: boolean, text: string) => (meldung = { wo, ok, text });

  /* Leitungscode */
  let neuerCode = $state('');
  async function codeSpeichern(e: SubmitEvent) {
    e.preventDefault();
    if (!token) return;
    if (!codeGueltig(neuerCode)) return zeige('code', false, T.neu.codeUngueltig);
    try {
      einst = await api.einstellungenSetzen(token, { turnier: id, leitungsCode: neuerCode });
      neuerCode = '';
      zeige('code', true, T.einstellungen.codeGeaendert);
    } catch (x) {
      zeige('code', false, fehlerText(x, T.app.fehlerAllgemein));
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
      einst = einst ? { ...einst, letzteSicherung: a.zeit } : einst;
      zeige('mail', true, T.einstellungen.gesendet(a.gesendetAn.join(', ')));
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

  {#if !lokal && einst}
    <section>
      <h3>{T.einstellungen.sicherungTitel}</h3>
      <p class="leise">{T.einstellungen.erklaerung}</p>
      {#if !einst.mail}
        <div class="meldung info">{T.einstellungen.keinMail}</div>
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

  {#if !lokal && einst}
    <section>
      <h3>{T.einstellungen.codeTitel}<Hilfe text={T.einstellungen.codeText} /></h3>
      {#if einst.leitungsCode}<p class="leise">{T.turnier.code}: <strong class="code-klein">{codeAnzeige(einst.leitungsCode)}</strong></p>{/if}
      <form class="reihe" onsubmit={codeSpeichern}>
        <input
          class="wachsen code-feld"
          value={neuerCode}
          oninput={(e) => {
            neuerCode = codeEingabe(e.currentTarget.value);
            e.currentTarget.value = neuerCode;
          }}
          inputmode="numeric"
          maxlength="6"
          autocomplete="off"
          placeholder="______"
          aria-label={T.turnier.codeEingabe}
        />
        <button type="submit" class="zweit">{T.einstellungen.codeSpeichern}</button>
      </form>
      {@render hinweis('code')}
    </section>
  {/if}

  <section>
    <h3>{T.einstellungen.abschliessenTitel}</h3>
    <p class="leise">{T.einstellungen.abschliessenText}</p>
    <button class="zweit" onclick={abschliessen}>{abgeschlossen ? T.einstellungen.wiedereroeffnen : T.einstellungen.abschliessen}</button>
  </section>
</details>

<style>
  .einstellungen section { border-top: 1px solid var(--linie); padding-top: 14px; margin-top: 14px; }
  .einstellungen section:first-of-type { border-top: 0; margin-top: 8px; padding-top: 0; }
  .empf + .empf { margin-top: 8px; }
  .code-klein { font-family: ui-monospace, monospace; letter-spacing: 0.1em; }
</style>
