import { expect, test, type Locator, type Page } from '@playwright/test';
import { angabenSetzen } from './hilfen';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Etappe 8: Rückgängig, Nachmelden, Auslosung im laufenden Turnier, Zeitplan, Vorplanen und
 * Ziehen auf Tische, neue Spielsysteme in der Auswahl – und ein Lasttest mit 128 Spielern.
 * Alles im Einzelgerät-Betrieb (ohne Server), auf Handy, Tablet und PC.
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
    return el.scrollWidth - el.clientWidth;
  });
  expect(breit, 'waagerechter Scrollbalken').toBeLessThanOrEqual(1);
  if (!bereich) return;
  const zuKlein = await bereich.locator('button:visible:not(.knopf-hilfe), select:visible, a.knopf:visible, input:visible:not([type=checkbox]):not([type=radio])').evaluateAll((els) =>
    els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().height)}px`),
  );
  expect(zuKlein, 'Touch-Ziele unter 44 px').toEqual([]);
}

async function einzelgeraet(page: Page, name: string) {
  await page.route(/api\/index\.php/, (r) => r.abort());
  await page.goto('./');
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill(name);
  await page.getByLabel(/^Dein Name/).fill('Sascha');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
}

test('Rückgängig, Nachmelden, Zeitplan, Vorplanen und Ziehen auf Tische', async ({ page }, info) => {
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  await einzelgeraet(page, 'Planpokal');
  await angabenSetzen(page, { tische: '2' });
  await page.getByRole('button', { name: '+ Neuer Spieler' }).click();
  for (const [v, n] of [
    ['Anna', 'Alpha'],
    ['Ben', 'Beta'],
    ['Cem', 'Gamma'],
    ['Dora', 'Delta'],
    ['Emil', 'Epsilon'],
  ]) {
    await page.getByLabel('Vorname').fill(v!);
    await page.getByLabel('Nachname').fill(n!);
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} ${n} ✓`)).toBeVisible();
  }

  // Konkurrenz: neue Spielsysteme in der Auswahl, feste Satzzahl nur beim Schweizer/Cup-System
  await page.getByRole('link', { name: 'Konkurrenzen' }).click();
  await page.getByRole('radio', { name: /^Cup-System/ }).check();
  await expect(page.getByTestId('feste-saetze')).toBeVisible();
  await page.getByRole('radio', { name: /^Schweizer System/ }).check();
  await expect(page.getByText('Beschleunigt auslosen')).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Offene Klasse');
  await page.getByLabel(/Jeder gegen jeden/).check();
  await expect(page.getByTestId('feste-saetze')).toHaveCount(0);
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  const konk = page.getByTestId('konkurrenz');
  for (const n of ['Anna Alpha', 'Ben Beta', 'Cem Gamma', 'Dora Delta']) await konk.getByRole('checkbox', { name: n }).check();
  await page.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('starten').click();
  await expect(konk.getByText('Gruppenphase')).toBeVisible();

  // Rückgängig direkt nach dem Speichern
  const aktion = page.getByTestId('aktion');
  await expect(aktion).toContainText('Start der Konkurrenz');
  await layoutPruefen(page, aktion);
  await bild(page, '50-rueckgaengig-hinweis');
  await aktion.getByTestId('rueckgaengig').click();
  await expect(konk.getByText('Meldung', { exact: true })).toBeVisible();
  await expect(page.getByTestId('starten')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('starten').click();
  await expect(konk.getByText('Gruppenphase')).toBeVisible();

  // Nachmelden: Emil spielt in der Gruppe gegen alle
  const nach = page.getByTestId('nachmelden');
  await nach.getByLabel('Wer?').selectOption({ label: 'Emil Epsilon' });
  await nach.getByTestId('nachmelden-knopf').click();
  await expect(page.getByText('Emil Epsilon ist nachgemeldet.')).toBeVisible();
  await expect(page.getByText('Alle Spieler des Turniers sind schon gemeldet.')).toBeVisible();
  await layoutPruefen(page, konk);
  await bild(page, '51-nachmelden');
  await page.getByRole('link', { name: 'Spiele', exact: true }).click();
  await expect(page.getByTestId('spiel')).toHaveCount(10);
  // Geschätzte Beginnzeiten an den offenen Spielen
  await expect(page.getByTestId('geschaetzt').first()).toContainText(/ca\. \d\d:\d\d/);

  // Tische: Zeitplan mit Ende, Vorplanen, Ziehen auf einen freien Tisch
  await page.getByRole('link', { name: 'Tische', exact: true }).click();
  await expect(page.getByTestId('zeitplan-ende')).toContainText(/Voraussichtliches Ende: ca\. \d\d:\d\d Uhr/);
  const zeitplan = page.getByTestId('zeitplan');
  await zeitplan.getByText('Schätzung anpassen').click();
  await zeitplan.getByTestId('satz-minuten').selectOption('5');
  await expect(zeitplan).toContainText('5 Min. je Satz');
  await page.getByTestId('planen').first().click();
  const pf = page.getByTestId('planen-form');
  await pf.getByLabel('Tisch', { exact: true }).selectOption({ label: 'Tisch 2' });
  await layoutPruefen(page, pf);
  await bild(page, '52-planen');
  await pf.getByTestId('planen-speichern').click();
  await expect(page.getByTestId('naechste').locator('li').first()).toContainText('Tisch 2');

  // Ziehen: zweites Spiel am Griff auf Tisch 1 → sofort aufgerufen (PC: Maus; Handy/Tablet: Finger)
  const griff = page.getByTestId('griff').nth(1);
  const ziel = page.getByTestId('tisch-1');
  await ziel.scrollIntoViewIfNeeded();
  const t = (await ziel.boundingBox())!;
  const zx = t.x + t.width / 2;
  const zy = t.y + Math.min(t.height / 2, 30);
  if (info.project.use.hasTouch) {
    const g = (await griff.boundingBox())!;
    const p = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true };
    await griff.dispatchEvent('pointerdown', { ...p, clientX: g.x + 5, clientY: g.y + 5 });
    for (let i = 1; i <= 4; i++) await griff.dispatchEvent('pointermove', { ...p, clientX: zx, clientY: zy + i });
    await griff.dispatchEvent('pointerup', { ...p, clientX: zx, clientY: zy + 4 });
  } else {
    const g = (await griff.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(zx, zy, { steps: 8 });
    await page.mouse.up();
  }
  await expect(page.getByText('Spiel an Tisch 1 aufgerufen.')).toBeVisible();
  await expect(ziel).toContainText('–');
  await expect(ziel.getByRole('button', { name: 'Aufruf zurücknehmen' })).toBeVisible();
  await layoutPruefen(page, page.getByTestId('tische'));
  await bild(page, '53-tische-zeitplan');

  // Änderungsverlauf: Aufruf im Protokoll zurücknehmen und wiederherstellen
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await page.locator('summary', { hasText: 'Protokoll' }).click();
  const prot = page.getByTestId('protokoll');
  const erster = prot.locator('li').first();
  await expect(erster).toContainText('Spiel aufgerufen');
  await erster.getByTestId('verlauf-knopf').click();
  await expect(prot.locator('li').first()).toContainText('1 Eintrag rückgängig gemacht');
  await expect(prot.locator('li').nth(1)).toContainText('rückgängig gemacht');
  await expect(prot.locator('li').nth(1).getByTestId('verlauf-knopf')).toHaveText('Wiederherstellen');
  await layoutPruefen(page, prot);
  await bild(page, '54-verlauf');
  // Nach dem Zurücknehmen ist Tisch 1 wieder frei
  await page.getByRole('link', { name: 'Tische', exact: true }).click();
  await expect(page.getByTestId('tisch-1').getByText('frei')).toBeVisible();
  expect(fehler, 'Fehler auf der Seite').toEqual([]);
});

