<script lang="ts">
  import { T } from '../../texte';
  import { name, rundeVon } from '../../engine/abfragen';
  import { ergebnisText } from '../../engine/ergebnis';
  import type { KonkurrenzZustand, Spiel } from '../../engine/modell';
  import { seiteVon, type TurnierZustand } from '../../engine/zustand';

  let {
    z,
    k,
    spiel,
    ich = null,
    mitKonkurrenz = true,
    mitSchiri = false,
    oeffnen,
  }: { z: TurnierZustand; k: KonkurrenzZustand; spiel: Spiel; ich?: string | null; mitKonkurrenz?: boolean; mitSchiri?: boolean; oeffnen: () => void } = $props();

  const ort = $derived(rundeVon(k, spiel));
  const amTisch = $derived(spiel.tisch !== null && spiel.status === 'offen');
  const statusText = $derived.by(() => {
    if (spiel.status === 'wartet') return spiel.gesperrt ? T.spiele.gesperrt : T.spiele.wartet;
    if (spiel.status === 'freilos') return T.spiele.freilos;
    if (spiel.status === 'entfallen') return T.spiele.entfallen;
    if (spiel.status === 'offen') return T.spiele.offen;
    return '';
  });
  const seiteIch = $derived(seiteVon(k, spiel, ich));
  const bitteBestaetigen = $derived(!!seiteIch && spiel.stand === 'eingetragen' && !!spiel.eintrag && !spiel.eintrag.amtlich && spiel.eintrag.seite !== seiteIch);
</script>

<button class="spiel" class:amtisch={amTisch} class:fertig={spiel.status === 'gespielt'} class:hinweis={bitteBestaetigen || spiel.stand === 'angefochten' || spiel.stand === 'konflikt'} onclick={oeffnen} data-testid="spiel">
  <span class="ort leise">
    {#if amTisch}<strong class="tisch">{T.spiele.tisch(spiel.tisch!)}</strong> ·{/if}
    {mitKonkurrenz ? `${k.einst.name} · ` : ''}{ort}{#if amTisch && mitSchiri && spiel.schiri} · {T.spiele.schiri(spiel.schiri.name)}{/if}
  </span>
  <span class="namen">
    <span class:sieger={spiel.gewinner === 'a'} class:ich={seiteIch === 'a'}>{spiel.aFrei ? T.konk.freilos : name(z, spiel.a)}</span>
    <span class="leise">–</span>
    <span class:sieger={spiel.gewinner === 'b'} class:ich={seiteIch === 'b'}>{spiel.bFrei ? T.konk.freilos : name(z, spiel.b)}</span>
  </span>
  <span class="erg">
    {#if spiel.ergebnis}
      <strong>{ergebnisText(spiel.ergebnis)}</strong>
    {:else}
      <span class="leise">{amTisch ? T.tische.laeuft : statusText}</span>
    {/if}
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
  .marke.warn { color: var(--orange); border-color: var(--orange); }
</style>
