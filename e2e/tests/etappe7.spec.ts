import { expect, test, type Locator, type Page } from '@playwright/test';
import { angabenSetzen } from './hilfen';
import { mkdirSync, readFileSync } from 'node:fs';
import { ADMIN } from './einrichten';

/**
 * Etappe 7: Live-Anzeige (Beamer), Spielaufruf mit Automatik, Namen für Zuschauer,
 * Druckvorlagen, CSV-Export und Spiel-Link vom Spielzettel – auf Handy, Tablet und PC.
 */

async function bild(page: Page, name: string) {
  const ordner = `bilder/${test.info().project.name}`;
  mkdirSync(ordner, { recursive: true });
  await page.screenshot({ path: `${ordner}/${name}.png`, fullPage: true });
}

/** Keine waagerechten Scrollbalken; Bedienelemente mindestens 44 px hoch */
async function layoutPruefen(page: Page, bereich?: Locator) {
  const breit = await page.evaluate(() => {
    const el = document.scrollingElement!;
    const live = document.querySelector('[data-testid="live"]');
    return Math.max(el.scrollWidth - el.clientWidth, live ? live.scrollWidth - live.clientWidth : 0);
  });
  expect(breit, 'waagerechter Scrollbalken').toBeLessThanOrEqual(1);
  if (!bereich) return;
  const zuKlein = await bereich.locator('button:visible:not(.knopf-hilfe), select:visible, a.knopf:visible, input:visible:not([type=checkbox]):not([type=radio])').evaluateAll((els) =>
    els.filter((e) => { const h = e.getBoundingClientRect().height; return h > 0 && h < 44; }).map((e) => `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().height)}px`),
  );
  // ⓘ-Knöpfe: Tippfläche per ::after auf 44 px vergrößert
  expect(zuKlein, 'Touch-Ziele unter 44 px').toEqual([]);
}

async function ergebnisEintragen(page: Page) {
  const dlg = page.getByRole('dialog');
  for (const sz of [1, 2, 3]) {
    await dlg.getByTestId(`satz-${sz}`).getByRole('radio').first().click();
    await dlg.getByLabel(`Punkte des Verlierers Satz ${sz}`).fill('7');
  }
  await dlg.getByRole('button', { name: 'Ergebnis speichern' }).click();
  await expect(dlg).toBeHidden();
}

