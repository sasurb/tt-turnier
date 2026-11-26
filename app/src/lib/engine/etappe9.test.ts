import { sitzungsbindung } from './sitzungsbindung';
import { describe, expect, it } from 'vitest';
import { ART, type AnmeldungEintrag, type Autor } from '@shared/protokoll';
import { Baukasten, HELFER, LEITUNG, saetze } from './test/baukasten';
import { enthalteneUst, kassenListe, kassenSumme, kassenZeile, ohneCheckin, quittungsNr } from './kasse';
import { bicGueltig, giroCode, ibanAnzeige, ibanGueltig } from './girocode';
import { uebernahmePlanen } from './anmeldung';
import { centAus, euro } from './modell';
import { aufgabenVon, berechnen, rueckgaengigErlaubt } from './zustand';
import { Abgleich } from './abgleich';
import { Api } from './api';
import { SpeicherImArbeitsspeicher } from './speicher';
import type { LokalesEreignis } from './typen';
import { zeitplanDrosselZuruecksetzen, zeitplanGedrosselt } from './zeitplan';

const KASSE: Autor = { rolle: 'helfer', name: 'Kasse', aufgaben: ['kasse'] };
const SPRECHER: Autor = { rolle: 'helfer', name: 'Sprecher', aufgaben: ['aufruf'] };
const OBERSCHIRI: Autor = { rolle: 'helfer', name: 'OSR', aufgaben: ['oberschiri'] };
const SPIELER_A: Autor = { rolle: 'spieler', name: 'A', spieler: 'a' };
const SPIELER_B: Autor = { rolle: 'spieler', name: 'B', spieler: 'b' };

function jgj(t = new Baukasten()) {
  for (const s of ['a', 'b', 'c', 'd']) t.spieler(s);
  t.konkurrenz('k', { modus: 'jgj', startgeld: 800 }, ['a', 'b', 'c', 'd']);
  t.auslosen('k');
  t.starten('k', 'gruppen');
  return t;
}

