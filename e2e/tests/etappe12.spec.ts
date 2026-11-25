import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ADMIN } from './einrichten';

/**
 * Etappe 12: Reiter „Teilnehmer“ (statt „Spieler“) mit einem Abschnitt je Konkurrenz,
 * „Gleich melden für“ nur für Einzel, neuer Reiter „Spielerpool“ vor den Einstellungen –
 * auf Handy, Tablet und PC.
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
    els.filter((e) => { const h = e.getBoundingClientRect().height; return h > 0 && h < 44; }).map((e) => `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().height)}px`),
  );
  expect(zuKlein, 'Touch-Ziele unter 44 px').toEqual([]);
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Bereiche' });

async function konkurrenzAnlegen(page: Page, name: string, art?: 'Doppel') {
  const neu = page.getByRole('button', { name: /Neue Konkurrenz/ });
  if (await neu.isVisible()) await neu.click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  if (art) {
    await page.getByRole('radio', { name: art, exact: true }).check();
    await page.getByRole('radio', { name: /^K\.-o\.-System/ }).check();
  } else {
    await page.getByLabel(/Jeder gegen jeden/).check();
  }
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  await expect(page.getByTestId('konkurrenz').filter({ hasText: name })).toBeVisible();
}

test('Teilnehmer je Konkurrenz und Reiter Spielerpool', async ({ page }, info) => {
  const geraet = info.project.name;
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  await page.goto('./#/anmelden');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.passwort);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill(`Wintercup ${geraet}`);
  await page.getByLabel('Datum').fill('2027-12-04');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await expect(page.getByText('Verbunden')).toBeVisible();
  const tid = page.url().match(/#\/t\/([A-Z0-9-]+)/)![1]!;

  // Reiter: „Teilnehmer“ statt „Spieler“, „Spielerpool“ direkt vor „Einstellungen“
  const reiter = await nav(page).getByRole('link').allInnerTexts();
  expect(reiter.map((r) => r.trim())).not.toContain('Spieler');
  expect(reiter.some((r) => r.startsWith('Teilnehmer'))).toBe(true);
  expect(reiter.slice(-2).map((r) => r.trim())).toEqual(['Spielerpool', 'Einstellungen']);
  await expect(page.getByRole('heading', { name: /Alle Teilnehmer \(0\)/ })).toBeVisible();
  await expect(page.getByText('Noch keine Konkurrenz angelegt.')).toBeVisible();

  // Drei Konkurrenzen: zwei Einzel, ein Doppel
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  await konkurrenzAnlegen(page, 'Herren');
  await konkurrenzAnlegen(page, 'Damen');
  await konkurrenzAnlegen(page, 'Doppel', 'Doppel');

  // „Gleich melden für“ bietet nur die Einzel an; Häkchen bleiben für den nächsten Teilnehmer stehen
  await nav(page).getByRole('link', { name: /^Teilnehmer/ }).click();
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  const meldenFuer = page.getByRole('group', { name: /Gleich melden für/ });
  await expect(meldenFuer.getByRole('checkbox')).toHaveCount(2);
  await expect(meldenFuer.getByRole('checkbox', { name: 'Doppel' })).toHaveCount(0);
  await meldenFuer.getByRole('checkbox', { name: 'Herren' }).check();
  const verein = `TTC ${geraet}`;
  for (const [v, n] of [['Anton', 'Arm'], ['Bernd', 'Bach'], ['Carl', 'Cord']]) {
    await page.getByLabel('Vorname').fill(v!);
    await page.getByLabel('Nachname').fill(n!);
    await page.getByLabel('Verein', { exact: true }).fill(verein);
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} ${n} ✓`)).toBeVisible();
  }
  await meldenFuer.getByRole('checkbox', { name: 'Herren' }).uncheck();
  await meldenFuer.getByRole('checkbox', { name: 'Damen' }).check();
  for (const [v, n] of [['Doris', 'Dorn'], ['Eva', 'Ems']]) {
    await page.getByLabel('Vorname').fill(v!);
    await page.getByLabel('Nachname').fill(n!);
    await page.getByLabel('Verein', { exact: true }).fill(verein);
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} ${n} ✓`)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('heading', { name: /Alle Teilnehmer \(5\)/ })).toBeVisible();

  // Je Konkurrenz ein eigener Abschnitt mit den Gemeldeten
  const abschnitt = (name: string) => page.getByTestId('abschnitt-konkurrenz').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(page.getByTestId('abschnitt-konkurrenz')).toHaveCount(3);
  await expect(abschnitt('Herren').locator('summary')).toContainText('3 Teilnehmer');
  await expect(abschnitt('Damen').locator('summary')).toContainText('2 Teilnehmer');
  await expect(abschnitt('Doppel').locator('summary')).toContainText('0 Paare');

  // Herren: Carl abmelden, Doris dazu
  const herren = abschnitt('Herren');
  await herren.locator('summary').click();
  await herren.getByRole('checkbox', { name: /Carl Cord/ }).uncheck();
  await herren.getByRole('checkbox', { name: /Doris Dorn/ }).check();
  await expect(herren.locator('summary')).toContainText('3 Teilnehmer');
  await expect(herren.getByRole('checkbox', { name: /Carl Cord/ })).not.toBeChecked();

  // Doppel: Paar bilden
  const doppel = abschnitt('Doppel');
  await doppel.locator('summary').click();
  await doppel.getByLabel('Spieler 1').selectOption({ label: 'Anton Arm' });
  await doppel.getByLabel('Spieler 2').selectOption({ label: 'Bernd Bach' });
  await doppel.getByTestId('paar-melden').click();
  await expect(doppel.locator('summary')).toContainText('1 Paar');
  await expect(doppel.getByText('Anton Arm / Bernd Bach')).toBeVisible();
  // Gesamtliste zeigt, wer wo mitspielt
  const zeile = (name: string) => page.getByTestId('abschnitt-spieler').locator('li', { hasText: name });
  await expect(zeile('Anton Arm').getByTestId('teilnahmen')).toHaveText('Spielt in: Herren, Doppel');
  await expect(zeile('Eva Ems').getByTestId('teilnahmen')).toHaveText('Spielt in: Damen');
  await expect(zeile('Carl Cord').getByTestId('teilnahmen')).toHaveText('In noch keiner Konkurrenz gemeldet');
  await layoutPruefen(page, page.locator('main'));
  await bild(page, '80-teilnehmer-je-konkurrenz');

  // Unter „Konkurrenzen“ steht derselbe Stand
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  const herrenKarte = page.getByTestId('konkurrenz').filter({ hasText: 'Herren' }).first();
  await expect(herrenKarte.getByRole('heading', { name: 'Meldungen (3)' })).toBeVisible();
  await herrenKarte.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await herrenKarte.getByTestId('starten').click();
  await expect(herrenKarte.getByText('Gruppenphase')).toBeVisible();

  // Laufende Konkurrenz: Liste der Teilnehmer, Nachmelden im Abschnitt
  await nav(page).getByRole('link', { name: /^Teilnehmer/ }).click();
  const kid = await herren.getAttribute('data-konkurrenz');
  await page.goto(`./#/t/${tid}/teilnehmer/${kid}`);
  await expect(herren).toHaveAttribute('open', '');
  await expect(herren.getByTestId('teilnehmerliste').locator('li')).toHaveCount(3);
  await herren.getByLabel('Wer?').selectOption({ label: 'Carl Cord' });
  await herren.getByTestId('nachmelden-knopf').click();
  await expect(herren.getByText('Carl Cord ist nachgemeldet.')).toBeVisible();
  await expect(herren.getByTestId('teilnehmerliste').locator('li')).toHaveCount(4);
  await layoutPruefen(page, herren);
  await bild(page, '81-teilnehmer-laufend');

  // Alte Adresse …/spieler landet bei „Teilnehmer“
  await page.goto(`./#/t/${tid}/spieler`);
  await expect(page.getByTestId('abschnitt-spieler')).toBeVisible();
  await expect(nav(page).getByRole('link', { name: /^Teilnehmer/ })).toHaveAttribute('aria-current', 'page');

  // Reiter „Spielerpool“: Pool des Kontos bearbeiten, Turnier-Teilnehmer sind markiert
  await nav(page).getByRole('link', { name: 'Spielerpool' }).click();
  await expect(page.getByRole('heading', { name: 'Spielerpool', exact: true })).toBeVisible();
  await expect(page.getByText(/Änderungen hier gelten nur für den Pool/)).toBeVisible();
  const liste = page.getByTestId('pool-liste');
  await liste.getByRole('searchbox').fill(verein);
  const anton = liste.locator('li', { hasText: 'Anton Arm' });
  await expect(anton.getByText('im Turnier')).toBeVisible();
  await page.getByRole('button', { name: '+ Spieler anlegen' }).click();
  await page.getByLabel('Vorname').fill('Paul');
  await page.getByLabel('Nachname').fill('Pool');
  await page.getByLabel('Verein', { exact: true }).fill(verein);
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByText('Gespeichert.')).toBeVisible();
  const paul = liste.locator('li', { hasText: 'Paul Pool' });
  await expect(paul).toBeVisible();
  await expect(paul.getByText('im Turnier')).toHaveCount(0);
  await layoutPruefen(page, page.locator('main'));
  await bild(page, '82-spielerpool-reiter');

  // Der neue Pool-Spieler lässt sich unter „Teilnehmer“ übernehmen
  await nav(page).getByRole('link', { name: /^Teilnehmer/ }).click();
  await page.getByRole('button', { name: 'Aus dem Spielerpool' }).click();
  await page.getByRole('searchbox', { name: 'Suchen' }).first().fill(verein);
  await page.getByRole('checkbox', { name: new RegExp(`Paul Pool ${verein}`) }).check();
  await page.getByRole('button', { name: /Ins Turnier übernehmen/ }).click();
  await expect(page.getByRole('heading', { name: /Alle Teilnehmer \(6\)/ })).toBeVisible();

  expect(fehler).toEqual([]);
});
