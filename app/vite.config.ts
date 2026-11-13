import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig({
  // Relative Pfade: läuft unter tt-turnier.saschaurban.de/ und unter sasurb.github.io/tt-turnier/
  base: './',
  plugins: [svelte()],
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