describe('Etappe 9: Aufgaben der Helfer (feinere Rechte)', () => {
  it('Standard-Helfer (ohne Angabe) trägt ein und ruft auf; Kasse nicht', () => {
    expect(aufgabenVon(HELFER)).toEqual(['ergebnisse', 'aufruf']);
    expect(aufgabenVon({ ...LEITUNG })).toEqual(['ergebnisse', 'aufruf', 'kasse', 'oberschiri']);
    expect(aufgabenVon({ rolle: 'spieler', name: 'x', helfer: true })).toEqual(['ergebnisse', 'aufruf']);
    expect(aufgabenVon({ rolle: 'helfer', name: 'x', aufgaben: ['oberschiri', 'nix' as never, 'kasse'] })).toEqual(['kasse', 'oberschiri']);
    const t = jgj();
    const s = Object.values(t.z.konkurrenzen.k!.spiele)[0]!;
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: s.id, tisch: 1 }, HELFER);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.tisch).toBe(1);
    t.ergebnis('k', s.id, saetze(5, 5, 5), HELFER);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.stand).toBe('bestaetigt');
    t.e(ART.teilnehmerEingecheckt, { spieler: 'a', da: true }, HELFER);
    expect(t.z.checkin.a).toBeUndefined();
    expect(t.z.warnungen.at(-1)!.text).toMatch(/Kasse/);
  });

  it('Kasse: Check-in und Startgeld, aber keine Ergebnisse und keine Aufrufe', () => {
    const t = jgj();
    const s = Object.values(t.z.konkurrenzen.k!.spiele)[0]!;
    t.e(ART.teilnehmerEingecheckt, { spieler: 'a', da: true }, KASSE);
    t.e(ART.startgeldGebucht, { id: 'b0001', spieler: 'a', betrag: 800, art: 'bar' }, KASSE);
    t.ergebnis('k', s.id, saetze(5, 5, 5), KASSE);
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: s.id, tisch: 2 }, KASSE);
    const z = t.z;
    expect(z.checkin.a).toBe(true);
    expect(z.buchungen).toHaveLength(1);
    expect(z.konkurrenzen.k!.spiele[s.id]!.eintrag).toBeNull();
    expect(z.konkurrenzen.k!.spiele[s.id]!.tisch).toBeNull();
    expect(z.warnungen.map((w) => w.text).join(' ')).toMatch(/keine Ergebnisse.*Spielaufruf/s);
  });

  it('Sprecher ruft auf, trägt aber nichts ein', () => {
    const t = jgj();
    const s = Object.values(t.z.konkurrenzen.k!.spiele)[0]!;
    t.e(ART.spielAufgerufen, { konkurrenz: 'k', spiel: s.id, tisch: 3 }, SPRECHER);
    t.ergebnis('k', s.id, saetze(5, 5, 5), SPRECHER);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.tisch).toBe(3);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.eintrag).toBeNull();
  });

  it('Oberschiedsrichter entscheidet Konflikte und setzt zurück; normaler Helfer nicht', () => {
    const t = jgj();
    const s = Object.values(t.z.konkurrenzen.k!.spiele).find((x) => x.a === 'a' && x.b === 'b') ?? Object.values(t.z.konkurrenzen.k!.spiele).find((x) => [x.a, x.b].includes('a') && [x.a, x.b].includes('b'))!;
    const vonA = t.ergebnis('k', s.id, saetze(5, 5, 5), s.a === 'a' ? SPIELER_A : SPIELER_B);
    t.ergebnis('k', s.id, saetze(-5, -5, -5), s.a === 'a' ? SPIELER_B : SPIELER_A);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.stand).toBe('konflikt');
    t.e(ART.spielEntschieden, { konkurrenz: 'k', spiel: s.id, ereignis: vonA }, HELFER);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.stand).toBe('konflikt');
    t.e(ART.spielEntschieden, { konkurrenz: 'k', spiel: s.id, ereignis: vonA }, OBERSCHIRI);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.stand).toBe('bestaetigt');
    t.e(ART.spielZurueckgesetzt, { konkurrenz: 'k', spiel: s.id }, HELFER);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.eintrag).not.toBeNull();
    t.e(ART.spielZurueckgesetzt, { konkurrenz: 'k', spiel: s.id }, OBERSCHIRI);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.eintrag).toBeNull();
    // Oberschiedsrichter trägt auch amtlich ein
    t.ergebnis('k', s.id, saetze(5, 5, 5), OBERSCHIRI);
    expect(t.z.konkurrenzen.k!.spiele[s.id]!.stand).toBe('bestaetigt');
  });
});

describe('Etappe 9: Absicherungen in der Engine', () => {
  const ev = (id: string, art: string, daten: Record<string, unknown>, status: LokalesEreignis['status'], autor: Autor | null = null): LokalesEreignis => ({
    id, art, daten, zeit: '2026-11-16T10:00:00Z', geraet: 'g', turnier: 't', status, seq: Number(id.slice(1)), empfangen: null, autor,
  });
  it('Ohne Autor gibt es Leitungsrechte nur im Einzelgerät-Betrieb', () => {
    const lokal = berechnen([ev('e1', ART.spielerAngelegt, { id: 'x', vorname: 'X', nachname: 'Y', verein: '' }, 'lokal')]);
    expect(lokal.spielerReihe).toEqual(['x']);
    const online = berechnen([ev('e1', ART.spielerAngelegt, { id: 'x', vorname: 'X', nachname: 'Y', verein: '' }, 'bestaetigt')]);
    expect(online.spielerReihe).toEqual([]);
    expect(online.warnungen[0]!.text).toMatch(/Nur die Turnierleitung/);
  });
  it('Spieler- und Konkurrenz-IDs nur Kleinbuchstaben und Ziffern', () => {
    const t = new Baukasten();
    for (const id of ['__proto__', 'A-b', 'x y', '', 'a'.repeat(17), 'constructor']) t.e(ART.spielerAngelegt, { id, vorname: 'X', nachname: 'Y', verein: '' });
    t.e(ART.konkurrenzAngelegt, { id: 'k-1', einst: {} });
    expect(t.z.spielerReihe).toEqual(['constructor']); // nur Kleinbuchstaben: erlaubt, die Maps sind prototypfrei
    expect(t.z.konkurrenzReihe).toEqual([]);
    t.spieler('abc123');
    expect(t.z.spieler.abc123?.vorname).toBe('ABC123');
  });
  it('Turnier umbenennen nur die Leitung; vom Server abgelehnte Einträge zählen nicht', () => {
    const t = new Baukasten();
    t.e(ART.turnierAngelegt, { name: 'Alt', datum: null });
    t.e(ART.turnierUmbenannt, { name: 'Hack', datum: '2027-01-01' }, HELFER);
    expect(t.z.name).toBe('Alt');
    t.e(ART.turnierUmbenannt, { name: 'Neu', datum: '2027-01-01' });
    expect(t.z.name).toBe('Neu');
    t.liste.push({ ...t.liste.at(-1)!, id: 'abgelehnt1', daten: { name: 'Abgelehnt' }, status: 'abgelehnt', seq: null });
    expect(berechnen(t.liste).name).toBe('Neu');
  });
  it('Kasse in den Turnierangaben (gekürzt, IBAN ohne Leerzeichen)', () => {
    const t = new Baukasten();
    t.e(ART.turnierDaten, { kasse: { aussteller: ' TTC ', iban: 'de89 3704 0044 0532 0130 00', ust: 'enthalten', ustSatz: 7, fremd: 'x' } });
    expect(t.z.kasse).toEqual({ aussteller: 'TTC', anschrift: '', ust: 'enthalten', ustSatz: 7, fusstext: '', empfaenger: '', iban: 'DE89370400440532013000', bic: '' });
    t.e(ART.turnierDaten, { ort: 'Halle' });
    expect(t.z.kasse?.aussteller).toBe('TTC');
    t.e(ART.turnierDaten, { kasse: null });
    expect(t.z.kasse).toBeNull();
  });
});

