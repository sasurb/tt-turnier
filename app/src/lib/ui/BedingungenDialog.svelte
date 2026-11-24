<script lang="ts">
  import { T } from '../texte';
  import { linkZu, route } from '../router.svelte';
  import { api } from '../dienste';
  import { abmelden, app, fehlerText, setzeSitzung } from '../app.svelte';

  /**
   * Ab 0.17: Konten, die der aktuellen Fassung der Nutzungsbedingungen (mit AVV) noch nicht zugestimmt haben
   * (bestehende Konten, vom Admin angelegte), stimmen beim nächsten Öffnen zu. Der Server verlangt das für alle
   * Konto-Aktionen (Fehler „bedingungen“).
   */
  const offen = $derived(
    app.server.art === 'bereit' && !!app.server.info.sparten && !!app.sitzung && app.sitzung.konto.bedingungen === false && !['bedingungen', 'datenschutz', 'impressum', 'ueber'].includes(route.seite),
  );
  let volljaehrig = $state(false);
  let zustimmung = $state(false);
  let fehler = $state('');

  async function zustimmen() {
    const s = app.sitzung;
    if (!s) return;
    fehler = '';
    try {
      const konto = await api.bedingungenAnnehmen(s.token);
      setzeSitzung({ token: s.token, konto });
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    }
  }
</script>

{#if offen}
  <div class="schleier" role="presentation"></div>
  <div class="dialog karte" role="dialog" aria-modal="true" aria-labelledby="bd-titel" data-testid="bedingungen-dialog">
    <h2 id="bd-titel">{T.bedingungen.dialogTitel}</h2>
    <p>{T.bedingungen.dialogText}</p>
    <p><a href={linkZu('bedingungen')}>{T.bedingungen.lesen} ›</a></p>
    <label class="haken"><input type="checkbox" bind:checked={volljaehrig} /> {T.registrieren.volljaehrig}</label>
    <label class="haken"><input type="checkbox" bind:checked={zustimmung} /> <span>{T.registrieren.bedingungenVor} {T.registrieren.bedingungenLink} {T.registrieren.bedingungenNach}</span></label>
    {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
    <div class="reihe">
      <button onclick={zustimmen} disabled={!volljaehrig || !zustimmung}>{T.bedingungen.zustimmen}</button>
      <button class="zweit" onclick={abmelden}>{T.bedingungen.spaeter}</button>
    </div>
  </div>
{/if}

<style>
  .schleier { position: fixed; inset: 0; background: rgb(0 0 0 / 0.45); z-index: 40; }
  .dialog { position: fixed; z-index: 41; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; margin: 0; }
</style>
