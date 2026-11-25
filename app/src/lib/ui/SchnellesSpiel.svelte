<script lang="ts">
  /**
   * Schnelles Spiel (ab 0.18): ohne Anmeldung und ohne Server – Spielsystem wählen, Namen eintippen, los. Das Spiel
   * liegt nur auf diesem Gerät; später lässt es sich unter „Einstellungen“ in ein Turnier der Sparte übernehmen.
   */
  import { ART } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { speicher } from '../dienste';
  import { lokaleTurnierId, kurzId } from '../engine/ids';
  import { TurnierSitzung } from '../engine/turnier';
  import { standardEinstellungen, type Modus } from '../engine/modell';
  import { auslosungErstellen, gruppenZahlVorschlag } from '../engine/abfragen';
  import { neuerZufallswert } from '../engine/zufall';
  import { geraetId, turnierMerken } from '../einstellungen';
  import Hilfe from './Hilfe.svelte';

  const MODI: Modus[] = ['jgj', 'ko', 'gruppen_ko', 'schweizer', 'kaiser'];
  let modus = $state<Modus>('jgj');
  let bestOf = $state(3);
  let namenText = $state('');
  let fehler = $state('');
  let laeuft = $state(false);

  const namen = $derived([...new Set(namenText.split(/\n|,|;/).map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean))].slice(0, 64));
  const minimum = $derived(modus === 'kaiser' ? 4 : 2);

  async function los(e: SubmitEvent) {
    e.preventDefault();
    if (namen.length < minimum) {
      fehler = T.schnell.zuWenig(minimum);
      return;
    }
    laeuft = true;
    fehler = '';
    try {
      const id = lokaleTurnierId();
      const heute = new Date().toISOString().slice(0, 10);
      const name = T.schnell.turnierName(new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }));
      const s = new TurnierSitzung({ speicher, turnier: id, modus: 'lokal', geraet: geraetId(), autor: { rolle: 'leitung', name: 'Leitung' } });
      await s.eintragen(ART.turnierAngelegt, { name, datum: heute });
      turnierMerken({ id, name, datum: heute, modus: 'lokal', rolle: 'leitung', token: null });
      const ids: string[] = [];
      for (const n of namen) {
        const teile = n.split(' ');
        const sid = kurzId();
        ids.push(sid);
        await s.eintragen(ART.spielerAngelegt, { id: sid, vorname: teile[0]!.slice(0, 80), nachname: teile.slice(1).join(' ').slice(0, 80), verein: '' });
      }
      const kid = kurzId();
      await s.eintragen(ART.konkurrenzAngelegt, { id: kid, einst: { ...standardEinstellungen(), name: T.schnell.konkurrenz, modus, bestOf } });
      for (const sid of ids) await s.eintragen(ART.teilnehmerGemeldet, { konkurrenz: kid, id: sid });
      const z = await s.zustand();
      const k = z.konkurrenzen[kid]!;
      await s.eintragen(ART.auslosung, auslosungErstellen(z, k, neuerZufallswert(), modus === 'gruppen_ko' ? gruppenZahlVorschlag(k) : undefined));

      await s.eintragen(ART.phaseGestartet, { konkurrenz: kid, phase: modus === 'ko' ? 'ko' : 'gruppen' });
      gehe(`t/${id}/spiele`);
    } catch (x) {
      fehler = x instanceof Error ? x.message : String(x);
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>⚡ {T.schnell.titel}</h1>
<p class="leise">{T.schnell.text}</p>
<form class="karte" onsubmit={los} data-testid="schnell">
  <div class="label-zeile"><label for="sm">{T.schnell.modus}</label><Hilfe text={T.schnell.modusHilfe} /></div>
  <select id="sm" bind:value={modus} data-testid="schnell-modus">
    {#each MODI as m (m)}<option value={m}>{T.konk.modi[m]}</option>{/each}
  </select>
  <label for="sb">{T.schnell.saetze}</label>
  <select id="sb" bind:value={bestOf}>
    {#each [1, 3, 5, 7] as b (b)}<option value={b}>{T.schnell.saetzeWahl(b)}</option>{/each}
  </select>
  <div class="label-zeile"><label for="sn">{T.schnell.namen}</label><Hilfe text={T.schnell.namenHilfe} /></div>
  <textarea id="sn" bind:value={namenText} rows="8" placeholder={T.schnell.namenBeispiel} data-testid="schnell-namen"></textarea>
  <p class="leise" data-testid="schnell-anzahl">{T.schnell.anzahl(namen.length)}</p>
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <button type="submit" class="breit" disabled={laeuft || namen.length < minimum} data-testid="schnell-los">{T.schnell.los}</button>
</form>
<p class="leise">{T.schnell.spaeter}</p>
<p><a href={linkZu('')}>{T.app.zurStart}</a></p>

<style>
  textarea { resize: vertical; width: 100%; }
</style>
