import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ADMIN } from './einrichten';

/**
 * Etappe 10: Hilfe-/Handbuchseite (Suche, Rollen, Link auf ein Kapitel) und Freigabe der Online-Anmeldung
 * durch den Admin – auf Handy, Tablet und PC.
 */

async function bild(page: Page, name: string) {
  const ordner = `bilder/${test.info().project.name}`;
  mkdirSync(ordner, { recursive: true });
  await page.screenshot({ path: `${ordner}/${name}.png`, fullPage: true });
}

async function layoutPruefen(page: Page, bereich?: Locator) {
  const breit = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
  expect(breit, 'waagerechter Scrollbalken').toBeLessThanOrEqual(1);
  if (!bereich) return;
  const zuKlein = await bereich.locator('button:visible:not(.knopf-hilfe), select:visible, a.knopf:visible, input:visible:not([type=checkbox]):not([type=radio]), summary:visible').evaluateAll((els) =>
    els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().height)}px`),
  );
  expect(zuKlein, 'Touch-Ziele unter 44 px').toEqual([]);
}

test('Hilfe: Suche, Rollen, Kapitel-Link', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('start-hilfe').click();
  await expect(page.getByRole('heading', { name: 'Hilfe und Anleitung' })).toBeVisible();
  await layoutPruefen(page, page.locator('main'));
  await bild(page, 'e10-hilfe');

  // Suche: nur das passende Kapitel, aufgeklappt
  await page.getByTestId('handbuch-suche').fill('Freilos gesetzte');
  const kapitel = page.locator('details.kapitel');
  await expect(kapitel).toHaveCount(1);
  await expect(kapitel.first()).toHaveAttribute('open', '');
  await expect(kapitel.first()).toContainText('Setzpositionen');
  await page.getByTestId('handbuch-suche').fill('gibtesnichtxyz');
  await expect(page.getByText('Dazu gibt es noch keine Anleitung')).toBeVisible();
  await page.getByTestId('handbuch-suche').fill('');

  // Rolle Zuschauer: kein Kapitel zur Kasse
  await page.getByRole('button', { name: 'Zuschauer', exact: true }).click();
  await expect(page.locator('#kapitel-kasse')).toHaveCount(0);
  await expect(page.locator('#kapitel-sichtbarkeit')).toHaveCount(1);
  await page.getByRole('button', { name: 'Alle', exact: true }).click();

  // Link auf ein Kapitel: aufgeklappt
  await page.goto('./#/hilfe/kasse');
  await expect(page.locator('#kapitel-kasse')).toHaveAttribute('open', '');
  await expect(page.locator('#kapitel-kasse')).toContainText('Nicht Eingecheckte streichen');
  await layoutPruefen(page, page.locator('main'));
  await bild(page, 'e10-hilfe-kasse');

  // Fußzeile führt überall hin
  await page.goto('./#/impressum');
  await page.getByTestId('fuss-hilfe').click();
  await expect(page).toHaveURL(/#\/hilfe$/);
});

test('Admin schaltet die Online-Anmeldung für ein Konto frei', async ({ page }, info) => {
  await page.goto('./#/anmelden');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.passwort);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByTestId('neues-turnier')).toBeVisible();
  await page.goto('./#/verwaltung');
  await expect(page.getByRole('heading', { name: 'Verwaltung' })).toBeVisible();
  const neu = page.locator('details', { hasText: 'Konto für jemanden anlegen' });
  if (await neu.count()) await neu.locator('summary').click();
  const mail = `freigabe.${info.project.name}@example.org`;
  await page.getByLabel('Name (Verein oder Person)').fill(`TTC Freigabe ${info.project.name}`);
  await page.getByLabel('E-Mail', { exact: true }).fill(mail);
  await page.locator('#kp').fill('freigabe123');
  await page.getByRole('button', { name: 'Konto anlegen' }).click();
  await expect(page.getByText('Konto angelegt.')).toBeVisible();
  const zeile = page.locator('li.reihe', { hasText: mail });
  const auswahl = zeile.getByTestId('admin-anmeldung');
  await expect(auswahl).toHaveValue('auto');
  await auswahl.selectOption('frei');
  await expect(page.getByText(/Online-Anmeldung für „TTC Freigabe/)).toBeVisible();
  await page.reload();
  await expect(page.locator('li.reihe', { hasText: mail }).getByTestId('admin-anmeldung')).toHaveValue('frei');
  await layoutPruefen(page, page.locator('main'));
  await bild(page, 'e10-verwaltung');
});
