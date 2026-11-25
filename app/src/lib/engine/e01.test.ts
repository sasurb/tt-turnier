import { expect, it } from 'vitest';
import { ART } from '@shared/protokoll';
import { T } from '../texte';
import { Api } from './api';
import { SpeicherImArbeitsspeicher } from './speicher';
import { TestServer } from './test/testServer';
import { TurnierSitzung } from './turnier';

function aufbau() {
  const server = new TestServer();
  const speicher = new SpeicherImArbeitsspeicher();
  const tab = (token: () => string | null, name: string) => new TurnierSitzung({
    turnier: 't', modus: 'online', geraet: 'gemeinsam', speicher,
    autor: { rolle: 'spieler', name }, token, api: new Api('http://test.invalid/api/index.php', server.abruf),
  });
  return { server, speicher, tab };
}

it('F-030: Eintrag bleibt bei der beim Antippen verwendeten Sitzung, auch nach Reload', async () => {
  const { server, tab } = aufbau();
  let token = 'tok-a';
  const spieler = tab(() => token, 'Alva');
  server.offline = true;
  const gespeichert = spieler.eintragen(ART.testNotiz, { text: 'Ergebnis' });
  token = 'tok-b';
  const e = await gespeichert;
  server.offline = false;
  await spieler.abgleich!.durchlauf();
  expect(server.ereignisse).toHaveLength(0);
  await tab(() => 'tok-a', 'Alva').abgleich!.durchlauf();
  expect(server.ereignisse).toHaveLength(1);
  expect(server.ereignisse[0]).toMatchObject({ id: e.id, autor: { name: 'Gerät A' } });
});

it('F-014: fremde und abgemeldete Sitzung können die Ablehnung weder sehen noch verwerfen', async () => {
  const { speicher, tab } = aufbau();
  const a = tab(() => 'tok-a', 'Alva');
  const e = await a.eintragen(ART.testNotiz, {});
  await speicher.ablehnen('t', [{ id: e.id, meldung: 'abgelehnt' }]);
  for (const token of ['tok-b', null]) {
    const b = tab(() => token, 'Gast');
    expect(await b.ereignisse()).toEqual([]);
    await b.abgelehnteVerwerfen();
  }
  expect(await a.ereignisse()).toHaveLength(1);
  await a.abgelehnteVerwerfen();
  expect(await a.ereignisse()).toEqual([]);
});

it('F-032: amtliche Herkunft bei Leitung, Helfer und Spieler mit Helferrecht', () => {
  expect(T.erg.amtlicherEintrag({ rolle: 'leitung', name: 'L' })).toContain('Turnierleitung');
  for (const rolle of ['spieler', 'helfer'] as const) {
    expect(T.erg.amtlicherEintrag({ rolle, helfer: true, name: 'H' })).toContain('Helferrechten');
  }
});

it('F-033: bei fehlendem oder ausgeblendetem Namen erscheint nur die Uhrzeit', () => {
  for (const name of [undefined, '', ' ']) expect(T.erg.von(name, '14:35')).toBe('14:35');
  expect(T.erg.von('Alva', '14:35')).toBe('eingetragen von Alva, 14:35');
});

it.each([413, 429])('F-004: HTTP %i steuert erneuten Versand auch bei HTML-Fehlerseite', async (status) => {
  const server = new TestServer();
  let versuche = 0;
  const session = new TurnierSitzung({
    turnier: 't', modus: 'online', geraet: 'g', speicher: new SpeicherImArbeitsspeicher(),
    autor: { rolle: 'leitung', name: 'A' }, token: () => 'tok-a',
    api: new Api('http://test.invalid/', async (url, init) => {
      if (init.method === 'POST') {
        versuche++;
        return new Response('Problem', { status, headers: { 'Retry-After': '60' } });
      }
      return server.abruf(url, init);
    }),
  });
  await session.eintragen(ART.testNotiz, {});
  for (let i = 0; i < 4; i++) await session.abgleich!.durchlauf();
  expect(versuche).toBe(1);
  expect((await session.ereignisse())[0]?.status).toBe(status === 413 ? 'abgelehnt' : 'ausstehend');
});

it('F-014: gespeicherte Serverdaten und Lesestände sind pro Sitzung getrennt', async () => {
  const { server, speicher, tab } = aufbau();
  Object.assign(speicher, { sitzungsbereiche: true });
  server.mitSicht = true;
  const privat = tab(() => 'tok-a', 'A');
  await privat.eintragen(ART.spielerAngelegt, { id: 's', jahrgang: 2012 });
  await privat.abgleich!.durchlauf();
  const gast = tab(() => null, '');
  expect(await gast.ereignisse()).toEqual([]);
  await gast.abgleich!.durchlauf();
  expect((await gast.ereignisse())[0]?.daten.jahrgang).toBeUndefined();
  expect((await privat.ereignisse())[0]?.daten.jahrgang).toBe(2012);
  await speicher.loeschen('t');
  expect(await privat.ereignisse()).toEqual([]);
  expect(await gast.ereignisse()).toEqual([]);
});
