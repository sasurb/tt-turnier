<script lang="ts">
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api } from '../dienste';
  import { angemeldet, app, fehlerText } from '../app.svelte';
  import PasswortFeld from './PasswortFeld.svelte';
  import Hilfe from './Hilfe.svelte';

  /**
   * Konto anlegen (ab 0.17): ohne Einladung mit Verein und Sparte (das Konto wird Spartenleitung),
   * mit Einladung (#/registrieren/<schlüssel>) tritt das Konto der Sparte, dem Turnier bzw. dem Ausschuss bei.
   * „Mindestens 18“ und die Zustimmung zu den Nutzungsbedingungen (mit AVV) sind Pflicht.
   */
  let { einladung = null, nachweis = null }: { nachweis?: string | null; einladung?: string | null } = $props();

  let name = $state('');
  let email = $state('');
  let passwort = $state('');
  let verein = $state('');
  let sparte = $state('Tischtennis');
  let volljaehrig = $state(false);
  let bedingungen = $state(false);
  let website = $state(''); // Fangfeld für Bots, für Menschen unsichtbar
  let versendet = $state(false);
  let fehler = $state('');
  let laeuft = $state(false);
  const mitSparten = $derived(app.server.art === 'bereit' && !!app.server.info.sparten);

  async function anlegen(e: SubmitEvent) {
    e.preventDefault();
    fehler = '';
    laeuft = true;
    try {
      if (!nachweis) {
        await api.registrierlink(email.trim(), einladung, website);
        versendet = true;
        return;
      }
      const a = await api.registrieren({
        nachweis,
        name: name.trim(),
        email: email.trim(),
        passwort,
        volljaehrig,
        bedingungen,
        ...(einladung ? { einladung } : { verein: verein.trim(), sparte: sparte.trim() || 'Tischtennis' }),
        website,
      });
      angemeldet(a, einladung ? T.einladung.angenommen : T.registrieren.willkommen, einladung && a.konto.ausschuesse?.length && !a.konto.sparten?.length ? `ausschuss/${a.konto.ausschuesse[0]!.id}` : '');
    } catch (x) {
      fehler = fehlerText(x, T.app.fehlerAllgemein);
    } finally {
      laeuft = false;
    }
  }
</script>

<h1>{T.registrieren.titel}</h1>
<p class="leise">{einladung ? T.registrieren.einleitungEinladung : T.registrieren.einleitung}</p>
{#if app.server.art === 'keiner'}
  <div class="meldung info">{T.app.keinServer}</div>
{/if}

<form class="karte" onsubmit={anlegen}>
  {#if nachweis}
  <div class="label-zeile"><label for="rn">{T.registrieren.name}</label><Hilfe text={T.registrieren.nameHilfe} /></div>
  <input id="rn" bind:value={name} autocomplete="name" minlength="2" maxlength="120" required />
  {/if}
  <div class="label-zeile"><label for="re">{T.registrieren.email}</label><Hilfe text={T.registrieren.emailHilfe} /></div>
  <input id="re" type="email" bind:value={email} autocomplete="email" inputmode="email" autocapitalize="off" required />
  {#if nachweis}
  <label for="rp">{T.registrieren.passwort}</label>
  <PasswortFeld id="rp" bind:wert={passwort} neu min={8} />

  {#if !einladung && mitSparten}
    <div class="label-zeile"><label for="rv">{T.registrieren.verein}</label><Hilfe text={T.registrieren.vereinHilfe} /></div>
    <input id="rv" bind:value={verein} autocomplete="organization" minlength="2" maxlength="160" required />
    <div class="label-zeile"><label for="rs">{T.registrieren.sparte}</label><Hilfe text={T.registrieren.sparteHilfe} /></div>
    <input id="rs" bind:value={sparte} minlength="2" maxlength="120" required />
  {/if}

  {/if}
  <div class="fang" aria-hidden="true">
    <label for="rw">Website</label>
    <input id="rw" bind:value={website} tabindex="-1" autocomplete="off" />
  </div>

  {#if nachweis}
  <div class="haken-zeile">
    <label class="haken"><input type="checkbox" bind:checked={volljaehrig} required /> {T.registrieren.volljaehrig}</label>
    <Hilfe text={T.registrieren.volljaehrigHilfe} />
  </div>
  <div class="haken-zeile">
    <label class="haken">
      <input type="checkbox" bind:checked={bedingungen} required />
      <span>{T.registrieren.bedingungenVor} <a href={linkZu('bedingungen')} target="_blank" rel="noopener">{T.registrieren.bedingungenLink}</a> {T.registrieren.bedingungenNach}</span>
    </label>
    <Hilfe text={T.registrieren.bedingungenHilfe} />
  </div>

  {/if}
  {#if versendet}<p role="status">Öffne den Bestätigungslink in deiner E-Mail. Er gilt 24 Stunden.</p>{/if}
  <p class="leise datenschutz">
    {T.registrieren.datenschutzVor} <a href={linkZu('datenschutz')}>{T.registrieren.datenschutzLink}</a>{T.registrieren.datenschutzNach}
  </p>
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <button type="submit" class="breit" disabled={laeuft || (!!nachweis && (!volljaehrig || !bedingungen))}>{nachweis ? T.registrieren.knopf : 'Bestätigungslink anfordern'}</button>
</form>

<section class="karte neu">
  <span>{T.registrieren.schonKonto}</span>
  <a class="knopf zweit" href={linkZu(einladung ? `einladung/${einladung}` : 'anmelden')}>{T.anmelden.knopf}</a>
</section>

<style>
  .fang { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
  .datenschutz { margin: 16px 0 12px; }
  .neu { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .haken-zeile { display: flex; align-items: flex-start; gap: 6px; margin-top: 12px; }
  .haken-zeile .haken { flex: 1; }
</style>
