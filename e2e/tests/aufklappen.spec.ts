import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ADMIN } from './einrichten';

/**
 * Paket 0.15b: Zugeklappte Konkurrenzen bleiben zu (auch nach Änderungen und Reiterwechsel),
 * und „Konkurrenzen zusammenlegen“ hat schon am Knopf eine Hilfe-ⓘ – auf Handy, Tablet und PC.
 */

async function bild(page: Page, name: string) {
  const ordner = `bilder/${test.info().project.name}`;
  mkdirSync(ordner, { recursive: true });
  await page.screenshot({ path: `${ordner}/${name}.png`, fullPage: true });
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Bereiche' });

async function konkurrenzAnlegen(page: Page, name: string) {
  const neu = page.getByRole('button', { name: /Neue Konkurrenz/ });
  if (await neu.isVisible()) await neu.click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel(/Jeder gegen jeden/).check();
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  await expect(page.getByTestId('konkurrenz').filter({ hasText: name })).toBeVisible();
}

test('Konkurrenz bleibt zugeklappt, Zusammenlegen mit Hilfe', async ({ page }, info) => {
  const geraet = info.project.name;
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  await page.goto('./#/anmelden');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.passwort);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill(`Aufklappen ${geraet}`);
  await page.getByLabel('Datum').fill('2027-12-11');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await expect(page.getByText('Verbunden')).toBeVisible();

  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  await konkurrenzAnlegen(page, 'Herren A');
  await konkurrenzAnlegen(page, 'Herren B');

  // Hilfe-ⓘ steht direkt neben dem Knopf, nicht erst im aufgeklappten Formular
  const knopf = page.getByTestId('zusammenlegen');
  await expect(knopf).toBeVisible();
  const hilfe = page.getByTestId('zusammenlegen-hilfe').getByRole('button', { name: 'Hilfe' });
  await expect(hilfe).toBeVisible();
  await hilfe.click();
  const blase = page.getByTestId('zusammenlegen-hilfe').getByRole('tooltip');
  await expect(blase).toBeVisible();
  await expect(blase).toContainText('aus zwei Konkurrenzen eine einzige');
  // Blase ragt nicht über den Bildschirmrand (ⓘ steht am Handy ganz rechts)
  const breite = page.viewportSize()!.width;
  await expect.poll(async () => { const r = (await blase.boundingBox())!; return r.x >= 0 && r.x + r.width <= breite; }).toBe(true);
  await bild(page, 'zusammenlegen-hilfe');
  await page.keyboard.press('Escape');
  await expect(blase).toBeHidden();

  // Zuklappen: bleibt zu, auch wenn sich der Turnierzustand ändert (neue Konkurrenz) und nach Reiterwechsel
  const a = page.getByTestId('konkurrenz').filter({ hasText: 'Herren A' });
  await expect(a).toHaveAttribute('open', '');
  await a.locator('summary').click();
  await expect(a).not.toHaveAttribute('open');
  await page.waitForTimeout(2500);
  await expect(a).not.toHaveAttribute('open');
  await konkurrenzAnlegen(page, 'Herren C');
  await expect(a).not.toHaveAttribute('open');
  await expect(page.getByTestId('konkurrenz').filter({ hasText: 'Herren B' })).toHaveAttribute('open', '');

  await nav(page).getByRole('link', { name: /^Teilnehmer/ }).click();
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  await expect(page.getByTestId('konkurrenz').filter({ hasText: 'Herren A' })).not.toHaveAttribute('open');

  // Wieder aufklappen geht
  await page.getByTestId('konkurrenz').filter({ hasText: 'Herren A' }).locator('summary').click();
  await expect(page.getByTestId('konkurrenz').filter({ hasText: 'Herren A' })).toHaveAttribute('open', '');
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('konkurrenz').filter({ hasText: 'Herren A' })).toHaveAttribute('open', '');
  await page.getByTestId('konkurrenz').filter({ hasText: 'Herren A' }).locator('summary').click();
  await bild(page, 'konkurrenz-zugeklappt');

  const ueber = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
  expect(ueber, 'waagerechter Scrollbalken').toBeLessThanOrEqual(1);
  const hoehe = await knopf.evaluate((e) => e.getBoundingClientRect().height);
  expect(hoehe).toBeGreaterThanOrEqual(44);
  expect(fehler).toEqual([]);
});
