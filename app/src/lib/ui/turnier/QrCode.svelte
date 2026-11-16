<script lang="ts">
  import qrcode from 'qrcode-generator';

  // UTF-8 statt Latin-1: Umlaute in WLAN-Namen, Vereinsnamen (GiroCode) und Links bleiben lesbar
  const q = qrcode as unknown as { stringToBytes: unknown; stringToBytesFuncs: Record<string, unknown> };
  if (q.stringToBytesFuncs?.['UTF-8']) q.stringToBytes = q.stringToBytesFuncs['UTF-8'];

  let { text, groesse = 160, label = '' }: { text: string; groesse?: number; label?: string } = $props();

  const svg = $derived.by(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  });
</script>

<div class="qr" style:width="{groesse}px" style:height="{groesse}px" role="img" aria-label={label || text}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- selbst erzeugtes SVG -->
  {@html svg}
</div>

<style>
  .qr { background: #fff; border-radius: 8px; flex: none; }
  .qr :global(svg) { width: 100%; height: 100%; display: block; }
</style>
