import { expect, test, type Page } from '@playwright/test';
import { angabenSetzen, reiterOeffnen, reiterSichtbarMachen } from './hilfen';
import { mkdirSync } from 'node:fs';
import { registrierlinkOeffnen, letzteMail } from './mails';
import { ADMIN } from './einrichten';

/**
 * Kompletter Ablauf, wie ihn eine fremde Person ohne Anleitung erlebt –
 * auf Handy, Tablet und PC (Projekte in playwright.config.ts).
 */

/** Demo ohne Server (wie GitHub Pages): die App findet keinen Server und erlaubt „Nur dieses Gerät“ */
async function ohneServer(page: Page) {
  await page.route(/api\/index\.php/, (r) => r.abort());
}

async function bild(page: Page, name: string) {
  const ordner = `bilder/${test.info().project.name}`;
  mkdirSync(ordner, { recursive: true });
  await page.screenshot({ path: `${ordner}/${name}.png`, fullPage: true, scale: 'css' });
}

test('Konto anlegen, Online-Turnier, Mitleiten, Sicherung, Passwort vergessen, Konto löschen', async ({ page, browser }, info) => {
  const geraet = info.project.name;
  const email = `veranstalter-${geraet}-${Date.now()}@example.org`;
  const passwort = 'sicher-genug-1';

  // Startseite als Gast: nur „Anmelden“ (Turnierleitung) und „Turnier beitreten“ – kein „Neues Turnier“
  await page.goto('./');
  await expect(page.getByTestId('neues-turnier')).toHaveCount(0);
  await expect(page.getByTestId('anmelden')).toBeVisible();
  await expect(page.getByTestId('beitreten')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Turnierleitung' })).toBeVisible();
  await bild(page, '01-start-gast');

  // Konto anlegen
  await page.getByRole('link', { name: 'Konto anlegen' }).first().click();
  await expect(page.getByRole('heading', { name: 'Konto anlegen' })).toBeVisible();
  await registrierlinkOeffnen(page, email);
  await page.getByLabel('Dein Name').fill(`TTC ${geraet}`);
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort (mindestens 8 Zeichen)').fill(passwort);
  // ab 0.17: Verein und Sparte, mindestens 18, Nutzungsbedingungen mit AVV
  await page.getByLabel('Verein', { exact: true }).fill(`TTC ${geraet} e. V.`);
  await expect(page.getByLabel('Sparte', { exact: true })).toHaveValue('Tischtennis');
  await expect(page.getByRole('button', { name: 'Konto anlegen' })).toBeDisabled();
  await page.getByLabel('Ich bin mindestens 18 Jahre alt.').check();
  await page.getByRole('checkbox', { name: /Nutzungsbedingungen/ }).check();
  await bild(page, '02-registrieren');
  await page.getByRole('button', { name: 'Konto anlegen' }).click();

  // Danach: Willkommen, großer Knopf, Name in der Kopfzeile
  await expect(page.getByText('Willkommen! Dein Konto ist angelegt.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Konto-Menü' })).toContainText(`TTC ${geraet}`);
  await expect(page.getByTestId('neues-turnier')).toBeVisible();
  await bild(page, '03-start-angemeldet');
  expect(letzteMail(email, /Willkommen/)).toBeTruthy();
  expect(letzteMail('betreiber@example.org', new RegExp(`Neues Konto: TTC ${geraet}`))).toBeTruthy();

  // Neues Turnier: online, ohne Auswahl „Nur dieses Gerät“ (gibt es nur in der Demo und auf der Zentrale)
  await page.getByTestId('neues-turnier').click();
  await expect(page.getByLabel(/Nur dieses Gerät/)).toHaveCount(0);
  await expect(page.getByText(/persönliche Leitungskennung/)).toBeVisible();
  await expect(page.getByRole('radio', { name: /Zufällig vergeben/ })).toBeChecked();
  await expect(page.getByLabel('Automatische Löschung')).toHaveValue('12');
  await page.getByLabel('Name des Turniers').fill(`Herbstpokal ${geraet}`);
  await bild(page, '04-neues-turnier');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();

  // Turnierseite: ohne Spieler öffnet „Spieler“
  await expect(page.getByRole('heading', { name: `Herbstpokal ${geraet}` })).toBeVisible();
  await expect(page.getByText('Verbunden')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Alle Teilnehmer/ })).toBeVisible();
  const spieler = [
    ['Anna', 'Alpha', 'TTC Nord', '1650'],
    ['Ben', 'Beta', 'TSV Süd', '1500'],
    ['Cem', 'Gamma', 'TTC Nord', '1420'],
    ['Dora', 'Delta', 'SV Ost', '1300'],
  ];
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  for (const [v, n, ve, ttr] of spieler) {
    await page.getByLabel('Vorname').fill(v!);
    await page.getByLabel('Nachname').fill(n!);
    await page.getByLabel('Verein', { exact: true }).fill(ve!);
    await page.getByRole('textbox', { name: 'TTR-Punkte' }).fill(ttr!);
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} ${n} ✓`)).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: /Alle Teilnehmer \(4\)/ })).toBeVisible();
  await bild(page, '05-spieler');

  // Konkurrenz: Jeder gegen jeden, alle melden, auslosen, starten
  await reiterOeffnen(page, 'Konkurrenzen');
  await page.getByLabel('Name', { exact: true }).fill('Herren');
  await page.getByLabel(/Jeder gegen jeden/).check();
  await expect(page.getByText(/Wie wird bei Gleichstand gewertet/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  await page.getByRole('button', { name: 'Alle melden' }).click();
  await expect(page.getByText('Meldungen (4)')).toBeVisible();
  await page.getByRole('button', { name: 'Auslosen' }).click();
  await expect(page.getByTestId('starten')).toBeVisible();
  await bild(page, '06-auslosung');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('starten').click();
  await expect(page.getByTestId('konkurrenz').getByText('Gruppenphase')).toBeVisible();

  // Zugänge: Turnierkennung (8 Ziffern), Link, Leitungskennung der Leitung, Spielerkennungen
  await reiterOeffnen(page, 'Zugänge');
  const turnierKennung = (await page.getByTestId('turnierkennung').innerText()).replace(/\s/g, '');
  expect(turnierKennung).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  const link = await page.getByLabel('Link').inputValue();
  expect(link).toContain(`#/t/${turnierKennung}`);
  const leitungZugaenge = page.getByTestId('zugaenge-leitung');
  await expect(leitungZugaenge.getByTestId('code')).toHaveCount(1);
  await expect(leitungZugaenge.locator('li', { hasText: `TTC ${geraet}` })).toBeVisible();
  // Weitere Leitungsperson anlegen
  await leitungZugaenge.getByLabel('Name der Person').fill('Co-Leitung Karl');
  await leitungZugaenge.getByRole('button', { name: 'Zur Turnierleitung hinzufügen' }).click();
  await expect(leitungZugaenge.getByTestId('code')).toHaveCount(2);
  const karlKennung = (await leitungZugaenge.locator('li', { hasText: 'Co-Leitung Karl' }).getByTestId('code').innerText()).replace(/\s/g, '');
  expect(karlKennung).toMatch(/^\d{8}$/);
  // Spieler: aufklappen, 4 Kennungen
  const spielerZugaenge = page.getByTestId('zugaenge-spieler');
  await spielerZugaenge.locator('summary').click();
  await expect(spielerZugaenge.getByTestId('code')).toHaveCount(4);
  const annaCode = (await spielerZugaenge.locator('li', { hasText: 'Anna Alpha' }).getByTestId('code').innerText()).replace(/\s/g, '');
  expect(annaCode).toMatch(/^\d{8}$/);
  // Helfer: Ben aus den Spielern wählen – er behält seine Kennung, bekommt aber Helferrecht
  const helferZugaenge = page.getByTestId('zugaenge-helfer');
  await helferZugaenge.locator('summary').click();
  await helferZugaenge.getByLabel('Aus Spielern wählen').check();
  await helferZugaenge.getByLabel('Spieler, der auch Helfer sein soll').selectOption({ label: 'Ben Beta' });
  await helferZugaenge.getByRole('button', { name: 'Helfer hinzufügen' }).click();
  await expect(helferZugaenge.locator('li', { hasText: 'Ben Beta' })).toContainText('Spieler und Helfer');
  const benCode = (await helferZugaenge.locator('li', { hasText: 'Ben Beta' }).getByTestId('code').innerText()).replace(/\s/g, '');
  await bild(page, '07-zugaenge');

  // Hilfe an der Turnierkennung: antippen (Handy/Tablet) bzw. darüberfahren (PC)
  const hilfe = page.getByRole('button', { name: 'Hilfe' }).first();
  if (info.project.use.hasTouch) await hilfe.tap();
  else await hilfe.hover();
  await expect(page.getByRole('tooltip').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);

  // Einstellungen: Erklärung, Sicherung jetzt senden
  await reiterOeffnen(page, 'Einstellungen');
  await expect(page.getByText(/Solange das Turnier auf mindestens einem Gerät geöffnet ist/)).toBeVisible();
  await expect(page.getByLabel('Empfänger (bis zu 3) 1')).toHaveValue(email);
  await page.getByLabel('Wie oft?').selectOption({ label: 'Alle 15 Minuten' });
  await page.getByLabel('Empfänger (bis zu 3) 2').fill(`helfer-${geraet}@example.org`);
  await page.locator('form', { has: page.getByLabel('Wie oft?') }).getByRole('button', { name: 'Speichern' }).click();
  // ab 0.17: neue Sparten senden in den ersten 7 Tagen nur an eigene Adressen – der Admin gibt die Sparte frei
  await expect(page.getByText(/in den ersten 7 Tagen nur an die eigenen Adressen/)).toBeVisible();
  await spartFreigeben(page, `TTC ${geraet} e. V.`);
  await page.locator('form', { has: page.getByLabel('Wie oft?') }).getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Gespeichert.')).toBeVisible();
  // ab 0.17: neue Adresse außerhalb der Leitung bestätigt erst per Link (Frage 14A)
  await expect(page.getByTestId('sicherung-unbestaetigt')).toContainText(`helfer-${geraet}@example.org`);
  const bestaetigen = /#\/sicherung\/[A-Z0-9-]+\/[a-f0-9]{64}/.exec(letzteMail(`helfer-${geraet}@example.org`, /Bitte bestätigen: Empfang von Turnier-Sicherungen/)?.text ?? '')?.[0];
  expect(bestaetigen).toBeTruthy();
  const turnierSeite = page.url();
  await page.goto(`./${bestaetigen}`);
  await page.getByTestId('sicherung-bestaetigen').click();
  await expect(page.getByTestId('sicherung-link')).toContainText('bekommt ab jetzt die Sicherungen');
  await page.goto(turnierSeite);
  await reiterOeffnen(page, 'Einstellungen');
  await expect(page.getByTestId('sicherung-unbestaetigt')).toHaveCount(0);
  await page.getByRole('button', { name: 'Jetzt per Mail sichern' }).click();
  await expect(page.getByText(/Sicherung gesendet an/)).toBeVisible();
  const sm = letzteMail(`helfer-${geraet}@example.org`, /Sicherung: Herbstpokal/);
  expect(sm?.anhang).toBe(true);
  expect(sm?.text).toContain('Warum diese Mail?');
  await bild(page, '08-einstellungen');

  // Zweites Gerät: „Turnier beitreten“ in zwei Schritten (Turnierkennung, dann eigene Kennung) als Co-Leitung Karl
  const u = info.project.use;
  const zweites = await browser.newContext({
    viewport: u.viewport,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    deviceScaleFactor: u.deviceScaleFactor,
    userAgent: u.userAgent,
    locale: 'de-DE',
  });
  const p2 = await zweites.newPage();
  await p2.goto('./');
  await p2.getByTestId('beitreten').click();
  // ab 0.17: Buchstaben und Ziffern, Groß/klein egal
  await p2.getByLabel('Turnierkennung', { exact: true }).fill(turnierKennung.toLowerCase());
  await expect(p2.getByLabel('Turnierkennung', { exact: true })).toHaveValue(turnierKennung);
  await bild(p2, '09a-beitreten');
  await p2.getByRole('button', { name: 'Weiter' }).click();
  await expect(p2.getByText(`Herbstpokal ${geraet}`)).toBeVisible();
  await p2.getByLabel('Deine Kennung, Block 1').fill(karlKennung.slice(0, 4));
  await p2.getByLabel('Deine Kennung, Block 2').fill(karlKennung.slice(4));
  await bild(p2, '09b-beitreten-kennung');
  await p2.getByTestId('mit-kennung').click();
  await expect(p2.getByText(/Willkommen, Co-Leitung Karl/)).toBeVisible();
  await expect(await reiterSichtbarMachen(p2, 'Zugänge')).toBeVisible();
  // Karl meldet sich ab und ist Zuschauer; dann kommt Anna über ihren persönlichen Link
  p2.once('dialog', (d) => void d.accept());
  await p2.getByRole('button', { name: 'Abmelden' }).click();
  await expect(p2.getByText('Mitmachen').first()).toBeVisible();
  await expect(p2.getByRole('link', { name: 'Zugänge' })).toHaveCount(0);
  await bild(p2, '09-zuschauer');
  await p2.goto(link.replace('#/t/', '#/c/') + '/' + annaCode);
  await expect(p2.getByText(/Willkommen, Anna Alpha/)).toBeVisible();
  await expect(p2.getByRole('link', { name: 'Meine Spiele' })).toHaveAttribute('aria-current', 'page');
  await expect(p2.getByTestId('spiel')).toHaveCount(3);
  await p2.getByTestId('spiel').first().click();
  const dialog = p2.getByRole('dialog');
  for (const [i, punkte] of [
    [1, '5'],
    [2, '7'],
    [3, '9'],
  ] as const) {
    await dialog
      .getByTestId(`satz-${i}`)
      .getByRole('radio', { name: /Anna Alpha/ })
      .click();
    await dialog.getByLabel(`Punkte des Verlierers Satz ${i}`).fill(punkte);
  }
  await expect(dialog.getByText('3:0 (11:5, 11:7, 11:9)')).toBeVisible();
  await bild(p2, '10-ergebnis-eingeben');
  await dialog.getByRole('button', { name: 'Ergebnis speichern' }).click();
  await expect(p2.getByText('vom Spieler eingetragen').first()).toBeVisible();

  // Leitung sieht das Ergebnis (mit Abgleich) in Spielen und Tabelle
  await page.getByRole('link', { name: 'Spiele', exact: true }).click();
  await page.getByRole('radio', { name: 'Gespielt' }).click();
  await expect(page.getByText('vom Spieler eingetragen')).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('link', { name: 'Tabellen' }).click();
  await expect(page.getByTestId('tabelle-A').locator('tbody tr').first()).toContainText('Anna Alpha');
  await bild(page, '11-tabelle');

  // Verdeckte Stände: Leitung verdeckt die Tabellen, Anna sieht nur den Hinweis; „Ergebnisse veröffentlichen“ hebt es auf
  await reiterOeffnen(page, 'Einstellungen');
  await page.getByLabel('Tabellen und Platzierungen zeigen').uncheck();
  await expect(page.getByText('Gespeichert.').first()).toBeVisible();
  await p2.getByRole('link', { name: 'Tabellen' }).click();
  await expect(p2.getByTestId('verdeckt')).toBeVisible({ timeout: 15_000 });
  await expect(p2.getByTestId('tabelle-A')).toHaveCount(0);
  await bild(p2, '11b-verdeckt');
  await page.getByRole('link', { name: 'Tabellen' }).click();
  await expect(page.getByTestId('tabelle-A')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('veroeffentlichen').click();
  await expect(p2.getByTestId('tabelle-A')).toBeVisible({ timeout: 15_000 });

  // Ben (Spieler und Helfer) trägt ein fremdes Spiel amtlich ein
  await p2.goto(link.replace('#/t/', '#/c/') + '/' + benCode);
  await expect(p2.getByText(/Willkommen, Ben Beta/)).toBeVisible();
  await expect(p2.getByTestId('angemeldet-als')).toContainText('Spieler und Helfer');
  await p2.getByRole('link', { name: 'Spiele', exact: true }).click();
  await p2.getByTestId('spiel').filter({ hasText: 'Cem Gamma' }).filter({ hasText: 'Dora Delta' }).first().click();
  const d2 = p2.getByRole('dialog');
  for (const [i, punkte] of [
    [1, '4'],
    [2, '6'],
    [3, '8'],
  ] as const) {
    await d2
      .getByTestId(`satz-${i}`)
      .getByRole('radio', { name: /Cem Gamma/ })
      .click();
    await d2.getByLabel(`Punkte des Verlierers Satz ${i}`).fill(punkte);
  }
  await d2.getByRole('button', { name: 'Ergebnis speichern' }).click();
  await expect(p2.getByRole('dialog')).toHaveCount(0);
  await p2.getByRole('radio', { name: 'Gespielt' }).click();
  const cemDora = p2.getByTestId('spiel').filter({ hasText: 'Cem Gamma' }).filter({ hasText: 'Dora Delta' });
  await expect(cemDora).toContainText('3:0');
  await expect(cemDora).not.toContainText(/eingetragen|bestätigen/); // amtlich: gilt sofort, keine Bestätigung nötig

  // Protokoll steht ganz unten in den Einstellungen
  await reiterOeffnen(page, 'Einstellungen');
  await page.locator('summary', { hasText: 'Protokoll' }).click();
  await expect(page.getByText(/von Anna Alpha \(Spieler\)/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/von Ben Beta \(Spieler und Helfer\)/)).toBeVisible({ timeout: 15_000 });
  await zweites.close();

  // Abmelden über das Kopfzeilen-Menü: danach ist das eigene Turnier nur noch lesbar (kein hängen gebliebenes Konto-Token)
  await page.getByRole('button', { name: 'Konto-Menü' }).click();
  await expect(page.getByRole('menuitem', { name: 'Meine Turniere' })).toBeVisible();
  await bild(page, '09-menue');
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page.getByTestId('anmelden')).toBeVisible();
  await page.goto(link);
  await expect(page.getByText(/Du bist abgemeldet und schaust nur zu/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zugänge' })).toHaveCount(0);
  await expect(page.getByText('Nicht angemeldet – Einträge werden nicht gesendet')).toHaveCount(0);
  await page.goto('./');

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
  // Wieder angemeldet: eigenes Turnier ist ohne weitere Anmeldung wieder leitbar
  await page.getByRole('button', { name: `Herbstpokal ${geraet}` }).click();
  await expect(await reiterSichtbarMachen(page, 'Zugänge')).toBeVisible();
  await expect(page.getByText('Verbunden')).toBeVisible();
  await page.goto('./');

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
  // Erste Frage „wirklich löschen?“, zweite „einzige Spartenleitung – Sparte mitlöschen?“
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
  await expect(page.getByText('Dein Konto wurde gelöscht.')).toBeVisible();
});

