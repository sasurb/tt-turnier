<script lang="ts">
  import { T } from '../../texte';
  import { spielerName } from '../../engine/modell';
  import type { TurnierZustand } from '../../engine/zustand';
  import { benachrichtigen, faehigkeiten, setzeMitteilungEinstellung, systemErlauben, type MitteilungEinstellung } from '../../mitteilung';
  import Hilfe from '../Hilfe.svelte';

  /**
   * Einstellungen „Aufruf aufs Handy“: für wen (eigene Kennung oder einem Spieler folgen), Ton,
   * Vibration, Mitteilung im Hintergrund, Bildschirm wach halten. Gilt nur auf diesem Gerät.
   */
  let {
    z,
    turnierId,
    ich,
    einstellung = $bindable(),
    zugeklappt = false,
  }: { z: TurnierZustand; turnierId: string; ich: string | null; einstellung: MitteilungEinstellung; zugeklappt?: boolean } = $props();

  const kann = faehigkeiten();
  let systemFehler = $state('');
  const spieler = $derived([...z.spielerReihe].map((id) => ({ id, name: spielerName(z.spieler[id]) })).sort((a, b) => a.name.localeCompare(b.name, 'de')));

  function setzen(neu: Partial<MitteilungEinstellung>) {
    einstellung = { ...einstellung, ...neu };
    setzeMitteilungEinstellung(turnierId, einstellung);
  }
  async function systemUmschalten(an: boolean) {
    systemFehler = '';
    if (!an) return setzen({ system: false });
    const ok = await systemErlauben();
    if (!ok) systemFehler = kann.system ? T.mitteilung.systemVerweigert : T.mitteilung.systemNicht;
    setzen({ system: ok });
  }
</script>

<details class="karte mitteilung" open={!zugeklappt} data-testid="mitteilung">
  <summary>{T.mitteilung.titel}<Hilfe text={T.mitteilung.hilfe} /></summary>
  {#if !ich}
    <label>
      {T.mitteilung.fuer}
      <select value={einstellung.spieler ?? ''} onchange={(e) => setzen({ spieler: (e.currentTarget as HTMLSelectElement).value || null })} data-testid="mitteilung-spieler">
        <option value="">{T.mitteilung.niemand}</option>
        {#each spieler as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
      </select>
    </label>
  {/if}
  {#if ich || einstellung.spieler}
    <label class="haken"><input type="checkbox" checked={einstellung.ton} onchange={(e) => setzen({ ton: (e.currentTarget as HTMLInputElement).checked })} /> {T.mitteilung.ton}</label>
    {#if kann.vibration}
      <label class="haken"><input type="checkbox" checked={einstellung.vibration} onchange={(e) => setzen({ vibration: (e.currentTarget as HTMLInputElement).checked })} /> {T.mitteilung.vibration}</label>
    {/if}
    <label class="haken">
      <input type="checkbox" checked={einstellung.system} disabled={!kann.system} onchange={(e) => void systemUmschalten((e.currentTarget as HTMLInputElement).checked)} />
      {T.mitteilung.system}
    </label>
    {#if !kann.system}<p class="leise">{T.mitteilung.systemNicht}</p>{/if}
    {#if systemFehler}<p class="meldung info">{systemFehler}</p>{/if}
    {#if kann.wach}
      <label class="haken"><input type="checkbox" checked={einstellung.wach} onchange={(e) => setzen({ wach: (e.currentTarget as HTMLInputElement).checked })} /> {T.mitteilung.wach}</label>
    {/if}
    <button class="zweit klein" onclick={() => void benachrichtigen({ ...einstellung, system: false }, T.app.titel, T.mitteilung.probeText, 'probe')}>{T.mitteilung.probe}</button>
  {/if}
</details>

<style>
  .mitteilung summary { font-weight: 700; display: flex; align-items: center; gap: 4px; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; margin: 8px 0; min-height: 44px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  select { width: 100%; }
</style>
