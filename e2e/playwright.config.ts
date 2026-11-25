import { defineConfig, devices } from '@playwright/test';

/**
 * Oberflächentests auf Handy, Tablet und PC gegen den echten PHP-Server (SQLite).
 * Aufruf: cd e2e && npm ci && npx playwright install chromium && npx playwright test
 * Screenshots landen in e2e/bilder/<gerät>/.
 */
const PORT = Number(process.env.PORT ?? 8090);

export default defineConfig({
  testDir: './tests',
  testIgnore: /zentrale\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './tests/einrichten.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [
    { name: 'webkit', testMatch: /e01-e07\.spec\.ts/, use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'handy', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, browserName: 'chromium' } },
    { name: 'pc', use: { viewport: { width: 1280, height: 860 }, browserName: 'chromium' } },
  ],
  webServer: {
    command: './server-starten.sh',
    url: `http://127.0.0.1:${PORT}/api/index.php?r=info`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(PORT) },
  },
});
