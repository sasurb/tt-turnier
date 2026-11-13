<script lang="ts">
  import { onMount } from 'svelte';
  import { T } from '../texte';
  import { linkZu } from '../router.svelte';
  import { serverPruefen, speicher, type ServerZustand } from '../dienste';
  import { gemerkteTurniere, kontoSitzung, turnierVergessen, type GemerktesTurnier } from '../einstellungen';

  let server = $state<ServerZustand>({ art: 'pruefe' });
  let turniere = $state<GemerktesTurnier[]>(gemerkteTurniere());
  const angemeldet = kontoSitzung();

  onMount(async () => {
    server = await serverPruefen();
  });

  async function entfernen(t: GemerktesTurnier) {
    const frage = t.modus === 'lokal' ? T.start.entfernenLokalFrage : T.start.entfernenFrage;
    if (!confirm(frage)) return;
    await speicher.loeschen(t.id);
    turnierVergessen(t.id);
    turniere = gemerkteTurniere();
  }

  function datum(d: string | null) {
    return d ? new Date(d + 'T12:00:00').toLocaleDateString('de-DE') : '';
  }
</script>

<p class="leise">{T.start.willkommen}</p>

{#if server.art === 'keiner'}
  <div class="meldung info">{T.start.keinServer}</div>
{:else if server.art === 'nicht_eingerichtet'}
  <div class="meldung info">
    {T.start.nichtEingerichtet}
    <a href={linkZu('einrichtung')}>{T.start.einrichten}</a>
  </div>
{/if}

<section class="auswahl">
  <a class="kachel" href={linkZu('neu')}>
    <strong>{T.start.neuLokal}</strong>
    <span class="leise">{T.start.neuLokalHinweis}</span>
  </a>
  {#if server.art === 'bereit'}
    {#if angemeldet}
      <a class="kachel" href={linkZu('konto')}>
        <strong>{T.start.zumKonto}</strong>
        <span class="leise">{angemeldet.konto.name}</span>
      </a>
    {:else}
      <a class="kachel" href={linkZu('anmelden')}>
        <strong>{T.start.anmelden}</strong>
        <span class="leise">{T.start.anmeldenHinweis}</span>
      </a>
    {/if}
    <a class="kachel" href={linkZu('beitreten')}>
      <strong>{T.start.beitreten}</strong>
      <span class="leise">{T.start.beitretenHinweis}</span>
    </a>
  {/if}
</section>

<section class="karte">
  <h2>{T.start.meineTurniere}</h2>
  {#if turniere.length === 0}
    <p class="leise">{T.start.keineTurniere}</p>
  {:else}
    <ul class="liste">
      {#each turniere as t (t.id)}
        <li class="reihe">
          <a class="wachsen turnierlink" href={linkZu('t/' + t.id)}>
            <strong>{t.name}</strong>
            <span class="leise">
              {datum(t.datum)}
              <span class="marke" class:online={t.modus === 'online'}>
                {t.modus === 'online' ? T.start.modusOnline : T.start.modusLokal}
              </span>
            </span>
          </a>
          <button class="gefahr klein" onclick={() => entfernen(t)} aria-label={T.start.entfernen} title={T.start.entfernen}>✕</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .auswahl { display: grid; gap: 12px; margin-bottom: 16px; }
  @media (min-width: 640px) { .auswahl { grid-template-columns: repeat(3, 1fr); } }
  .kachel {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 16px;
    min-height: 88px;
    border-radius: var(--radius);
    background: var(--flaeche);
    border: 1px solid var(--linie);
    box-shadow: var(--schatten);
    color: var(--text);
    text-decoration: none;
  }
  .kachel strong { color: var(--blau); font-size: 1.05rem; }
  .kachel:hover { border-color: var(--blau); }
  .turnierlink { display: flex; flex-direction: column; color: var(--text); text-decoration: none; min-height: 44px; justify-content: center; }
</style>
