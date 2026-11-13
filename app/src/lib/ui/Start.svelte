<script lang="ts">
  import type { TurnierInfo } from '@shared/protokoll';
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { api, speicher } from '../dienste';
  import { app, anmeldungAbgelaufen, kontoTurnierOeffnen } from '../app.svelte';
  import { gemerkteTurniere, turnierVergessen, type GemerktesTurnier } from '../einstellungen';

  let geraet = $state<GemerktesTurnier[]>(gemerkteTurniere());
  let konto = $state<TurnierInfo[] | null>(null);
  let hinweis = $state(app.hinweis);
  app.hinweis = null;

  const angemeldet = $derived(app.sitzung);
  const bereit = $derived(app.server.art === 'bereit');
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
      .then((a) => (konto = a.turniere))
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
</script>

{#if hinweis}
  <div class="meldung ok" role="status">{hinweis}</div>
{/if}

{#if angemeldet}
  <p class="gruss">{T.start.hallo(angemeldet.konto.name)}</p>
{:else}
  <p class="leise">{T.start.willkommen}</p>
{/if}

<a class="knopf gross" href={linkZu('neu')} data-testid="neues-turnier">
  <span aria-hidden="true" class="plus">+</span>
  {T.start.neuesTurnier}
</a>

{#if app.server.art === 'nicht_eingerichtet'}
  <div class="meldung info">
    {T.start.nichtEingerichtet}
    <a href={linkZu('einrichtung')}>{T.start.einrichten}</a>
  </div>
{:else if app.server.art === 'keiner'}
  <div class="meldung info">{T.start.keinServer}</div>
{/if}

{#if bereit && !angemeldet}
  <section class="karte werbung">
    <h2>{T.start.mehrGeraeteTitel}</h2>
    <p class="leise">{T.start.mehrGeraeteText}</p>
    <div class="reihe">
      <a class="knopf" href={linkZu('registrieren')}>{T.start.kontoAnlegen}</a>
      <a class="knopf zweit" href={linkZu('anmelden')}>{T.start.anmelden}</a>
    </div>
  </section>
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
            <button class="zeile" onclick={() => kontoTurnierOeffnen(t, true)}>
              <strong>{t.name}</strong>
              <span class="leise">{datum(t.datum)} <span class="marke online">{T.start.modusOnline}</span></span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

{#if !konto || nurGeraet.length > 0}
  <section class="karte">
    <h2>{konto ? T.start.aufDiesemGeraet : T.start.meineTurniere}</h2>
    {#if nurGeraet.length === 0}
      <p class="leise">{T.start.keineTurniereGast}</p>
    {:else}
      <ul class="liste">
        {#each nurGeraet as t (t.id)}
          <li class="reihe">
            <a class="wachsen zeile" href={linkZu('t/' + t.id)}>
              <strong>{t.name}</strong>
              <span class="leise">
                {datum(t.datum)}
                <span class="marke" class:online={t.modus === 'online'}>
                  {t.modus === 'online' ? T.start.modusOnline : T.start.modusLokal}
                </span>
                {#if t.modus === 'online' && !t.token}<span class="marke">{T.start.rolleZuschauer}</span>{/if}
              </span>
            </a>
            <button class="gefahr klein" onclick={() => entfernen(t)} aria-label={T.start.entfernen} title={T.start.entfernen}>✕</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

{#if bereit}
  <section class="beitreten">
    <a class="knopf zweit breit" href={linkZu('beitreten')}>{T.start.beitreten}</a>
    <p class="leise">{T.start.beitretenHinweis}</p>
  </section>
{/if}

<style>
  .gruss { font-size: 1.15rem; font-weight: 600; margin-bottom: 14px; }
  .knopf.gross {
    width: 100%;
    min-height: 64px;
    font-size: 1.2rem;
    margin-bottom: var(--abstand);
    border-radius: var(--radius);
    box-shadow: var(--schatten);
  }
  .plus { font-size: 1.6rem; line-height: 1; font-weight: 400; }
  .werbung h2 { margin-bottom: 6px; }
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
  .beitreten { margin-top: 8px; }
  .beitreten p { margin-top: 8px; text-align: center; }
</style>
