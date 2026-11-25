import { sitzungsbindung } from './sitzungsbindung';
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ART } from '@shared/protokoll';
import { Api } from './api';
import { neueId, lokaleTurnierId } from './ids';
import { SpeicherImArbeitsspeicher, SpeicherIndexedDb } from './speicher';
import { TestServer } from './test/testServer';
import { TurnierSitzung } from './turnier';
import { sortieren, type LokalesEreignis } from './typen';
import { berechnen } from './zustand';

function geraet(server: TestServer, name: 'a' | 'b', token: string | null = `tok-${name}`) {
  const speicher = new SpeicherImArbeitsspeicher();
  const sitzung = new TurnierSitzung({
    speicher,
    turnier: 'turnier001',
    modus: 'online',
    geraet: `geraet-${name}`,
    autor: { rolle: 'leitung', name: `Gerät ${name.toUpperCase()}` },
    api: new Api('http://test.invalid/api/index.php', server.abruf),
    token: () => token,
  });
  return { speicher, sitzung };
}

describe('IDs', () => {
  it('erzeugt eindeutige UUIDs und lokale Turnier-IDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, neueId));
    expect(ids.size).toBe(1000);
    expect(neueId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(lokaleTurnierId()).toMatch(/^l[0-9a-f]{11}$/);
  });
});

