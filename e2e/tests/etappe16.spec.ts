import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Paket 0.16: Startassistent, Konkurrenzarten und Spielsysteme in den Einstellungen (mit Folgen für bestehende
 * Konkurrenzen und Teilnehmer ohne Konkurrenz), Modus „Gruppen + Platzierungsgruppen“, Rückzug zurücknehmen.
 * Einzelgerät-Betrieb (ohne Server) auf Handy, Tablet und PC.
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

const nav = (page: Page) => page.getByRole('navigation', { name: 'Bereiche' });

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

async function ergebnis(page: Page, spiel: Locator, gewinntLinks: boolean, saetze = 2) {
  await spiel.click();
  const dlg = page.getByRole('dialog');
  for (let sz = 1; sz <= saetze; sz++) {
    await dlg.getByTestId(`satz-${sz}`).getByRole('radio').nth(gewinntLinks ? 0 : 1).click();
    await dlg.getByLabel(`Punkte des Verlierers Satz ${sz}`).fill('6');
  }
  await dlg.getByRole('button', { name: 'Ergebnis speichern' }).click();
  await expect(dlg).toBeHidden();
}

test('Startassistent, Auswahl in den Einstellungen, Teilnehmer ohne Konkurrenz', async ({ page }) => {
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  await page.route(/api\/index\.php/, (r) => r.abort());
  await page.goto('./');
  await page.getByTestId('neues-turnier').click();
  const ass = page.getByTestId('assistent');
  await expect(ass.getByTestId('assistent-schritt')).toContainText('Schritt 1 von 8');
  // Ohne Namen geht es nicht weiter
  await ass.getByTestId('assistent-weiter').click();
  await expect(ass.getByRole('alert')).toContainText('mindestens 2 Zeichen');
  await page.getByLabel('Name des Turniers').fill('Assistenten-Cup');
  await page.getByLabel('Ort / Halle (optional)').fill('Sporthalle Nord');
  await page.getByLabel(/^Dein Name/).fill('Sascha');
  await layoutPruefen(page, ass);
  await bild(page, '160-assistent-1');
  await ass.getByTestId('assistent-weiter').click();

  // Schritt 2: Arten – Einzel ist vorgewählt, Doppel dazu
  await expect(ass.getByTestId('assistent-schritt')).toContainText('Konkurrenzarten');
  await expect(ass.getByTestId('art-einzel')).toBeChecked();
  await ass.getByTestId('art-doppel').check();
  await layoutPruefen(page, ass);
  await bild(page, '161-assistent-arten');
  await ass.getByTestId('assistent-weiter').click();

  // Schritt 3: Spielsysteme – nichts gewählt geht nicht
  for (const m of ['gruppen_ko', 'jgj', 'ko']) await ass.getByTestId(`modus-${m}`).uncheck();
  await ass.getByTestId('assistent-weiter').click();
  await expect(ass.getByRole('alert')).toContainText('mindestens ein Spielsystem');
  await ass.getByTestId('modus-gruppen_platz').check();
  await ass.getByTestId('modus-jgj').check();
  await layoutPruefen(page, ass);
  await bild(page, '162-assistent-modi');
  await ass.getByTestId('assistent-weiter').click();

  // Schritt 4: Klassen nach TTR mit Vorlage
  await ass.getByTestId('klassen-ttr').check();
  await expect(ass.getByTestId('ttr-bereiche')).toBeVisible();
  await ass.getByTestId('assistent-weiter').click();
  // Schritt 5: Anmeldung (nur online) und Kasse
  await expect(ass.getByText('Gibt es nur bei Turnieren auf mehreren Geräten')).toBeVisible();
  await ass.getByTestId('assistent-kasse').check();
  await ass.getByTestId('assistent-weiter').click();
  // Schritt 6: Sichtbarkeit – Kurzform der Namen
  await ass.getByRole('radio', { name: /Kurzform/ }).check();
  await ass.getByTestId('assistent-weiter').click();
  // Schritt 7: Zugänge (Einzelgerät: nur Hinweis), danach weiter mit Konkurrenzen
  await ass.getByRole('radio', { name: 'Konkurrenzen anlegen' }).check();
  await ass.getByTestId('assistent-weiter').click();
  // Schritt 8: Zusammenfassung
  const zf = ass.getByTestId('zusammenfassung');
  await expect(zf).toContainText('Einzel, Doppel');
  await expect(zf).toContainText('Gruppen + Platzierungsgruppen, Jeder gegen jeden');
  await expect(zf).toContainText('Sporthalle Nord');
  await layoutPruefen(page, ass);
  await bild(page, '163-assistent-zusammenfassung');
  await ass.getByTestId('assistent-anlegen').click();

  // Unter „Konkurrenzen“ nur die gewählten Arten und Systeme
  await expect(page).toHaveURL(/\/konkurrenzen$/);
  const form = page.locator('.konk-form').first();
  await expect(form.getByRole('radio', { name: 'Einzel', exact: true })).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Doppel', exact: true })).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Mixed', exact: true })).toHaveCount(0);
  await expect(form.getByRole('radio', { name: /^Gruppen \+ Platzierungsgruppen/ })).toBeChecked();
  await expect(form.getByRole('radio', { name: /^K\.-o\.-System/ })).toHaveCount(0);
  await expect(form.getByTestId('endrunde')).toBeVisible();
  await expect(form.getByText('Plätze je Gruppe in jede Platzierungsgruppe')).toBeVisible();
  await layoutPruefen(page, form);
  await bild(page, '164-konkurrenz-form');
  await form.getByRole('button', { name: 'Abbrechen' }).click();

  await spielerAnlegen(page, [
    ['Anna', 'Alpha'],
    ['Ben', 'Beta'],
    ['Cem', 'Gamma'],
    ['Dora', 'Delta'],
  ]);
  // Einzel mit Anna und Ben, Doppel mit Cem/Dora
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  // Ohne Konkurrenz steht das Formular gleich offen
  await page.getByLabel('Name', { exact: true }).fill('Einzel offen');
  await page.getByRole('radio', { name: /^Jeder gegen jeden/ }).check();
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  const einzel = page.getByTestId('konkurrenz').filter({ hasText: 'Einzel offen' });
  for (const n of ['Anna Alpha', 'Ben Beta']) await einzel.getByRole('checkbox', { name: n }).check();
  await page.getByRole('button', { name: '+ Neue Konkurrenz' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Doppel offen');
  await page.getByRole('radio', { name: 'Doppel', exact: true }).check();
  await page.getByRole('radio', { name: /^Jeder gegen jeden/ }).check();
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  const doppel = page.getByTestId('konkurrenz').filter({ hasText: 'Doppel offen' });
  await doppel.getByLabel('Spieler 1').selectOption({ label: 'Cem Gamma' });
  await doppel.getByLabel('Spieler 2').selectOption({ label: 'Dora Delta' });
  await doppel.getByTestId('paar-melden').click();
  await expect(doppel.getByText('1 Paar')).toBeVisible();

  // Einstellungen: Doppel abwählen → Vorschau zeigt, was passiert
  await nav(page).getByRole('link', { name: 'Einstellungen' }).click();
  const aw = page.getByTestId('auswahl');
  await aw.locator('summary').click();
  await expect(aw.getByTestId('auswahl-art-einzel')).toBeChecked();
  await expect(aw.getByTestId('auswahl-art-mixed')).not.toBeChecked();
  await aw.getByTestId('auswahl-art-doppel').uncheck();
  await expect(aw.getByTestId('auswahl-entfernen')).toContainText('Doppel offen');
  await expect(aw.getByTestId('auswahl-ohne')).toContainText('Cem Gamma, Dora Delta');
  await layoutPruefen(page, aw);
  await bild(page, '165-auswahl-folgen');
  page.once('dialog', (d) => void d.accept());
  await aw.getByTestId('auswahl-uebernehmen').click();
  await expect(aw.getByText('Übernommen.')).toBeVisible();
  await expect(page.getByTestId('konkurrenz')).toHaveCount(0);

  // Teilnehmer: Hinweis auf die beiden ohne Konkurrenz, gesammelt melden
  await nav(page).getByRole('link', { name: /^Teilnehmer/ }).click();
  const ohne = page.getByTestId('ohne-konkurrenz');
  await expect(ohne).toContainText('2 Teilnehmer sind in keiner Konkurrenz gemeldet');
  await layoutPruefen(page, ohne);
  await bild(page, '166-ohne-konkurrenz');
  await ohne.getByTestId('ohne-melden').click();
  await expect(page.getByText('2 gemeldet in „Einzel offen“.')).toBeVisible();
  await expect(page.getByTestId('ohne-konkurrenz')).toHaveCount(0);

  // Mixed wieder anbieten: Konkurrenzen-Formular zeigt es danach
  await nav(page).getByRole('link', { name: 'Einstellungen' }).click();
  await aw.locator('summary').click();
  await aw.getByTestId('auswahl-art-mixed').check();
  await expect(aw.getByText('Keine bestehende Konkurrenz ist betroffen.')).toBeVisible();
  await aw.getByTestId('auswahl-uebernehmen').click();
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  await page.getByRole('button', { name: '+ Neue Konkurrenz' }).click();
  await expect(page.getByRole('radio', { name: 'Mixed', exact: true })).toBeVisible();
  expect(fehler).toEqual([]);
});

