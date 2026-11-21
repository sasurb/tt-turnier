import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ADMIN } from './einrichten';

/**
 * Etappe 11, Teil A: Kasse & Check-in ohne Netz (Nachtragen beim Online-Gehen), Spieler-Rubrik mit
 * aufklappbaren Abschnitten, „Angaben im Turnier“ unter Konkurrenzen, Spielerformular (leeren, Vereins-
 * vorschläge, gleicher Verein), Spenden-Seite – auf Handy, Tablet und PC.
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

async function anmelden(page: Page) {
  await page.goto('./#/anmelden');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.passwort);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByTestId('neues-turnier')).toBeVisible();
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Bereiche' });

test('Kasse & Check-in offline, Spieler-Rubrik, Angaben unter Konkurrenzen, Spielerformular, Spenden', async ({ page, browser }, info) => {
  const geraet = info.project.name;
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  await anmelden(page);
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill(`Herbstcup ${geraet}`);
  await page.getByLabel('Datum').fill('2027-10-02');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await expect(page.getByText('Verbunden')).toBeVisible();
  const tid = page.url().match(/#\/t\/(\d{8})/)![1]!;

  // Spieler-Rubrik: Spieler im Turnier und Online-Anmeldungen als aufklappbare Abschnitte, keine Angaben mehr dort
  await expect(nav(page).getByRole('link', { name: 'Anmeldungen' })).toHaveCount(0);
  await expect(page.getByTestId('abschnitt-spieler')).toBeVisible();
  await expect(page.getByTestId('abschnitt-anmeldungen')).toBeVisible();
  await expect(page.getByTestId('abschnitt-angaben')).toHaveCount(0);

  // Angaben im Turnier: erster Punkt unter Konkurrenzen
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  const erste = page.locator('main .karte').first();
  await expect(erste).toHaveAttribute('data-testid', 'abschnitt-angaben');
  await page.getByLabel('Name', { exact: true }).fill('Herren');
  await page.getByLabel(/Jeder gegen jeden/).check();
  await page.getByTestId('startgeld').fill('5');
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  await layoutPruefen(page, page.locator('main'));
  await bild(page, 'e11-konkurrenzen-angaben');

  // Spielerformular: nach dem Anlegen leer, mit Häkchen bleibt der Verein stehen, Vereine als Vorschlag
  await nav(page).getByRole('link', { name: /^Spieler/ }).click();
  await page.getByRole('button', { name: '+ Neuer Spieler' }).click();
  await page.getByLabel('Gleich melden für').selectOption({ label: 'Herren' });
  await page.getByLabel(/Weitere Spieler vom gleichen Verein/).check();
  const vorname = page.getByLabel('Vorname');
  const verein = page.getByLabel('Verein', { exact: true });
  for (const [v, n] of [
    ['Anna', 'Alpha'],
    ['Ben', 'Beta'],
  ]) {
    await vorname.fill(v!);
    await page.getByLabel('Nachname').fill(n!);
    if (v === 'Anna') await verein.fill('TTC Nord');
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} ${n} ✓`)).toBeVisible();
    await expect(vorname).toHaveValue('');
    await expect(page.getByLabel('Nachname')).toHaveValue('');
    await expect(verein).toHaveValue('TTC Nord');
  }
  await expect(vorname).toBeFocused();
  await page.getByLabel(/Weitere Spieler vom gleichen Verein/).uncheck();
  await vorname.fill('Cem');
  await page.getByLabel('Nachname').fill('Gamma');
  await verein.fill('TSV Süd');
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByText('Cem Gamma ✓')).toBeVisible();
  await expect(verein).toHaveValue('');
  const liste = await verein.getAttribute('list');
  const vorschlaege = await page.locator(`datalist#${liste} option`).evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  expect(vorschlaege).toEqual(expect.arrayContaining(['TTC Nord', 'TSV Süd']));
  await expect(page.getByRole('heading', { name: /Spieler im Turnier \(3\)/ })).toBeVisible();
  await layoutPruefen(page, page.locator('main'));
  await bild(page, 'e11-spieler-rubrik');

  // Kasse & Check-in: App einmal online laden (Service Worker speichert sie), dann ohne Netz kassieren
  await nav(page).getByRole('link', { name: 'Kasse & Check-in' }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((ok) => navigator.serviceWorker.addEventListener('controllerchange', ok, { once: true }));
  });
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline')).toBeVisible();
  const zeile = page.getByTestId('kasse-liste').locator('li', { hasText: 'Anna Alpha' });
  await expect(zeile).toContainText('Offen: 5,00 €');
  await zeile.getByTestId('checkin').click();
  await zeile.getByTestId('kassieren').click();
  await zeile.getByTestId('kasse-buchen').click();
  await expect(zeile).toContainText('✓ Bezahlt 5,00 €');
  await expect(page.getByText('2 Einträge warten')).toBeVisible();
  await layoutPruefen(page, page.locator('main'));
  await bild(page, 'e11-kasse-offline');

  // Wieder Netz: automatisch nachgetragen
  await page.context().setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.getByText(/Einträge? wartet?/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('offline')).toHaveCount(0);

  // Zweites Gerät der Leitung sieht die Buchung vom Server
  const ctx2 = await browser.newContext({ baseURL: page.url().split('#')[0] });
  const p2 = await ctx2.newPage();
  await anmelden(p2);
  await p2.goto(`./#/t/${tid}/kasse`);
  await expect(p2.getByTestId('kasse-liste').locator('li', { hasText: 'Anna Alpha' })).toContainText('✓ Bezahlt 5,00 €');
  await expect(p2.getByTestId('kasse-liste').locator('li', { hasText: 'Anna Alpha' }).getByTestId('checkin')).toHaveText('✓ Da');
  await ctx2.close();

  // Alte Adresse …/anmeldung landet bei „Spieler“
  await page.goto(`./#/t/${tid}/anmeldung`);
  await expect(page.getByTestId('abschnitt-anmeldungen')).toBeVisible();

  // Spenden: freundlicher Hinweis, Links öffnen den Anbieter in einem neuen Tab
  await page.getByTestId('fuss-spenden').click();
  await expect(page.getByRole('heading', { name: 'Unterstützen' })).toBeVisible();
  await expect(page.getByText(/kostenfrei zur Verfügung/)).toBeVisible();
  await expect(page.getByText(/Spendenbescheinigung/)).toBeVisible();
  const wege = page.getByTestId('spendenwege').getByRole('link');
  await expect(wege).toHaveCount(2);
  await expect(wege.first()).toHaveAttribute('href', 'https://www.paypal.com/paypalme/beispiel');
  await expect(wege.first()).toHaveAttribute('target', '_blank');
  await expect(wege.first()).toHaveAttribute('rel', /noopener/);
  await layoutPruefen(page, page.locator('main'));
  await bild(page, 'e11-spenden');
  expect(fehler).toEqual([]);
});
