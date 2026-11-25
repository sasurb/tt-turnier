import { expect, test, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { letzteMail } from './mails';

/**
 * Paket 0.17: Verein/Sparte bei der Registrierung, Einladung einer Turnierleitung (Konto über den Link),
 * Recht „Turniere anlegen“, Ausschuss mit Nachrichten, Wunschkennung, Jugendturnier, Löschfrist,
 * Nutzungsbedingungen, „Über“ mit Urheberhinweis. Online gegen den PHP-Server auf Handy, Tablet und PC.
 */

async function bild(page: Page, name: string) {
  const ordner = `bilder/${test.info().project.name}`;
  mkdirSync(ordner, { recursive: true });
  await page.screenshot({ path: `${ordner}/${name}.png`, fullPage: true });
}

async function layoutPruefen(page: Page, bereich?: Locator) {
  const breit = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return el.scrollWidth - el.clientWidth;
  });
  expect(breit, 'waagerechter Scrollbalken').toBeLessThanOrEqual(1);
  if (!bereich) return;
  const zuKlein = await bereich.locator('button:visible:not(.knopf-hilfe), select:visible, a.knopf:visible, input:visible:not([type=checkbox]):not([type=radio])').evaluateAll((els) =>
    els.filter((e) => { const h = e.getBoundingClientRect().height; return h > 0 && h < 44; }).map((e) => `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().height)}px`),
  );
  expect(zuKlein, 'Touch-Ziele unter 44 px').toEqual([]);
}

async function neuerKontext(browser: Browser, info: TestInfo) {
  const u = info.project.use;
  const ctx = await browser.newContext({
    viewport: u.viewport,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    deviceScaleFactor: u.deviceScaleFactor,
    userAgent: u.userAgent,
    locale: 'de-DE',
    baseURL: u.baseURL,
  });
  return ctx.newPage();
}

async function registrieren(page: Page, name: string, email: string, verein: string | null) {
  await page.getByLabel('Dein Name').fill(name);
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort (mindestens 8 Zeichen)').fill('sicher-genug-17');
  if (verein !== null) await page.getByLabel('Verein', { exact: true }).fill(verein);
  await page.getByLabel('Ich bin mindestens 18 Jahre alt.').check();
  await page.getByRole('checkbox', { name: /Nutzungsbedingungen/ }).check();
  await page.getByRole('button', { name: 'Konto anlegen' }).click();
}

