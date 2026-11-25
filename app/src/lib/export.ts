import { wertungVorlaeufig } from './engine/modell';
import { endstand, name, nameLang, rundeVon } from './engine/abfragen';
import { ergebnisText } from './engine/ergebnis';
import { spielerVon, type TurnierZustand } from './engine/zustand';

/**
 * CSV-Export für Tabellenkalkulationen (Excel, LibreOffice): Semikolon, UTF-8 mit BOM, Zeilenende CRLF.
 * Schutz vor „CSV-Injection“: Textfelder, die mit = + - @ oder Steuerzeichen beginnen, bekommen ein
 * vorangestelltes Hochkomma, damit Excel sie nicht als Formel ausführt.
 */
export function csvFeld(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let t = v.replace(/\r\n?/g, '\n');
  if (/^[=+\-@\t\r\n]/.test(t)) t = `'${t}`;
  return /[;,"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function csv(zeilen: (string | number | null | undefined)[][]): string {
  return '﻿' + zeilen.map((z) => z.map(csvFeld).join(';')).join('\r\n') + '\r\n';
}

export function dateiStamm(z: TurnierZustand): string {
  return z.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'turnier';
}

const GESCHLECHT: Record<string, string> = { m: 'm', w: 'w', d: 'd' };

/** Teilnehmerliste: nur die Angaben, die im Turnier geführt werden */
export function teilnehmerCsv(z: TurnierZustand): string {
  const angaben = z.angaben;
  const kopf = ['Vorname', 'Nachname', 'Verein', ...(angaben.includes('ttr') ? ['TTR'] : []), ...(angaben.includes('klasse') ? ['Klasse'] : []), ...(angaben.includes('geschlecht') ? ['Geschlecht'] : []), ...(angaben.includes('jahrgang') ? ['Jahrgang'] : []), 'Konkurrenzen'];
  const zeilen = z.spielerReihe.map((id) => {
    const s = z.spieler[id]!;
    const konk = z.konkurrenzReihe.filter((kid) => {
      const k = z.konkurrenzen[kid]!;
      return k.meldungen.some((m) => m === id || k.paare[m]?.spieler.includes(id) || k.mannschaften?.[m]?.spieler.includes(id));
    });
    return [
      s.vorname,
      s.nachname,
      s.verein,
      ...(angaben.includes('ttr') ? [s.ttr ?? null] : []),
      ...(angaben.includes('klasse') ? [s.klasse ?? ''] : []),
      ...(angaben.includes('geschlecht') ? [s.geschlecht ? GESCHLECHT[s.geschlecht] ?? '' : ''] : []),
      ...(angaben.includes('jahrgang') ? [s.jahrgang ?? null] : []),
      konk.map((kid) => z.konkurrenzen[kid]!.einst.name).join(', '),
    ];
  });
  return csv([kopf, ...zeilen]);
}

/** Alle Spiele mit Ergebnis (auch offene), in Spielfolge je Konkurrenz */
export function spieleCsv(z: TurnierZustand): string {
  const kopf = ['Konkurrenz', 'Runde', 'Spieler A', 'Verein A', 'Spieler B', 'Verein B', 'Sätze A', 'Sätze B', 'Satzergebnisse', 'Sieger', 'Wertung', 'Stand', 'Tisch', 'Eingetragen'];
  const verein = (k: Parameters<typeof spielerVon>[0], t: string | null) => [...new Set(spielerVon(k, t).map((id) => z.spieler[id]?.verein ?? '').filter(Boolean))].join(' / ');
  const zeilen: (string | number | null)[][] = [];
  for (const kid of z.konkurrenzReihe) {
    const k = z.konkurrenzen[kid]!;
    for (const sid of k.reihenfolge) {
      const s = k.spiele[sid]!;
      if (s.status === 'entfallen' || (s.status === 'freilos' && !s.a && !s.b)) continue;
      const e = s.ergebnis;
      const art = s.status === 'freilos' ? 'Freilos' : !e ? (s.status === 'wartet' ? 'wartet' : 'offen') : e.art === 'kampflos' ? 'kampflos' : e.art === 'aufgabe' ? 'Aufgabe' : 'gespielt';
      zeilen.push([
        k.einst.name,
        rundeVon(k, s),
        s.aFrei ? 'Freilos' : nameLang(z, s.a, k),
        verein(k, s.a),
        s.bFrei ? 'Freilos' : nameLang(z, s.b, k),
        verein(k, s.b),
        e ? e.satzA : null,
        e ? e.satzB : null,
        e?.saetze ? e.saetze.map(([a, b]) => `${a}:${b}`).join(' ') : '',
        s.gewinner ? nameLang(z, s.gewinner === 'a' ? s.a : s.b, k) : '',
        art + (s.gestrichen ? ' (gestrichen)' : ''),
        s.stand === 'angefochten' ? 'angefochten (vorläufig)' : s.stand === 'konflikt' ? 'Konflikt (vorläufig)' : s.stand === 'eingetragen' ? 'unbestätigt' : '',
        s.tisch,
        s.eintrag ? new Date(s.eintrag.zeit).toLocaleString('de-DE') : '',
      ]);
    }
  }
  return csv([kopf, ...zeilen]);
}

/** Endstand aller Konkurrenzen */
export function endstandCsv(z: TurnierZustand): string {
  const zeilen: (string | number | null)[][] = [['Konkurrenz', 'Platz', 'Name', 'Verein']];
  for (const kid of z.konkurrenzReihe) {
    const k = z.konkurrenzen[kid]!;
    for (const p of endstand(k)) {
      const vereine = [...new Set(spielerVon(k, p.id).map((id) => z.spieler[id]?.verein ?? '').filter(Boolean))].join(' / ');
      zeilen.push([k.einst.name, p.bezeichnung + (wertungVorlaeufig(k) ? ' (vorläufig)' : ''), nameLang(z, p.id, k), vereine]);
    }
  }
  return csv(zeilen);
}

/** Lesbares Ergebnis für Listen */
export function ergebnisKurz(z: TurnierZustand, kid: string, sid: string): string {
  const s = z.konkurrenzen[kid]?.spiele[sid];
  if (!s) return '';
  if (s.status === 'freilos') return 'Freilos';
  return s.ergebnis ? ergebnisText(s.ergebnis) : `${name(z, s.a)} – ${name(z, s.b)}`;
}
