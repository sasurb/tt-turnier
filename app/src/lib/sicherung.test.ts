import { describe, expect, it } from 'vitest';
import { ART } from '@shared/protokoll';
import { codeAnzeige, codeEingabe, codeGueltig, neuerCode } from './code';
import { SpeicherImArbeitsspeicher } from './engine/speicher';
import { TurnierSitzung } from './engine/turnier';
import { dateiname, erinnerungFaellig, sicherungErstellen, sicherungLesen, SicherungFehler } from './sicherung';

describe('Leitungscode', () => {
  it('prüft wie der Server', () => {
    expect(codeGueltig('483920')).toBe(true);
    expect(codeGueltig('012946')).toBe(true);
    for (const schlecht of ['123456', '654321', '890123', '111111', '12345', '12345a', '']) expect(codeGueltig(schlecht)).toBe(false);
  });
  it('schlägt nur gültige Codes vor', () => {
    for (let i = 0; i < 500; i++) expect(codeGueltig(neuerCode())).toBe(true);
  });
  it('säubert Eingaben und zeigt lesbar an', () => {
    expect(codeEingabe(' 48 39-20 77')).toBe('483920');
    expect(codeAnzeige('483920')).toBe('483 920');
  });
});

describe('Sicherung', () => {
  it('erstellt, liest und stellt ein lokales Turnier vollständig wieder her', async () => {
    const quelle = new TurnierSitzung({ speicher: new SpeicherImArbeitsspeicher(), turnier: 'lquelle', modus: 'lokal', geraet: 'g-1', autor: { rolle: 'leitung', name: 'Sascha' } });
    await quelle.eintragen(ART.turnierAngelegt, { name: 'Pokal', datum: '2026-12-01' });
    await quelle.eintragen(ART.testNotiz, { text: 'eins' });
    await quelle.eintragen(ART.turnierAbgeschlossen, {});
    const s = sicherungErstellen({ id: 'lquelle', name: 'Pokal', datum: '2026-12-01', modus: 'lokal' }, await quelle.ereignisse(), new Date('2026-12-01T18:30:00Z'));
    expect(dateiname(s)).toBe('sicherung-pokal-20261201-1830.json');

    const gelesen = sicherungLesen(JSON.stringify(s));
    const ziel = new TurnierSitzung({ speicher: new SpeicherImArbeitsspeicher(), turnier: 'lziel', modus: 'lokal', geraet: 'g-2', autor: { rolle: 'leitung', name: 'Jana' } });
    expect(await ziel.importieren(gelesen.ereignisse)).toBe(3);
    expect(await ziel.importieren(gelesen.ereignisse)).toBe(0); // erneutes Einspielen verdoppelt nichts
    const z = await ziel.zustand();
    expect(z.name).toBe('Pokal');
    expect(z.abgeschlossen).toBe(true);
    expect(z.notizen.map((n) => `${n.text}|${n.von}`)).toEqual(['eins|Sascha']); // lokal bleibt der Autor erhalten
  });

  it('stellt online als ausstehende Einträge mit neuem Autor bereit', async () => {
    const speicher = new SpeicherImArbeitsspeicher();
    const ziel = new TurnierSitzung({
      speicher, turnier: 'onl1', modus: 'online', geraet: 'g-2', autor: { rolle: 'leitung', name: 'Jana' },
      api: {} as never, token: () => null,
    });
    await ziel.importieren([{ id: 'aaaaaaaa-1', art: ART.testNotiz, daten: { text: 'x' }, zeit: '2026-01-01T00:00:00Z', geraet: 'g-1', autor: { rolle: 'leitung', name: 'Alt' } }]);
    const [e] = await speicher.ausstehende('onl1');
    expect(e?.status).toBe('ausstehend');
    expect(e?.autor?.name).toBe('Jana');
  });

  it('weist fremde und beschädigte Dateien verständlich ab', () => {
    expect(() => sicherungLesen('kein json')).toThrow(SicherungFehler);
    expect(() => sicherungLesen('{"format":"anders"}')).toThrow(/keine Sicherung/);
    expect(() => sicherungLesen('{"format":"tt-turnier-sicherung","version":2}')).toThrow(/neueren App-Version/);
    expect(() =>
      sicherungLesen(JSON.stringify({ format: 'tt-turnier-sicherung', version: 1, turnier: { name: 'x' }, ereignisse: [{ id: 'x', art: 'a' }] })),
    ).toThrow(/beschädigt/);
  });

  it('erinnert nur nach Ablauf des Abstands und bei Änderungen', () => {
    const t0 = Date.parse('2026-12-01T10:00:00Z');
    const s = { takt: 30 as const, zuletzt: '2026-12-01T10:00:00Z', anzahl: 5 };
    expect(erinnerungFaellig(s, 6, '', t0 + 29 * 60_000)).toBe(false);
    expect(erinnerungFaellig(s, 6, '', t0 + 30 * 60_000)).toBe(true);
    expect(erinnerungFaellig(s, 5, '', t0 + 90 * 60_000)).toBe(false);
    expect(erinnerungFaellig({ ...s, takt: 0 }, 9, '', t0 + 90 * 60_000)).toBe(false);
    expect(erinnerungFaellig({ takt: 15, zuletzt: null, anzahl: 0 }, 1, '2026-12-01T10:00:00Z', t0 + 16 * 60_000)).toBe(true);
  });
});