describe('Etappe 9: Kasse und Quittungen', () => {
  it('Startgeld aus den Konkurrenzen, Buchung, Storno, Quittungsnummern', () => {
    const t = new Baukasten();
    for (const s of ['a', 'b', 'c']) t.spieler(s);
    t.konkurrenz('h', { modus: 'jgj', startgeld: 800 }, ['a', 'b', 'c']);
    t.konkurrenz('d', { modus: 'jgj', startgeld: 500, art: 'doppel' }, []);
    t.e(ART.paarGemeldet, { konkurrenz: 'd', id: 'p-0001', spieler: ['a', 'b'] });
    expect(kassenZeile(t.z, 'a').soll).toBe(1300);
    expect(kassenZeile(t.z, 'c').soll).toBe(800);
    t.e(ART.startgeldGebucht, { id: 'b0001', spieler: 'a', betrag: 1000, art: 'bar' }, KASSE);
    t.e(ART.startgeldGebucht, { id: 'b0002', spieler: 'a', betrag: 300, art: 'erlassen' }, LEITUNG);
    t.e(ART.startgeldGebucht, { id: 'b0003', spieler: 'b', betrag: 1300, art: 'ueberweisung' }, KASSE);
    t.e(ART.startgeldGebucht, { id: 'b0003', spieler: 'b', betrag: 1, art: 'bar' }, KASSE); // doppelt
    t.e(ART.startgeldGebucht, { id: 'b0004', spieler: 'zz', betrag: 1, art: 'bar' }, KASSE); // unbekannt
    t.e(ART.startgeldGebucht, { id: 'b0005', spieler: 'c', betrag: -5, art: 'bar' }, KASSE); // negativ
    expect(t.z.buchungen.map(quittungsNr)).toEqual(['Q-B000-1', 'Q-B000-2', 'Q-B000-3']);
    expect(t.z.buchungen.map((b) => b.nr)).toEqual([1, 2, 3]);
    const a = kassenZeile(t.z, 'a');
    expect([a.bezahlt, a.erlassen, a.offen]).toEqual([1000, 300, 0]);
    t.e(ART.startgeldStorniert, { buchung: 'b0001' }, KASSE);
    t.e(ART.startgeldStorniert, { buchung: 'b0001' }, KASSE); // zweimal
    expect(kassenZeile(t.z, 'a').offen).toBe(1000);
    expect(t.z.buchungen[0]!.storniert?.von).toBe('Kasse');
    const s = kassenSumme(t.z);
    expect(s).toMatchObject({ soll: 3400, bar: 0, ueberweisung: 1300, erlassen: 300, offen: 1800, gemeldet: 3 });
    expect(kassenListe(t.z)).toHaveLength(3);
    // Kassenbuch: nur stornieren, nie zurücknehmen
    expect(rueckgaengigErlaubt({ art: ART.startgeldGebucht, daten: {} })).toBe(false);
    expect(rueckgaengigErlaubt({ art: ART.startgeldStorniert, daten: {} })).toBe(false);
    expect(rueckgaengigErlaubt({ art: ART.teilnehmerEingecheckt, daten: {} })).toBe(true);
  });
  it('Nicht Eingecheckte streichen: nur nicht begonnene Konkurrenzen, Paare nur komplett da', () => {
    const t = new Baukasten();
    for (const s of ['a', 'b', 'c', 'd']) t.spieler(s);
    t.konkurrenz('h', { modus: 'jgj' }, ['a', 'b', 'c']);
    t.konkurrenz('d', { modus: 'jgj', art: 'doppel' }, []);
    t.e(ART.paarGemeldet, { konkurrenz: 'd', id: 'p-0001', spieler: ['a', 'd'] });
    t.konkurrenz('l', { modus: 'jgj' }, ['b', 'c', 'd']);
    t.auslosen('l');
    t.starten('l', 'gruppen');
    t.e(ART.teilnehmerEingecheckt, { spieler: 'a', da: true });
    t.e(ART.teilnehmerEingecheckt, { spieler: 'b', da: true });
    t.e(ART.teilnehmerEingecheckt, { spieler: 'b', da: false });
    expect(ohneCheckin(t.z)).toEqual([
      { konkurrenz: 'h', teilnehmer: 'b' },
      { konkurrenz: 'h', teilnehmer: 'c' },
      { konkurrenz: 'd', teilnehmer: 'p-0001' },
    ]);
    expect(kassenSumme(t.z).da).toBe(1);
  });
  it('Umsatzsteuer, Beträge, Eingabe', () => {
    expect(enthalteneUst(1190, 19)).toBe(190);
    expect(enthalteneUst(1070, 7)).toBe(70);
    expect(euro(750)).toBe('7,50 €');
    expect(centAus('7,5')).toBe(750);
    expect(centAus(' 12 € ')).toBe(1200);
    expect(centAus('')).toBeNull();
    expect(centAus('abc')).toBeUndefined();
    expect(centAus('1,234')).toBeUndefined();
  });
});

