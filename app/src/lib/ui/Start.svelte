<script lang="ts">
  import { SPENDENWEGE } from '../rechtliches';
  import type { TurnierInfo, ZentraleStatus } from '@shared/protokoll';
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api, speicher } from '../dienste';
  import { app, anmeldungAbgelaufen, kontoTurnierOeffnen } from '../app.svelte';
  import { gemerkteTurniere, turnierVergessen, type GemerktesTurnier } from '../einstellungen';
  import { amGeraetDerZentrale, istZentrale } from '../zentrale.svelte';
  import { codeAnzeige } from '../code';

  /**
   * Startseite. Drei Lagen:
   * - Online-Server: Turnierleitung meldet sich an; alle anderen treten mit einer Kennung bei.
   * - Gerät der Zentrale: wie angemeldete Leitung (Turniere anlegen), andere Geräte im WLAN treten bei.
   * - Demo ohne Server (GitHub Pages): Turniere nur auf diesem Gerät.
   */
  let geraet = $state<GemerktesTurnier[]>(gemerkteTurniere());
  let konto = $state<TurnierInfo[] | null>(null);
  let hinweis = $state(app.hinweis);
  app.hinweis = null;

  const angemeldet = $derived(app.sitzung);
  const bereit = $derived(app.server.art === 'bereit');
  const demo = $derived(app.server.art === 'keiner');
  const zentrale = $derived(istZentrale());
  const zentralGeraet = $derived(amGeraetDerZentrale());
  /** Neue Turniere: angemeldete Leitung (auch Zentrale) oder Demo ohne Server */
  const darfAnlegen = $derived(!!angemeldet || demo);
  let zStatus = $state<ZentraleStatus | null>(null);
  $effect(() => {
    if (!zentralGeraet) return;
    const holen = () => api.zentraleStatus().then((s) => (zStatus = s)).catch(() => undefined);
    void holen();
    const t = setInterval(holen, 10_000);
    return () => clearInterval(t);
  });
  /** Turniere auf diesem Gerät, die nicht ohnehin in der Konto-Liste stehen */
  const nurGeraet = $derived(konto ? geraet.filter((g) => !konto!.some((k) => k.id === g.id)) : geraet);

  $effect(() => {
    const s = app.sitzung;
    if (!s || app.server.art !== 'bereit') {
      konto = null;
      return;
    }
    api
      .turniere(s.token)
      .then((a) => (konto = a.turniere.slice(0, 8)))
      .catch((x) => {
        anmeldungAbgelaufen(x);
      });
  });

  async function entfernen(t: GemerktesTurnier) {
    const frage = t.modus === 'lokal' ? T.start.entfernenLokalFrage : T.start.entfernenFrage;
    if (!confirm(frage)) return;
    await speicher.loeschen(t.id);
    turnierVergessen(t.id);
    geraet = gemerkteTurniere();
  }

  function datum(d: string | null) {
    return d ? new Date(d + 'T12:00:00').toLocaleDateString('de-DE') : '';
  }
  function rolleText(t: GemerktesTurnier) {
    if (t.modus === 'lokal') return T.start.modusLokal;
    if (t.token) return t.helfer ? T.zugang.spielerHelfer : T.rollen[t.rolle];
    return T.start.rolleZuschauer;
  }
</script>

