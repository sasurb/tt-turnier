import { expect, test, type Locator, type Page } from '@playwright/test';
import { angabenSetzen } from './hilfen';
import { mkdirSync } from 'node:fs';
import { ADMIN } from './einrichten';
import { letzteMail } from './mails';

/**
 * Etappe 9: Online-Anmeldung mit Bestätigung und Warteliste, Übernahme ins Turnier, Check-in,
 * Startgeld mit Quittung und GiroCode, Aufgaben für Helfer (Kasse), Mitteilung bei Spielaufruf –
 * auf Handy, Tablet und PC.
 */

async function bild(page: Page, name: string) {
  const ordner = `bilder/${test.info().project.name}`;
  mkdirSync(ordner, { recursive: true });
  await page.screenshot({ path: `${ordner}/${name}.png`, fullPage: true });
}

/** Keine waagerechten Scrollbalken; Bedienelemente mindestens 44 px hoch */
async function layoutPruefen(page: Page, bereich?: Locator) {
  const breit = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
  expect(breit, 'waagerechter Scrollbalken').toBeLessThanOrEqual(1);
  if (!bereich) return;
  const zuKlein = await bereich.locator('button:visible:not(.knopf-hilfe), select:visible, a.knopf:visible, input:visible:not([type=checkbox]):not([type=radio])').evaluateAll((els) =>
    els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().height)}px`),
  );
  expect(zuKlein, 'Touch-Ziele unter 44 px').toEqual([]);
}

function linkAus(text: string | undefined): string {
  const m = /(http:\/\/127\.0\.0\.1:\d+\/#\/meldung\/[A-Z0-9-]+\/[a-f0-9]{64})/.exec(text ?? '');
  expect(m, 'Link in der Mail').not.toBeNull();
  return m![1]!;
}

test('Online-Anmeldung, Warteliste, Übernahme, Kasse mit Quittung, Helfer mit Aufgabe Kasse, Aufruf aufs Handy', async ({ page, browser }, info) => {
  const geraet = info.project.name;
  const mail = (n: string) => `${n}.${geraet}@example.org`;
  await page.goto('./#/anmelden');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.passwort);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByTestId('neues-turnier').click();
  await page.getByLabel('Name des Turniers').fill(`Frühjahrscup ${geraet}`);
  await page.getByLabel('Datum').fill('2027-03-20');
  await page.getByRole('button', { name: 'Turnier anlegen' }).click();
  await expect(page.getByText('Verbunden')).toBeVisible();
  const tid = page.url().match(/#\/t\/([A-Z0-9-]+)/)![1]!;

  // Ein Tisch, Konkurrenz mit Startgeld und Höchstzahl 2
  await angabenSetzen(page, { tische: '1' });
  await page.getByRole('link', { name: 'Konkurrenzen' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Herren');
  await page.getByLabel(/Jeder gegen jeden/).check();
  await page.getByTestId('startgeld').fill('8');
  await page.getByTestId('max-teilnehmer').fill('2');
  await page.getByRole('button', { name: 'Konkurrenz anlegen' }).click();

  // Kasse und Quittung einrichten (Bankverbindung für den GiroCode)
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  const kasse = page.getByTestId('kasse-einstellungen');
  await kasse.getByLabel('Aussteller (Verein)').fill('TTC Frühling e. V.');
  await kasse.getByLabel('Kontoinhaber').fill('TTC Frühling e. V.');
  await kasse.getByTestId('kasse-iban').fill('DE89 3704 0044 0532 0130 01');
  await expect(kasse.getByText('Die IBAN ist ungültig')).toBeVisible();
  await kasse.getByTestId('kasse-iban').fill('DE89 3704 0044 0532 0130 00');
  await kasse.getByLabel('Umsatzsteuer-Hinweis').selectOption('befreit');
  await kasse.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Kasse und Quittung gespeichert.')).toBeVisible();

  // Online-Anmeldung öffnen
  await page.getByRole('link', { name: /^Teilnehmer/ }).click();
  await page.getByTestId('abschnitt-anmeldungen').locator('summary').first().click();
  await page.getByTestId('anmeldung-oeffnen').click();
  await expect(page.getByTestId('anmeldung-status')).toHaveText('Anmeldung geöffnet');
  const link = await page.getByTestId('anmeldung-link').inputValue();
  expect(link).toContain(`#/meldung/${tid}`);
  await layoutPruefen(page, page.locator('main'));
  await bild(page, '90-anmeldung-leitung');

  // Spielerin meldet sich über den Link an (ohne Anmeldung, eigener Browser)
  const oeffentlich = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const p = await oeffentlich.newPage();
  await p.goto(`./#/meldung/${tid}`);
  await expect(p.getByRole('heading', { name: `Frühjahrscup ${geraet}` })).toBeVisible();
  await expect(p.getByText('noch 2 Plätze frei')).toBeVisible();
  await p.getByLabel('Vorname').fill('Ada');
  await p.getByLabel('Nachname').fill('Aufschlag');
  await p.getByLabel('Verein (freiwillig)').fill('TSV Ost');
  await p.getByLabel('E-Mail-Adresse').fill(mail('ada'));
  await expect(p.getByTestId('meldung-konkurrenz')).toBeChecked(); // einzige Konkurrenz ist vorausgewählt
  await expect(p.getByTestId('meldung-senden')).toBeDisabled();
  await p.getByTestId('meldung-datenschutz').check();
  await p.getByTestId('meldung-volljaehrig').check();
  await layoutPruefen(p, p.locator('main'));
  await bild(p, '91-anmeldeformular');
  await p.getByTestId('meldung-senden').click();
  await expect(p.getByTestId('meldung-gesendet')).toBeVisible();
  // Bestätigungslink aus der Mail
  await expect.poll(() => letzteMail(mail('ada'), /Bitte bestätigen/)?.text ?? '').toContain('#/meldung/');
  await p.goto(linkAus(letzteMail(mail('ada'), /Bitte bestätigen/)?.text));
  // Der Link allein bestätigt nicht (Mail-Scanner) – erst der Knopf
  await expect(p.getByTestId('meldung-stand')).toContainText('noch nicht bestätigt');
  await p.getByTestId('meldung-jetzt-bestaetigen').click();
  await expect(p.getByTestId('meldung-bestaetigt')).toBeVisible();
  await expect(p.getByTestId('meldung-stand')).toContainText('Platz sicher');
  await expect(p.getByText('Startgeld: 8,00 €')).toBeVisible();
  await expect(p.getByRole('img', { name: 'GiroCode für die Überweisung' })).toBeVisible();
  await layoutPruefen(p, p.locator('main'));
  await bild(p, '92-anmeldung-bestaetigt');
  const adaLink = p.url();

  // Zwei weitere über die Schnittstelle: Ben bekommt den letzten Platz, Cem kommt auf die Warteliste
  for (const n of ['ben', 'cem']) {
    const r = await p.evaluate(
      async ([t, e, v]) =>
        (
          await fetch('api/index.php?r=anmeldung.senden', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ turnier: t, vorname: v, nachname: 'Netz', verein: '', email: e, konkurrenzen: [{ id: '' }], volljaehrig: true, datenschutz: true }),
          })
        ).status,
      [tid, mail(n), n.toUpperCase()],
    );
    expect(r).toBe(400); // unbekannte Konkurrenz
  }
  const konkId = await p.evaluate(async (t) => ((await (await fetch(`api/index.php?r=anmeldung&turnier=${t}`)).json()) as { einstellungen: { konkurrenzen: { id: string }[] } }).einstellungen.konkurrenzen[0]!.id, tid);
  for (const n of ['ben', 'cem']) {
    const r = await p.evaluate(
      async ([t, e, v, k, jung]) =>
        (
          await fetch('api/index.php?r=anmeldung.senden', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ turnier: t, vorname: v, nachname: 'Netz', verein: '', email: e, konkurrenzen: [{ id: k }], volljaehrig: jung !== 'x', datenschutz: true }),
          })
        ).status,
      [tid, mail(n), n === 'ben' ? 'Ben' : 'Cem', konkId, n === 'cem' ? '1' : '0'],
    );
    expect(r).toBe(200);
    await expect.poll(() => letzteMail(mail(n), /Bitte bestätigen/)?.text ?? '').toContain('#/meldung/');
    await p.goto(linkAus(letzteMail(mail(n), /Bitte bestätigen/)?.text));
    await p.getByTestId('meldung-jetzt-bestaetigen').click();
    await expect(p.getByTestId('meldung-stand')).toContainText(n === 'ben' ? 'Platz sicher' : 'Warteliste – Platz 1');
  }

  // Hinweis-Mail an die Leitung (seit 0.13): ohne Namen der Angemeldeten
  await expect.poll(() => letzteMail(ADMIN.email, new RegExp(`Neue Anmeldung: Frühjahrscup ${geraet}`))?.text ?? '').toContain('Bestätigte Anmeldungen insgesamt');
  expect(letzteMail(ADMIN.email, new RegExp(`Neue Anmeldung: Frühjahrscup ${geraet}`))!.text).not.toContain('Netz');

  // Leitung: Liste mit Warteliste, Übernahme ins Turnier
  await page.reload();
  const liste = page.getByTestId('anmeldung-liste');
  await expect(liste.locator(':scope > li')).toHaveCount(3);
  await expect(liste).toContainText(mail('cem'));
  await expect(liste.locator('li', { hasText: 'Cem Netz' })).toContainText('Warteliste 1');
  await expect(liste.locator('li', { hasText: 'Cem Netz' })).toContainText('unter 18');
  await page.getByTestId('anmeldung-uebernehmen').click();
  await expect(page.getByText(/Änderung\(en\) übernommen/)).toBeVisible();
  await expect(liste.locator('li', { hasText: 'Ada Aufschlag' })).toContainText('im Turnier');
  await layoutPruefen(page, page.locator('main'));
  await bild(page, '93-anmeldungen-liste');

  // Ada meldet sich ab → Cem rückt nach (Mail) → erneut übernehmen streicht Ada und meldet Cem
  await p.goto(adaLink);
  p.once('dialog', (d) => void d.accept());
  await p.getByTestId('meldung-abmelden').click();
  await expect(p.getByTestId('meldung-stand')).toContainText('abgemeldet');
  await expect.poll(() => letzteMail(mail('cem'), /Nachgerückt/)?.text ?? '').toContain('Platz sicher');
  await page.reload();
  await page.getByTestId('anmeldung-uebernehmen').click();
  await expect(page.getByText(/Änderung\(en\) übernommen/)).toBeVisible();

  // Kasse: Ada ist gestrichen (kein Startgeld), Cem nachgerückt; Check-in, 8 € bar, Quittung
  await page.getByRole('link', { name: 'Kasse & Check-in', exact: true }).click();
  await expect(page.getByTestId('kasse-liste').locator('li', { hasText: 'Ada Aufschlag' })).toContainText('Kein Startgeld');
  await expect(page.getByTestId('kasse-liste').locator('li', { hasText: 'Cem Netz' })).toContainText('Offen: 8,00 €');
  const zeile = page.getByTestId('kasse-liste').locator('li', { hasText: 'Ben Netz' });
  await expect(zeile).toContainText('Offen: 8,00 €');
  await zeile.getByTestId('checkin').click();
  await expect(zeile.getByTestId('checkin')).toHaveText('✓ Da');
  await zeile.getByTestId('kassieren').click();
  await expect(zeile.getByTestId('kasse-betrag')).toHaveValue('8,00');
  await layoutPruefen(page, page.locator('main'));
  await bild(page, '94-kasse');
  await zeile.getByTestId('kasse-buchen').click();
  await expect(zeile).toContainText('✓ Bezahlt 8,00 €');
  await zeile.getByTestId('kassieren').click();
  await zeile.getByRole('link', { name: 'Quittung' }).click();
  const q = page.getByTestId('quittung');
  await expect(q).toContainText(/Q-[A-Z0-9]{4}-[A-Z0-9]+/);
  await expect(q).toContainText('8,00 €');
  await expect(q).toContainText('Ben Netz');
  await expect(q).toContainText('§ 4 Nr. 22 b UStG');
  await layoutPruefen(page);
  await bild(page, '95-quittung');
  await page.getByRole('link', { name: /Zurück/ }).click();

  // Zuschauer sehen weder Zahlungen noch Check-in noch Bankverbindung
  const roh = await p.evaluate(async (t) => (await fetch(`api/index.php?r=events&turnier=${t}&ab=0`)).text(), tid);
  expect(roh).not.toContain('startgeld.gebucht');
  expect(roh).not.toContain('teilnehmer.eingecheckt');
  expect(roh).not.toContain('DE89');
  await oeffentlich.close();

  // Helfer mit Aufgabe „Kasse“
  await page.getByRole('link', { name: 'Zugänge' }).click();
  const helfer = page.getByTestId('zugaenge-helfer');
  await helfer.locator('summary').click();
  await helfer.getByLabel('Name des Helfers').fill('Eva Kasse');
  await helfer.getByTestId('helfer-vorlage').selectOption({ label: 'Kasse (Check-in und Startgeld)' });
  await helfer.getByRole('button', { name: 'Helfer hinzufügen' }).click();
  const eva = helfer.locator('li', { hasText: 'Eva Kasse' });
  await expect(eva.getByTestId('aufgaben').getByRole('button', { name: '✓ Kasse & Check-in' })).toBeVisible();
  await expect(eva.getByTestId('aufgaben').getByRole('button', { name: 'Ergebnisse', exact: true })).toBeVisible();
  const evaCode = (await eva.getByTestId('code').innerText()).replace(/\s/g, '');
  await layoutPruefen(page, helfer);
  await bild(page, '96-helfer-aufgaben');
  const spielerZugaenge = page.getByTestId('zugaenge-spieler');
  await spielerZugaenge.locator('summary').click();
  await expect(spielerZugaenge.getByTestId('code')).toHaveCount(3);
  const cemCode = (await spielerZugaenge.locator('li', { hasText: 'Cem Netz' }).getByTestId('code').innerText()).replace(/\s/g, '');

  const k2 = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const h = await k2.newPage();
  await h.goto(`./#/c/${tid}/${evaCode}`);
  await expect(h.getByTestId('angemeldet-als')).toContainText('Eva Kasse');
  await expect(h.getByRole('link', { name: 'Kasse & Check-in', exact: true })).toBeVisible();
  await expect(h.getByRole('link', { name: 'Zugänge' })).toHaveCount(0);
  const cemZeile = h.getByTestId('kasse-liste').locator('li', { hasText: 'Cem Netz' });
  await cemZeile.getByTestId('checkin').click();
  await expect(cemZeile.getByTestId('checkin')).toHaveText('✓ Da');
  await expect(h.getByTestId('kasse-checkin')).toContainText('2 von 2');
  await bild(h, '97-helfer-kasse');
  await k2.close();

  // Spieler Cem: Aufruf aufs Handy, sobald sein Spiel an den Tisch kommt
  const k3 = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const s = await k3.newPage();
  await s.goto(`./#/c/${tid}/${cemCode}`);
  await expect(s.getByTestId('mitteilung')).toBeVisible();
  await layoutPruefen(s, s.getByTestId('mitteilung'));
  await bild(s, '98-mitteilung');
  await s.getByRole('link', { name: 'Spiele', exact: true }).click();

  await page.getByRole('link', { name: 'Konkurrenzen' }).click();
  await page.getByRole('button', { name: 'Auslosen' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('starten').click();
  await page.getByRole('link', { name: 'Tische', exact: true }).click();
  const einst = page.getByTestId('aufruf-einstellungen');
  await einst.locator('summary').click();
  await einst.getByTestId('automatisch').check();
  await expect(page.getByTestId('tische').locator('li').first()).toContainText('–');
  await expect(s.getByTestId('aufruf-hinweis')).toContainText('Tisch 1', { timeout: 20_000 });
  await layoutPruefen(s);
  await bild(s, '99-aufruf-hinweis');
  await k3.close();
});