test('Online: automatischer Aufruf, Live-Anzeige für Zuschauer, Kurzform, Drucken, CSV, Spiel-Link', async ({ page, browser }, info) => {
  const geraet = info.project.name;
  // Anmelden mit dem vorhandenen Konto (die Registrierung ist auf 5 Konten je Stunde und Anschluss begrenzt)
  await page.goto('./#/anmelden');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.passwort);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill(`Livepokal ${geraet}`);
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await expect(page.getByText('Verbunden')).toBeVisible();
  const tid = page.url().match(/#\/t\/([A-Z0-9-]+)/)![1]!;

  await angabenSetzen(page, { tische: '2' });
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  for (const [v, n] of [
    ['Anna', 'Alpha'],
    ['Ben', 'Beta'],
    ['Cem', 'Gamma'],
    ['Dora', 'Delta'],
  ]) {
    await page.getByLabel('Vorname').fill(v!);
    await page.getByLabel('Nachname').fill(n!);
    await page.getByLabel('Verein', { exact: true }).fill('TTV Mitte');
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} ${n} ✓`)).toBeVisible();
  }
  await page.getByRole('link', { name: 'Konkurrenzen' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Offene Klasse');
  await page.getByLabel(/Jeder gegen jeden/).check();
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  await page.getByRole('button', { name: 'Alle melden' }).click();
  await page.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('starten').click();
  await expect(page.getByTestId('konkurrenz').getByText('Gruppenphase')).toBeVisible();

  // Tische: Automatik belegt beide Tische, Mindestpause einstellbar
  await page.getByRole('link', { name: 'Tische', exact: true }).click();
  const einst = page.getByTestId('aufruf-einstellungen');
  await einst.locator('summary').click();
  await einst.getByTestId('pause').selectOption('3');
  await einst.getByTestId('automatisch').check();
  const tische = page.getByTestId('tische').locator('li');
  await expect(tische.nth(0).getByRole('button', { name: /Spielinformationen Tisch 1: .+ gegen .+/ })).toBeVisible();
  await expect(tische.nth(1).getByRole('button', { name: /Spielinformationen Tisch 2: .+ gegen .+/ })).toBeVisible();
  await expect(page.getByTestId('tische').getByText('frei')).toHaveCount(0);
  await layoutPruefen(page, einst);
  await bild(page, '40-tische-automatisch');

  // Zuschauer am Beamer: Live-Anzeige ohne Anmeldung
  const zuschauer = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const beamer = await zuschauer.newPage();
  await beamer.goto(`./#/live/${tid}`);
  const live = beamer.getByTestId('live');
  await expect(live.getByRole('heading', { name: `Livepokal ${geraet}` })).toBeVisible();
  await expect(live.getByText('An den Tischen')).toBeVisible();
  await expect(live.locator('.tisch:not(.leer)')).toHaveCount(2);
  await expect(live).toContainText('Alpha');
  await beamer.waitForTimeout(4000); // ein Abgleich später: was beim Öffnen lief, blinkt nicht auf
  await expect(beamer.getByTestId('live-banner')).toHaveCount(0);
  await layoutPruefen(beamer);
  await bild(beamer, '41-live');
  // Menü der Anzeige
  await beamer.getByTestId('live-menue').click();
  await expect(beamer.getByRole('dialog', { name: 'Anzeige einstellen' })).toBeVisible();
  await layoutPruefen(beamer, beamer.getByRole('dialog', { name: 'Anzeige einstellen' }));
  await bild(beamer, '42-live-menue');
  await beamer.getByRole('dialog').getByRole('button', { name: 'Schließen' }).click();

  // Neuer Aufruf erscheint groß: Aufruf an Tisch 2 zurücknehmen → Automatik ruft neu auf
  await tische.nth(1).getByRole('button', { name: 'Aufruf zurücknehmen' }).click();
  await expect(beamer.getByTestId('live-banner')).toBeVisible({ timeout: 15_000 });
  await expect(beamer.getByTestId('live-banner')).toContainText('Tisch 2');
  await bild(beamer, '43-live-aufruf');

  // Namen für Zuschauer: Kurzform → der Beamer zeigt nur noch „Anna A.“
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await page.getByTestId('namen-kurz').check();
  await expect(page.getByText('Gespeichert.').first()).toBeVisible();
  await expect(live).not.toContainText('Alpha', { timeout: 20_000 });
  await expect(live).toContainText(/(Anna|Ben|Cem|Dora) [ABGD]\./);
  // Auch die Rohdaten, die der Zuschauer-Browser bekommt, enthalten keine Nachnamen
  const roh = await beamer.evaluate(async (t) => (await fetch(`api/index.php?r=events&turnier=${t}&ab=0`)).text(), tid);
  expect(roh).not.toContain('Alpha');
  expect(roh).toContain('"sicht":"kurz"');
  // Die Leitung sieht weiter die vollen Namen
  await page.getByRole('link', { name: 'Tische', exact: true }).click();
  await expect(page.getByTestId('tische')).toContainText(/Alpha|Beta|Gamma|Delta/);
  await zuschauer.close();

  // Drucken: Spielzettel der aufgerufenen Spiele mit QR-Link
  await page.getByRole('link', { name: 'Drucken' }).click();
  await expect(page.getByRole('heading', { name: 'Drucken und Export' })).toBeVisible();
  await layoutPruefen(page);
  await bild(page, '44-drucken-reiter');
  // CSV
  const [datei] = await Promise.all([page.waitForEvent('download'), page.getByTestId('csv-teilnehmer').click()]);
  const csv = readFileSync((await datei.path())!, 'utf8');
  expect(csv.startsWith('\uFEFFVorname;Nachname;Verein')).toBe(true);
  expect(csv).toContain('Anna;Alpha;TTV Mitte');
  await page.getByTestId('vorlage-spielzettel').click();
  const dok = page.getByTestId('druck-dokument');
  await expect(dok.locator('.zettel')).toHaveCount(2);
  await layoutPruefen(page, page.getByTestId('druck-werkzeug'));
  await bild(page, '45-spielzettel');
  const spielLink = await dok.locator('.zettel').first().getAttribute('data-spiel');
  expect(spielLink).toContain(`#/t/${tid}/spiel/`);
  for (const art of ['gruppen', 'ergebnisse', 'teilnehmer', 'aushang', 'urkunden']) {
    await page.getByTestId('druck-art').selectOption(art);
    await expect(dok).toHaveAttribute('data-art', art);
    await bild(page, `46-druck-${art}`);
  }
  await expect(dok.getByText(/Noch kein Endstand/)).toBeVisible();
  await page.getByTestId('druck-art').selectOption('aushang');
  await expect(dok.getByText(tid.replace(/^(.{4})(.{4})$/, '$1 $2'))).toBeVisible();

  // Spiel-Link vom Zettel öffnet das Ergebnis zum Eintragen
  await page.goto(spielLink!.replace(/^.*#/, './#'));
  await expect(page.getByRole('dialog')).toBeVisible();
  await ergebnisEintragen(page);
  await expect(page).toHaveURL(new RegExp(`#/t/${tid}/spiele`));
});

test('Einzelgerät: K.-o.-Baum, Urkunden und Endstand drucken, Live-Anzeige im zweiten Fenster', async ({ page }) => {
  await page.route(/api\/index\.php/, (r) => r.abort());
  await page.goto('./');
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill('Vereinspokal');
  await page.getByLabel(/^Dein Name/).fill('Sascha');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  for (const v of ['Ali', 'Bea', 'Cid', 'Dan']) {
    await page.getByLabel('Vorname').fill(v);
    await page.getByLabel('Nachname').fill(v + 'son');
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} ${v}son ✓`)).toBeVisible();
  }
  await page.getByRole('link', { name: 'Konkurrenzen' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Pokal');
  await page.getByRole('radio', { name: /^K\.-o\.-System/ }).check();
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  await page.getByRole('button', { name: 'Alle melden' }).click();
  await page.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('starten').click();
  const id = page.url().match(/#\/t\/(l[0-9a-f]+)/)![1]!;

  // Live-Anzeige im zweiten Fenster desselben Browsers (Laptop am Beamer)
  const beamer = await page.context().newPage();
  await beamer.goto(`./#/live/${id}`);
  await expect(beamer.getByTestId('live').getByRole('heading', { name: 'Vereinspokal' })).toBeVisible();

  // Alle drei Spiele über „Spiele“ eintragen
  await page.getByRole('link', { name: 'Spiele', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-testid="spiel"]:not(.fertig):not(:disabled)').first().click();
    await ergebnisEintragen(page);
  }
  // Beamer zeigt die letzten Ergebnisse
  await expect(beamer.getByTestId('live').getByText('Letzte Ergebnisse')).toBeVisible();
  await expect(beamer.getByTestId('live').locator('.erg')).toHaveCount(3, { timeout: 10_000 });
  await bild(beamer, '47-live-lokal');
  await beamer.close();

  await page.getByRole('link', { name: 'Drucken' }).click();
  await page.getByTestId('vorlage-baum').click();
  const dok = page.getByTestId('druck-dokument');
  await expect(dok.locator('.baum .box')).toHaveCount(3);
  await bild(page, '48-druck-baum');
  await page.getByTestId('druck-art').selectOption('urkunden');
  await expect(dok.locator('.urkunde')).toHaveCount(4); // 1., 2. und zweimal Platz 3–4
  await expect(dok.locator('.urkunde').first()).toContainText('1. Platz');
  await bild(page, '49-urkunden');
  await page.getByTestId('druck-art').selectOption('ergebnisse');
  await expect(dok.getByText('Endstand')).toBeVisible();
  await page.getByRole('link', { name: /Zurück/ }).click();
  const [datei] = await Promise.all([page.waitForEvent('download'), page.getByTestId('csv-endstand').click()]);
  const csv = readFileSync((await datei.path())!, 'utf8');
  expect(csv).toContain('Konkurrenz;Platz;Name;Verein');
  expect(csv.split('\r\n').filter((z) => z.startsWith('Pokal;'))).toHaveLength(4);
});
