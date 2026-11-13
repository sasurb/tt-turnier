<script lang="ts">
  import { T } from '../../texte';
  import { name, runden } from '../../engine/abfragen';
  import { ergebnisText } from '../../engine/ergebnis';
  import { rundenName } from '../../engine/ko';
  import { gruppenName, type KonkurrenzZustand, type Spiel } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';

  let {
    z,
    k,
    spiel,
    ich = null,
    mitKonkurrenz = true,
    oeffnen,
  }: { z: TurnierZustand; k: KonkurrenzZustand; spiel: Spiel; ich?: string | null; mitKonkurrenz?: boolean; oeffnen: () => void } = $props();

  const ort = $derived(
    spiel.phase === 'gruppen'
      ? `${T.konk.gruppe(gruppenName(spiel.gruppe ?? 0))} · ${T.spiele.runde(spiel.runde)}`
      : spiel.platz3
        ? T.konk.platz3
        : rundenName(spiel.runde, runden(k)),
  );
  const statusText = $derived.by(() => {
    if (spiel.status === 'wartet') return spiel.gesperrt ? T.spiele.gesperrt : T.spiele.wartet;
    if (spiel.status === 'freilos') return T.spiele.freilos;
    if (spiel.status === 'entfallen') return T.spiele.entfallen;
    if (spiel.status === 'offen') return T.spiele.offen;
    return '';
  });
  const bitteBestaetigen = $derived(!!ich && spiel.stand === 'eingetragen' && !!spiel.eintrag && !spiel.eintrag.amtlich && spiel.eintrag.von?.spieler !== ich);
  const seiteIch = $derived(ich ? (spiel.a === ich ? 'a' : spiel.b === ich ? 'b' : null) : null);
</script>

<button class="spiel" class:fertig={spiel.status === 'gespielt'} class:hinweis={bitteBestaetigen || spiel.stand === 'angefochten' || spiel.stand === 'konflikt'} onclick={oeffnen} data-testid="spiel">
  <span class="ort leise">{mitKonkurrenz ? `${k.einst.name} · ` : ''}{ort}</span>
  <span class="namen">
    <span class:sieger={spiel.gewinner === 'a'} class:ich={seiteIch === 'a'}>{spiel.aFrei ? T.konk.freilos : name(z, spiel.a)}</span>
    <span class="leise">–</span>
    <span class:sieger={spiel.gewinner === 'b'} class:ich={seiteIch === 'b'}>{spiel.bFrei ? T.konk.freilos : name(z, spiel.b)}</span>
  </span>
  <span class="erg">
    {#if spiel.ergebnis}
      <strong>{ergebnisText(spiel.ergebnis)}</strong>
    {:else}
      <span class="leise">{statusText}</span>
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
  .namen { display: flex; flex-wrap: wrap; gap: 0 8px; font-size: 1.05rem; font-weight: 600; }
  .sieger { color: var(--gruen); }
  .ich { text-decoration: underline; text-underline-offset: 3px; }
  .erg { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-variant-numeric: tabular-nums; }
  .marke.warn { color: var(--orange); border-color: var(--orange); }
</style>