test('Sparte, Einladung einer Turnierleitung, Recht „Turniere anlegen“, Ausschuss', async ({ page, browser }, info) => {
  const geraet = info.project.name;
  const st = Date.now();
  const sara = `sara-${geraet}-${st}@example.org`;
  const tom = `tom-${geraet}-${st}@example.org`;

  await page.goto('./#/registrieren');
  await registrieren(page, 'Sara Sparte', sara, `SV Nord ${geraet}`);
  await expect(page.getByText('Willkommen! Dein Konto ist angelegt.')).toBeVisible();
  expect(letzteMail(sara, /Willkommen/)?.text).toContain('Sparte „Tischtennis“');

  // Sparte über das Konto-Menü
  await page.getByRole('button', { name: 'Konto-Menü' }).click();
  await page.getByTestId('menue-sparte').click();
  await expect(page.getByTestId('sparte-name')).toHaveText(`SV Nord ${geraet} – Tischtennis`);
  await expect(page.getByTestId('mitglied')).toHaveCount(1);
  await page.getByTestId('einladen').locator('summary').click();
  await page.getByLabel('Name', { exact: true }).fill('Tom Turnier');
  await page.getByLabel('E-Mail', { exact: true }).fill(tom);
  await page.getByRole('button', { name: 'Einladung senden' }).click();
  await expect(page.getByText('Einladung verschickt.')).toBeVisible();
  await expect(page.getByText('Offene Einladungen')).toBeVisible();
  await layoutPruefen(page, page.locator('main'));
  await bild(page, '17-01-sparte');

  // Tom öffnet den Link aus der Mail, legt ein Konto an und gehört zur Sparte
  const link = /#\/einladung\/[a-f0-9]{64}/.exec(letzteMail(tom, /Einladung/)?.text ?? '')?.[0];
  expect(link).toBeTruthy();
  const p2 = await neuerKontext(browser, info);
  await p2.goto(`./${link}`);
  await expect(p2.getByTestId('einladung')).toContainText('Sara Sparte lädt dich ein: Turnierleitung');
  await bild(p2, '17-02-einladung');
  await p2.getByRole('link', { name: 'Konto anlegen und annehmen' }).click();
  await expect(p2.getByLabel('Verein', { exact: true })).toHaveCount(0);
  await registrieren(p2, 'Tom Turnier', tom, null);
  await expect(p2.getByText('Einladung angenommen. Willkommen!')).toBeVisible();
  await expect(p2.getByTestId('neues-turnier')).toHaveCount(0); // ohne Recht „Turniere anlegen“
  await p2.getByRole('button', { name: 'Konto-Menü' }).click();
  await p2.getByTestId('menue-sparte').click();
  await expect(p2.getByText('Diese Seite ist für die Spartenleitung')).toBeVisible();

  // Spartenleitung gibt das Recht; Tom legt ein Turnier mit Wunschkennung als Jugendturnier an
  await page.reload();
  const tomZeile = page.getByTestId('mitglied').filter({ hasText: 'Tom Turnier' });
  await tomZeile.getByLabel('darf Turniere anlegen').check();
  await expect(tomZeile.getByLabel('darf Turniere anlegen')).toBeChecked();
  await p2.goto('./');
  await p2.reload(); // Kontodaten (Recht) neu laden
  await expect(p2.getByTestId('neues-turnier')).toBeVisible();
  await p2.getByTestId('neues-turnier').click();
  const kennung = `JC-${geraet.toUpperCase()}${String(st).slice(-4)}`.slice(0, 12);
  await p2.getByLabel('Name des Turniers').fill('Jugendcup');
  await p2.getByTestId('jugendturnier').check();
  await p2.getByTestId('kennung-wunsch').check();
  await p2.getByLabel('Gewünschte Kennung').fill(kennung.toLowerCase());
  await expect(p2.getByLabel('Gewünschte Kennung')).toHaveValue(kennung);
  await expect(p2.getByText(/besser die Zufallskennung/)).toBeVisible();
  await p2.getByLabel('Automatische Löschung').selectOption('24');
  await layoutPruefen(p2, p2.locator('main'));
  await bild(p2, '17-03-neues-turnier-wunschkennung');
  await p2.getByRole('button', { name: 'Turnier anlegen' }).click();
  await expect(p2).toHaveURL(new RegExp(`#/t/${kennung}`));

  // Einstellungen: Jugendturnier an, App-Wertung aus, Löschfrist 24 Monate, Textbaustein
  await p2.getByRole('navigation', { name: 'Bereiche' }).getByRole('link', { name: 'Einstellungen' }).click();
  await expect(p2.getByTestId('jugend-schalter')).toBeChecked();
  await expect(p2.getByTestId('appwertung-schalter')).not.toBeChecked();
  await expect(p2.getByTestId('namen-kurz')).toBeChecked();
  await expect(p2.getByTestId('loeschfrist-24')).toBeChecked();
  await expect(p2.getByTestId('loeschung-am')).toContainText('gelöscht');
  await p2.getByTestId('textbaustein').locator('summary').click();
  await expect(p2.getByTestId('textbaustein').getByRole('textbox')).toHaveValue(/^Datenschutz: Mit der Meldung.*Verantwortlich ist SV Nord/);
  await expect(p2.getByTestId('iban-hinweis')).toContainText('Vereinskonto');
  await layoutPruefen(p2, p2.getByTestId('abschnitt-jugend'));
  await bild(p2, '17-04-einstellungen-jugend');

  // Online-Anmeldung eines Jugendturniers: keine Einzelanmeldung
  const p3 = await neuerKontext(browser, info);
  await p3.goto(`./#/meldung/${kennung.toLowerCase()}`);
  await expect(p3.getByText(/Für dieses Turnier gibt es keine Online-Anmeldung|Jugendturnier/)).toBeVisible();

  // Spartenleitung sieht Toms Turnier; Ausschuss mit Nachricht
  await page.goto('./#/turniere');
  await expect(page.getByText('Jugendcup')).toBeVisible();
  await page.goto('./#/sparte');
  await page.getByLabel('Name des Ausschusses').fill('Sommerfest');
  await page.getByRole('button', { name: 'Ausschuss anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Sommerfest' })).toBeVisible();
  await page.getByLabel('Nachricht', { exact: true }).fill('Wer bringt den Grill mit?');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByTestId('nachricht')).toContainText('Wer bringt den Grill mit?');
  await layoutPruefen(page, page.locator('main'));
  await bild(page, '17-05-ausschuss');

  // Nutzungsbedingungen, Über (Urheberhinweis nach AGPL § 7 b)
  await page.goto('./#/bedingungen');
  await expect(page.getByRole('heading', { name: /Vereinbarung zur Auftragsverarbeitung/ })).toBeVisible();
  await page.getByTestId('fuss-ueber').click();
  await expect(page.getByTestId('urheber')).toHaveText('Entwickelt von Sascha Urban.');
  await expect(page.getByTestId('quellcode')).toHaveAttribute('href', 'https://github.com/Sasurb/tt-turnier');
  await layoutPruefen(page, page.locator('main'));
  await bild(page, '17-06-ueber');
});
