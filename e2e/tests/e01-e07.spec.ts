import { expect, test } from '@playwright/test';
import { reiterOeffnen } from './hilfen';

test('V-005 und V-009: Teilnehmerstart ohne Einzelkonkurrenz und manuelle Verlängerung', async ({ page }) => {
  await page.goto('./#/schnell');
  await page.getByLabel(/Nur Teilnehmer anlegen/).check();
  await page.getByTestId('schnell-namen').fill('Anna\nBen');
  await page.getByTestId('schnell-los').click();
  await expect(page).toHaveURL(/konkurrenzen$/);
  await expect(page.getByTestId('konkurrenz')).toHaveCount(0);
  await page.goto('./#/schnell');
  await page.getByTestId('schnell-namen').fill('Anna\nBen');
  await page.locator('#sb').selectOption('1');
  await page.getByTestId('schnell-los').click();
  await page.getByTestId('spiel').first().click();
  await page.getByRole('button', { name: 'Beide Ballpunktzahlen eingeben' }).click();
  const felder = page.getByTestId('satz-1').getByRole('textbox');
  await felder.nth(0).fill('102');
  await felder.nth(1).fill('100');
  await page.getByRole('button', { name: /speichern/i }).last().click();
  await page.getByRole('radio', { name: /gespielt|fertig/i }).first().click();
  await page.getByTestId('spiel').first().click();
  await expect(page.getByRole('dialog')).toContainText('1:0');
});


test('F-006: Ergebniseingabe, Spiele, Tische und Navigation im Hoch- und Querformat', async ({ page }) => {
  await page.goto('./#/schnell');
  await page.getByTestId('schnell-namen').fill('Anna Müller\nBen Schulz');
  await page.getByTestId('schnell-los').click();
  const navigation = page.getByRole('navigation', { name: 'Bereiche' });
  const dialog = page.getByRole('dialog');
  for (const breite of [320, 360, 390, 412, 430]) {
    for (const [width, height] of [[breite, 800], [800, breite]] as const) {
      await page.setViewportSize({ width, height });
      await reiterOeffnen(page, 'Spiele');
      await expect(navigation).toBeVisible();
      const mehr = navigation.getByRole('button', { name: 'Mehr', exact: true });
      const ohneUeberlauf = async () => {
        expect(await page.evaluate(() => {
          const root = document.scrollingElement!;
          return root.scrollWidth - root.clientWidth;
        })).toBeLessThanOrEqual(1);
      };
      if (width <= 600) {
        await expect(mehr).toBeVisible();
        await mehr.click();
        await expect(navigation.getByRole('link', { name: 'Einstellungen' })).toBeVisible();
        await ohneUeberlauf();
        await mehr.click();
      } else {
        await expect(mehr).toBeHidden();
      }
      await ohneUeberlauf();
      await page.getByTestId('spiel').first().click();
      await page.getByRole('button', { name: 'Beide Ballpunktzahlen eingeben' }).click();
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
      await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
      await reiterOeffnen(page, 'Tische');
      await expect(page.getByTestId('tische')).toBeVisible();
      await ohneUeberlauf();
    }
  }
});
