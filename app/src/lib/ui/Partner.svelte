<script lang="ts">
  import { onMount } from 'svelte';
  import type { PartnerAntwort } from '@shared/protokoll';
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { fehlerText } from '../app.svelte';
  import Hilfe from './Hilfe.svelte';

  /** #/partner/<turnier>/<schlüssel>: Partner/in einer Doppelmeldung bestätigt oder lehnt ab (Frage 11B) */
  let { turnier, schluessel }: { turnier: string; schluessel: string } = $props();
  let info = $state<PartnerAntwort | null>(null);
  let volljaehrig = $state(false);
  let fehler = $state('');
  let laeuft = $state(false);

  onMount(async () => {
    try {
      info = await api.anmeldungPartner(turnier, schluessel);
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  });

  async function antworten(antwort: 'ja' | 'nein') {
    if (antwort === 'nein' && !confirm(T.partner.neinFrage)) return;
    fehler = '';
    laeuft = true;
    try {
      info = await api.anmeldungPartner(turnier, schluessel, antwort, antwort === 'ja' ? volljaehrig : undefined);
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.partner.titel}</h1>
{#if info}
  <section class="karte" data-testid="partner">
    <p><strong>{T.partner.text(info.von, info.konkurrenz, info.turnier.name)}</strong></p>
    <p class="meldung" class:ok={info.status === 'bestaetigt'} class:info={info.status !== 'bestaetigt'} data-testid="partner-status">{T.partner.status[info.status]}</p>
    {#if info.status === 'offen'}
      <div class="label-zeile">
        <label class="haken"><input type="checkbox" bind:checked={volljaehrig} /> {T.partner.volljaehrig}</label>
        <Hilfe text={T.partner.volljaehrigHilfe} />
      </div>
      {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
      <div class="reihe">
        <button onclick={() => antworten('ja')} disabled={laeuft || !volljaehrig}>{T.partner.ja}</button>
        <button class="zweit" onclick={() => antworten('nein')} disabled={laeuft}>{T.partner.nein}</button>
      </div>
    {/if}
    <p class="leise">{T.partner.datenschutz} <a href={linkZu('datenschutz')}>{T.fuss.datenschutz}</a></p>
  </section>
{:else if fehler}
  <div class="meldung fehler" role="alert">{fehler}</div>
{/if}
