<script lang="ts">
  /**
   * Siegprämie einer Konkurrenz (ab 0.18): Einstellung (Leitung), Rechnung mit „voraussichtlich“ bis zum Ende,
   * Auszahlung an der Kasse mit Beleg, Storno. Steuerhinweis zur Gemeinnützigkeit immer sichtbar.
   */
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { euro, type KonkurrenzZustand } from '../../engine/modell';
  import { nameLang, platzText } from '../../engine/abfragen';
  import { kurzId } from '../../engine/ids';
  import { linkZu } from '../../router.svelte';
  import { PRAEMIE_VORLAGEN, praemienRechnen, type PraemieEinstellungen } from '../../engine/praemie';
  import type { TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';

  let { z, k, leitung, turnierId, eintragen }: { z: TurnierZustand; k: KonkurrenzZustand; leitung: boolean; turnierId: string; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();

  const r = $derived(praemienRechnen(z, k));
  let bearbeiten = $state(false);
  let ebArt = $state<'prozent' | 'fest'>('prozent');
  let ebWert = $state('0');
  let vtArt = $state<'prozent' | 'fest'>('prozent');
  let vorlage = $state('2');
  let feste = $state('');
  let fehler = $state('');

  function oeffnen() {
    const p = k.einst.praemie;
    ebArt = p?.einbehalt.art ?? 'prozent';
    ebWert = p ? String(p.einbehalt.art === 'fest' ? p.einbehalt.wert / 100 : p.einbehalt.wert) : '0';
    vtArt = p?.verteilung.art ?? 'prozent';
    const v = p && p.verteilung.art === 'prozent' ? PRAEMIE_VORLAGEN.findIndex((x) => x.werte.join() === p.verteilung.werte.join()) : -1;
    vorlage = String(v >= 0 ? v : 2);
    feste = p && p.verteilung.art === 'fest' ? p.verteilung.werte.map((w) => w / 100).join(', ') : '';
    fehler = '';
    bearbeiten = true;
  }
  async function speichern(e: SubmitEvent) {
    e.preventDefault();
    const eb = Number(ebWert.replace(',', '.'));
    if (!Number.isFinite(eb) || eb < 0 || (ebArt === 'prozent' && eb > 100)) {
      fehler = T.praemie.festeFalsch;
      return;
    }
    let werte: number[];
    if (vtArt === 'prozent') werte = PRAEMIE_VORLAGEN[Number(vorlage)]!.werte;
    else {
      werte = feste.split(/[;\s]*[,;][\s]*|\s+/).filter(Boolean).map((x) => Math.round(Number(x.replace(',', '.')) * 100));
      if (!werte.length || werte.some((w) => !Number.isFinite(w) || w <= 0)) {
        fehler = T.praemie.festeFalsch;
        return;
      }
    }
    const praemie: PraemieEinstellungen = { einbehalt: { art: ebArt, wert: ebArt === 'fest' ? Math.round(eb * 100) : Math.round(eb) }, verteilung: { art: vtArt, werte } };
    await eintragen(ART.konkurrenzGeaendert, { id: k.id, einst: { praemie } });
    bearbeiten = false;
  }
  async function aus() {
    await eintragen(ART.konkurrenzGeaendert, { id: k.id, einst: { praemie: null } });
    bearbeiten = false;
  }
  async function auszahlen(teilnehmer: string, platz: string, betrag: number) {
    await eintragen(ART.praemieAusgezahlt, { id: kurzId(), konkurrenz: k.id, teilnehmer, platz, betrag });
  }
  async function stornieren(id: string) {
    if (!confirm(T.praemie.stornoFrage)) return;
    await eintragen(ART.praemieAusgezahlt, { storno: id, konkurrenz: k.id });
  }
  const meineAuszahlungen = $derived(z.auszahlungen.filter((a) => a.konkurrenz === k.id && !a.storniert));
</script>

<div class="praemie" data-testid="praemie-{k.id}">
  <div class="reihe">
    <h3 class="wachsen">{k.einst.name}</h3>
    {#if leitung && !bearbeiten}<button class="zweit klein" onclick={oeffnen} data-testid="praemie-einrichten">{k.einst.praemie ? T.app.bearbeiten : T.praemie.einrichten}</button>{/if}
  </div>
  {#if bearbeiten}
    <form onsubmit={speichern}>
      <fieldset>
        <legend>{T.praemie.einbehalt}</legend>
        <div class="reihe">
          <select bind:value={ebArt} aria-label={T.praemie.einbehalt}><option value="prozent">{T.praemie.prozent}</option><option value="fest">{T.praemie.fest}</option></select>
          <input bind:value={ebWert} inputmode="decimal" aria-label="{T.praemie.einbehalt} ({ebArt === 'prozent' ? '%' : '€'})" data-testid="praemie-einbehalt" />
        </div>
      </fieldset>
      <fieldset>
        <legend>{T.praemie.verteilung}</legend>
        <div class="reihe"><label class="wahl-klein"><input type="radio" value="prozent" bind:group={vtArt} /> {T.praemie.vorlage}</label><label class="wahl-klein"><input type="radio" value="fest" bind:group={vtArt} /> {T.praemie.fest}</label></div>
        {#if vtArt === 'prozent'}
          <select bind:value={vorlage} aria-label={T.praemie.vorlage} data-testid="praemie-vorlage">
            {#each PRAEMIE_VORLAGEN as v, i (v.name)}<option value={String(i)}>{v.name}</option>{/each}
          </select>
        {:else}
          <label>{T.praemie.feste}<input bind:value={feste} inputmode="decimal" placeholder="50, 30, 20" /></label>
        {/if}
      </fieldset>
      {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
      <div class="reihe">
        <button type="submit" data-testid="praemie-speichern">{T.praemie.speichern}</button>
        {#if k.einst.praemie}<button type="button" class="zweit" onclick={aus}>{T.praemie.aus}</button>{/if}
        <button type="button" class="zweit" onclick={() => (bearbeiten = false)}>{T.app.abbrechen}</button>
      </div>
    </form>
  {/if}
  {#if r}
    <p class="leise">{T.praemie.topf(euro(r.topf), euro(r.einbehalt))}</p>
    {#if r.voraussichtlich}
      <ul class="liste kompakt">
        {#each r.plaetze as b, i (i)}{#if b}<li class="reihe"><span class="wachsen">{T.praemie.platz(i + 1)}</span><span>{euro(b)} <span class="leise">({T.praemie.voraussichtlich})</span></span></li>{/if}{/each}
      </ul>
    {:else}
      <ul class="liste kompakt">
        {#each r.empfaenger as e (e.teilnehmer)}
          <li class="reihe">
            <span class="wachsen">{platzText(e.platz)} · {nameLang(z, e.teilnehmer, k)}</span>
            {#if e.ausgezahlt >= e.betrag}
              <span class="marke">✓ {euro(e.ausgezahlt)} {T.praemie.ausgezahlt}</span>
            {:else}
              <button class="klein" onclick={() => auszahlen(e.teilnehmer, e.platz, e.betrag - e.ausgezahlt)} data-testid="praemie-auszahlen">{T.praemie.auszahlen(euro(e.betrag - e.ausgezahlt))}</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <p class="leise">{T.praemie.verein(euro(r.verein))}</p>
    {#if meineAuszahlungen.length}
      <div class="reihe">
        <a class="knopf zweit klein" href={linkZu(`druck/${turnierId}/praemien`)}>{T.praemie.belege}</a>
        {#if leitung}{#each meineAuszahlungen as a (a.id)}<button class="zweit klein" onclick={() => stornieren(a.id)} aria-label="{T.praemie.stornieren} {nameLang(z, a.teilnehmer, k)}">{T.praemie.stornieren}: {nameLang(z, a.teilnehmer, k)}</button>{/each}{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .praemie { border-top: 1px solid var(--linie); padding-top: 8px; margin-top: 8px; }
  .praemie h3 { margin: 0; }
  fieldset { margin: 8px 0; }
  .wahl-klein { display: flex; gap: 8px; align-items: center; font-weight: 400; min-height: 44px; margin: 0; }
  .wahl-klein input { width: 22px; height: 22px; min-height: 0; }
  .kompakt li { padding: 6px 0; }
</style>
