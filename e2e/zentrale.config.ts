import { defineConfig, devices } from '@playwright/test';
import { networkInterfaces } from 'node:os';

/**
 * Oberflächentests gegen die Android-Zentrale (Java-Kern im JDK, gleiche Logik wie auf dem Handy).
 * Das „Gerät der Zentrale“ öffnet 127.0.0.1, die anderen Geräte die Adresse im Netz.
 * Aufruf: (cd ../zentrale/kern && ./pruefen.sh) && npx playwright test -c zentrale.config.ts
 */
const PORT = Number(process.env.ZENTRALE_PORT ?? 8099);
/** Festes Geheimnis für den Test (die Hülle öffnet die App sonst mit einem zufälligen) */
export const GEHEIMNIS = '0123456789abcdef0123456789abcdef';

function lanAdresse(): string {
  for (const liste of Object.values(networkInterfaces())) {
    for (const a of liste ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('Keine Netzwerkadresse gefunden');
}
process.env.ZENTRALE_LAN = process.env.ZENTRALE_LAN ?? `http://${lanAdresse()}:${PORT}/`;

export default defineConfig({
  testDir: './tests',
  testMatch: /zentrale\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'zentrale-handy',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
    {
      name: 'zentrale-tablet',
      use: {
        viewport: { width: 820, height: 1180 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        browserName: 'chromium',
      },
    },
  ],
  webServer: {
    command: `rm -rf /tmp/tt-e2e-zentrale && (cd ../app && npm run build --silent) && java -jar ../zentrale/kern/build/kern.jar --daten /tmp/tt-e2e-zentrale --app ../app/dist --port ${PORT} --geheimnis ${GEHEIMNIS}`,
    url: `http://127.0.0.1:${PORT}/api/index.php?r=info`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
