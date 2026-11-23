<script lang="ts">
  /**
   * Einstellungen → „Konkurrenzarten und Spielsysteme“ (ab 0.16): alle Arten und Spielsysteme zum Anhaken; die im
   * Startassistenten gewählten sind angehakt. Unter „Konkurrenzen“ stehen nur die gewählten zur Wahl. Vor dem
   * Übernehmen zeigt die Vorschau, was mit bestehenden Konkurrenzen passiert (löschen, umstellen) und wer danach in
   * keiner Konkurrenz mehr gemeldet ist.
   */
  import { onMount, tick } from 'svelte';
  import { ART } from '@shared/protokoll';
  import { T } from '../../texte';
  import { linkZu } from '../../router.svelte';
  import { alsEineAktion } from '../../aktion';
  import { ALLE_ARTEN, MODI, MODI_MANNSCHAFT, spielerName, type KonkurrenzArt, type Modus } from '../../engine/modell';
  import { angeboten, auswahlFolgen, auswahlOrdnen, auswahlPruefen } from '../../engine/auswahl';
  import type { TurnierZustand } from '../../engine/zustand';
  import Hilfe from '../Hilfe.svelte';

  let {
    z,
    turnierId,
    offen = false,
    eintragen,
  }: { z: TurnierZustand; turnierId: string; offen?: boolean; eintragen: (art: string, d: Record<string, unknown>) => Promise<unknown> } = $props();

  // svelte-ignore state_referenced_locally
  let auf = $state(offen);
  let knoten: HTMLDetailsElement | undefined = $state();
  onMount(async () => {
    if (!offen) return;
    await tick();
    knoten?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  const jetzt = $derived(angeboten(z));
  // svelte-ignore state_referenced_locally
  let arten = $state<KonkurrenzArt[]>([...angeboten(z).arten]);
  // svelte-ignore state_referenced_locally
  let modi = $state<Modus[]>([...angeboten(z).modi]);
  let meldung = $state<{ ok: boolean; text: string } | null>(null);
  let ohneNachher = $state<string[]>([]);
  let laeuft = $state(false);

  const neu = $derived(auswahlOrdnen({ arten, modi }));
  const geaendert = $derived(JSON.stringify(neu) !== JSON.stringify(auswahlOrdnen(jetzt)));
  const fehler = $derived(auswahlPruefen(neu));
  const folgen = $derived(auswahlFolgen(z, neu));
  const nutzungArt = (a: KonkurrenzArt) => z.konkurrenzReihe.filter((id) => z.konkurrenzen[id]!.einst.art === a).length;
  const nutzungModus = (m: Modus) => z.konkurrenzReihe.filter((id) => z.konkurrenzen[id]!.einst.modus === m).length;
  const namen = (ids: string[]) => ids.map((id) => z.konkurrenzen[id]?.einst.name ?? id).join(', ');

  function zuruecksetzen() {
    arten = [...jetzt.arten];
    modi = [...jetzt.modi];
  }

  async function uebernehmen() {
    if (fehler || folgen.gesperrt.length) return;
    if (folgen.entfernen.length && !confirm(T.auswahl.entfernen(namen(folgen.entfernen)) + '?')) return;
    laeuft = true;
    meldung = null;
    const ohne = [...folgen.ohneKonkurrenz];
    try {
      await alsEineAktion(async () => {
        for (const u of folgen.umstellen) {
          const k = z.konkurrenzen[u.id];
          if (k) await eintragen(ART.konkurrenzGeaendert, { id: u.id, einst: { ...$state.snapshot(k.einst), modus: u.nach } });
        }
        for (const id of folgen.entfernen) await eintragen(ART.konkurrenzEntfernt, { id });
        await eintragen(ART.turnierDaten, { konkurrenzarten: neu });
      });
      ohneNachher = ohne;
      meldung = { ok: true, text: T.auswahl.gespeichert };
    } catch (x) {
      meldung = { ok: false, text: x instanceof Error ? x.message : String(x) };
    } finally {
      laeuft = false;
    }
  }
</script>

<details class="auswahl" bind:open={auf} bind:this={knoten} data-testid="auswahl">
  <summary>
    <span class="titel">{T.auswahl.titel}</span>
    <span class="leise">{z.konkurrenzarten ? jetzt.arten.map((a) => T.konk.arten[a]).join(', ') : T.auswahl.alle}</span>
  </summary>
  <p class="leise">{T.auswahl.text}<Hilfe text={T.auswahl.hilfe} /></p>

  <fieldset>
    <legend>{T.auswahl.arten}</legend>
    <div class="gitter">
      {#each ALLE_ARTEN as a (a)}
        <label class="haken">
          <input type="checkbox" value={a} bind:group={arten} data-testid="auswahl-art-{a}" />
          <span>{T.konk.arten[a]}{#if nutzungArt(a)} <span class="leise">· {T.auswahl.imEinsatz(nutzungArt(a))}</span>{/if}</span>
        </label>
      {/each}
    </div>
  </fieldset>

  <fieldset>
    <legend>{T.auswahl.modi}</legend>
    <div class="gitter">
      {#each MODI as m (m)}
        <label class="haken">
          <input type="checkbox" value={m} bind:group={modi} data-testid="auswahl-modus-{m}" />
          <span>
            {T.konk.modi[m]}
            {#if nutzungModus(m)}<span class="leise">· {T.auswahl.imEinsatz(nutzungModus(m))}</span>{/if}
            {#if arten.includes('mannschaft') && !MODI_MANNSCHAFT.includes(m)}<span class="leise">· {T.assistent.modiNurEinzel}</span>{/if}
          </span>
        </label>
      {/each}
    </div>
  </fieldset>

  {#if geaendert}
    <div class="folgen" data-testid="auswahl-folgen">
      <h4>{T.auswahl.folgen}</h4>
      {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
      {#if folgen.gesperrt.length}
        <div class="meldung fehler" role="alert">
          <strong>{T.auswahl.gesperrt}:</strong>
          <ul>{#each folgen.gesperrt as g (g)}<li>{g}</li>{/each}</ul>
        </div>
      {/if}
      <ul class="liste">
        {#if folgen.entfernen.length}<li data-testid="auswahl-entfernen">{T.auswahl.entfernen(namen(folgen.entfernen))}</li>{/if}
        {#each folgen.umstellen as u (u.id)}<li>{T.auswahl.umstellen(z.konkurrenzen[u.id]!.einst.name, T.konk.modi[u.nach]!)}</li>{/each}
        {#if folgen.ohneKonkurrenz.length}
          <li class="warn" data-testid="auswahl-ohne">{T.auswahl.ohne(folgen.ohneKonkurrenz.length, folgen.ohneKonkurrenz.map((id) => spielerName(z.spieler[id])).join(', '))}</li>
        {/if}
        {#if !folgen.entfernen.length && !folgen.umstellen.length && !folgen.gesperrt.length}<li class="leise">{T.auswahl.nichts}</li>{/if}
      </ul>
      <div class="reihe">
        <button disabled={laeuft || !!fehler || folgen.gesperrt.length > 0} onclick={uebernehmen} data-testid="auswahl-uebernehmen">{T.auswahl.speichern}</button>
        <button class="zweit" onclick={zuruecksetzen}>{T.app.abbrechen}</button>
      </div>
    </div>
  {/if}
  {#if meldung}
    <div class="meldung" class:ok={meldung.ok} class:fehler={!meldung.ok} role="status">
      {meldung.text}
      {#if meldung.ok && ohneNachher.length}
        {T.ohneKonk.titel(ohneNachher.length)} – <a href={linkZu(`t/${turnierId}/teilnehmer`)}>{T.reiter.teilnehmer} →</a>
      {/if}
      {#if meldung.ok}<a href={linkZu(`t/${turnierId}/konkurrenzen`)}>{T.auswahl.neuAnlegen}</a>{/if}
    </div>
  {/if}
</details>

<style>
  .auswahl > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; min-height: 44px; cursor: pointer; }
  .auswahl > summary .titel { font-weight: 700; font-size: 1.05rem; }
  .gitter { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: 0 16px; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  fieldset { margin-top: 8px; }
  .folgen { border-top: 1px solid var(--linie); margin-top: 10px; padding-top: 8px; }
  .folgen h4 { margin: 4px 0; }
  .folgen .warn { color: var(--orange-text); font-weight: 600; }
  .meldung a { margin-left: 8px; }
</style>
