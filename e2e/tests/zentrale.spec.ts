import { expect, test, type Page } from '@playwright/test';
import { reiterOeffnen } from './hilfen';
import { mkdirSync } from 'node:fs';

/**
 * Halle ohne Internet: Das Handy der Leitung ist die Zentrale, eine Spielerin trägt
 * auf ihrem eigenen Gerät über das WLAN der Zentrale ein.
 */
async function bild(page: Page, name: string) {
  const ordner = `bilder/${test.info().project.name}`;
  mkdirSync(ordner, { recursive: true });
  await page.screenshot({ path: `${ordner}/${name}.png`, fullPage: true });
}

test('Zentrale: Beitritt, Turnier anlegen, Spielerin trägt über das WLAN ein', async ({ page, browser }, info) => {
  const lan = process.env.ZENTRALE_LAN!;
  const geraet = info.project.name;

  // Gerät der Zentrale: ohne Anmeldung als „Zentrale“ angemeldet, Karte zur Zentrale-Seite
  // Das Gerät der Zentrale öffnet die App mit dem Geheimnis der Hülle
  await page.goto('./?zentrale=0123456789abcdef0123456789abcdef');
  await expect(page.getByTestId('zentrale-karte')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Konto-Menü' })).toContainText('Zentrale');
  await expect(page.getByRole('heading', { name: 'Turnierleitung' })).toHaveCount(0);
  await bild(page, '01-start-zentrale');

  await page.getByTestId('zentrale-karte').click();
  await expect(page.getByRole('heading', { name: 'So treten andere Geräte bei' })).toBeVisible();
  await expect(page.getByTestId('adresse')).toHaveText(lan);
  await page.getByLabel('Name des WLANs (SSID)').fill('TT-Halle');
  await page.getByLabel('Passwort des WLANs').fill('aufschlag24');
  await page.getByRole('button', { name: 'Für den WLAN-Code speichern' }).click();
  await expect(page.getByTestId('beitritt').getByText('TT-Halle')).toBeVisible();
  await expect(page.getByTestId('beitritt').locator('.qr')).toHaveCount(2);
  await bild(page, '02-zentrale-seite');

  // Neues Turnier: „Mehrere Geräte (Zentrale)“ vorausgewählt
  await page.getByRole('link', { name: 'Zurück' }).click();
  await page.getByTestId('neues-turnier').click();
  await expect(page.getByLabel(/Mehrere Geräte \(Zentrale\)/)).toBeChecked();
  await page.getByLabel('Name des Turniers').fill(`Hallencup ${geraet}`);
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await expect(page.getByRole('heading', { name: `Hallencup ${geraet}` })).toBeVisible();
  await expect(page.getByText('Verbunden')).toBeVisible();

  for (const [v, n] of [
    ['Anna', 'Alpha'],
    ['Ben', 'Beta'],
  ] as const) {
    if (v === 'Anna') await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
    await page.getByLabel('Vorname').fill(v);
    await page.getByLabel('Nachname').fill(n);
    await page.getByLabel('Verein', { exact: true }).fill('TTC');
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} ${n} ✓`)).toBeVisible();
  }
  await reiterOeffnen(page, 'Konkurrenzen');
  await page.getByLabel('Name', { exact: true }).fill('Offen');
  await page.getByLabel(/Jeder gegen jeden/).check();
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  await page.getByRole('button', { name: 'Alle melden' }).click();
  await expect(page.getByRole('heading', { name: 'Meldungen (2)' })).toBeVisible();
  await page.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('starten').click();
  await expect(page.getByTestId('konkurrenz').getByText('Gruppenphase')).toBeVisible();

  // Zugänge: Turnierkennung 8 Ziffern, Links zeigen auf die Adresse im WLAN, nicht auf 127.0.0.1
  await reiterOeffnen(page, 'Zugänge');
  expect((await page.getByTestId('turnierkennung').innerText()).replace(/\s/g, '')).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  const link = await page.getByLabel('Link').inputValue();
  expect(link.startsWith(lan)).toBe(true);
  // Die Zentrale hat für die Leitung eine eigene Kennung
  await expect(page.getByTestId('zugaenge-leitung').getByTestId('code')).toHaveCount(1);
  const spielerZugaenge = page.getByTestId('zugaenge-spieler');
  await spielerZugaenge.locator('summary').click();
  const annaCode = (await spielerZugaenge.locator('li', { hasText: 'Anna Alpha' }).getByTestId('code').innerText()).replace(/\s/g, '');
  expect(annaCode).toMatch(/^\d{8}$/);
  await bild(page, '03-zugaenge');

  // Anderes Gerät im WLAN: kein Konto-Angebot, kein „Neues Turnier“ – nur beitreten; persönlicher Link meldet Anna an
  const u = info.project.use;
  const zweites = await browser.newContext({
    viewport: u.viewport,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    deviceScaleFactor: u.deviceScaleFactor,
    userAgent: u.userAgent,
    locale: 'de-DE',
  });
  const p2 = await zweites.newPage();
  await p2.goto(lan);
  await expect(p2.getByTestId('neues-turnier')).toHaveCount(0);
  await expect(p2.getByTestId('beitreten')).toBeVisible();
  await expect(p2.getByTestId('zentrale-karte')).toHaveCount(0);
  await expect(p2.getByRole('link', { name: 'Anmelden' })).toHaveCount(0);
  await p2.goto(link.replace('#/t/', '#/c/') + '/' + annaCode);
  await expect(p2.getByText(/Willkommen, Anna Alpha/)).toBeVisible();
  await p2.getByTestId('spiel').first().click();
  const dialog = p2.getByRole('dialog');
  for (const [i, punkte] of [
    [1, '5'],
    [2, '7'],
    [3, '9'],
  ] as const) {
    await dialog
      .getByTestId(`satz-${i}`)
      .getByRole('radio', { name: /Anna Alpha/ })
      .click();
    await dialog.getByLabel(`Punkte des Verlierers Satz ${i}`).fill(punkte);
  }
  await dialog.getByRole('button', { name: 'Ergebnis speichern' }).click();
  await expect(p2.getByText('vom Spieler eingetragen').first()).toBeVisible();
  await bild(p2, '04-spielerin');
  await zweites.close();

  // Zentrale sieht das Ergebnis und das verbundene Gerät
  await page.getByRole('link', { name: 'Tabellen' }).click();
  await expect(page.getByTestId('tabelle-A').locator('tbody tr').first()).toContainText('Anna Alpha', { timeout: 15_000 });
  await page.goto('./?zentrale=0123456789abcdef0123456789abcdef#/zentrale');
  await expect(page.getByText(/1 anderes Gerät verbunden|andere Geräte verbunden/)).toBeVisible();
  await expect(page.getByText(`Hallencup ${geraet}`)).toBeVisible();
});
