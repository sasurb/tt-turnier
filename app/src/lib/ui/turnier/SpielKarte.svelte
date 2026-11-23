<script lang="ts">
  import { T } from '../../texte';
  import { name, rundeVon, vorgabeVon } from '../../engine/abfragen';
  import { ergebnisText } from '../../engine/ergebnis';
  import type { KonkurrenzZustand, Spiel } from '../../engine/modell';
  import { seiteVon, type TurnierZustand } from '../../engine/zustand';
  import { teileVon, zwischenstand } from '../../engine/mannschaft';

  let {
    z,
    k,
    spiel,
    ich = null,
    mitKonkurrenz = true,
    mitSchiri = false,
    zeit = null,
    oeffnen,
  }: {
    z: TurnierZustand;
    k: KonkurrenzZustand;
    spiel: Spiel;
    ich?: string | null;
    mitKonkurrenz?: boolean;
    mitSchiri?: boolean;
    /** geschätzter Beginn „HH:MM“ (Zeitplan) */
    zeit?: string | null;
    oeffnen: () => void;
  } = $props();

  const ort = $derived(rundeVon(k, spiel));
  const vorgabe = $derived(spiel.status === 'offen' ? vorgabeVon(z, k, spiel) : null);
  const frei = $derived(k.einst.modus === 'kaiser' ? T.spiele.setztAus : T.konk.freilos);
  const amTisch = $derived(spiel.tisch !== null && spiel.status === 'offen');
  const statusText = $derived.by(() => {
    if (spiel.status === 'wartet') return spiel.gesperrt ? T.spiele.gesperrt : T.spiele.wartet;
    if (spiel.status === 'freilos') return T.spiele.freilos;
    if (spiel.status === 'entfallen') return T.spiele.entfallen;
    if (spiel.status === 'offen') return T.spiele.offen;
    return '';
  });
  const seiteIch = $derived(seiteVon(k, spiel, ich));
  const planText = $derived(
    spiel.plan && (spiel.status === 'offen' || spiel.status === 'wartet') && !amTisch
      ? [spiel.plan.tisch ? T.spiele.tisch(spiel.plan.tisch) : '', spiel.plan.zeit ? T.spiele.ab(spiel.plan.zeit) : ''].filter(Boolean).join(' · ')
      : '',
  );
  /** Mannschaften: Zwischenstand der laufenden Begegnung */
  const zwischen = $derived(k.einst.art === 'mannschaft' && !spiel.ergebnis && (spiel.status === 'offen') ? zwischenstand(teileVon(k, spiel)) : null);
  const unentschieden = $derived(spiel.status === 'gespielt' && !!spiel.ergebnis && spiel.ergebnis.gewinner === null);
  const bitteBestaetigen = $derived(!!seiteIch && spiel.stand === 'eingetragen' && !!spiel.eintrag && !spiel.eintrag.amtlich && spiel.eintrag.seite !== seiteIch);
</script>

<button class="spiel" class:amtisch={amTisch} class:fertig={spiel.status === 'gespielt'} class:hinweis={bitteBestaetigen || spiel.stand === 'angefochten' || spiel.stand === 'konflikt'} onclick={oeffnen} data-testid="spiel">
  <span class="ort leise">
    {#if amTisch}<strong class="tisch">{T.spiele.tisch(spiel.tisch!, spiel.tisch2)}</strong> ·{/if}
    {mitKonkurrenz ? `${k.einst.name} · ` : ''}{ort}{#if amTisch && mitSchiri && spiel.schiri} · {T.spiele.schiri(spiel.schiri.name)}{/if}{#if vorgabe}{' · '}<strong>{T.spiele.vorgabeKurz(name(z, vorgabe.seite === 'a' ? spiel.a : spiel.b), vorgabe.punkte)}</strong>{/if}
  </span>
  <span class="namen">
    <span class:sieger={spiel.gewinner === 'a'} class:ich={seiteIch === 'a'}>{spiel.aFrei ? frei : name(z, spiel.a)}</span>
    <span class="leise">–</span>
    <span class:sieger={spiel.gewinner === 'b'} class:ich={seiteIch === 'b'}>{spiel.bFrei ? frei : name(z, spiel.b)}</span>
  </span>
  <span class="erg">
    {#if spiel.ergebnis}
      <strong>{ergebnisText(spiel.ergebnis)}</strong>
    {:else if zwischen && zwischen.gespielt > 0}
      <strong data-testid="zwischenstand">{T.spiele.zwischenstand(zwischen.siegeA, zwischen.siegeB)}</strong>
    {:else}
      <span class="leise">{amTisch ? T.tische.laeuft : statusText}</span>
      {#if zeit && !amTisch}<span class="zeit" data-testid="geschaetzt">{T.spiele.ca(zeit)}</span>{/if}
    {/if}
    {#if unentschieden}<span class="marke">{T.spiele.unentschieden}</span>{/if}
    {#if planText}<span class="marke plan">{T.spiele.geplant(planText)}</span>{/if}
    {#if bitteBestaetigen}<span class="marke warn">{T.spiele.bestaetigenNoetig}</span>
    {:else if spiel.stand === 'angefochten' || spiel.stand === 'konflikt'}<span class="marke warn">{T.spiele[spiel.stand]}</span>
    {:else if spiel.stand === 'eingetragen'}<span class="marke">{T.spiele.eingetragen}</span>{/if}
    {#if spiel.gestrichen}<span class="marke">{T.spiele.gestrichen}</span>{/if}
    {#if spiel.kampflosDurchRueckzug}<span class="marke">{T.spiele.kampflosRueckzug}</span>{/if}
  </span>
</button>

<style>
  .spiel {
    display: grid;
    gap: 2px;
    width: 100%;
    text-align: left;
    justify-content: stretch;
    background: var(--flaeche);
    color: var(--text);
    border: 1px solid var(--linie);
    border-left: 4px solid var(--blau);
    border-radius: 10px;
    padding: 10px 12px;
    font-weight: 400;
    margin-bottom: 8px;
  }
  .spiel:hover { background: var(--grund); }
  .spiel.fertig { border-left-color: var(--linie); }
  .spiel.hinweis { border-left-color: var(--orange); }
  .spiel.amtisch { border-left-color: var(--gruen); background: color-mix(in srgb, var(--gruen) 6%, var(--flaeche)); }
  .tisch { color: var(--gruen); }
  .namen { display: flex; flex-wrap: wrap; gap: 0 8px; font-size: 1.05rem; font-weight: 600; }
  .sieger { color: var(--gruen); }
  .ich { text-decoration: underline; text-underline-offset: 3px; }
  .erg { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-variant-numeric: tabular-nums; }
  .marke.warn { color: var(--orange-text); border-color: var(--orange); }
  .marke.plan { color: var(--blau); border-color: var(--blau); }
  .zeit { font-weight: 600; color: var(--blau); }
</style>
