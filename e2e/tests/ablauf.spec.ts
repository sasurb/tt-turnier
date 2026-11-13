import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { letzteMail } from './mails';

/**
 * Kompletter Ablauf, wie ihn eine fremde Person ohne Anleitung erlebt –
 * auf Handy, Tablet und PC (Projekte in playwright.config.ts).
 */

async function bild(page: Page, name: string) {
  const ordner = `bilder/${test.info().project.name}`;
  mkdirSync(ordner, { recursive: true });
  await page.screenshot({ path: `${ordner}/${name}.png`, fullPage: true });
}

test('Konto anlegen, Online-Turnier, Mitleiten, Sicherung, Passwort vergessen, Konto löschen', async ({ page, browser }, info) => {
  const geraet = info.project.name;
  const email = `veranstalter-${geraet}-${Date.now()}@example.org`;
  const passwort = 'sicher-genug-1';

  // Startseite als Gast: „Neues Turnier“ sofort sichtbar, Konto-Angebot darunter
  await page.goto('./');
  await expect(page.getByTestId('neues-turnier')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Anmelden' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mit mehreren Geräten eintragen?' })).toBeVisible();
  await bild(page, '01-start-gast');

  // Konto anlegen
  await page.getByRole('link', { name: 'Konto anlegen' }).first().click();
  await expect(page.getByRole('heading', { name: 'Konto anlegen' })).toBeVisible();
  await page.getByLabel('Name (Verein oder Person)').fill(`TTC ${geraet}`);
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort (mindestens 8 Zeichen)').fill(passwort);
  await bild(page, '02-registrieren');
  await page.getByRole('button', { name: 'Konto anlegen' }).click();

  // Danach: Willkommen, großer Knopf, Name in der Kopfzeile
  await expect(page.getByText('Willkommen! Dein Konto ist angelegt.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Konto-Menü' })).toContainText(`TTC ${geraet}`);
  await expect(page.getByTestId('neues-turnier')).toBeVisible();
  await bild(page, '03-start-angemeldet');
  expect(letzteMail(email, /Willkommen/)).toBeTruthy();
  expect(letzteMail('betreiber@example.org', new RegExp(`Neues Konto: TTC ${geraet}`))).toBeTruthy();

  // Neues Turnier: online vorausgewählt, Code vorgeschlagen
  await page.getByTestId('neues-turnier').click();
  await expect(page.getByLabel(/Mehrere Geräte/)).toBeChecked();
  const code = await page.getByLabel(/^Leitungscode/).inputValue();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel('Name des Turniers').fill(`Herbstpokal ${geraet}`);
  await bild(page, '04-neues-turnier');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();

  // Turnierseite: Teilen mit Leitungscode
  await expect(page.getByRole('heading', { name: `Herbstpokal ${geraet}` })).toBeVisible();
  await expect(page.getByTestId('leitungscode')).toHaveText(`${code.slice(0, 3)} ${code.slice(3)}`);
  await expect(page.getByText('Verbunden')).toBeVisible();
  const link = await page.getByLabel('Link').inputValue();
  await bild(page, '05-turnier-leitung');

  // Hilfe am Leitungscode: antippen (Handy/Tablet) bzw. darüberfahren (PC)
  const hilfe = page.getByRole('button', { name: 'Hilfe' }).first();
  if (info.project.use.hasTouch) await hilfe.tap();
  else await hilfe.hover();
  await expect(page.getByRole('tooltip').first()).toBeVisible();
  await bild(page, '06-hilfe');
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);

  // Einstellungen: Erklärung, Sicherung jetzt senden
  await page.getByText('Einstellungen', { exact: true }).click();
  await expect(page.getByText(/Solange das Turnier auf mindestens einem Gerät geöffnet ist/)).toBeVisible();
  await expect(page.getByLabel('Empfänger (bis zu 3) 1')).toHaveValue(email);
  await page.getByLabel('Wie oft?').selectOption({ label: 'Alle 15 Minuten' });
  await page.getByLabel('Empfänger (bis zu 3) 2').fill(`helfer-${geraet}@example.org`);
  await page.getByRole('button', { name: 'Speichern' }).first().click();
  await expect(page.getByText('Gespeichert.')).toBeVisible();
  await page.getByRole('button', { name: 'Jetzt per Mail sichern' }).click();
  await expect(page.getByText(/Sicherung gesendet an/)).toBeVisible();
  const sm = letzteMail(`helfer-${geraet}@example.org`, /Sicherung: Herbstpokal/);
  expect(sm?.anhang).toBe(true);
  expect(sm?.text).toContain('Warum diese Mail?');
  await bild(page, '07-einstellungen');

  // Zweites Gerät: Link öffnen, mit Code mitleiten, eintragen
  const u = info.project.use;
  const zweites = await browser.newContext({ viewport: u.viewport, isMobile: u.isMobile, hasTouch: u.hasTouch, deviceScaleFactor: u.deviceScaleFactor, userAgent: u.userAgent, locale: 'de-DE' });
  const p2 = await zweites.newPage();
  await p2.goto(link);
  await expect(p2.getByText('Du schaust zu')).toBeVisible();
  await bild(p2, '08-zweites-geraet-zuschauer');
  await p2.getByLabel('Leitungscode (6 Ziffern)').fill(code);
  await p2.getByLabel('Dein Name (erscheint im Protokoll)').fill('Helferin Jana');
  await p2.getByRole('button', { name: 'Mitleiten' }).click();
  await expect(p2.getByPlaceholder('Testeintrag')).toBeVisible();
  await p2.getByPlaceholder('Testeintrag').fill('Tisch 3 frei');
  await p2.getByRole('button', { name: 'Eintragen' }).click();
  await expect(page.getByText('Tisch 3 frei')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/von Helferin Jana/)).toBeVisible();
  await zweites.close();

  // Abmelden über das Kopfzeilen-Menü
  await page.getByRole('button', { name: 'Konto-Menü' }).click();
  await bild(page, '09-menue');
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page.getByRole('link', { name: 'Anmelden' }).first()).toBeVisible();

  // Passwort vergessen → Link aus der Mail → neues Passwort → angemeldet
  await page.getByRole('link', { name: 'Anmelden' }).first().click();
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  await page.getByRole('link', { name: 'Passwort vergessen?' }).click();
  await expect(page.getByRole('heading', { name: 'Passwort vergessen' })).toBeVisible();
  await page.getByLabel('E-Mail').fill(email);
  await page.getByRole('button', { name: 'Link senden' }).click();
  await expect(page.getByText(/ist jetzt eine Mail mit einem Link unterwegs/)).toBeVisible();
  const rm = letzteMail(email, /Passwort zurücksetzen/);
  const resetLink = /http\S+#\/zuruecksetzen\/[a-f0-9]{64}/.exec(rm?.text ?? '')?.[0];
  expect(resetLink).toBeTruthy();
  await page.goto(resetLink!);
  await page.getByLabel('Neues Passwort (mindestens 8 Zeichen)').fill('noch-sicherer-2');
  await page.getByRole('button', { name: 'Passwort speichern' }).click();
  await expect(page.getByText('Passwort geändert. Du bist angemeldet.')).toBeVisible();
  await expect(page.getByRole('button', { name: `Herbstpokal ${geraet}` })).toBeVisible();
  await bild(page, '10-meine-turniere');

  // Rückmeldung an den Betreiber
  await page.getByRole('button', { name: 'Konto-Menü' }).click();
  await page.getByRole('menuitem', { name: 'Mein Konto' }).click();
  await bild(page, '11-konto');
  await page.getByRole('link', { name: 'Fehler melden oder Wunsch äußern' }).click();
  await expect(page.getByRole('heading', { name: 'Kontakt' })).toBeVisible();
  await page.getByLabel('Nachricht').fill(`Testnachricht vom ${geraet}`);
  await page.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(page.getByText('Danke! Die Nachricht ist angekommen.')).toBeVisible();
  expect(letzteMail('betreiber@example.org', /Fehlermeldung/)?.text).toContain(`Testnachricht vom ${geraet}`);

  // Konto löschen
  await page.goto('./#/konto');
  await page.getByText('Konto löschen', { exact: true }).click();
  await page.getByLabel('Zur Bestätigung dein Passwort').fill('noch-sicherer-2');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
  await expect(page.getByText('Dein Konto wurde gelöscht.')).toBeVisible();
});