describe('Etappe 9: IBAN und GiroCode', () => {
  it('prüft IBAN und BIC', () => {
    expect(ibanGueltig('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(ibanGueltig('de89370400440532013000')).toBe(true);
    expect(ibanGueltig('DE89370400440532013001')).toBe(false);
    expect(ibanGueltig('DE8937040044053201300')).toBe(false);
    expect(ibanGueltig('GB82WEST12345698765432')).toBe(true);
    expect(ibanAnzeige('DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00');
    expect(bicGueltig('COBADEFFXXX')).toBe(true);
    expect(bicGueltig('')).toBe(true);
    expect(bicGueltig('KAPUTT')).toBe(false);
  });
  it('erzeugt den EPC-Text (Version 002, UTF-8)', () => {
    const g = giroCode({ empfaenger: 'TTC Süd e. V.', iban: 'DE89 3704 0044 0532 0130 00', betrag: 1250, zweck: 'Startgeld Frühjahr\nAda' })!;
    expect(g.split('\n')).toEqual(['BCD', '002', '1', 'SCT', '', 'TTC Süd e. V.', 'DE89370400440532013000', 'EUR12.50', '', '', 'Startgeld Frühjahr Ada']);
    expect(giroCode({ empfaenger: 'X', iban: 'DE00', betrag: 1, zweck: '' })).toBeNull();
    expect(giroCode({ empfaenger: '', iban: 'DE89370400440532013000', betrag: 1, zweck: '' })).toBeNull();
    expect(giroCode({ empfaenger: 'X', iban: 'DE89370400440532013000', betrag: 0, zweck: 'y'.repeat(200) })!.split('\n')[10]).toHaveLength(140);
  });
});

describe('Etappe 9: Übernahme der Online-Anmeldungen', () => {
  const anm = (id: string, k: AnmeldungEintrag['konkurrenzen'], extra: Partial<AnmeldungEintrag> = {}): AnmeldungEintrag => ({
    id, vorname: id.toUpperCase(), nachname: 'Muster', verein: 'TV', email: `${id}@x.de`, ttr: 1400, klasse: null, geschlecht: 'w', jahrgang: 2010,
    angelegt: '2026-11-16T10:00:00Z', bestaetigt: '2026-11-16T10:05:00Z', konkurrenzen: k, spieler: null, ...extra,
  });
  it('legt Spieler mit fester ID an, meldet in Einzel, Doppel als Hinweis; nur gewählte Angaben', () => {
    const t = new Baukasten();
    t.e(ART.turnierDaten, { angaben: ['ttr'] });
    t.konkurrenz('h', { modus: 'jgj' }, []);
    t.konkurrenz('d', { modus: 'jgj', art: 'doppel' }, []);
    const p = uebernahmePlanen(t.z, [
      anm('ada', [{ id: 'h', status: 'platz', position: null, partner: null }, { id: 'd', status: 'platz', position: null, partner: 'Doris' }]),
      anm('ben', [{ id: 'h', status: 'warteliste', position: 1, partner: null }]),
      anm('cem', [{ id: 'h', status: 'platz', position: null, partner: null }], { bestaetigt: null }),
      anm('X-1', [{ id: 'h', status: 'platz', position: null, partner: null }]),
    ]);
    expect(p.schritte.map((s) => [s.id, s.art])).toEqual([
      ['anm-ada-sp', ART.spielerAngelegt],
      [null, ART.teilnehmerGemeldet],
    ]);
    expect(p.schritte[0]!.daten).toEqual({ id: 'ada', vorname: 'ADA', nachname: 'Muster', verein: 'TV', ttr: 1400 });
    expect(p.hinweise).toEqual(['ADA Muster: d – Paar von Hand bilden (Partner/in: Doris).']);
    expect(p.uebernommen).toEqual(['ada']); // ben wartet noch – kommt erst mit Platz ins Turnier
  });
  it('rückt nach bzw. streicht Abmeldungen; laufende Konkurrenzen nur als Hinweis', () => {
    const t = new Baukasten();
    t.spieler('ada');
    t.spieler('ben');
    t.spieler('xx');
    t.konkurrenz('h', { modus: 'jgj' }, ['ada', 'xx']);
    t.konkurrenz('l', { modus: 'jgj' }, ['ben', 'xx']);
    t.auslosen('l');
    t.starten('l', 'gruppen');
    const p = uebernahmePlanen(t.z, [
      anm('ada', [{ id: 'h', status: 'abgemeldet', position: null, partner: null }], { spieler: 'ada' }),
      anm('ben', [{ id: 'h', status: 'platz', position: null, partner: null }, { id: 'l', status: 'abgemeldet', position: null, partner: null }], { spieler: 'ben' }),
    ]);
    expect(p.schritte.map((s) => `${s.art}:${String(s.daten.id)}`)).toEqual([`${ART.teilnehmerAbgemeldet}:ada`, `${ART.teilnehmerGemeldet}:ben`]);
    expect(p.hinweise).toHaveLength(1);
    expect(p.hinweise[0]).toMatch(/läuft schon/);
    expect(p.uebernommen).toEqual([]);
  });
});

describe('Etappe 9: Abgleich mit einzeln abgelehnten Einträgen', () => {
  /** Kleiner Schein-Server: lehnt „spieler.angelegt“ ab, filtert „startgeld.gebucht“ aus der Sicht */
  function schein() {
    const gespeichert: { seq: number; id: string; art: string; daten: unknown; zeit: string; geraet: string }[] = [];
    let mitBis = true;
    const abruf = async (url: string, init: RequestInit): Promise<Response> => {
      const u = new URL(url);
      const r = u.searchParams.get('r');
      if (r === 'events' && init.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { ereignisse: { id: string; art: string; daten: unknown; zeit: string; geraet: string }[] };
        const angenommen: { id: string; seq: number }[] = [];
        const abgelehnt: { id: string; fehler: string; meldung: string }[] = [];
        for (const e of body.ereignisse) {
          if (e.art === ART.spielerAngelegt) abgelehnt.push({ id: e.id, fehler: 'keine_berechtigung', meldung: 'Nicht erlaubt.' });
          else {
            gespeichert.push({ ...e, seq: gespeichert.length + 1 });
            angenommen.push({ id: e.id, seq: gespeichert.length });
          }
        }
        return new Response(JSON.stringify({ angenommen, hoechsteSeq: gespeichert.length, ...(abgelehnt.length ? { abgelehnt } : {}) }), { status: 200 });
      }
      const ab = Number(u.searchParams.get('ab') ?? 0);
      const rest = gespeichert.filter((e) => e.seq > ab);
      const sichtbar = rest.filter((e) => e.art !== ART.startgeldGebucht);
      return new Response(
        JSON.stringify({
          ereignisse: sichtbar.map((e) => ({ ...e, empfangen: e.zeit, autor: { rolle: 'helfer', name: 'H' } })),
          hoechsteSeq: gespeichert.length,
          mehr: false,
          sicht: 'spieler',
          ...(mitBis ? { bis: rest.at(-1)?.seq ?? ab } : {}),
        }),
        { status: 200 },
      );
    };
    return { abruf, gespeichert, ohneBis: () => (mitBis = false) };
  }

  it('markiert den abgelehnten Eintrag, sendet ihn nicht erneut, der Rest kommt an', async () => {
    const s = schein();
    const speicher = new SpeicherImArbeitsspeicher();
    const ag = new Abgleich({ speicher, api: new Api('http://test.invalid/api/index.php', s.abruf), turnier: 't1', token: () => 'tok' });
    const neu = (id: string, art: string): LokalesEreignis => ({
      id, art, daten: {}, zeit: '2026-11-16T10:00:00Z', geraet: 'g-1', turnier: 't1', status: 'ausstehend', seq: null, empfangen: null, autor: HELFER, sitzung: sitzungsbindung('tok'), reihe: Number(id.slice(1)),
    });
    await speicher.hinzufuegen(neu('e1', ART.testNotiz));
    await speicher.hinzufuegen(neu('e2', ART.spielerAngelegt));
    await speicher.hinzufuegen(neu('e3', ART.testNotiz));
    await ag.durchlauf();
    const alle = await speicher.alle('t1');
    expect(alle.find((e) => e.id === 'e2')).toMatchObject({ status: 'abgelehnt', fehler: 'Nicht erlaubt.' });
    expect(alle.filter((e) => e.status === 'bestaetigt').map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(ag.status.ausstehend).toBe(0);
    expect(ag.status.meldung).toMatch(/abgelehnt/);
    await ag.durchlauf();
    expect(s.gespeichert).toHaveLength(2); // nicht erneut gesendet
    await speicher.entfernen('t1', ['e2', 'e1']);
    expect((await speicher.alle('t1')).map((e) => e.id)).toEqual(['e1', 'e3']); // bestätigte bleiben
  });

  it('rückt mit „bis“ vor, auch wenn der Filter alles weglässt', async () => {
    const s = schein();
    const speicher = new SpeicherImArbeitsspeicher();
    const ag = new Abgleich({ speicher, api: new Api('http://test.invalid/api/index.php', s.abruf), turnier: 't2', token: () => 'tok' });
    s.gespeichert.push({ seq: 1, id: 'x1', art: ART.startgeldGebucht, daten: {}, zeit: '2026-11-16T10:00:00Z', geraet: 'g' });
    s.gespeichert.push({ seq: 2, id: 'x2', art: ART.startgeldGebucht, daten: {}, zeit: '2026-11-16T10:00:00Z', geraet: 'g' });
    await ag.durchlauf();
    expect(await speicher.abgeholtBis('t2')).toBe(2);
    expect(await speicher.alle('t2')).toEqual([]);
  });
});

describe('Etappe 9: Zeitplan gedrosselt', () => {
  it('rechnet schnelle Pläne sofort und gleichen Stand nur einmal', () => {
    zeitplanDrosselZuruecksetzen();
    const t = jgj();
    const z = t.z;
    const ergebnisse: unknown[] = [];
    zeitplanGedrosselt(z, Date.now(), (p) => ergebnisse.push(p));
    zeitplanGedrosselt(z, Date.now(), (p) => ergebnisse.push(p));
    expect(ergebnisse).toHaveLength(2);
    expect(ergebnisse[0]).toBe(ergebnisse[1]);
  });
});
