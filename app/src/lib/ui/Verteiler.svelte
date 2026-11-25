<script lang="ts">
  /**
   * Verteiler für Ankündigungen (ab 0.18):
   *   #/verteiler/<turnier>        eintragen (Sparte des Turniers)
   *   #/verteiler/b/<schlüssel>    bestätigen (Double-Opt-In)
   *   #/verteiler/ab/<kennung>     abbestellen (Link in jeder Mail)
   */
  import { onMount } from 'svelte';
  import type { AnmeldungInfo } from '@shared/protokoll';
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { fehlerText } from '../app.svelte';

  let { art, wert }: { art: 'eintragen' | 'bestaetigen' | 'abmelden'; wert: string } = $props();

  let info = $state<AnmeldungInfo | null>(null);
  let name = $state('');
  let email = $state('');
  let alter = $state<'' | 'voll' | 'eltern'>('');
  let datenschutz = $state(false);
  let website = $state('');
  let fehler = $state('');
  let laeuft = $state(false);
  let fertig = $state('');

  onMount(async () => {
    if (art === 'eintragen') {
      try {
        info = await api.anmeldungInfo(wert);
      } catch {
        info = null; // auch ohne Online-Anmeldung möglich – Name des Turniers fehlt dann
      }
    } else if (art === 'bestaetigen') {
      try {
        const r = await api.verteilerBestaetigen(wert);
        fertig = T.verteiler.bestaetigt(`${r.verein} – ${r.sparte}`);
      } catch (x) {
        fehler = fehlerText(x, T.app.fehlerAllgemein);
      }
    }
  });

  async function eintragen(e: SubmitEvent) {
    e.preventDefault();
    fehler = '';
    laeuft = true;
    try {
      await api.verteilerEintragen({ turnier: wert, name: name.trim(), email: email.trim(), volljaehrig: alter === 'voll', erziehungsberechtigte: alter === 'eltern', datenschutz, website });
      fertig = T.verteiler.gesendet;
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }

  async function abmelden() {
    fehler = '';
    laeuft = true;
    try {
      await api.verteilerAbmelden(wert);
      fertig = T.verteiler.abgemeldet;
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.verteiler.seite}</h1>
{#if fertig}
  <div class="meldung ok" role="status" data-testid="verteiler-fertig">{fertig}</div>
{:else if art === 'bestaetigen'}
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{:else}<p class="leise">{T.verteiler.pruefe}</p>{/if}
{:else if art === 'abmelden'}
  <div class="karte">
    <p>{T.verteiler.abmeldenFrage}</p>
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <button class="breit" onclick={abmelden} disabled={laeuft} data-testid="verteiler-abmelden">{T.verteiler.abmelden}</button>
  </div>
{:else}
  <form class="karte" onsubmit={eintragen}>
    <p>{T.verteiler.seiteText(info?.turnier.veranstalter ?? '')}</p>
    {#if info}<p class="leise">{info.turnier.name}</p>{/if}
    <label for="vt-name">{T.verteiler.name}</label>
    <input id="vt-name" bind:value={name} autocomplete="name" maxlength="120" required />
    <label for="vt-mail">{T.verteiler.email}</label>
    <input id="vt-mail" type="email" bind:value={email} autocomplete="email" maxlength="190" required />
    <fieldset>
      <label class="haken"><input type="radio" name="vt-alter" value="voll" bind:group={alter} /> {T.verteiler.volljaehrig}</label>
      <label class="haken"><input type="radio" name="vt-alter" value="eltern" bind:group={alter} /> {T.verteiler.eltern}</label>
    </fieldset>
    <label class="haken"><input type="checkbox" bind:checked={datenschutz} /> <span>{T.verteiler.datenschutz} <a href={linkZu('datenschutz')} target="_blank" rel="noopener">{T.meldung.datenschutzLink}</a></span></label>
    <div class="fang" aria-hidden="true"><label for="vw">Website</label><input id="vw" bind:value={website} tabindex="-1" autocomplete="off" /></div>
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <button type="submit" class="breit" disabled={laeuft || name.trim().length < 2 || !email.includes('@') || !alter || !datenschutz} data-testid="verteiler-eintragen">{T.verteiler.eintragen}</button>
  </form>
{/if}
<p><a href={linkZu('')}>{T.app.zurStart}</a></p>

<style>
  fieldset { border: 0; padding: 0; margin: 12px 0 0; }
  .haken { display: flex; gap: 10px; align-items: center; font-weight: 400; min-height: 44px; margin: 0; }
  .haken input { width: 22px; height: 22px; min-height: 0; flex: none; }
  .fang { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
</style>
