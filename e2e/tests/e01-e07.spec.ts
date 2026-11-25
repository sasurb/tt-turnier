import { expect, test } from '@playwright/test';

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


test('F-006: Ergebniseingabe passt bei 320 bis 430 Pixeln in beide Ausrichtungen', async ({ page }) => {
  await page.goto('./#/schnell');
  await page.getByTestId('schnell-namen').fill('Anna Müller\nBen Schulz');
  await page.getByTestId('schnell-los').click();
  await page.getByTestId('spiel').first().click();
  await page.getByRole('button', { name: 'Beide Ballpunktzahlen eingeben' }).click();
  const dialog = page.getByRole('dialog');
  for (const breite of [320, 360, 390, 412, 430]) {
    for (const [width, height] of [[breite, 800], [800, breite]] as const) {
      await page.setViewportSize({ width, height });
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    }
  }
});