test('Demo ohne Server: Turnier nur auf diesem Gerät, Sicherung herunterladen und wiederherstellen', async ({ page }) => {
  await ohneServer(page);
  await page.goto('./');
  await expect(page.getByText(/Demo: Dieser Stand hat keinen Server/)).toBeVisible();
  await page.getByTestId('neues-turnier').click();
  // ohne Server gibt es keine Wahl: nur dieses Gerät
  await expect(page.getByLabel(/Mehrere Geräte/)).toHaveCount(0);
  await bild(page, '12-neu-ohne-server');
  await page.getByLabel('Name des Turniers').fill('Hallenturnier offline');
  await page.getByLabel(/^Dein Name/).fill('Sascha');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Hallenturnier offline' })).toBeVisible();
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  await page.getByLabel('Vorname').fill('Lotte');
  await page.getByLabel('Nachname').fill('Lokal');
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByText('Lotte Lokal ✓')).toBeVisible();

  await reiterOeffnen(page, 'Einstellungen');
  await expect(page.getByText(/Dieses Turnier liegt nur auf diesem Gerät/).first()).toBeVisible();
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
  await reiterOeffnen(page, /^Teilnehmer/);
  await expect(page.getByText('Lotte Lokal')).toBeVisible();
  await reiterOeffnen(page, 'Einstellungen');
  await page.locator('summary', { hasText: 'Protokoll' }).click();
  await expect(page.getByText(/Aus Sicherung wiederhergestellt/)).toBeVisible();
});

