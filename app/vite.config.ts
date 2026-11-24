import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

const shared = fileURLToPath(new URL('../shared', import.meta.url));
const paket = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string };

/**
 * Erzeugt beim Bauen dist/sw.js aus sw/sw-vorlage.js mit der Liste aller App-Dateien (für den
 * Offline-Betrieb). Die Version ist eine Prüfsumme über die Dateinamen: neue App → neuer Zwischenspeicher.
 */
function serviceWorker(): Plugin {
  return {
    name: 'tt-service-worker',
    apply: 'build',
    generateBundle(_opt, bundle) {
      const oeffentlich = readdirSync(fileURLToPath(new URL('./public', import.meta.url))).filter((d) => !d.startsWith('.'));
      const dateien = ['./', ...oeffentlich.map((d) => `./${d}`), ...Object.keys(bundle).filter((d) => !d.endsWith('.map')).map((d) => `./${d}`)].filter(
        (d, i, a) => a.indexOf(d) === i && d !== './sw.js',
      );
      const version = createHash('sha256').update(dateien.join('|')).digest('hex').slice(0, 12);
      const vorlage = readFileSync(fileURLToPath(new URL('./sw/sw-vorlage.js', import.meta.url)), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: vorlage.replace('__VERSION__', version).replace('__DATEIEN__', JSON.stringify(dateien)) });
    },
  };
}

export default defineConfig({
  // Relative Pfade: läuft unter tt-turnier.saschaurban.de/ und unter sasurb.github.io/tt-turnier/
  base: './',
  plugins: [svelte(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(paket.version) },
  resolve: { alias: { '@shared': shared } },
  server: {
    fs: { allow: ['..'] },
    // Entwicklung: PHP-Server lokal mit „php -S localhost:8080 -t ../server-php/public“
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
