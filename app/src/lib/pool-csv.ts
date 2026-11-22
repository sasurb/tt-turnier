/** Spielerpool als CSV (Import aus Excel/click-TT, Export) – ohne App-Zustand, damit testbar */
import type { PoolSpieler } from '@shared/protokoll';
import { kurzId } from './engine/ids';
import { csvFeld } from './export';

/* ---------------- CSV ---------------- */

/** Spaltennamen → Feld (ohne Prototyp, damit Köpfe wie „constructor“ nichts treffen) */
const SPALTEN: Record<string, keyof PoolSpieler | 'name'> = Object.assign(Object.create(null) as Record<string, keyof PoolSpieler | 'name'>, {
  geschätzt: 'ttrGeschaetzt',
  geschaetzt: 'ttrGeschaetzt',
  ttrgeschätzt: 'ttrGeschaetzt',
  hobby: 'ttrGeschaetzt',
  vorname: 'vorname',
  nachname: 'nachname',
  name: 'name',
  verein: 'verein',
  ttr: 'ttr',
  qttr: 'ttr',
  'ttr-punkte': 'ttr',
  punkte: 'ttr',
  klasse: 'klasse',
  leistungsklasse: 'klasse',
  geschlecht: 'geschlecht',
  jahrgang: 'jahrgang',
  geburtsjahr: 'jahrgang',
});

function zeileTeilen(z: string, trenner: string): string[] {
  const aus: string[] = [];
  let feld = '';
  let inAnf = false;
  for (let i = 0; i < z.length; i++) {
    const c = z[i]!;
    if (inAnf) {
      if (c === '"' && z[i + 1] === '"') {
        feld += '"';
        i++;
      } else if (c === '"') inAnf = false;
      else feld += c;
    } else if (c === '"') inAnf = true;
    else if (c === trenner) {
      aus.push(feld.trim());
      feld = '';
    } else feld += c;
  }
  aus.push(feld.trim());
  return aus;
}

function geschlechtLesen(t: string): PoolSpieler['geschlecht'] {
  const g = t.trim().toLowerCase();
  if (['m', 'männlich', 'maennlich', 'herr', 'herren'].includes(g)) return 'm';
  if (['w', 'weiblich', 'frau', 'damen', 'f'].includes(g)) return 'w';
  if (['d', 'divers'].includes(g)) return 'd';
  return null;
}

/**
 * Liest eine Tabelle (CSV aus Excel/click-TT, Trenner ; , oder Tab).
 * Mit Kopfzeile werden die Spalten am Namen erkannt, sonst: Vorname; Nachname; Verein; TTR.
 */
/** Zeilen trennen – Zeilenumbrüche innerhalb von Anführungszeichen gehören zum Feld */
function zeilenTeilen(text: string): string[] {
  const aus: string[] = [];
  let zeile = '';
  let inAnf = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') inAnf = !inAnf;
    if (!inAnf && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      aus.push(zeile);
      zeile = '';
    } else zeile += c;
  }
  aus.push(zeile);
  return aus;
}

/** Feldinhalt: Zeilenumbrüche zu Leerzeichen, Schutz-Hochkomma aus dem Export (vor = + - @) entfernen */
function feldText(v: string): string {
  return v.replace(/[\r\n\t]+/g, ' ').replace(/^'(?=[=+\-@])/, '').trim();
}

export function csvLesen(text: string): { spieler: PoolSpieler[]; uebersprungen: number } {
  const zeilen = zeilenTeilen(text.replace(/^﻿/, '')).filter((z) => z.trim());
  if (!zeilen.length) return { spieler: [], uebersprungen: 0 };
  const erste = zeilen[0]!;
  const trenner = erste.includes('\t') ? '\t' : erste.split(';').length >= erste.split(',').length ? ';' : ',';
  let kopf = zeileTeilen(erste, trenner).map((k) => SPALTEN[k.toLowerCase().replace(/\s+/g, '')]);
  let start = 1;
  if (!kopf.some(Boolean)) {
    kopf = ['vorname', 'nachname', 'verein', 'ttr'];
    start = 0;
  }
  const spieler: PoolSpieler[] = [];
  let uebersprungen = 0;
  for (const z of zeilen.slice(start)) {
    const w = zeileTeilen(z, trenner);
    const p: PoolSpieler = { id: kurzId(), vorname: '', nachname: '', verein: '' };
    kopf.forEach((k, i) => {
      const v = feldText(w[i] ?? '');
      if (!k || !v) return;
      if (k === 'name') {
        // „Nachname, Vorname“ oder „Vorname Nachname“
        if (v.includes(',')) {
          const [n, ...r] = v.split(',');
          p.nachname = n!.trim();
          p.vorname = r.join(',').trim();
        } else {
          const t = v.split(/\s+/);
          p.nachname = t.pop() ?? '';
          p.vorname = t.join(' ');
        }
      } else if (k === 'ttr' || k === 'jahrgang') {
        const n = parseInt(v.replace(/\D/g, ''), 10);
        if (Number.isFinite(n)) p[k] = n;
      } else if (k === 'geschlecht') p.geschlecht = geschlechtLesen(v);
      else if (k === 'ttrGeschaetzt') p.ttrGeschaetzt = /^(ja|j|x|1|true|wahr)$/i.test(v);
      else if (k === 'vorname' || k === 'nachname' || k === 'verein' || k === 'klasse') p[k] = v;
    });
    if (!p.vorname && !p.nachname) uebersprungen++;
    else spieler.push(p);
  }
  return { spieler, uebersprungen };
}

/** Mit Schutz vor CSV-Injection (csvFeld): Namen aus Online-Anmeldungen stammen von Dritten */
export function csvAusgeben(liste: PoolSpieler[]): string {
  const kopf = 'Vorname;Nachname;Verein;TTR;Geschätzt;Klasse;Geschlecht;Jahrgang';
  return [kopf, ...liste.map((p) => [p.vorname, p.nachname, p.verein, p.ttr, p.ttrGeschaetzt ? 'ja' : '', p.klasse, p.geschlecht, p.jahrgang].map((v) => csvFeld(v ?? null)).join(';'))].join('\r\n');
}