test('Turnier nur auf diesem Gerät: Sicherung herunterladen und wiederherstellen', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('neues-turnier').click();
  // ohne Anmeldung ist „online“ gesperrt, „nur dieses Gerät“ gewählt
  await expect(page.getByLabel(/Mehrere Geräte/)).toBeDisabled();
  await expect(page.getByLabel(/Nur dieses Gerät/)).toBeChecked();
  await expect(page.getByText('Dafür bitte anmelden oder ein kostenloses Konto anlegen.')).toBeVisible();
  await bild(page, '12-neu-ohne-konto');
  await page.getByLabel('Name des Turniers').fill('Hallenturnier offline');
  await page.getByLabel(/^Dein Name/).fill('Sascha');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Hallenturnier offline' })).toBeVisible();
  await page.getByPlaceholder('Testeintrag').fill('Runde 1 fertig');
  await page.getByRole('button', { name: 'Eintragen' }).click();

  await page.getByText('Einstellungen', { exact: true }).click();
  await expect(page.getByText(/Dieses Turnier liegt nur auf diesem Gerät/)).toBeVisible();
  await bild(page, '13-lokal-einstellungen');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Sicherung herunterladen' }).click()]);
  const datei = `bilder/${test.info().project.name}/sicherung.json`;
  await download.saveAs(datei);
  expect(download.suggestedFilename()).toMatch(/^sicherung-hallenturnier-offline-\d{8}-\d{4}\.json$/);

  // Wiederherstellen als neues Turnier
  await page.goto('./#/wiederherstellen');
  await page.getByLabel('Sicherungsdatei').setInputFiles(datei);
  await expect(page.getByText('Hallenturnier offline')).toBeVisible();
  await bild(page, '14-wiederherstellen');
  await page.getByRole('button', { name: 'Wiederherstellen' }).click();
  await expect(page.getByText(/Turnier wiederhergestellt: 2 Einträge übernommen/)).toBeVisible();
  await expect(page.getByText('Runde 1 fertig')).toBeVisible();
  await expect(page.getByText(/Aus Sicherung wiederhergestellt/)).toBeVisible();
});

