import { expect, type Page } from '@playwright/test';

export async function reiterSichtbarMachen(page: Page, name: string | RegExp) {
  const navigation = page.getByRole('navigation', { name: 'Bereiche' });
  const link = navigation.getByRole('link', { name, exact: true });
  const mehr = navigation.getByRole('button', { name: 'Mehr', exact: true });
  await expect(navigation).toBeVisible();
  if (!(await link.isVisible()) && await mehr.isVisible() && await mehr.getAttribute('aria-expanded') === 'false') {
    await mehr.click();
  }
  return link;
}

export async function reiterOeffnen(page: Page, name: string | RegExp) {
  const link = await reiterSichtbarMachen(page, name);
  await link.click();
  // Nebenreiter schließen das Menü sofort. Erst nach der Hash-Navigation ist der neue Reiter sichtbar.
  await expect(link).toHaveAttribute('aria-current', 'page');
}

/**
 * Angaben im Turnier, Ort und Tische setzen (seit 0.13 erster Punkt unter „Konkurrenzen“) und danach
 * zurück zu „Spieler“.
 */
export async function angabenSetzen(page: Page, f: { tische?: string; angaben?: string[] }) {
  await reiterOeffnen(page, 'Konkurrenzen');
  const angaben = page.getByTestId('abschnitt-angaben');
  await angaben.locator('summary').click();
  for (const a of f.angaben ?? []) await angaben.getByLabel(a, { exact: true }).check();
  if (f.tische) await angaben.getByLabel('Anzahl Tische').fill(f.tische);
  await angaben.getByRole('button', { name: 'Speichern' }).click();
  await expect(angaben.getByText('Gespeichert.')).toBeVisible();
  await reiterOeffnen(page, /^Teilnehmer/);
}
