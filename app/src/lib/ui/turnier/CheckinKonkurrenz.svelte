<script lang="ts">
  /**
   * Check-in einer Konkurrenz vor der Auslosung (ab 0.18): Stand, „Alle anwesend“, „Check-in abschließen“
   * (die Leitung kann Fehlende dabei streichen), wieder öffnen. Leitung und Kasse.
   */
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { alsEineAktion } from '../../aktion';
  import { name } from '../../engine/abfragen';
  import type { KonkurrenzZustand } from '../../engine/modell';
  import { checkinStand } from '../../engine/kasse';
  import { spielerVon, type TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';

  let { z, k, leitung, eintragen }: { z: TurnierZustand; k: KonkurrenzZustand; leitung: boolean; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();

  const st = $derived(checkinStand(z, k));
  let fehler = $state('');

  async function alleDa() {
    fehler = '';
    try {
      await alsEineAktion(async () => {
        for (const t of k.meldungen) {
          const spieler = k.einst.art === 'mannschaft' ? (k.mannschaften[t]?.spieler ?? []) : spielerVon(k, t);
          for (const s of spieler) if (z.checkin[s] !== true) await eintragen(ART.teilnehmerEingecheckt, { spieler: s, da: true });
        }
        await eintragen(ART.konkurrenzCheckin, { konkurrenz: k.id, fertig: true });
      });
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    }
  }
  async function abschliessen() {
    fehler = '';
    const streichen = leitung && st.fehlend.length > 0 && confirm(T.checkin.streichenFrage(st.fehlend.length, st.fehlend.map((t) => name(z, t, k)).join(', ')));
    try {
      await alsEineAktion(async () => {
        if (streichen) for (const t of st.fehlend) await eintragen(ART.teilnehmerAbgemeldet, { konkurrenz: k.id, id: t });
        await eintragen(ART.konkurrenzCheckin, { konkurrenz: k.id, fertig: true });
      });
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    }
  }
  async function oeffnen() {
    await eintragen(ART.konkurrenzCheckin, { konkurrenz: k.id, fertig: false });
  }
</script>

<div class="checkin" class:fertig={k.checkinFertig} data-testid="checkin-konkurrenz">
  <div class="reihe">
    <strong class="wachsen">{k.checkinFertig ? `✓ ${T.checkin.fertig}` : T.checkin.titel}: {T.checkin.stand(st.da, st.teilnehmer)}</strong>
    <Hilfe text={T.checkin.hilfe} />
  </div>
  {#if !k.checkinFertig && st.fehlend.length}
    <p class="leise">{T.checkin.fehlt}: {st.fehlend.map((t) => name(z, t, k)).join(', ')}</p>
  {/if}
  {#each st.unterbesetzt as u (u.teilnehmer)}
    <p class="hinweis">{name(z, u.teilnehmer, k)}: {T.mannschaft.unterbesetzt(u.da, u.min)}{k.einst.mannschaft?.ersatz ? ` – ${T.checkin.ersatz}` : ''}</p>
  {/each}
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <div class="reihe">
    {#if k.checkinFertig}
      <button class="zweit klein" onclick={oeffnen}>{T.checkin.oeffnen}</button>
    {:else}
      {#if st.fehlend.length}<button class="zweit" onclick={alleDa} data-testid="checkin-alle">{T.checkin.alleDa}</button>{/if}
      <button onclick={abschliessen} data-testid="checkin-abschliessen">{T.checkin.abschliessen}</button>
    {/if}
  </div>
</div>

<style>
  .checkin { border: 1px solid var(--linie); border-radius: 10px; padding: 10px 12px; margin: 8px 0 12px; }
  .checkin.fertig { border-color: var(--gruen); }
  .hinweis { color: var(--orange-text); font-weight: 600; margin: 4px 0; }
  .leise { margin: 4px 0; }
</style>
