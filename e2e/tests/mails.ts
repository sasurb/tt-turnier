import { readdirSync, readFileSync } from 'node:fs';

const ORDNER = process.env.MAIL_ORDNER ?? '/tmp/tt-e2e/mails';

export interface GeleseneMail {
  an: string;
  betreff: string;
  text: string;
  anhang: boolean;
}

/** Liest die vom DateiMailer abgelegten Mails (neueste zuletzt). */
export function mails(): GeleseneMail[] {
  return readdirSync(ORDNER)
    .filter((f) => f.endsWith('.eml'))
    .sort()
    .map((f) => {
      const roh = readFileSync(`${ORDNER}/${f}`, 'utf8');
      const an = /^To: (.*)$/m.exec(roh)?.[1]?.trim() ?? '';
      const betreff = /^Subject: (.*)$/m.exec(roh)?.[1]?.trim() ?? '';
      // erster base64-Block nach einer Leerzeile = Text der Mail
      const teile = roh.split(/\r?\n\r?\n/);
      let text = '';
      for (const t of teile.slice(1)) {
        const b = t.split(/\r?\n--/)[0]!.replace(/\s+/g, '');
        if (/^[A-Za-z0-9+/=]+$/.test(b) && b.length > 8) {
          text = Buffer.from(b, 'base64').toString('utf8');
          break;
        }
      }
      return { an, betreff, text, anhang: /Content-Disposition: attachment/.test(roh) };
    });
}

export function letzteMail(an: string, betreff: RegExp): GeleseneMail | undefined {
  return mails().filter((m) => m.an === an && betreff.test(m.betreff)).at(-1);
}

export async function registrierlinkOeffnen(page: import('@playwright/test').Page, email: string) {
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Bestätigungslink anfordern' }).click();
  await page.getByRole('status').filter({ hasText: 'Bestätigungslink' }).waitFor();
  const link = letzteMail(email, /E-Mail-Adresse bestätigen/)?.text.match(/#\/aktivieren\/[a-f0-9]{64}(?:\/[a-zA-Z0-9_-]+)?/);
  if (!link) throw new Error('Bestätigungslink fehlt');
  await page.goto('./' + link[0]);
}
