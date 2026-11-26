import { expect, test, type Locator, type Page } from '@playwright/test';
import { angabenSetzen, reiterOeffnen } from './hilfen';
import { mkdirSync } from 'node:fs';

/**
 * V-010: Grafische Tischübersicht. Tisch als stilisierter Tischtennistisch, Angaben am Tisch,
 * Antippen öffnet die Funktionen der Leitung (Aufruf, Ergebnis, Tisch wechseln, zurücknehmen, sperren),
 * freier Tisch zeigt das letzte Ergebnis. Dazu: versehentlich eingeschaltete Automatik zurücknehmen.
 * Einzelgerät-Betrieb (ohne Server), auf Handy, Tablet und PC.
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
  const zuKlein = await bereich.locator('button:visible:not(.knopf-hilfe), select:visible, a.knopf:visible').evaluateAll((els) =>
    els.filter((e) => { const h = e.getBoundingClientRect().height; return h > 0 && h < 44; }).map((e) => `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().height)}px`),
  );
  expect(zuKlein, 'Touch-Ziele unter 44 px').toEqual([]);
}

test('V-010: Tische als Tischtennistisch, Funktionen per Antippen, letztes Ergebnis, Automatik zurücknehmen', async ({ page }) => {
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  await page.route(/api\/index\.php/, (r) => r.abort());
  await page.goto('./');
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill('Tischpokal');
  await page.getByLabel(/^Dein Name/).fill('Sascha');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await angabenSetzen(page, { tische: '3' });
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  for (const [v, n] of [['Anna', 'Alpha'], ['Ben', 'Beta'], ['Cem', 'Gamma'], ['Dora', 'Delta']]) {
    await page.getByLabel('Vorname').fill(v!);
    await page.getByLabel('Nachname').fill(n!);
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} ${n} ✓`)).toBeVisible();
  }
  await reiterOeffnen(page, 'Konkurrenzen');
  await page.getByLabel('Name', { exact: true }).fill('Herren');
  await page.getByLabel(/Jeder gegen jeden/).check();
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  const konk = page.getByTestId('konkurrenz');
  for (const n of ['Anna Alpha', 'Ben Beta', 'Cem Gamma', 'Dora Delta']) await konk.getByRole('checkbox', { name: n }).check();
  await page.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('starten').click();
  await expect(konk.getByText('Gruppenphase')).toBeVisible();

  await page.getByRole('link', { name: 'Tische', exact: true }).click();
  const t1 = page.getByTestId('tisch-1');
  const t2 = page.getByTestId('tisch-2');
  const t3 = page.getByTestId('tisch-3');
  for (const t of [t1, t2, t3]) await expect(t.getByText('frei', { exact: true })).toBeVisible();

  // Tisch als Tischtennistisch: Querformat in etwa wie ein echter Tisch, mit Netz und Nummer
  const flaeche = t1.getByTestId('tischflaeche');
  const box = (await flaeche.boundingBox())!;
  expect(box.width / box.height).toBeGreaterThan(1.8);
  expect(box.width / box.height).toBeLessThan(2.7);
  await expect(flaeche.locator('.netz')).toHaveCount(1);
  await expect(flaeche.locator('.nr')).toHaveText('1');

  // Tisch 3 sperren – über die Funktionen am Tisch
  await t3.getByRole('button', { name: 'Tisch 3: frei' }).click();
  const auswahl = page.getByTestId('tisch-auswahl');
  await layoutPruefen(page, auswahl);
  await auswahl.getByRole('button', { name: 'Tisch sperren' }).click();
  await expect(t3.getByText('gesperrt', { exact: true })).toBeVisible();
  await expect(t3.getByTestId('tischflaeche')).toContainText('🔒');

  // Freier Tisch: nächstes Spiel aufrufen
  await t1.getByRole('button', { name: 'Tisch 1: frei' }).click();
  await auswahl.getByTestId('tisch-belegen').click();
  await page.getByTestId('aufrufen').click();
  const lauf1 = t1.getByRole('button', { name: /^Tisch 1: .+ gegen .+/ });
  await expect(lauf1).toBeVisible();
  await expect(t1.getByText('läuft', { exact: true })).toBeVisible();
  await expect(lauf1).toContainText('gerade aufgerufen');
  const paar = (await lauf1.getAttribute('aria-label'))!.replace(/^Tisch 1: /, '');

  // Tisch wechseln: Spiel geht an Tisch 2, Tisch 1 wird frei
  await lauf1.click();
  await expect(auswahl.getByRole('button', { name: 'Ergebnis eintragen' })).toBeVisible();
  await expect(auswahl.getByRole('button', { name: 'Aufruf zurücknehmen' })).toBeVisible();
  await layoutPruefen(page, auswahl);
  await bild(page, '60-tisch-funktionen');
  await auswahl.getByLabel('Tisch 1 wechseln').selectOption({ label: 'Tisch 2' });
  await expect(t2.getByRole('button', { name: `Tisch 2: ${paar}` })).toBeVisible();
  await expect(t1.getByText('frei', { exact: true })).toBeVisible();

  // Ergebnis eintragen vom Tisch aus → Tisch frei, zeigt das letzte Spiel mit Sätzen je Seite
  await t2.getByRole('button', { name: `Tisch 2: ${paar}` }).click();
  await auswahl.getByRole('button', { name: 'Ergebnis eintragen' }).click();
  const dlg = page.getByRole('dialog');
  for (const sz of [1, 2, 3]) {
    await dlg.getByTestId(`satz-${sz}`).getByRole('radio').first().click();
    await dlg.getByLabel(`Punkte des Verlierers Satz ${sz}`).fill('7');
  }
  await dlg.getByRole('button', { name: 'Ergebnis speichern' }).click();
  await expect(t2.getByText('frei', { exact: true })).toBeVisible();
  const zuletzt = t2.getByTestId('tischflaeche');
  await expect(zuletzt).toContainText('11 · 11 · 11');
  await expect(zuletzt).toContainText('7 · 7 · 7');
  await expect(zuletzt).toContainText(/gerade beendet|vor \d+ Min\. beendet/);
  await expect(t2).toContainText('zuletzt: Herren');
  await layoutPruefen(page, page.getByTestId('tische'));
  await bild(page, '61-tische');

  // Schmale Handys: kein waagerechter Scrollbalken
  const vorher = page.viewportSize()!;
  for (const breite of [320, 390]) {
    await page.setViewportSize({ width: breite, height: 760 });
    await layoutPruefen(page, page.getByTestId('tische'));
  }
  await bild(page, '62-tische-390');
  await page.setViewportSize(vorher);

  // Automatik versehentlich eingeschaltet: Aufrufe bleiben, lassen sich aber gesammelt zurücknehmen
  const einst = page.getByTestId('aufruf-einstellungen');
  await einst.locator('summary').click();
  await einst.getByTestId('automatisch').check();
  // Nach Runde 1 ist genau ein Spiel bereit (Ben/Cem bzw. Anna/Dora), die übrigen warten auf beschäftigte Spieler
  const laufend = page.getByTestId('tische').getByRole('button', { name: /^Tisch [12]: .+ gegen .+/ });
  await expect(laufend).toHaveCount(1);
  await einst.getByTestId('automatisch').uncheck();
  const rueck = page.getByTestId('auto-zurueck');
  await expect(rueck).toContainText('automatisch aufgerufen');
  // Laufende Spiele bleiben, solange niemand zurücknimmt
  await expect(laufend).toHaveCount(1);
  await layoutPruefen(page, rueck);
  await bild(page, '63-automatik-zuruecknehmen');
  await rueck.getByRole('button', { name: 'Aufruf zurücknehmen' }).click();
  await expect(page.getByText('Aufruf zurückgenommen.')).toBeVisible();
  await expect(laufend).toHaveCount(0);
  // Einschalten belegt wieder automatisch, Ausschalten ohne „Zurücknehmen“ behält die Aufrufe
  await einst.getByTestId('automatisch').check();
  await expect(laufend).toHaveCount(1);
  await einst.getByTestId('automatisch').uncheck();
  await page.getByTestId('auto-zurueck').getByRole('button', { name: 'Aufrufe behalten' }).click();
  await expect(page.getByTestId('auto-zurueck')).toHaveCount(0);
  await expect(laufend).toHaveCount(1);
  expect(fehler, 'Fehler auf der Seite').toEqual([]);
});