test('Einzelgerät: Gruppen + K.-o. mit Ergebnissen der Leitung, Stände verdeckt', async ({ page }) => {
  await ohneServer(page);
  await page.goto('./');
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill('Vereinsmeisterschaft');
  await page.getByLabel(/^Dein Name/).fill('Sascha');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  for (const [v, ttr] of [
    ['Ali', '1800'],
    ['Bea', '1700'],
    ['Cid', '1600'],
    ['Dan', '1500'],
    ['Eva', '1400'],
    ['Fin', '1300'],
  ]) {
    await page.getByLabel('Vorname').fill(v!);
    await page.getByLabel('Nachname').fill('Test');
    await page.getByRole('textbox', { name: 'TTR-Punkte' }).fill(ttr!);
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} Test ✓`)).toBeVisible();
  }
  await reiterOeffnen(page, 'Konkurrenzen');
  await page.getByLabel('Name', { exact: true }).fill('Offen');
  await page.getByLabel('Gewinnsätze').selectOption({ label: '2 Gewinnsätze (Best of 3)' });
  await page.getByLabel('Spieler je Gruppe (höchstens)').selectOption('3');
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  await page.getByRole('button', { name: 'Alle melden' }).click();
  await page.getByRole('button', { name: 'Auslosen' }).click();
  await expect(page.getByText('Gruppe B')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('starten').click();

  // Alle 6 Gruppenspiele: links gewinnt 2:0
  await page.getByRole('link', { name: 'Spiele', exact: true }).click();
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('spiel').first().click();
    const d = page.getByRole('dialog');
    for (const s of [1, 2]) {
      await d.getByTestId(`satz-${s}`).getByRole('radio').first().click();
      await d.getByLabel(`Punkte des Verlierers Satz ${s}`).fill('8');
    }
    await d.getByRole('button', { name: 'Ergebnis speichern' }).click();
    await expect(d).toBeHidden();
  }
  await expect(page.getByText('Keine Spiele in dieser Auswahl.')).toBeVisible();
  await page.getByRole('link', { name: 'Tabellen' }).click();
  await expect(page.getByTestId('tabelle-A')).toBeVisible();
  await bild(page, '18-gruppen');

  // Endrunde
  await reiterOeffnen(page, 'Konkurrenzen');
  await page.getByRole('button', { name: 'Endrunde auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Endrunde starten' }).click();
  await page.getByRole('link', { name: 'Tabellen' }).click();
  await expect(page.getByText('Halbfinale')).toBeVisible();
  await expect(page.getByText('Endspiel')).toBeVisible();
  await bild(page, '19-ko-baum');

  // Stände verdecken: die Leitung sieht weiter alles, bekommt aber den Hinweis und den Knopf
  await reiterOeffnen(page, 'Einstellungen');
  await page.getByLabel('Tabellen und Platzierungen zeigen').uncheck();
  await page.getByLabel('K.-o.-Baum zeigen').uncheck();
  await page.getByRole('link', { name: 'Tabellen' }).click();
  await expect(page.getByText(/Für Spieler und Zuschauer verdeckt/)).toBeVisible();
  await expect(page.getByTestId('tabelle-A')).toBeVisible();
  await bild(page, '20-verdeckt-leitung');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('veroeffentlichen').click();
  await expect(page.getByText(/Für Spieler und Zuschauer verdeckt/)).toHaveCount(0);
});

test('Einzelgerät: Konkurrenzen nach Leistungsklassen, klassenreine Gruppen', async ({ page }) => {
  await ohneServer(page);
  await page.goto('./');
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill('Klassenturnier');
  await page.getByLabel(/^Dein Name/).fill('Sascha');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  // Leistungsklasse als Spielerangabe einschalten
  await angabenSetzen(page, { angaben: ['Leistungsklasse'] });
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  for (const [v, kl] of [
    ['Ali', 'A'],
    ['Bea', 'A'],
    ['Cid', 'A'],
    ['Dan', 'B'],
    ['Eva', 'B'],
    ['Fin', 'B'],
    ['Gil', 'B'],
  ]) {
    await page.getByLabel('Vorname').fill(v!);
    await page.getByLabel('Nachname').fill('Test');
    await page.getByRole('combobox', { name: 'Leistungsklasse' }).fill(kl!);
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} Test ✓`)).toBeVisible();
  }
  // Assistent: je Klasse eine Konkurrenz
  await reiterOeffnen(page, 'Konkurrenzen');
  await page.getByTestId('klassen-assistent').click();
  await expect(page.getByTestId('klassen-vorschau')).toContainText('A');
  await expect(page.getByTestId('klassen-vorschau')).toContainText('B');
  await bild(page, '21-klassen-assistent');
  await page.getByTestId('klassen-anlegen').click();
  await expect(page.getByText(/^A · .*3 Teilnehmer/)).toBeVisible();
  await expect(page.getByText(/^B · .*4 Teilnehmer/)).toBeVisible();

  // Dritte Konkurrenz: alle gemeinsam, Gruppen aber nur aus gleicher Klasse
  await page.getByRole('button', { name: '+ Neue Konkurrenz' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Gemeinsam');
  await page.getByLabel('Spieler je Gruppe (höchstens)').selectOption('4');
  await page.getByLabel('Gruppen bilden aus').selectOption('klasse');
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  const gemeinsam = page.getByTestId('konkurrenz').filter({ hasText: 'Gemeinsam' });
  await gemeinsam.getByRole('button', { name: 'Alle melden' }).click();
  await expect(gemeinsam.getByRole('heading', { name: 'Meldungen (7)' })).toBeVisible();
  await gemeinsam.getByRole('button', { name: 'Auslosen' }).click();
  await expect(gemeinsam.getByText('Gruppe A')).toBeVisible();
  await expect(gemeinsam.getByText('Gruppe B')).toBeVisible();
  await bild(page, '22-klassenreine-gruppen');
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

test('Etappe 5: Doppel mit Trostrunde, Spielaufruf an Tische mit Schiedsrichter', async ({ page }) => {
  await ohneServer(page);
  await page.goto('./');
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill('Doppelturnier');
  await page.getByLabel(/^Dein Name/).fill('Sascha');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  // 2 Tische
  await angabenSetzen(page, { tische: '2' });
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  for (const v of ['Ali', 'Bea', 'Cid', 'Dan', 'Eva', 'Fin', 'Gil', 'Hal', 'Ida']) {
    await page.getByLabel('Vorname').fill(v);
    await page.getByLabel('Nachname').fill(v + 'son');
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} ${v}son ✓`)).toBeVisible();
  }
  await reiterOeffnen(page, 'Konkurrenzen');
  await page.getByLabel('Name', { exact: true }).fill('Herren-Doppel');
  await page.getByRole('radio', { name: 'Doppel', exact: true }).check();
  await page.getByRole('radio', { name: /^K\.-o\.-System/ }).check();
  await page.getByRole('checkbox', { name: 'Trostrunde' }).check();
  await bild(page, '23-doppel-form');
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  const konk = page.getByTestId('konkurrenz').filter({ hasText: 'Herren-Doppel' });
  // ein Paar von Hand, der Rest zufällig (einer bleibt übrig)
  await konk.getByLabel('Spieler 1').selectOption({ label: 'Ali Alison' });
  await konk.getByLabel('Spieler 2').selectOption({ label: 'Bea Beason' });
  await konk.getByTestId('paar-melden').click();
  await expect(konk.getByText('Ali Alison / Bea Beason')).toBeVisible();
  await konk.getByRole('button', { name: /zufällig zu Paaren/ }).click();
  await expect(konk.getByText('4 Paare')).toBeVisible();
  await bild(page, '24-doppel-paare');
  await konk.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await konk.getByTestId('starten').click();

  // Tische: erstes Spiel an Tisch 1 mit Schiedsrichter
  await page.getByRole('link', { name: 'Tische' }).click();
  await expect(page.getByTestId('tische').locator('li')).toHaveCount(2);
  await page.getByTestId('naechste').getByRole('button', { name: 'An Tisch 1' }).first().click();
  // Schiedsrichter: der erste vorgeschlagene freie Spieler (Paare sind zufällig)
  const srAuswahl = page.getByTestId('aufruf').getByLabel('Schiedsrichter');
  const sr = (await srAuswahl.locator('option').nth(1).textContent())!.trim();
  await srAuswahl.selectOption({ label: sr });
  await page.getByTestId('aufrufen').click();
  const tisch1 = page.getByTestId('tische').locator('li').first();
  await expect(tisch1).toContainText(`SR: ${sr}`);
  await expect(tisch1).toContainText('/');
  await bild(page, '25-tische');
  // Ergebnis direkt vom Tisch aus
  await tisch1.getByRole('button', { name: 'Ergebnis eintragen' }).click();
  const dlg = page.getByRole('dialog');
  for (const sz of [1, 2, 3]) {
    await dlg.getByTestId(`satz-${sz}`).getByRole('radio').first().click();
    await dlg.getByLabel(`Punkte des Verlierers Satz ${sz}`).fill('7');
  }
  await dlg.getByRole('button', { name: 'Ergebnis speichern' }).click();
  await expect(dlg).toBeHidden();
  await expect(tisch1).toContainText('frei');

  // Tabellen: Hauptrunde und Trostrunde
  await page.getByRole('link', { name: 'Tabellen' }).click();
  await expect(page.getByRole('heading', { name: 'Trostrunde', exact: true })).toBeVisible();
  await bild(page, '26-trostrunde');
});

test('Etappe 6: Schweizer System mit Vorgabe, Kaiserturnier', async ({ page }) => {
  await ohneServer(page);
  await page.goto('./');
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill('Vereinsmeisterschaft');
  await page.getByLabel(/^Dein Name/).fill('Sascha');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await page.getByRole('button', { name: '+ Neuer Teilnehmer' }).click();
  for (const [v, ttr] of [
    ['Ali', '1800'],
    ['Bea', '1700'],
    ['Cid', '1600'],
    ['Dan', '1500'],
    ['Eva', '1400'],
    ['Fin', '1300'],
  ]) {
    await page.getByLabel('Vorname').fill(v!);
    await page.getByLabel('Nachname').fill('Test');
    await page.getByRole('textbox', { name: 'TTR-Punkte' }).fill(ttr!);
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.getByText(`${v} Test ✓`)).toBeVisible();
  }
  // Schweizer System, 3 Runden, mit Vorgabe
  await reiterOeffnen(page, 'Konkurrenzen');
  await page.getByLabel('Name', { exact: true }).fill('Schweizer');
  await page.getByRole('radio', { name: /^Schweizer System/ }).check();
  await page.getByLabel('Gewinnsätze').selectOption({ label: '2 Gewinnsätze (Best of 3)' });
  await page.getByLabel('Anzahl Runden').fill('3');
  await page.getByRole('checkbox', { name: 'Vorgabeturnier' }).check();
  await expect(page.getByText(/Beispiel: 1500 gegen 1300 = 4 Punkte Vorgabe/)).toBeVisible();
  await bild(page, '27-schweizer-form');
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  const konk = page.getByTestId('konkurrenz').filter({ hasText: 'Schweizer' });
  await konk.getByRole('button', { name: 'Alle melden' }).click();
  await konk.getByRole('button', { name: 'Auslosen' }).click();
  await expect(konk.getByText('Startliste', { exact: true })).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await konk.getByTestId('starten').click();

  // Runde 1: Ali–Dan, Bea–Eva, Cid–Fin; Vorgabe für den Schwächeren
  await page.getByRole('link', { name: 'Spiele', exact: true }).click();
  await expect(page.getByTestId('spiel')).toHaveCount(3);
  await expect(page.getByTestId('spiel').first()).toContainText('Vorgabe Dan Test +6');
  await bild(page, '28-schweizer-spiele');
  for (let runde = 1; runde <= 3; runde++) {
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('spiel').first().click();
      const d = page.getByRole('dialog');
      if (runde === 1 && i === 0) await expect(d.getByTestId('vorgabe')).toContainText('Dan Test beginnt jeden Satz mit 6:0');
      for (const s of [1, 2]) {
        await d.getByTestId(`satz-${s}`).getByRole('radio').first().click();
        await d.getByLabel(`Punkte des Verlierers Satz ${s}`).fill('8');
      }
      await d.getByRole('button', { name: 'Ergebnis speichern' }).click();
      await expect(d).toBeHidden();
    }
  }
  await expect(page.getByText('Keine Spiele in dieser Auswahl.')).toBeVisible();
  await page.getByRole('link', { name: 'Tabellen' }).click();
  await expect(page.getByTestId('runde-stand')).toContainText('Runde 3 von 3');
  await expect(page.getByTestId('rangliste').locator('tbody tr')).toHaveCount(6);
  await expect(page.getByTestId('rangliste').locator('tbody tr').first()).toContainText('Ali Test');
  await bild(page, '29-schweizer-rangliste');

  // Kaiserturnier mit einem Gewinnsatz
  await reiterOeffnen(page, 'Konkurrenzen');
  await page.getByRole('button', { name: /Neue Konkurrenz/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Kaiser');
  await page.getByRole('radio', { name: /^Kaiserturnier/ }).check();
  await page.getByLabel('Gewinnsätze').selectOption({ label: '1 Gewinnsatz' });
  await page.getByLabel('Anzahl Runden').fill('2');
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();
  const ks = page.getByTestId('konkurrenz').filter({ hasText: 'Kaiser' });
  await ks.getByRole('button', { name: 'Alle melden' }).click();
  await ks.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await ks.getByTestId('starten').click();
  await page.getByRole('link', { name: 'Spiele', exact: true }).click();
  await expect(page.getByTestId('spiel').filter({ hasText: 'Kaisertisch' })).toHaveCount(1);
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('spiel').first().click();
    const d = page.getByRole('dialog');
    await d.getByTestId('satz-1').getByRole('radio').last().click(); // rechts gewinnt: Aufsteiger
    await d.getByLabel('Punkte des Verlierers Satz 1').fill('9');
    await d.getByRole('button', { name: 'Ergebnis speichern' }).click();
    await expect(d).toBeHidden();
  }
  await page.getByRole('link', { name: 'Tabellen' }).click();
  await page.getByRole('tab', { name: 'Kaiser' }).click();
  await expect(page.getByTestId('rangleiter').locator('tbody tr')).toHaveCount(6);
  await expect(page.getByTestId('rangleiter').locator('tbody tr').first()).toContainText('Kaiser');
  await bild(page, '30-kaiser');
});

/** Admin gibt die Online-Anmeldung/Sicherung einer neuen Sparte frei (über die Schnittstelle) */
async function spartFreigeben(page: Page, verein: string) {
  const api = new URL('api/index.php', page.url()).toString();
  const login = await page.request.post(`${api}?r=login`, { data: ADMIN });
  const token = (await login.json()).token as string;
  const sparten = (await (await page.request.get(`${api}?r=sparten`, { headers: { 'X-TT-Token': token } })).json()).sparten as { id: number; verein: string }[];
  const id = sparten.find((x) => x.verein === verein)!.id;
  const r = await page.request.post(`${api}?r=sparte.anmeldung`, { headers: { 'X-TT-Token': token }, data: { id, anmeldung: 'frei' } });
  expect(r.ok()).toBe(true);
}