describe('Reihenfolge', () => {
  it('bestätigte nach Laufnummer, ausstehende danach nach Zeit', () => {
    const e = (id: string, seq: number | null, zeit: string): LokalesEreignis => ({
      id, seq, zeit, art: 'x', daten: {}, geraet: 'g', turnier: 't', status: seq ? 'bestaetigt' : 'ausstehend', empfangen: null, autor: null,
    });
    const r = sortieren([e('d', null, '2026-01-02'), e('b', 5, '2026-01-09'), e('c', null, '2026-01-01'), e('a', 2, '2026-01-10')]);
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('Einzelgerät-Betrieb', () => {
  it('trägt ohne Server ein und berechnet den Stand', async () => {
    const speicher = new SpeicherImArbeitsspeicher();
    const t = new TurnierSitzung({
      speicher, turnier: 'lokal1', modus: 'lokal', geraet: 'g-1', autor: { rolle: 'leitung', name: 'Sascha' },
    });
    expect(t.abgleich).toBeNull();
    await t.eintragen(ART.turnierAngelegt, { name: 'Hobbyturnier', datum: '2026-12-01' });
    await Promise.all([t.eintragen(ART.testNotiz, { text: 'eins' }), t.eintragen(ART.testNotiz, { text: 'zwei' })]);
    const liste = await t.ereignisse();
    expect(liste.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(liste.every((e) => e.status === 'lokal')).toBe(true);
    const z = await t.zustand();
    expect(z.name).toBe('Hobbyturnier');
    expect(z.notizen.map((n) => `${n.text}/${n.von}`)).toEqual(['eins/Sascha', 'zwei/Sascha']);
  });

  it('überspringt unbekannte Ereignis-Arten', () => {
    const z = berechnen([
      { id: '1', art: 'zukunft.unbekannt', daten: {}, zeit: '', geraet: 'g', turnier: 't', status: 'lokal', seq: 1, empfangen: null, autor: null },
    ]);
    expect(z.anzahlEreignisse).toBe(1);
  });
});

describe('Sicht beim Abholen (Datenschutz)', () => {
  it('Zuschauer bekommen gefilterte Daten; nach der Anmeldung wird alles neu abgeholt', async () => {
    const server = new TestServer();
    server.mitSicht = true;
    const a = geraet(server, 'a');
    await a.sitzung.eintragen(ART.spielerAngelegt, { id: 's1', vorname: 'Lea', nachname: 'Löwe', verein: 'TSV', jahrgang: 2012 });
    await a.sitzung.abgleich!.durchlauf();
    let token: string | null = null;
    const speicher = new SpeicherImArbeitsspeicher();
    const z = new TurnierSitzung({
      speicher, turnier: 'turnier001', modus: 'online', geraet: 'geraet-z', autor: { rolle: 'zuschauer', name: '' },
      api: new Api('http://test.invalid/api/index.php', server.abruf), token: () => token,
    });
    await z.abgleich!.durchlauf();
    let liste = await speicher.alle('turnier001');
    expect(liste).toHaveLength(1);
    expect((liste[0]!.daten as Record<string, unknown>).jahrgang).toBeUndefined();
    expect(liste[0]!.autor?.name).toBe('');
    expect(await speicher.sicht('turnier001')).toBe('zuschauer');
    // Anmeldung (z. B. Spielerkennung): ausstehender Eintrag bleibt, Bestand wird voll neu geladen
    token = 'tok-b';
    await z.eintragen(ART.testNotiz, { text: 'von Z' });
    await z.abgleich!.durchlauf();
    liste = await speicher.alle('turnier001');
    expect(liste.map((e) => e.art)).toEqual([ART.spielerAngelegt, ART.testNotiz]);
    expect((liste[0]!.daten as Record<string, unknown>).jahrgang).toBe(2012);
    expect(liste[0]!.autor?.name).toBe('Gerät A');
    expect(await speicher.sicht('turnier001')).toBe('voll');
    // Abmelden: wieder nur die Zuschauer-Sicht
    token = null;
    await z.abgleich!.durchlauf();
    liste = await speicher.alle('turnier001');
    expect((liste[0]!.daten as Record<string, unknown>).jahrgang).toBeUndefined();
    expect(liste).toHaveLength(2);
  });

  it('Token ohne Rechte: nichts Gefiltertes übernehmen, Oberfläche wird benachrichtigt', async () => {
    const server = new TestServer();
    server.mitSicht = true;
    const a = geraet(server, 'a');
    await a.sitzung.eintragen(ART.spielerAngelegt, { id: 's1', vorname: 'Lea', nachname: 'Löwe', verein: 'TSV', jahrgang: 2012 });
    await a.sitzung.abgleich!.durchlauf();
    // Gerät B hatte Rechte (voller Bestand), dann wird seine Kennung gesperrt
    let verloren = 0;
    const speicher = new SpeicherImArbeitsspeicher();
    const b = new TurnierSitzung({
      speicher, turnier: 'turnier001', modus: 'online', geraet: 'geraet-b', autor: { rolle: 'leitung', name: 'B' },
      api: new Api('http://test.invalid/api/index.php', server.abruf), token: () => 'tok-b', beiRechteVerlust: () => verloren++,
    });
    await b.abgleich!.durchlauf();
    expect((await speicher.alle('turnier001'))[0]!.daten).toMatchObject({ jahrgang: 2012 });
    server.tokens.delete('tok-b');
    await b.abgleich!.durchlauf();
    expect(verloren).toBe(1);
    expect(b.status?.verbindung).toBe('nicht_angemeldet');
    expect((await speicher.alle('turnier001'))[0]!.daten).toMatchObject({ jahrgang: 2012 });
    expect(await speicher.sicht('turnier001')).toBe('voll');
  });

  it('IndexedDB: Sicht und Laufnummer bleiben getrennt erhalten, Verwerfen behält Ausstehende', async () => {
    const s = new SpeicherIndexedDb('sicht-test-' + Math.random());
    await s.setzeAbgeholtBis('t', 7);
    await s.setzeSicht('t', 'kurz');
    expect(await s.abgeholtBis('t')).toBe(7);
    expect(await s.sicht('t')).toBe('kurz');
    const e = (id: string, status: LokalesEreignis['status']): LokalesEreignis => ({
      id, seq: status === 'ausstehend' ? null : 1, zeit: '2026-01-01', art: 'x', daten: {}, geraet: 'g', turnier: 't', status, empfangen: null, autor: null,
    });
    await s.uebernehmen([e('b1', 'bestaetigt'), e('a1', 'ausstehend')]);
    await s.bestaetigteVerwerfen('t');
    expect((await s.alle('t')).map((x) => x.id)).toEqual(['a1']);
    expect(await s.abgeholtBis('t')).toBe(0);
    expect(await s.sicht('t')).toBe('kurz');
  });
});

describe('Online-Abgleich zwischen zwei Geräten', () => {
  it('Eintrag auf A erscheint auf B, mit Autor vom Server', async () => {
    const server = new TestServer();
    const a = geraet(server, 'a');
    const b = geraet(server, 'b');
    await a.sitzung.eintragen(ART.testNotiz, { text: 'Hallo von A' });
    expect((await a.speicher.alle('turnier001'))[0]!.status).toBe('ausstehend');
    await a.sitzung.abgleich!.durchlauf();
    await b.sitzung.abgleich!.durchlauf();
    const aufB = await b.speicher.alle('turnier001');
    expect(aufB).toHaveLength(1);
    expect(aufB[0]!.status).toBe('bestaetigt');
    expect(aufB[0]!.autor?.name).toBe('Gerät A');
    expect((await a.speicher.alle('turnier001'))[0]!.status).toBe('bestaetigt');
    expect(a.sitzung.status?.verbindung).toBe('verbunden');
  });

  it('puffert offline und sendet nach Rückkehr ohne Doppelung', async () => {
    const server = new TestServer();
    const a = geraet(server, 'a');
    const b = geraet(server, 'b');
    server.offline = true;
    await a.sitzung.eintragen(ART.testNotiz, { text: '1' });
    await a.sitzung.eintragen(ART.testNotiz, { text: '2' });
    await a.sitzung.abgleich!.durchlauf();
    expect(a.sitzung.status).toMatchObject({ verbindung: 'offline', ausstehend: 2 });
    server.offline = false;
    await a.sitzung.abgleich!.durchlauf();
    await a.sitzung.abgleich!.durchlauf(); // erneuter Durchlauf darf nichts verdoppeln
    await b.sitzung.abgleich!.durchlauf();
    expect(server.ereignisse).toHaveLength(2);
    expect((await b.sitzung.zustand()).notizen.map((n) => n.text)).toEqual(['1', '2']);
    expect(a.sitzung.status).toMatchObject({ verbindung: 'verbunden', ausstehend: 0 });
  });

  it('gleichzeitige Einträge landen auf beiden Geräten in derselben Reihenfolge', async () => {
    const server = new TestServer();
    const a = geraet(server, 'a');
    const b = geraet(server, 'b');
    await a.sitzung.eintragen(ART.testNotiz, { text: 'A1' });
    await b.sitzung.eintragen(ART.testNotiz, { text: 'B1' });
    await b.sitzung.abgleich!.durchlauf();
    await a.sitzung.abgleich!.durchlauf();
    await b.sitzung.abgleich!.durchlauf();
    const ta = (await a.sitzung.zustand()).notizen.map((n) => n.text);
    const tb = (await b.sitzung.zustand()).notizen.map((n) => n.text);
    expect(ta).toEqual(['B1', 'A1']);
    expect(tb).toEqual(ta);
  });

  it('holt große Mengen in Blöcken ab', async () => {
    const server = new TestServer();
    const a = geraet(server, 'a');
    const b = geraet(server, 'b');
    for (let i = 0; i < 450; i++) await a.speicher.hinzufuegen({
      id: neueId(), art: ART.testNotiz, daten: { text: String(i) }, sitzung: sitzungsbindung('tok-a'), zeit: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      geraet: 'geraet-a', turnier: 'turnier001', status: 'ausstehend', seq: null, empfangen: null, autor: null,
    });
    for (let i = 0; i < 3; i++) await a.sitzung.abgleich!.durchlauf();
    expect(server.ereignisse).toHaveLength(450);
    await b.sitzung.abgleich!.durchlauf();
    const z = await b.sitzung.zustand();
    expect(z.notizen).toHaveLength(450);
    expect(z.notizen[449]!.text).toBe('449');
  });

  it('Zuschauer ohne Token liest mit, kann aber nicht senden', async () => {
    const server = new TestServer();
    const a = geraet(server, 'a');
    const z = geraet(server, 'b', null);
    await a.sitzung.eintragen(ART.testNotiz, { text: 'öffentlich' });
    await a.sitzung.abgleich!.durchlauf();
    await z.sitzung.abgleich!.durchlauf();
    expect((await z.sitzung.zustand()).notizen).toHaveLength(1);
    await z.sitzung.eintragen(ART.testNotiz, { text: 'heimlich' });
    await z.sitzung.abgleich!.durchlauf();
    expect(z.sitzung.status?.verbindung).toBe('nicht_angemeldet');
    expect(server.ereignisse).toHaveLength(1);
  });

  it('gestarteter Abgleich sendet sofort nach dem Eintragen und läuft selbständig weiter', async () => {
    const server = new TestServer();
    const a = geraet(server, 'a');
    const b = new TurnierSitzung({
      speicher: new SpeicherImArbeitsspeicher(), turnier: 'turnier001', modus: 'online', geraet: 'geraet-b',
      autor: { rolle: 'zuschauer', name: '' }, api: new Api('http://test.invalid/api/index.php', server.abruf),
      intervallMs: 20,
    });
    a.sitzung.start();
    b.start();
    await a.sitzung.eintragen(ART.testNotiz, { text: 'live' });
    const bis = Date.now() + 2000;
    while ((await b.zustand()).notizen.length === 0 && Date.now() < bis) await new Promise((r) => setTimeout(r, 10));
    a.sitzung.stop();
    b.stop();
    expect((await b.zustand()).notizen[0]?.text).toBe('live');
  });

  it('abgelaufenes Token: Einträge bleiben erhalten und Status meldet Anmeldung', async () => {
    const server = new TestServer();
    const a = geraet(server, 'a', 'tok-ungueltig');
    await a.sitzung.eintragen(ART.testNotiz, { text: 'x' });
    await a.sitzung.abgleich!.durchlauf();
    expect(a.sitzung.status).toMatchObject({ verbindung: 'nicht_angemeldet', ausstehend: 1 });
  });
});

describe('IndexedDB-Speicher', () => {
  it('speichert, ersetzt und löscht je Turnier', async () => {
    const s = new SpeicherIndexedDb('test-' + neueId());
    const basis = { art: 'x', daten: { a: 1 }, geraet: 'g', autor: null, empfangen: null } as const;
    await s.hinzufuegen({ ...basis, id: 'e1', turnier: 't1', status: 'ausstehend', seq: null, zeit: '2026-01-01' });
    await s.hinzufuegen({ ...basis, id: 'e2', turnier: 't1', status: 'ausstehend', seq: null, zeit: '2026-01-02' });
    await s.hinzufuegen({ ...basis, id: 'e3', turnier: 't2', status: 'lokal', seq: 1, zeit: '2026-01-01' });
    await expect(s.hinzufuegen({ ...basis, id: 'e3', turnier: 't2', status: 'lokal', seq: 1, zeit: '' })).rejects.toBeTruthy();
    expect((await s.ausstehende('t1')).map((e) => e.id)).toEqual(['e1', 'e2']);
    await s.uebernehmen([{ ...basis, id: 'e2', turnier: 't1', status: 'bestaetigt', seq: 7, zeit: '2026-01-02' }]);
    expect((await s.alle('t1')).map((e) => e.id)).toEqual(['e2', 'e1']);
    await s.setzeAbgeholtBis('t1', 7);
    expect(await s.abgeholtBis('t1')).toBe(7);
    expect(await s.abgeholtBis('t2')).toBe(0);
    await s.loeschen('t1');
    expect(await s.alle('t1')).toEqual([]);
    expect(await s.alle('t2')).toHaveLength(1);
    expect(await s.abgeholtBis('t1')).toBe(0);
  });
});
