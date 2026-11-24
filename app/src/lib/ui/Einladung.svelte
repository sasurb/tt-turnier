<script lang="ts">
  import { onMount } from 'svelte';
  import type { EinladungInfo } from '@shared/protokoll';
  import { T } from '../texte';
  import { gehe, linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { app, fehlerText, setzeSitzung } from '../app.svelte';

  /** #/einladung/<schlüssel>: Einladung in eine Sparte, ein Turnier oder einen Ausschuss annehmen */
  let { schluessel }: { schluessel: string } = $props();
  let info = $state<EinladungInfo | null>(null);
  let fehler = $state('');
  let laeuft = $state(false);

  onMount(async () => {
    try {
      info = (await api.einladungInfo(schluessel)).einladung;
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  });

  function was(i: EinladungInfo): string {
    if (i.art === 'turnier') return T.einladung.was.turnier(i.ziel ?? '');
    if (i.art === 'ausschuss') return T.einladung.was.ausschuss(i.ziel ?? '');
    if (i.rolle === 'spartenleitung') return T.einladung.was.spartenleitung;
    return i.anlegen ? T.einladung.was.turnierleitungAnlegen : T.einladung.was.turnierleitung;
  }

  async function annehmen() {
    const s = app.sitzung;
    if (!s) return;
    fehler = '';
    laeuft = true;
    try {
      const a = await api.einladungAnnehmen(s.token, schluessel);
      setzeSitzung({ token: s.token, konto: { ...s.konto, sparten: a.sparten, ausschuesse: a.ausschuesse } });
      app.hinweis = T.einladung.angenommen;
      gehe(a.ausschuss ? `ausschuss/${a.ausschuss}` : 'turniere');
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.einladung.titel}</h1>
{#if !info && !fehler}
  <p class="leise">{T.einladung.laden}</p>
{/if}
{#if info}
  <section class="karte" data-testid="einladung">
    <p><strong>{T.einladung.text(info.von, was(info), `${info.verein} – ${info.sparte}`)}</strong></p>
    <p class="leise">{T.einladung.fuer(info.email)}</p>
    {#if app.sitzung}
      {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
      <button class="breit" onclick={annehmen} disabled={laeuft}>{T.einladung.annehmen}</button>
    {/if}
  </section>
  {#if !app.sitzung}
    <section class="karte">
      <p>{T.einladung.neuHier}</p>
      <a class="knopf breit" href={linkZu(`registrieren/${schluessel}`)}>{T.einladung.kontoAnlegen}</a>
      <p style="margin-top:16px">{T.einladung.schonKonto}</p>
      <a class="knopf zweit breit" href={linkZu(`anmelden/einladung/${schluessel}`)}>{T.einladung.anmelden}</a>
    </section>
  {/if}
{:else if fehler}
  <div class="meldung fehler" role="alert">{fehler}</div>
  <a class="knopf zweit" href={linkZu('')}>{T.app.zurueck}</a>
{/if}
