<script lang="ts">
  /**
   * Eingabe einer 8-stelligen Kennung in zwei Viererblöcken. Nach 4 Ziffern springt der Cursor
   * in den zweiten Block; eingefügte Kennungen („4839 2017“) werden auf beide Felder verteilt.
   * `wert` ist immer die reine Ziffernfolge (0–8 Zeichen).
   */
  let {
    wert = $bindable(''),
    id,
    label,
    autofocus = false,
    disabled = false,
  }: { wert?: string; id: string; label: string; autofocus?: boolean; disabled?: boolean } = $props();

  let feld1: HTMLInputElement | undefined = $state();
  let feld2: HTMLInputElement | undefined = $state();
  // Fokus beim Erscheinen (statt autofocus-Attribut, das Screenreader überrumpelt)
  $effect(() => {
    if (autofocus) feld1?.focus();
  });
  const teil1 = $derived(wert.slice(0, 4));
  const teil2 = $derived(wert.slice(4, 8));

  function ziffern(t: string) {
    return t.replace(/\D/g, '');
  }
  function eingabe1(e: Event) {
    const z = ziffern((e.currentTarget as HTMLInputElement).value);
    if (z.length > 4) {
      wert = z.slice(0, 8);
      feld2?.focus();
    } else {
      wert = z + wert.slice(4);
      if (z.length === 4) feld2?.focus();
    }
    (e.currentTarget as HTMLInputElement).value = wert.slice(0, 4);
  }
  function eingabe2(e: Event) {
    const z = ziffern((e.currentTarget as HTMLInputElement).value).slice(0, 4);
    wert = wert.slice(0, 4) + z;
    (e.currentTarget as HTMLInputElement).value = z;
  }
  function taste2(e: KeyboardEvent) {
    if (e.key === 'Backspace' && teil2 === '') {
      feld1?.focus();
      e.preventDefault();
      wert = wert.slice(0, 3);
    }
  }
  function einfuegen(e: ClipboardEvent) {
    const z = ziffern(e.clipboardData?.getData('text') ?? '');
    if (z.length >= 8) {
      e.preventDefault();
      wert = z.slice(0, 8);
      feld2?.focus();
    }
  }
</script>

<div class="kennung" role="group" aria-label={label}>
  <input
    bind:this={feld1}
    id={id}
    value={teil1}
    oninput={eingabe1}
    onpaste={einfuegen}
    inputmode="numeric"
    pattern="[0-9]*"
    maxlength="8"
    autocomplete="one-time-code"
    placeholder="0000"
    aria-label="{label}, Block 1"
    {disabled}
  />
  <span aria-hidden="true">–</span>
  <input
    bind:this={feld2}
    id="{id}-2"
    value={teil2}
    oninput={eingabe2}
    onkeydown={taste2}
    onpaste={einfuegen}
    inputmode="numeric"
    pattern="[0-9]*"
    maxlength="4"
    autocomplete="off"
    placeholder="0000"
    aria-label="{label}, Block 2"
    {disabled}
  />
</div>

<style>
  .kennung { display: flex; align-items: center; gap: 8px; }
  .kennung input {
    width: 6.2rem;
    min-width: 0;
    text-align: center;
    font-family: ui-monospace, monospace;
    font-size: 1.5rem;
    letter-spacing: 0.15em;
    padding: 8px 4px;
  }
  .kennung span { color: var(--leise); font-size: 1.3rem; }
</style>
