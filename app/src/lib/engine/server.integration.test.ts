/**
 * Abgleich zweier Geräte gegen einen echten Server (PHP).
 * Läuft nur, wenn TT_SERVER gesetzt ist, z. B.:
 *   TT_SERVER=http://localhost:8080/api/index.php TT_SETUP_CODE=… npx vitest run server.integration
 * In GitHub Actions startet der Workflow dafür „php -S“ mit SQLite bzw. MySQL.
 */
import { describe, expect, it } from 'vitest';
import { ART } from '@shared/protokoll';
import { Api } from './api';
import { SpeicherImArbeitsspeicher } from './speicher';
import { TurnierSitzung } from './turnier';

// Umgebungsvariablen ohne Node-Typen lesen (die App selbst läuft im Browser)
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const basis = env.TT_SERVER;
const code = env.TT_SETUP_CODE ?? 'einrichtung-123456';

describe.skipIf(!basis)('Integration mit echtem Server', () => {
  it('zwei Geräte gleichen über den Server ab', async () => {
    const api = new Api(basis!);
    const info = await api.info();
    expect(info.protokoll).toBe(1);
    const zufall = Math.random().toString(36).slice(2, 8);
    if (!info.eingerichtet) {
      await api.setup({ code, name: 'Admin', email: `admin-${zufall}@example.org`, passwort: 'admin-passwort' });
    }
    // Admin anmelden: bei bereits eingerichtetem Server über Umgebungsvariablen
    const adminMail = env.TT_ADMIN_EMAIL ?? `admin-${zufall}@example.org`;
    const adminPw = env.TT_ADMIN_PASSWORT ?? 'admin-passwort';
    const admin = await api.login(adminMail, adminPw);
    await api.kontoAnlegen(admin.token, { name: 'TTC Test', email: `v-${zufall}@example.org`, passwort: 'veranst-pw' });
    const v = await api.login(`v-${zufall}@example.org`, 'veranst-pw');
    const t = await api.turnierAnlegen(v.token, { name: 'Integrationstest', datum: '2026-12-01', leitungsCode: '583920' });
    const zugangB = await api.turnierZugang(t.turnier.id, '583920', 'Helferin B');

    const geraet = (name: string, token: string | null) =>
      new TurnierSitzung({
        speicher: new SpeicherImArbeitsspeicher(),
        turnier: t.turnier.id,
        modus: 'online',
        geraet: 'geraet-' + name,
        autor: { rolle: 'leitung', name },
        api,
        token: () => token,
      });
    const a = geraet('a', t.token);
    const b = geraet('b', zugangB.token);
    const zuschauer = geraet('z', null);

    await a.eintragen(ART.testNotiz, { text: 'von A' });
    await b.eintragen(ART.testNotiz, { text: 'von B' });
    await a.abgleich!.durchlauf();
    await b.abgleich!.durchlauf();
    await a.abgleich!.durchlauf();
    await zuschauer.abgleich!.durchlauf();

    const texte = async (s: TurnierSitzung) => (await s.zustand()).notizen.map((n) => `${n.text}|${n.von}`);
    expect(await texte(a)).toEqual(['von A|TTC Test', 'von B|Helferin B']);
    expect(await texte(b)).toEqual(await texte(a));
    expect(await texte(zuschauer)).toEqual(await texte(a));
  });
});
