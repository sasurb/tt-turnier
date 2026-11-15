/**
 * Abgleich mehrerer Geräte über die Android-Zentrale (Java-Kern im JDK).
 * Läuft nur, wenn TT_ZENTRALE gesetzt ist, z. B.:
 *   TT_ZENTRALE=http://127.0.0.1:8099/api/index.php npx vitest run zentrale.integration
 * Der Test läuft auf demselben Rechner wie die Zentrale und gilt damit als „Gerät der Zentrale“.
 */
import { describe, expect, it } from 'vitest';
import { ART } from '@shared/protokoll';
import { Api, ApiFehler } from './api';
import { SpeicherImArbeitsspeicher } from './speicher';
import { TurnierSitzung } from './turnier';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const basis = env.TT_ZENTRALE;

describe.skipIf(!basis)('Integration mit der Zentrale', () => {
  it('Gerät der Zentrale, Helferin und Spieler gleichen ab', async () => {
    const geheimnis = env.TT_ZENTRALE_GEHEIMNIS ?? null;
    const api = new Api(basis!, undefined, undefined, () => geheimnis);
    const info = await api.info();
    expect(info.protokoll).toBe(1);
    expect(info.zentrale).toBeTruthy();
    expect(info.registrierung).toBe(false);

    const konto = await api.zentraleAnmelden();
    const t = await api.turnierAnlegen(konto.token, {
      name: 'Hallenturnier',
      datum: '2026-12-01',
    });
    expect(t.turnier.id).toMatch(/^[0-9]{8}$/);
    const leitungB = await api.codesAnlegen(t.token, t.turnier.id, [{ rolle: 'leitung', bezug: 'l-b', name: 'Helferin B' }]);
    const zugangB = await api.turnierZugang(t.turnier.id, leitungB.codes.find((c) => c.bezug === 'l-b')!.code);
    const codes = await api.codesAnlegen(t.token, t.turnier.id, [{ rolle: 'spieler', bezug: 'sp1', name: 'Anna' }]);
    const anna = await api.turnierZugang(t.turnier.id, codes.codes.find((c) => c.bezug === 'sp1')!.code);
    expect(anna.rolle).toBe('spieler');
    expect(anna.spieler).toBe('sp1');

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
    expect(await texte(a)).toEqual(['von A|Zentrale', 'von B|Helferin B']);
    expect(await texte(b)).toEqual(await texte(a));
    expect(await texte(zuschauer)).toEqual(await texte(a));

    // Spieler dürfen nur Ergebnisse senden
    await expect(
      api.senden(t.turnier.id, anna.token, [
        {
          id: 'x-12345678',
          art: ART.testNotiz,
          daten: {},
          zeit: new Date().toISOString(),
          geraet: 'geraet-s',
        },
      ]),
    ).rejects.toBeInstanceOf(ApiFehler);

    // Status der Zentrale (nur vom Gerät selbst)
    const st = await api.zentraleStatus();
    expect(st.online.verbunden).toBe(false);
    const liste = await api.turniere(konto.token);
    expect(liste.turniere.some((x) => x.id === t.turnier.id && x.herkunft === 'zentrale')).toBe(true);
  });
});
