import { expect, test, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ADMIN } from './einrichten';
import { letzteMail } from './mails';

/**
 * Paket 0.18: Posteingang je Kennung mit Glocke, Nachricht an Teilnehmer, Ergebnisse nach dem Abschluss,
 * Verteiler (Eintragen, Bestätigen, Abbestellen, Ankündigung der Sparte). Online gegen den PHP-Server.
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
    els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().height)}px`),
  );
  expect(zuKlein, 'Touch-Ziele unter 44 px').toEqual([]);
}

async function neuerKontext(browser: Browser, info: TestInfo) {
  const u = info.project.use;
  const ctx = await browser.newContext({ viewport: u.viewport, isMobile: u.isMobile, hasTouch: u.hasTouch, deviceScaleFactor: u.deviceScaleFactor, userAgent: u.userAgent, locale: 'de-DE', baseURL: u.baseURL });
  return ctx.newPage();
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Bereiche' });

async function alsAdmin(page: Page) {
  await page.goto('./#/anmelden');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.passwort);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}

async function spielerAnlegen(page: Page, namen: [string, string][]) {
  await nav(page).getByRole('link', { name: /^Teilnehmer/ }).click();
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  for (const [v, n] of namen) {
    await page.getByLabel('Vorname').fill(v);
    await page.getByLabel('Nachname').fill(n);
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} ${n} ✓`)).toBeVisible();
  }
}

test('Posteingang, Nachricht an Teilnehmer, Ergebnisse verschicken, Verteiler', async ({ page, browser }, info) => {
  const geraet = info.project.name;
  await alsAdmin(page);
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill(`Nachrichtencup ${geraet}`);
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await expect(page.getByText('Verbunden')).toBeVisible();
  const tid = page.url().match(/#\/t\/([A-Z0-9-]+)/)![1]!;
  await spielerAnlegen(page, [['Ida', 'Inbox'], ['Jan', 'Jaeger']]);

  // Konkurrenz „jeder gegen jeden“ mit beiden
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Offen');
  await page.getByLabel(/Jeder gegen jeden/).check();
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();

  // Kennungen entstehen unter „Zugänge“; Idas Kennung merken
  await nav(page).getByRole('link', { name: 'Zugänge' }).click();
  const sp = page.getByTestId('zugaenge-spieler');
  await sp.locator('summary').click();
  await expect(sp.getByTestId('code')).toHaveCount(2);
  const idaCode = (await sp.locator('li', { hasText: 'Ida Inbox' }).getByTestId('code').innerText()).replace(/\s/g, '');

  // Ida öffnet das Turnier mit ihrer Kennung: Glocke ohne Zahl
  const ida = await neuerKontext(browser, info);
  await ida.goto(`./#/c/${tid}/${idaCode}`);
  await expect(ida.getByTestId('angemeldet-als')).toContainText('Ida Inbox');
  await expect(ida.getByTestId('postfach-knopf')).toBeVisible();
  await expect(ida.getByTestId('postfach-zahl')).toHaveCount(0);

  // Leitung schickt eine Nachricht an alle Teilnehmer
  await nav(page).getByRole('link', { name: /^Teilnehmer/ }).click();
  const rm = page.getByTestId('abschnitt-rundmail');
  await rm.locator('summary').click();
  await rm.getByTestId('rm-alle').check();
  await expect(rm.getByTestId('rm-anzahl')).toHaveText('2 Personen gewählt');
  await rm.getByLabel('Betreff').fill('Beginn 10 Uhr');
  await rm.getByLabel('Nachricht').fill('Bitte <b>pünktlich</b> sein.\nTische 1–4.');
  await layoutPruefen(page, rm);
  await bild(page, '18-01-rundmail');
  page.once('dialog', (d) => void d.accept());
  await rm.getByTestId('rm-senden').click();
  await expect(rm.getByText(/Verschickt: 2 in den Posteingang/)).toBeVisible();
  // Leitung mit Konto: ✉ „Gesendet“
  await page.getByTestId('postfach-knopf').click();
  await expect(page.getByTestId('postfach')).toContainText('Gesendete Nachrichten');
  await expect(page.getByTestId('postfach')).toContainText('Posteingang: 2');
  await page.getByTestId('postfach').getByRole('button', { name: 'Schließen' }).last().click();

  // Ida: nach dem Neuladen zeigt die Glocke 1; Text bleibt Text (kein HTML)
  await ida.reload();
  await expect(ida.getByTestId('postfach-zahl')).toHaveText('1');
  await layoutPruefen(ida, ida.locator('.kopf'));
  await bild(ida, '18-02-glocke');
  await ida.getByTestId('postfach-knopf').click();
  const pf = ida.getByTestId('postfach');
  await expect(pf).toContainText('Beginn 10 Uhr');
  await expect(pf).toContainText('Bitte <b>pünktlich</b> sein.');
  await expect(pf.locator('b')).toHaveCount(0);
  await layoutPruefen(ida, pf);
  await bild(ida, '18-03-posteingang');
  await pf.getByRole('button', { name: 'Schließen' }).last().click();
  await expect(ida.getByTestId('postfach-zahl')).toHaveCount(0);

  // Ergebnisse eintragen (ein Spiel), abschließen, verschicken
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  const karte = page.getByTestId('konkurrenz');
  await karte.getByRole('button', { name: 'Alle melden' }).click();
  await karte.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await karte.getByTestId('starten').click();
  await nav(page).getByRole('link', { name: 'Spiele', exact: true }).click();
  await page.locator('[data-testid=spiel]:not(.fertig)').first().click();
  const dlg = page.getByRole('dialog');
  for (let sz = 1; sz <= 3; sz++) {
    await dlg.getByTestId(`satz-${sz}`).getByRole('radio').nth(0).click();
    await dlg.getByLabel(`Punkte des Verlierers Satz ${sz}`).fill('6');
  }
  await dlg.getByRole('button', { name: 'Ergebnis speichern' }).click();
  await expect(dlg).toBeHidden();
  await nav(page).getByRole('link', { name: 'Einstellungen' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Turnier abschließen' }).click();
  const ev = page.getByTestId('ergebnis-versand');
  await expect(ev).toBeVisible();
  await ev.getByText('Vorschau der Ergebnisliste').click();
  await expect(ev.locator('pre')).toContainText('Offen');
  await layoutPruefen(page, ev);
  await bild(page, '18-04-ergebnis-versand');
  page.once('dialog', (d) => void d.accept());
  await ev.getByTestId('ergebnis-senden').click();
  await expect(ev.getByText(/Verschickt: 2 in den Posteingang/)).toBeVisible();
  await ida.reload();
  await expect(ida.getByTestId('postfach-zahl')).toHaveText('1');
  await ida.getByTestId('postfach-knopf').click();
  await expect(ida.getByTestId('postfach')).toContainText(/Offen: \d\. Platz/);
  await ida.context().close();

  // Verteiler: Link aus den Einstellungen, eintragen, bestätigen, Spartenleitung sieht den Eintrag, abbestellen
  const link = await page.getByTestId('verteiler-link').getAttribute('href');
  expect(link).toBe(`#/verteiler/${tid}`);
  const v = await neuerKontext(browser, info);
  const adresse = `vt-${geraet}-${Date.now()}@example.org`;
  await v.goto(`./${link}`);
  await v.getByLabel('Name', { exact: true }).fill('Vera Verteiler');
  await v.getByLabel('E-Mail', { exact: true }).fill(adresse);
  await v.getByLabel('Ich bin mindestens 18 Jahre alt.').check();
  await v.getByRole('checkbox', { name: /Datenschutzhinweis/ }).check();
  await layoutPruefen(v, v.locator('main'));
  await bild(v, '18-05-verteiler');
  await v.getByTestId('verteiler-eintragen').click();
  await expect(v.getByTestId('verteiler-fertig')).toContainText('bestätige den Link');
  const bestaetigen = /#\/verteiler\/b\/[a-f0-9]{64}/.exec(letzteMail(adresse, /Bitte bestätigen/)?.text ?? '')?.[0];
  expect(bestaetigen).toBeTruthy();
  await v.goto(`./${bestaetigen}`);
  await expect(v.getByTestId('verteiler-fertig')).toContainText('Danke!');

  await page.goto('./#/sparte');
  const vt = page.getByTestId('sparte-verteiler');
  await vt.locator('summary').click();
  await expect(vt).toContainText('Vera Verteiler');
  await expect(vt).toContainText('1 Person bestätigt');
  await vt.getByLabel('Betreff').fill('Nikolausturnier');
  await vt.getByLabel('Text').fill('Am 6. Dezember in der Halle Nord.');
  await layoutPruefen(page, vt);
  await bild(page, '18-06-sparte-verteiler');
  await vt.getByRole('button', { name: 'Ankündigung senden' }).click();
  await expect(vt.getByText(/Ankündigung an \d+ Personen/)).toBeVisible();

  // Die Warteschlange läuft nach den Antworten des Servers; spätestens nach einigen Aufrufen ist die Mail da
  let ab: string | undefined;
  for (let i = 0; i < 20 && !ab; i++) {
    await page.evaluate(() => fetch('api/index.php?r=info'));
    ab = /#\/verteiler\/ab\/[a-z0-9-]+/.exec(letzteMail(adresse, /Nikolausturnier/)?.text ?? '')?.[0];
  }
  expect(ab).toBeTruthy();
  await v.goto(`./${ab}`);
  await v.getByTestId('verteiler-abmelden').click();
  await expect(v.getByTestId('verteiler-fertig')).toContainText('ausgetragen');
  await v.context().close();
});