test('Lasttest: 128 Spieler in 32 Gruppen bleiben bedienbar', async ({ page }) => {
  test.setTimeout(150_000);
  // Sicherungsdatei mit 128 Spielern, Gruppen + K.-o., gestartet
  const ev: { id: string; art: string; daten: Record<string, unknown>; zeit: string; geraet: string; seq: number; empfangen: string; autor: { rolle: string; name: string } }[] = [];
  const zeit = new Date().toISOString();
  const neu = (art: string, daten: Record<string, unknown>) => ev.push({ id: randomUUID(), art, daten, zeit, geraet: 'last', seq: ev.length + 1, empfangen: zeit, autor: { rolle: 'leitung', name: 'Last' } });
  neu('turnier.angelegt', { name: 'Großturnier' });
  neu('turnier.daten', { tische: 16 });
  const ids = Array.from({ length: 128 }, (_, i) => `s${String(i).padStart(3, '0')}`);
  ids.forEach((id, i) => neu('spieler.angelegt', { id, vorname: `Vorname${i}`, nachname: `Nachname${i}`, verein: `Verein ${i % 20}`, ttr: 2200 - i * 5 }));
  neu('konkurrenz.angelegt', { id: 'herren', einst: { name: 'Herren', modus: 'gruppen_ko', gruppenGroesse: 4, aufsteiger: 2 } });
  for (const id of ids) neu('teilnehmer.gemeldet', { konkurrenz: 'herren', id });
  const gruppen = Array.from({ length: 32 }, (_, g) => [ids[g]!, ids[63 - g]!, ids[64 + g]!, ids[127 - g]!]);
  neu('auslosung.gesetzt', { konkurrenz: 'herren', phase: 'gruppen', zufall: 1, gruppen });
  neu('phase.gestartet', { konkurrenz: 'herren', phase: 'gruppen' });
  const datei = join(tmpdir(), `last-${randomUUID()}.json`);
  writeFileSync(datei, JSON.stringify({ format: 'tt-turnier-sicherung', version: 1, erstellt: zeit, turnier: { id: 'lasttest', name: 'Großturnier', datum: null, modus: 'lokal' }, ereignisse: ev }));

  await page.route(/api\/index\.php/, (r) => r.abort());
  await page.goto('./#/wiederherstellen');
  await page.locator('input[type=file]').setInputFiles(datei);
  await page.getByRole('button', { name: /wiederherstellen/i }).last().click();
  await expect(page.getByRole('heading', { name: 'Großturnier' })).toBeVisible({ timeout: 30_000 });

  let t0 = Date.now();
  await page.getByRole('link', { name: 'Spiele', exact: true }).click();
  await expect(page.getByTestId('spiel').first()).toBeVisible();
  await expect(page.getByTestId('spiel')).toHaveCount(192);
  const spieleMs = Date.now() - t0;

  t0 = Date.now();
  await page.getByRole('link', { name: 'Tische', exact: true }).click();
  await expect(page.getByTestId('zeitplan-ende')).toBeVisible();
  const tischeMs = Date.now() - t0;
  await layoutPruefen(page);
  await bild(page, '55-last-tische');

  t0 = Date.now();
  await page.getByRole('link', { name: 'Tabellen' }).click();
  await expect(page.getByText('Gruppe AF').first()).toBeVisible();
  const tabellenMs = Date.now() - t0;
  await layoutPruefen(page);

  // Ein Ergebnis eintragen: Stand ist sofort da
  await page.getByRole('link', { name: 'Spiele', exact: true }).click();
  t0 = Date.now();
  await page.getByTestId('spiel').first().click();
  const dlg = page.getByRole('dialog');
  for (const sz of [1, 2, 3]) {
    await dlg.getByTestId(`satz-${sz}`).getByRole('radio').first().click();
    await dlg.getByLabel(`Punkte des Verlierers Satz ${sz}`).fill('7');
  }
  await dlg.getByRole('button', { name: 'Ergebnis speichern' }).click();
  await expect(dlg).toBeHidden();
  const eintragMs = Date.now() - t0;
  console.info(`Lasttest Oberfläche (${test.info().project.name}): Spiele ${spieleMs} ms, Tische ${tischeMs} ms, Tabellen ${tabellenMs} ms, Ergebnis ${eintragMs} ms`);
  expect(spieleMs).toBeLessThan(5000);
  expect(tischeMs).toBeLessThan(5000);
  expect(tabellenMs).toBeLessThan(5000);
});
