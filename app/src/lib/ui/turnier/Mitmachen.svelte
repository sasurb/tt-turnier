<script lang="ts">
  import { T } from '../../texte';
  import { codeEingabe } from '../../code';

  let {
    anmelden,
    fehler = '',
    standardName = '',
  }: { anmelden: (code: string, name: string) => Promise<void>; fehler?: string; standardName?: string } = $props();

  let code = $state('');
  // svelte-ignore state_referenced_locally
  let name = $state(standardName);
  let sendet = $state(false);

  async function absenden(e: SubmitEvent) {
    e.preventDefault();
    sendet = true;
    try {
      await anmelden(code, name.trim());
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
  <input
    id="mc"
    class="code-feld"
    value={code}
    oninput={(e) => {
      code = codeEingabe(e.currentTarget.value);
      e.currentTarget.value = code;
    }}
    inputmode="numeric"
    pattern="[0-9]*"
    maxlength="6"
    autocomplete="one-time-code"
    required
  />
  <label for="mn">{T.zugang.name}</label>
  <input id="mn" bind:value={name} autocomplete="name" />
  {#if fehler}<div class="meldung fehler" role="alert">{fehler}</div>{/if}
  <button type="submit" style="margin-top:12px" disabled={code.length !== 6 || sendet}>{T.zugang.knopf}</button>
</form>
