import { expect, type Page } from '@playwright/test';

/**
 * Angaben im Turnier, Ort und Tische setzen (seit 0.13 erster Punkt unter „Konkurrenzen“) und danach
 * zurück zu „Spieler“.
 */
export async function angabenSetzen(page: Page, f: { tische?: string; angaben?: string[] }) {
  await page.getByRole('navigation', { name: 'Bereiche' }).getByRole('link', { name: 'Konkurrenzen' }).click();
  const angaben = page.getByTestId('abschnitt-angaben');
  await angaben.locator('summary').click();
  for (const a of f.angaben ?? []) await angaben.getByLabel(a, { exact: true }).check();
  if (f.tische) await angaben.getByLabel('Anzahl Tische').fill(f.tische);
  await angaben.getByRole('button', { name: 'Speichern' }).click();
  await expect(angaben.getByText('Gespeichert.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Bereiche' }).getByRole('link', { name: /^Teilnehmer/ }).click();
}
