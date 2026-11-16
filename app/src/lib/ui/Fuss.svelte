<script lang="ts">
  import { linkZu } from '../router.svelte';
  import { T } from '../texte';
</script>

<footer>
  <a href={linkZu('hilfe')} data-testid="fuss-hilfe">{T.fuss.hilfe}</a>
  <a href={linkZu('impressum')}>{T.fuss.impressum}</a>
  <a href={linkZu('datenschutz')}>{T.fuss.datenschutz}</a>
  <a href={linkZu('kontakt')}>{T.fuss.kontakt}</a>
</footer>

<style>
  footer {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 4px 20px;
    padding: 8px 16px calc(env(safe-area-inset-bottom) + 20px);
    font-size: 0.9rem;
  }
  footer a { color: var(--leise); min-height: 44px; display: inline-flex; align-items: center; }
</style>