{#if hinweis}
  <div class="meldung ok" role="status">{hinweis}</div>
{/if}

{#if zentralGeraet}
  <a class="karte zentrale" href={linkZu('zentrale')} data-testid="zentrale-karte">
    <strong>{T.zentrale.startTitel}</strong>
    <span class="leise">{zStatus ? T.zentrale.startText(zStatus.geraete) : T.app.laden} · {T.zentrale.oeffnen} ›</span>
  </a>
{:else if angemeldet}
  <p class="gruss">{T.start.hallo(angemeldet.konto.name)}</p>
{:else}
  <p class="leise willkommen">{T.start.willkommen}</p>
{/if}

{#if app.server.art === 'nicht_eingerichtet'}
  <div class="meldung info">
    {T.start.nichtEingerichtet}
    <a href={linkZu('einrichtung')}>{T.start.einrichten}</a>
  </div>
{:else if demo}
  <div class="meldung info">{T.start.demo}</div>
{/if}

{#if darfAnlegen}
  <a class="knopf gross" href={linkZu('neu')} data-testid="neues-turnier">
    <span aria-hidden="true" class="plus">+</span>
    {T.start.neuesTurnier}
  </a>
{/if}

{#if bereit && !angemeldet && !zentrale}
  <section class="karte einstieg">
    <h2>{T.start.leitungTitel}</h2>
    <p class="leise">{T.start.leitungText}</p>
    <div class="reihe">
      <a class="knopf" href={linkZu('anmelden')} data-testid="anmelden">{T.start.anmelden}</a>
      <a class="knopf zweit" href={linkZu('registrieren')}>{T.start.kontoAnlegen}</a>
    </div>
  </section>
{/if}

{#if bereit}
  <section class="karte einstieg">
    <h2>{T.start.beitretenTitel}</h2>
    <p class="leise">{zentrale && !zentralGeraet ? T.start.zentraleBeitreten : T.start.beitretenHinweis}</p>
    <a class="knopf" class:zweit={angemeldet} href={linkZu('beitreten')} data-testid="beitreten">{T.start.beitreten}</a>
  </section>
  <p class="hilfe-link">
    <a href={linkZu('hilfe')} data-testid="start-hilfe">{T.start.hilfe}</a>
    {#if SPENDENWEGE.length}<a href={linkZu('spenden')}>{T.spenden.fuss}</a>{/if}
  </p>
{/if}

{#if konto}
  <section class="karte">
    <h2>{T.start.meineTurniere}</h2>
    {#if konto.length === 0}
      <p class="leise">{T.start.keineTurniere}</p>
    {:else}
      <ul class="liste">
        {#each konto as t (t.id)}
          <li>
            <button class="zeile" onclick={() => kontoTurnierOeffnen(t)}>
              <strong>{t.name}</strong>
              <span class="leise">{datum(t.datum)} · <span class="kennung">{codeAnzeige(t.id)}</span> <span class="marke online">{zentrale ? T.zentrale.modus : T.start.modusOnline}</span></span>
            </button>
          </li>
        {/each}
      </ul>
      {#if konto.length >= 8}<p><a href={linkZu('turniere')}>{T.kopf.turniere} ›</a></p>{/if}
    {/if}
  </section>
{/if}

{#if nurGeraet.length > 0}
  <section class="karte">
    <h2>{T.start.aufDiesemGeraet}</h2>
    <ul class="liste">
      {#each nurGeraet as t (t.id)}
        <li class="reihe">
          <a class="wachsen zeile" href={linkZu('t/' + t.id)}>
            <strong>{t.name}</strong>
            <span class="leise">
              {datum(t.datum)}
              <span class="marke" class:online={t.modus === 'online'}>{rolleText(t)}</span>
            </span>
          </a>
          <button class="gefahr klein" onclick={() => entfernen(t)} aria-label={T.start.entfernen} title={T.start.entfernen}>✕</button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if angemeldet || demo}
  <p class="pool-link"><a href={linkZu('pool')}>{T.pool.titel}</a> <span class="leise">– {T.pool.text}</span></p>
{/if}

<style>
  .gruss { font-size: 1.15rem; font-weight: 600; margin-bottom: 14px; }
  .willkommen { margin-bottom: 14px; }
  .zentrale { display: flex; flex-direction: column; gap: 4px; text-decoration: none; color: var(--text); border-left: 4px solid var(--blau); }
  .zentrale:hover strong { color: var(--blau); }
  .knopf.gross {
    width: 100%;
    min-height: 64px;
    font-size: 1.2rem;
    margin-bottom: var(--abstand);
    border-radius: var(--radius);
    box-shadow: var(--schatten);
  }
  .plus { font-size: 1.6rem; line-height: 1; font-weight: 400; }
  .einstieg h2 { margin-bottom: 6px; }
  .einstieg .knopf { min-height: 52px; }
  .einstieg p { margin-bottom: 12px; }
  .kennung { font-family: ui-monospace, monospace; letter-spacing: 0.05em; }
  .zeile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 2px;
    width: 100%;
    min-height: 52px;
    padding: 4px 0;
    color: var(--text);
    background: transparent;
    border: 0;
    text-align: left;
    text-decoration: none;
    font-weight: 400;
  }
  .zeile:hover { background: transparent; }
  .zeile:hover strong { color: var(--blau); }
  .pool-link { margin-top: 20px; text-align: center; }
  .hilfe-link { display: flex; justify-content: center; flex-wrap: wrap; gap: 0 24px; }
  .hilfe-link a { display: inline-flex; align-items: center; min-height: 44px; }
</style>
