<script lang="ts">
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { linkZu } from '../../router.svelte';
  import { alsEineAktion } from '../../aktion';
  import { kurzId } from '../../engine/ids';
  import { centAus, euro } from '../../engine/modell';
  import { kassenListe, kassenSumme, kassenZeile, mannschaftAnwesend, ohneCheckin, quittungsNr, type KassenZeile } from '../../engine/kasse';
  import { giroCode } from '../../engine/girocode';
  import type { Buchung, TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';
  import QrCode from './QrCode.svelte';
  import CheckinKonkurrenz from './CheckinKonkurrenz.svelte';
  import PraemieKarte from './PraemieKarte.svelte';
  import { begonnen } from '../../engine/zustand';

  /**
   * Empfang am Turniertag: Check-in und Startgeld (Leitung und Helfer mit Aufgabe „Kasse“).
   * Große Knöpfe für die Bedienung mit einer Hand am Tisch der Turnierleitung.
   */
  let {
    z,
    turnierId,
    leitung,
    eintragen,
  }: { z: TurnierZustand; turnierId: string; leitung: boolean; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();

  let suche = $state('');
  let filter = $state<'alle' | 'fehlt' | 'offen' | 'da'>('alle');
  let offen = $state<string | null>(null);
  let betrag = $state('');
  let art = $state<Buchung['art']>('bar');
  let giro = $state<string | null>(null);
  let fehler = $state('');
  let hinweis = $state('');

  const liste = $derived(kassenListe(z));
  const summe = $derived(kassenSumme(z));
  const mitStartgeld = $derived(z.konkurrenzReihe.some((id) => !!z.konkurrenzen[id]!.einst.startgeld));
  const gefiltert = $derived(
    liste.filter((x) => {
      const q = suche.trim().toLowerCase();
      if (q && !`${x.name} ${x.verein}`.toLowerCase().includes(q)) return false;
      if (filter === 'fehlt') return !x.da;
      if (filter === 'da') return x.da;
      if (filter === 'offen') return x.offen > 0;
      return true;
    }),
  );

  async function checkin(x: KassenZeile) {
    fehler = '';
    try {
      await eintragen(ART.teilnehmerEingecheckt, { spieler: x.spieler, da: !x.da });
    } catch (e) {
      fehler = e instanceof Error ? e.message : String(e);
    }
  }
  function aufklappen(x: KassenZeile) {
    if (offen === x.spieler) {
      offen = null;
      return;
    }
    offen = x.spieler;
    betrag = x.offen > 0 ? (x.offen / 100).toFixed(2).replace('.', ',') : '';
    art = 'bar';
    giro = null;
    fehler = '';
  }
  async function buchen(x: KassenZeile) {
    const cent = centAus(betrag);
    if (cent === undefined || cent === null || cent <= 0) {
      fehler = T.kasse.betrag;
      return;
    }
    fehler = '';
    try {
      await eintragen(ART.startgeldGebucht, { id: kurzId(), spieler: x.spieler, betrag: cent, art });
      hinweis = `${x.name}: ${euro(cent)} ${T.kasse.arten[art]}`;
      offen = null;
    } catch (e) {
      fehler = e instanceof Error ? e.message : String(e);
    }
  }
  /* Ab 0.18: Check-in vor der Auslosung, Mannschaft auf einmal einchecken */
  const offeneKonkurrenzen = $derived(z.konkurrenzReihe.map((id) => z.konkurrenzen[id]!).filter((k) => !begonnen(k) && k.meldungen.length > 0));
  const mannschaften = $derived(
    z.konkurrenzReihe
      .map((id) => z.konkurrenzen[id]!)
      .filter((k) => k.einst.art === 'mannschaft')
      .flatMap((k) => k.meldungen.map((mid) => ({ k, m: k.mannschaften[mid]! })).filter((x) => !!x.m)),
  );
  async function pflichtSetzen(an: boolean) {
    await eintragen(ART.turnierDaten, { checkinPflicht: an });
  }
  function offenFuer(spieler: string[]) {
    return spieler.reduce((s, sid) => s + Math.max(0, kassenZeile(z, sid).offen), 0);
  }
  async function mannschaftDa(spieler: string[], name: string) {
    fehler = '';
    try {
      await alsEineAktion(async () => {
        for (const sid of spieler) {
          if (z.checkin[sid] !== true) await eintragen(ART.teilnehmerEingecheckt, { spieler: sid, da: true });
          const offen = kassenZeile(z, sid).offen;
          if (offen > 0) await eintragen(ART.startgeldGebucht, { id: kurzId(), spieler: sid, betrag: offen, art: 'bar' });
        }
      });
      hinweis = T.checkin.gebucht(name);
    } catch (e) {
      fehler = e instanceof Error ? e.message : String(e);
    }
  }
  async function stornieren(b: Buchung) {
    if (!confirm(T.kasse.stornoFrage)) return;
    await eintragen(ART.startgeldStorniert, { buchung: b.id });
  }
  async function streichen() {
    const l = ohneCheckin(z);
    if (!l.length) {
      hinweis = T.kasse.nichtsZuStreichen;
      return;
    }
    if (!confirm(T.kasse.streichenFrage(l.length))) return;
    await alsEineAktion(async () => {
      for (const m of l) await eintragen(ART.teilnehmerAbgemeldet, { konkurrenz: m.konkurrenz, id: m.teilnehmer });
    });
    hinweis = T.kasse.gestrichen(l.length);
  }
  function giroFuer(x: KassenZeile): string | null {
    const k = z.kasse;
    if (!k?.iban) return null;
    const cent = centAus(betrag) ?? x.offen;
    return giroCode({ empfaenger: k.empfaenger || k.aussteller, iban: k.iban, bic: k.bic, betrag: cent && cent > 0 ? cent : 0, zweck: T.kasse.zweck(z.name, x.name) });
  }
  function zeit(iso: string) {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<section class="karte">
  <h2>{T.kasse.titel}<Hilfe text={T.kasse.hilfe} /></h2>
  <p class="leise" data-testid="kasse-checkin">{T.kasse.summeText(summe.da, summe.gemeldet)}</p>
  {#if mitStartgeld}
    <dl class="summe" data-testid="kasse-summe">
      <div><dt>{T.kasse.soll}</dt><dd>{euro(summe.soll)}</dd></div>
      <div><dt>{T.kasse.arten.bar}</dt><dd>{euro(summe.bar)}</dd></div>
      <div><dt>{T.kasse.arten.ueberweisung}</dt><dd>{euro(summe.ueberweisung)}</dd></div>
      <div><dt>{T.kasse.erlassen}</dt><dd>{euro(summe.erlassen)}</dd></div>
      <div><dt>{T.kasse.offen}</dt><dd class:rot={summe.offen > 0}>{euro(summe.offen)}</dd></div>
    </dl>
  {/if}
  <div class="reihe">
    <a class="knopf zweit" href={linkZu(`druck/${turnierId}/kasse`)}>{T.kasse.kassenliste}</a>
    {#if leitung}
      <button class="zweit" onclick={streichen} data-testid="kasse-streichen">{T.kasse.streichen}</button>
      <Hilfe text={T.kasse.streichenHilfe} />
    {/if}
  </div>
  {#if leitung && !z.kasse?.aussteller && mitStartgeld}<p class="leise">{T.kasse.einrichtenText}</p>{/if}
  {#if leitung}
    <div class="label-zeile pflicht"><label class="haken"><input type="checkbox" checked={z.checkinPflicht} onchange={(e) => pflichtSetzen(e.currentTarget.checked)} data-testid="checkin-pflicht" /> {T.checkin.pflicht}</label><Hilfe text={T.checkin.pflichtHilfe} /></div>
  {/if}
</section>

{#if z.checkinPflicht && offeneKonkurrenzen.length}
  <section class="karte" data-testid="checkin-konkurrenzen">
    <h2>{T.checkin.konkurrenzen}</h2>
    {#each offeneKonkurrenzen as k (k.id)}
      <h3>{k.einst.name}</h3>
      <CheckinKonkurrenz {z} {k} {leitung} {eintragen} />
    {/each}
  </section>
{/if}

{#if mitStartgeld && (leitung || z.konkurrenzReihe.some((id) => z.konkurrenzen[id]!.einst.praemie))}
  <section class="karte" data-testid="kasse-praemien">
    <h2>{T.praemie.titel}<Hilfe text={T.praemie.hilfe} /></h2>
    <p class="meldung info steuer">{T.praemie.steuer}</p>
    {#each z.konkurrenzReihe.map((id) => z.konkurrenzen[id]!).filter((k) => k.einst.startgeld && (leitung || k.einst.praemie)) as k (k.id)}
      <PraemieKarte {z} {k} {leitung} {turnierId} {eintragen} />
    {/each}
  </section>
{/if}

{#if mannschaften.length}
  <section class="karte" data-testid="kasse-mannschaften">
    <h2>{T.checkin.mannschaften}<Hilfe text={T.checkin.mannschaftHilfe} /></h2>
    <ul class="liste">
      {#each mannschaften as { k, m } (`${k.id}|${m.id}`)}
        {@const a = mannschaftAnwesend(z, k, m.id)}
        {@const offen = offenFuer(m.spieler)}
        <li class="reihe">
          <span class="wachsen"><strong>{m.name}</strong> <span class="leise">· {k.einst.name}</span><br /><span class="leise" class:warn={a.da < a.min}>{T.checkin.mannschaftStand(a.da, m.spieler.length)}{a.da < a.min ? ` – ${T.mannschaft.unterbesetzt(a.da, a.min)}` : ''}</span></span>
          {#if a.da < m.spieler.length || offen > 0}
            <button class="zweit klein" onclick={() => mannschaftDa(m.spieler, m.name)} data-testid="mannschaft-da">{T.checkin.mannschaftDa(mitStartgeld && offen > 0 ? euro(offen) : '')}</button>
          {:else}
            <span class="marke">✓ {T.kasse.da}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if hinweis}<div class="meldung ok" role="status">{hinweis}</div>{/if}
{#if fehler && !offen}<div class="meldung fehler" role="alert">{fehler}</div>{/if}

{#if !z.spielerReihe.length}
  <p class="leise">{T.kasse.keineSpieler}</p>
{:else}
  <div class="werkzeug">
    <input bind:value={suche} placeholder={T.kasse.suche} aria-label={T.kasse.suche} type="search" autocomplete="off" />
    <div class="chips" role="group" aria-label="Filter">
      {#each ['alle', 'fehlt', 'offen', 'da'] as f (f)}
        {#if f !== 'offen' || mitStartgeld}
          <button class="chip" class:aktiv={filter === f} aria-pressed={filter === f} onclick={() => (filter = f as typeof filter)}>{T.kasse.filter[f]}</button>
        {/if}
      {/each}
    </div>
  </div>
  <ul class="liste" data-testid="kasse-liste">
    {#each gefiltert as x (x.spieler)}
      <li class="zeile" class:da={x.da}>
        <div class="oben">
          <button class="checkin" class:an={x.da} aria-pressed={x.da} onclick={() => checkin(x)} data-testid="checkin">{x.da ? `✓ ${T.kasse.da}` : T.kasse.nichtDa}</button>
          <div class="wachsen name">
            <strong>{x.name}</strong>
            {#if x.verein}<span class="leise"> · {x.verein}</span>{/if}
            {#if mitStartgeld}
              <div class="leise">
                {#if x.soll === 0 && x.bezahlt === 0}{T.kasse.nichts}
                {:else if x.offen > 0}<span class="rot">{T.kasse.offen}: {euro(x.offen)}</span> · {T.kasse.soll} {euro(x.soll)}
                {:else if x.offen < 0}{T.kasse.zuviel}: {euro(-x.offen)}
                {:else}✓ {T.kasse.bezahlt} {euro(x.bezahlt)}{x.erlassen ? ` · ${T.kasse.erlassen} ${euro(x.erlassen)}` : ''}{/if}
              </div>
            {/if}
          </div>
          {#if mitStartgeld}
            <button class="zweit klein" aria-expanded={offen === x.spieler} onclick={() => aufklappen(x)} data-testid="kassieren">€</button>
          {/if}
        </div>
        {#if offen === x.spieler}
          <div class="kassieren">
            {#if x.posten.length}<p class="leise">{x.posten.map((p) => `${p.name} ${euro(p.betrag)}`).join(' · ')}</p>{/if}
            <div class="label-zeile"><label for="kb-{x.spieler}">{T.kasse.betrag}</label><Hilfe text={T.kasse.betragHilfe} /></div>
            <input id="kb-{x.spieler}" bind:value={betrag} inputmode="decimal" autocomplete="off" data-testid="kasse-betrag" />
            <div class="chips" role="radiogroup" aria-label={T.kasse.betrag}>
              {#each ['bar', 'ueberweisung', 'erlassen'] as a (a)}
                <button class="chip" class:aktiv={art === a} role="radio" aria-checked={art === a} onclick={() => (art = a as Buchung['art'])}>{T.kasse.arten[a]}</button>
              {/each}
            </div>
            {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
            <div class="reihe">
              <button onclick={() => buchen(x)} data-testid="kasse-buchen">{T.kasse.buchen}</button>
              {#if z.kasse?.iban}<button class="zweit" onclick={() => (giro = giro ? null : giroFuer(x))}>{T.kasse.giroCode}</button>{/if}
            </div>
            {#if giro}
              <p class="leise">{T.kasse.giroCodeText}</p>
              <QrCode text={giro} groesse={200} label={T.kasse.giroCode} />
            {/if}
            {#if x.buchungen.length}
              <ul class="buchungen">
                {#each x.buchungen as b (b.id)}
                  <li class:storniert={!!b.storniert}>
                    <span class="wachsen">{quittungsNr(b)} · {euro(b.betrag)} {T.kasse.arten[b.art]} · {zeit(b.zeit)}{b.von ? ` · ${b.von}` : ''}{b.storniert ? ` · ${T.kasse.storniertAm(zeit(b.storniert.zeit), b.storniert.von)}` : ''}</span>
                    {#if b.art !== 'erlassen'}<a class="knopf zweit klein" href={linkZu(`druck/${turnierId}/quittungen/${b.id}`)}>{T.kasse.quittung}</a>{/if}
                    {#if !b.storniert}<button class="gefahr klein" onclick={() => stornieren(b)}>{T.kasse.stornieren}</button>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; margin: 0; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .pflicht { margin-top: 8px; }
  .warn { color: var(--orange-text); font-weight: 600; }
  h2 { display: flex; align-items: center; gap: 4px; }
  .summe { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr)); gap: 8px; margin: 8px 0 12px; }
  .summe div { background: var(--grund); border-radius: 8px; padding: 8px 10px; }
  .summe dt { font-size: 0.85rem; color: var(--leise); }
  .summe dd { margin: 0; font-weight: 700; font-size: 1.1rem; }
  .rot { color: var(--rot, #b00020); font-weight: 700; }
  .werkzeug { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { min-height: 44px; border-radius: 999px; padding: 0 14px; background: var(--flaeche); color: var(--text); border: 1px solid var(--linie); }
  .chip.aktiv { background: var(--blau); color: #fff; border-color: var(--blau); }
  .zeile .oben { display: flex; gap: 10px; align-items: center; }
  .name { min-width: 0; overflow-wrap: anywhere; }
  .checkin { flex: none; min-width: 6.5rem; min-height: 48px; font-weight: 700; background: var(--flaeche); color: var(--text); border: 2px solid var(--linie); }
  .checkin.an { background: var(--gruen); color: #fff; border-color: var(--gruen); }
  .kassieren { margin-top: 10px; padding: 10px; border-radius: 10px; background: var(--grund); display: flex; flex-direction: column; gap: 8px; }
  .buchungen { list-style: none; padding: 0; margin: 4px 0 0; display: flex; flex-direction: column; gap: 6px; }
  .buchungen li { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .buchungen li.storniert .wachsen { text-decoration: line-through; color: var(--leise); }
</style>
