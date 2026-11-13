<script lang="ts">
  import { app, abmelden } from '../app.svelte';
  import { linkZu, route } from '../router.svelte';
  import { T } from '../texte';

  let offen = $state(false);
  let wurzel: HTMLDivElement | undefined = $state();

  const name = $derived(app.sitzung?.konto.name ?? '');
  const initial = $derived(name.trim().charAt(0).toUpperCase() || '?');

  function aussen(e: PointerEvent) {
    if (offen && wurzel && !wurzel.contains(e.target as Node)) offen = false;
  }
  $effect(() => {
    void route.seite; // bei Seitenwechsel schließen
    offen = false;
  });
</script>

<svelte:window onpointerdown={aussen} onkeydown={(e) => e.key === 'Escape' && (offen = false)} />

<header>
  <a class="marke-app" href={linkZu('')}>
    <img src="./favicon.svg" alt="" width="28" height="28" />
    <span class="lang">{T.app.titel}</span>
    <span class="kurz">{T.app.kurz}</span>
  </a>

  {#if app.sitzung}
    <div class="konto" bind:this={wurzel}>
      <button
        class="konto-knopf"
        aria-haspopup="menu"
        aria-expanded={offen}
        aria-label={T.kopf.menue}
        title={`${T.kopf.angemeldetAls} ${name}`}
        onclick={() => (offen = !offen)}
      >
        <span class="kreis" aria-hidden="true">{initial}</span>
        <span class="name">{name}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {#if offen}
        <div class="menue" role="menu">
          <div class="leise wer">{T.kopf.angemeldetAls}<br /><strong>{name}</strong><br />{app.sitzung.konto.email}</div>
          <a role="menuitem" href={linkZu('konto')}>{T.kopf.konto}</a>
          <a role="menuitem" href={linkZu('pool')}>{T.pool.titel}</a>
          {#if app.sitzung.konto.rolle === 'admin'}
            <a role="menuitem" href={linkZu('verwaltung')}>{T.kopf.verwaltung}</a>
          {/if}
          <button role="menuitem" class="abmelden" onclick={abmelden}>{T.kopf.abmelden}</button>
        </div>
      {/if}
    </div>
  {:else if app.server.art === 'bereit' && route.seite !== 'anmelden'}
    <a class="anmelden" href={linkZu('anmelden')}>{T.kopf.anmelden}</a>
  {/if}
</header>

<style>
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: var(--blau);
    color: #fff;
    padding: calc(env(safe-area-inset-top) + 8px) 12px 8px 16px;
  }
  .marke-app {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: #fff;
    text-decoration: none;
    font-weight: 700;
    font-size: 1.1rem;
    min-height: 44px;
  }
  .marke-app img { border-radius: 7px; background: #fff2; }
  .kurz { display: none; }
  @media (max-width: 420px) {
    .lang { display: none; }
    .kurz { display: inline; }
  }
  .konto { position: relative; }
  .konto-knopf, .anmelden {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 4px 12px 4px 4px;
    border-radius: 999px;
    border: 1px solid #fff6;
    background: #ffffff1a;
    color: #fff;
    font-weight: 600;
    text-decoration: none;
  }
  .anmelden { padding: 4px 16px; }
  .konto-knopf:hover, .anmelden:hover { background: #ffffff33; }
  .kreis {
    display: inline-grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: #fff;
    color: var(--blau);
    font-weight: 700;
  }
  .name { max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 420px) {
    .name { max-width: 6.5rem; }
  }
  .menue {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    min-width: 15rem;
    background: var(--flaeche);
    color: var(--text);
    border: 1px solid var(--linie);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
    padding: 6px;
    display: flex;
    flex-direction: column;
  }
  .wer { padding: 8px 12px 10px; border-bottom: 1px solid var(--linie); margin-bottom: 4px; overflow-wrap: anywhere; }
  .menue a, .menue button {
    display: flex;
    align-items: center;
    min-height: 48px;
    padding: 0 12px;
    border-radius: 8px;
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
    background: transparent;
    border: 0;
    justify-content: flex-start;
    width: 100%;
  }
  .menue a:hover, .menue button:hover { background: var(--grund); }
  .menue .abmelden { color: var(--rot); }
</style>
