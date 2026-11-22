import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ADMIN } from './einrichten';

/**
 * 0.15: Gemeinsame Wertungsskala – Einstufung mit 4 Fragen für Hobbyspieler (ohne Veto-Regel),
 * reines Hobby-Turnier, Klassen-Vorlagen, App-Wertung und Übernahme in den Spielerpool,
 * Einstufung in der Online-Anmeldung – auf Handy, Tablet und PC.
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

const nav = (page: Page) => page.getByRole('navigation', { name: 'Bereiche' });

/** Einstufung: je Frage eine Antwort (Index 0–3) */
async function einstufen(bereich: Locator, antworten: number[]) {
  const e = bereich.getByTestId('einstufung');
  for (const [i, a] of antworten.entries()) await e.locator('fieldset').nth(i).getByRole('radio').nth(a).check();
}

test('Einstufung, Hobby-Turnier, App-Wertung und Klassen-Vorlagen', async ({ page, browser }, info) => {
  const geraet = info.project.name;
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  await page.goto('./#/anmelden');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.passwort);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill(`Hobbycup ${geraet}`);
  await page.getByLabel('Datum').fill('2027-12-11');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await expect(page.getByText('Verbunden')).toBeVisible();
  const tid = page.url().match(/#\/t\/(\d{8})/)![1]!;

  // Reines Hobby-Turnier: Jeder gegen jeden, nur Spieler ohne amtlichen TTR
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Hobby');
  await page.getByLabel(/Jeder gegen jeden/).check();
  await page.locator('summary', { hasText: 'Weitere Einstellungen' }).click();
  await page.getByLabel('Nur Hobbyspieler (ohne amtlichen TTR)').check();
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  await expect(page.getByTestId('konkurrenz').filter({ hasText: 'Hobby' })).toBeVisible();

  // Teilnehmer: Hobbyspielerin per Einstufung, Vereinsspieler mit Q-TTR
  await nav(page).getByRole('link', { name: /^Teilnehmer/ }).click();
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  await page.getByRole('group', { name: /Gleich melden für/ }).getByRole('checkbox', { name: 'Hobby' }).check();
  const verein = `TTC ${geraet}`;
  await page.getByLabel('Vorname').fill('Hanna');
  await page.getByLabel('Nachname').fill('Hobby');
  await page.getByLabel('Verein', { exact: true }).fill(verein);
  await page.getByRole('button', { name: 'Kein TTR? Einstufen' }).click();
  const form = page.locator('form.spielerform');
  // „Aktiv im Verein“ ohne Veto-Regel: 3 Punkte → H2 (1025), nicht mindestens 1175
  await einstufen(form, [3, 0, 0, 0]);
  await expect(form.getByTestId('einstufung-ergebnis')).toHaveText('H2 Geübt – Startwert 1025');
  await expect(form.getByTestId('einstufung-text')).toHaveText(/^Du hast ein gutes Ballgefühl.*\(untere E-Klasse\)\.$/);
  await expect(form.getByText('Wie sieht dein Aufschlag- und Rückschlagspiel aus?')).toBeVisible();
  await layoutPruefen(page, form);
  await bild(page, '83-einstufung');
  await form.getByRole('button', { name: 'Wert übernehmen' }).click();
  await expect(page.getByRole('textbox', { name: 'TTR-Punkte' })).toHaveValue('1025');
  await expect(page.getByLabel('Geschätzter Wert (Hobby, kein Q-TTR)')).toBeChecked();
  await expect(form.getByText('≈1025 · H2 Geübt')).toBeVisible();
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByText('Hanna Hobby ✓')).toBeVisible();
  await expect(page.getByLabel('Geschätzter Wert (Hobby, kein Q-TTR)')).not.toBeChecked();
  await page.getByLabel('Vorname').fill('Kai');
  await page.getByLabel('Nachname').fill('Klub');
  await page.getByLabel('Verein', { exact: true }).fill(verein);
  await page.getByRole('textbox', { name: 'TTR-Punkte' }).fill('1200');
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByText('Kai Klub ✓')).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  const zeile = (n: string) => page.getByTestId('abschnitt-spieler').locator('li', { hasText: n });
  await expect(zeile('Hanna Hobby')).toContainText('≈1025 · H2');
  await expect(zeile('Kai Klub')).toContainText('1200');
  await expect(zeile('Kai Klub')).not.toContainText('≈');

  // Im Hobby-Turnier bekommt der Vereinsspieler einen Hinweis
  const hobby = page.getByTestId('abschnitt-konkurrenz').first();
  await hobby.locator('summary').click();
  await expect(hobby.getByText('⚠ amtlicher TTR (nur Hobby)')).toHaveCount(1);

  // Auslosen, starten, Hanna gewinnt gegen Kai
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  const karte = page.getByTestId('konkurrenz').filter({ hasText: 'Hobby' }).first();
  await karte.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await karte.getByTestId('starten').click();
  await nav(page).getByRole('link', { name: 'Spiele', exact: true }).click();
  await page.getByTestId('spiel').first().click();
  const dlg = page.getByRole('dialog');
  const hannaLinks = (await dlg.textContent())!.indexOf('Hanna') < (await dlg.textContent())!.indexOf('Kai');
  for (const sz of [1, 2, 3]) {
    await dlg.getByTestId(`satz-${sz}`).getByRole('radio').nth(hannaLinks ? 0 : 1).click();
    await dlg.getByLabel(`Punkte des Verlierers Satz ${sz}`).fill('7');
  }
  await dlg.getByRole('button', { name: 'Ergebnis speichern' }).click();
  await expect(dlg).toBeHidden();

  // App-Wertung: Sieg gegen Stärkeren → +30 (K = 32), amtlicher TTR bleibt
  await nav(page).getByRole('link', { name: /^Teilnehmer/ }).click();
  const wertung = page.getByTestId('abschnitt-appwertung');
  // Gibt es etwas zu übernehmen, ist der Abschnitt schon aufgeklappt
  await expect(wertung).toHaveAttribute('open', '');
  await expect(wertung.getByTestId('appwertung-zeile')).toHaveText('1025 → 1055 (+30, 1 Spiel)');
  await expect(wertung.getByText('Kai Klub')).toHaveCount(0);
  await layoutPruefen(page, wertung);
  await bild(page, '84-appwertung');
  await wertung.getByTestId('appwertung-uebernehmen').click();
  await expect(wertung.getByText('1 Wert im Spielerpool aktualisiert.')).toBeVisible();
  await expect(wertung.getByText('Die Werte dieses Turniers sind schon im Spielerpool.')).toBeVisible();
  await expect(wertung.getByTestId('appwertung-uebernehmen')).toHaveCount(0);

  // Spielerpool: neuer Wert, als geschätzt markiert
  await nav(page).getByRole('link', { name: 'Spielerpool' }).click();
  await page.getByTestId('pool-liste').getByRole('searchbox').fill(verein);
  await expect(page.getByTestId('pool-liste').locator('li', { hasText: 'Hanna Hobby' })).toContainText('≈1055 · H2');
  await expect(page.getByTestId('pool-liste').locator('li', { hasText: 'Kai Klub' })).toContainText('TTR 1200');

  // Klassen-Vorlage „Hobby + Verein“ im Klassen-Assistenten: Konkurrenz je Stufe, nur Obergrenze
  await nav(page).getByRole('link', { name: 'Konkurrenzen' }).click();
  await page.getByRole('button', { name: /Neue Konkurrenz/ }).click();
  await page.getByTestId('klassen-assistent').click();
  await page.getByLabel('Aufteilen nach').selectOption('ttr');
  await page.getByLabel('Vorlage', { exact: true }).selectOption('gemischt');
  await expect(page.getByLabel('TTR-Grenzen (aufsteigend, mit Komma)')).toHaveValue('951, 1101, 1251, 1451, 1651, 1851');
  await expect(page.getByTestId('ttr-bereiche')).toContainText('H1 Einsteiger (bis 950) · H2 Geübt (bis 1100) · H3 / E-Klasse (bis 1250)');
  await expect(page.getByTestId('klassen-vorschau')).toContainText('H2 Geübt (bis 1100)');
  await expect(page.getByTestId('klassen-vorschau')).toContainText('H3 / E-Klasse (bis 1250)');
  // Damen-Abzug senkt die Vereinsklassen
  await page.getByLabel('Damen: Obergrenzen A–D senken um').selectOption('150');
  await expect(page.getByLabel('TTR-Grenzen (aufsteigend, mit Komma)')).toHaveValue('951, 1101, 1251, 1301, 1501, 1701');
  await layoutPruefen(page, page.locator('main'));
  await bild(page, '85-klassen-vorlage');

  // Online-Anmeldung mit TTR als Pflichtangabe: Hobbyspieler stufen sich selbst ein
  await nav(page).getByRole('link', { name: /^Teilnehmer/ }).click();
  const anm = page.getByTestId('abschnitt-anmeldungen');
  await anm.locator('summary').first().click();
  const ttrPflicht = anm.getByRole('checkbox', { name: 'TTR-Wert' });
  if (!(await ttrPflicht.isVisible())) await anm.getByText('Einrichten').click();
  await ttrPflicht.check();
  await anm.getByTestId('anmeldung-oeffnen').click();
  await expect(anm.getByTestId('anmeldung-status')).toHaveText('Anmeldung geöffnet');
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const p = await ctx.newPage();
  await p.goto(`./#/meldung/${tid}`);
  await p.getByLabel('Vorname').fill('Olli');
  await p.getByLabel('Nachname').fill('Online');
  await p.getByLabel('E-Mail-Adresse').fill(`olli-${geraet}@example.org`);
  await p.getByTestId('meldung-datenschutz').check();
  await expect(p.getByTestId('meldung-senden')).toBeDisabled();
  await p.getByRole('radio', { name: 'Nein, ich spiele hobbymäßig' }).check();
  await einstufen(p.locator('main'), [2, 2, 1, 1]);
  await expect(p.getByTestId('einstufung-ergebnis')).toHaveText('H3 Ambitioniert – Startwert 1175');
  await expect(p.getByTestId('einstufung-text')).toHaveText(/^Schnitt, Platzierung und erste Topspins.*gut mithalten\.$/);
  await expect(p.getByTestId('meldung-senden')).toBeEnabled();
  await layoutPruefen(p, p.locator('main'));
  await bild(p, '86-anmeldung-einstufung');
  await p.getByRole('radio', { name: 'Ja' }).check();
  await expect(p.getByTestId('meldung-senden')).toBeDisabled();
  await expect(p.getByLabel('Dein Q-TTR-Wert')).toBeVisible();
  await ctx.close();

  expect(fehler).toEqual([]);
});