test('Gruppen + Platzierungsgruppen: Vorrunde, Platzierungsrunde, Gesamtplatzierung; Rückzug zurücknehmen', async ({ page }) => {
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  await page.route(/api\/index\.php/, (r) => r.abort());
  await page.goto('./');
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill('Platzpokal');
  await page.getByLabel(/^Dein Name/).fill('Sascha');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await spielerAnlegen(page, [
    ['Anna', 'Alpha'],
    ['Ben', 'Beta'],
    ['Cem', 'Gamma'],
    ['Dora', 'Delta'],
  ]);
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Platzrunde');
  await page.getByRole('radio', { name: /^Gruppen \+ Platzierungsgruppen/ }).check();
  await page.getByLabel('Gewinnsätze', { exact: true }).selectOption('3');
  await page.getByTestId('aufsteiger').selectOption('1');
  await page.getByTestId('endrunde-bestof').selectOption('5');
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  const karte = page.getByTestId('konkurrenz');
  await karte.getByRole('button', { name: 'Alle melden' }).click();
  await karte.getByLabel('Anzahl Gruppen').selectOption('2');
  await karte.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await karte.getByTestId('starten').click();
  await expect(karte.getByText('Gruppenphase')).toBeVisible();
  await expect(karte.getByText('In Gruppe A sind noch Spiele offen')).toBeVisible();

  // Vorrunde: 2 Spiele (2 Gruppen à 2), linker Spieler gewinnt
  await nav(page).getByRole('link', { name: 'Spiele', exact: true }).click();
  for (let i = 0; i < 2; i++) await ergebnis(page, page.locator('[data-testid=spiel]:not(.fertig)').first(), true, 2);

  // Platzierungsrunde: Gruppensieger um Platz 1–2, Zweite um 3–4
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  const vorschau = karte.getByTestId('platz-vorschau');
  await expect(vorschau).toContainText('Plätze 1–2');
  await expect(vorschau).toContainText('Plätze 3–4');
  await layoutPruefen(page, karte);
  await bild(page, '167-platz-vorschau');
  page.once('dialog', (d) => void d.accept());
  await karte.getByTestId('platz-starten').click();
  await expect(karte.getByText('K.-o.-Runde')).toBeVisible();

  // Rückzug in der Platzierungsrunde und wieder zurücknehmen
  await nav(page).getByRole('link', { name: /^Teilnehmer/ }).click();
  const abschnitt = page.getByTestId('abschnitt-konkurrenz').first();
  if (!(await abschnitt.getAttribute('open'))) await abschnitt.locator('summary').click();
  await abschnitt.getByRole('combobox', { name: 'Rückzug' }).selectOption({ index: 1 });
  page.once('dialog', (d) => void d.accept());
  await abschnitt.getByRole('button', { name: 'Zurückziehen' }).click();
  const zurueck = abschnitt.getByTestId('rueckzug-zurueck');
  await expect(zurueck).toBeVisible();
  await layoutPruefen(page, abschnitt);
  await bild(page, '168-rueckzug-zurueck');
  page.once('dialog', (d) => void d.accept());
  await zurueck.getByRole('button', { name: 'Spielt wieder mit' }).click();
  await expect(abschnitt.getByTestId('rueckzug-zurueck')).toHaveCount(0);

  // Zweite Stufe mit 3 Gewinnsätzen
  await nav(page).getByRole('link', { name: 'Spiele', exact: true }).click();
  for (let i = 0; i < 2; i++) await ergebnis(page, page.locator('[data-testid=spiel]:not(.fertig)').filter({ hasText: 'Plätze' }).first(), true, 3);
  await nav(page).getByRole('link', { name: 'Tabellen' }).click();
  await expect(page.getByText('Vorrunde', { exact: true })).toBeVisible();
  await expect(page.getByText('Platzierungsrunde', { exact: true })).toBeVisible();
  const gesamt = page.getByTestId('gesamtplatzierung');
  await expect(gesamt.locator('li')).toHaveCount(4);
  await layoutPruefen(page);
  await bild(page, '169-gesamtplatzierung');
  expect(fehler).toEqual([]);
});
