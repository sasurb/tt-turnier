<script lang="ts">
  import { T } from '../../texte';
  import KennungFeld from '../KennungFeld.svelte';

  let { anmelden, fehler = '' }: { anmelden: (code: string) => Promise<void>; fehler?: string } = $props();

  let code = $state('');
  let sendet = $state(false);

  async function absenden(e: SubmitEvent) {
    e.preventDefault();
    sendet = true;
    try {
      await anmelden(code);
      code = '';
    } finally {
      sendet = false;
    }
  }
</script>

<form class="karte" onsubmit={absenden}>
  <h2>{T.zugang.titel}</h2>
  <p class="leise">{T.zugang.text}</p>
  <label for="mc">{T.zugang.code}</label>
  <KennungFeld id="mc" bind:wert={code} label={T.zugang.code} />
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <button type="submit" style="margin-top:12px" disabled={code.length !== 8 || sendet}>{T.zugang.knopf}</button>
</form>