test('Impressum, Datenschutz und Kontakt ohne Anmeldung', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: 'Impressum' }).click();
  await expect(page.getByText('Erika Muster')).toBeVisible();
  await expect(page.getByText('12345 Musterstadt')).toBeVisible();
  await bild(page, '15-impressum');
  await page.getByRole('link', { name: 'Datenschutzhinweis' }).click();
  await expect(page.getByRole('heading', { name: 'Wie lange?' })).toBeVisible();
  await bild(page, '16-datenschutz');
  // Kontaktformular nur einmal: der Server lässt je Anschluss 5 Nachrichten pro Stunde zu,
  // und alle Testgeräte kommen von 127.0.0.1
  if (test.info().project.name !== 'handy') return;
  await page.getByRole('link', { name: 'Kontakt' }).last().click();
  await expect(page.getByRole('heading', { name: 'Kontakt' })).toBeVisible();
  await page.getByLabel('Nachricht').fill('Frage ohne Konto');
  await page.getByLabel('Dein Name').fill('Gast');
  await page.getByLabel('Deine E-Mail (für die Antwort)').fill('gast@example.org');
  await page.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(page.getByText('Danke! Die Nachricht ist angekommen.')).toBeVisible();
});

test('Administrator: Verwaltung über das Menü', async ({ page }) => {
  await page.goto('./#/anmelden');
  await page.getByLabel('E-Mail').fill('admin@example.org');
  await page.getByLabel('Passwort', { exact: true }).fill('admin-passwort-1');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByTestId('neues-turnier')).toBeVisible();
  await page.getByRole('button', { name: 'Konto-Menü' }).click();
  await page.getByRole('menuitem', { name: 'Verwaltung' }).click();
  await expect(page.getByRole('heading', { name: /Konten/ })).toBeVisible();
  await bild(page, '17-verwaltung');
});
