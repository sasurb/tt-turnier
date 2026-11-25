import { spielerName, type KonkurrenzZustand } from './modell';
import { staerkeVon, systemVon } from './mannschaft';
import { spielerVon, teilnehmerVon, type Buchung, type TurnierZustand } from './zustand';

/**
 * Kasse: Startgeld je Spieler (Summe der Konkurrenzen, in denen er gemeldet ist), Zahlungen und
 * Quittungen. Alles aus den Buchungen berechnet; Buchungen sehen nur Leitung und Helfer (volle Sicht).
 */

export interface KassenZeile {
  spieler: string;
  name: string;
  verein: string;
  /** Konkurrenzen mit Startgeld, in denen der Spieler gemeldet ist */
  posten: { konkurrenz: string; name: string; betrag: number }[];
  soll: number;
  /** bar + Überweisung */
  bezahlt: number;
  erlassen: number;
  /** soll − bezahlt − erlassen (negativ = zu viel bezahlt) */
  offen: number;
  buchungen: Buchung[];
  da: boolean;
}

/** Konkurrenzen mit Startgeld, in denen der Spieler gemeldet ist (Einzel oder als Teil eines Paares) */
export function postenVon(z: TurnierZustand, spieler: string): KassenZeile['posten'] {
  const aus: KassenZeile['posten'] = [];
  for (const id of z.konkurrenzReihe) {
    const k = z.konkurrenzen[id]!;
    if (!k.einst.startgeld || !teilnehmerVon(k, spieler)) continue;
    aus.push({ konkurrenz: id, name: k.einst.name, betrag: k.einst.startgeld });
  }
  return aus;
}

export function kassenZeile(z: TurnierZustand, spieler: string): KassenZeile {
  const sp = z.spieler[spieler];
  const posten = postenVon(z, spieler);
  const buchungen = z.buchungen.filter((b) => b.spieler === spieler);
  const gueltig = buchungen.filter((b) => !b.storniert);
  const bezahlt = gueltig.filter((b) => b.art !== 'erlassen').reduce((s, b) => s + b.betrag, 0);
  const erlassen = gueltig.filter((b) => b.art === 'erlassen').reduce((s, b) => s + b.betrag, 0);
  const soll = posten.reduce((s, p) => s + p.betrag, 0);
  return {
    spieler,
    name: spielerName(sp),
    verein: sp?.verein ?? '',
    posten,
    soll,
    bezahlt,
    erlassen,
    offen: soll - bezahlt - erlassen,
    buchungen,
    da: z.checkin[spieler] === true,
  };
}

export function kassenListe(z: TurnierZustand): KassenZeile[] {
  // Begleitpersonen (ab 0.18) zahlen nicht und werden nicht eingecheckt
  return z.spielerReihe.filter((id) => !z.spieler[id]?.begleitung).map((id) => kassenZeile(z, id));
}

export interface KassenSumme {
  soll: number;
  bar: number;
  ueberweisung: number;
  erlassen: number;
  offen: number;
  /** Anzahl eingecheckt / Spieler mit Meldung */
  da: number;
  gemeldet: number;
}

export function kassenSumme(z: TurnierZustand): KassenSumme {
  const liste = kassenListe(z);
  const summe = (art: Buchung['art']) => z.buchungen.filter((b) => !b.storniert && b.art === art).reduce((s, b) => s + b.betrag, 0);
  return {
    soll: liste.reduce((s, x) => s + x.soll, 0),
    bar: summe('bar'),
    ueberweisung: summe('ueberweisung'),
    erlassen: summe('erlassen'),
    offen: liste.reduce((s, x) => s + Math.max(0, x.offen), 0),
    da: liste.filter((x) => x.da).length,
    gemeldet: liste.filter((x) => gemeldetIrgendwo(z, x.spieler)).length,
  };
}

/** Ist der Spieler in mindestens einer Konkurrenz gemeldet? */
export function gemeldetIrgendwo(z: TurnierZustand, spieler: string): boolean {
  return z.konkurrenzReihe.some((id) => !!teilnehmerVon(z.konkurrenzen[id]!, spieler));
}

/**
 * Meldungen von Spielern ohne Check-in in Konkurrenzen, die noch nicht begonnen haben – für
 * „Nicht Eingecheckte streichen“ vor der Auslosung. Liefert je Konkurrenz die Teilnehmer-IDs.
 */
export function ohneCheckin(z: TurnierZustand): { konkurrenz: string; teilnehmer: string }[] {
  const aus: { konkurrenz: string; teilnehmer: string }[] = [];
  for (const id of z.konkurrenzReihe) {
    const k = z.konkurrenzen[id]!;
    if (k.gestartet.gruppen || k.gestartet.ko) continue;
    for (const t of k.meldungen) {
      const spieler = spielerVon(k, t);
      if (spieler.some((s) => z.checkin[s] !== true)) aus.push({ konkurrenz: id, teilnehmer: t });
    }
  }
  return aus;
}

/**
 * Quittungsnummer aus der Buchungs-ID, z. B. „Q-K7M2-X9PA“: bleibt gleich, auch wenn zwei Kassen
 * offline buchen und sich die Reihenfolge beim Abgleich ändert. Die laufende Nummer (nr) dient nur
 * der Sortierung in der Kassenliste.
 */
export function quittungsNr(b: Pick<Buchung, 'id'>): string {
  const t = b.id.toUpperCase();
  return `Q-${t.slice(0, 4)}-${t.slice(4, 8)}${t.slice(8)}`;
}

/** Umsatzsteuer, die in einem Bruttobetrag enthalten ist (Cent, gerundet) */
export function enthalteneUst(brutto: number, satz: number): number {
  return Math.round((brutto * satz) / (100 + satz));
}

/* ---------- Check-in je Konkurrenz (ab 0.18) ---------- */

export interface CheckinStand {
  /** gemeldete Teilnehmer (Spieler, Paare, Mannschaften) */
  teilnehmer: number;
  /** davon anwesend (Paar: beide; Mannschaft: genug Spieler laut Sollstärke und Ersatzregel) */
  da: number;
  /** Teilnehmer, die nicht (vollständig) da sind */
  fehlend: string[];
  /** Mannschaften unter der Sollstärke (Hinweis, Nachbesetzung nach Ersatzregel) */
  unterbesetzt: { teilnehmer: string; da: number; min: number }[];
}

/** Anwesende Spieler einer Mannschaft und ob sie antreten kann */
export function mannschaftAnwesend(z: TurnierZustand, k: KonkurrenzZustand, mid: string): { da: number; reicht: boolean; min: number } {
  const m = k.mannschaften[mid];
  if (!m) return { da: 0, reicht: false, min: 1 };
  const da = m.spieler.filter((s) => z.checkin[s] === true).length;
  const st = staerkeVon(k.einst);
  const sys = systemVon(k.einst);
  const noetig = Math.max(1, Math.min(st.min, Math.max(1, sys.einzel)) - (k.einst.mannschaft?.ersatz ?? 0));
  return { da, reicht: da >= noetig, min: st.min };
}

export function checkinStand(z: TurnierZustand, k: KonkurrenzZustand): CheckinStand {
  const aus: CheckinStand = { teilnehmer: k.meldungen.length, da: 0, fehlend: [], unterbesetzt: [] };
  for (const t of k.meldungen) {
    let ok: boolean;
    if (k.einst.art === 'mannschaft') {
      const a = mannschaftAnwesend(z, k, t);
      ok = a.reicht;
      if (a.da < a.min) aus.unterbesetzt.push({ teilnehmer: t, da: a.da, min: a.min });
    } else ok = spielerVon(k, t).every((s) => z.checkin[s] === true);
    if (ok) aus.da++;
    else aus.fehlend.push(t);
  }
  return aus;
}

/** Ist die Auslosung gesperrt, weil der Check-in noch nicht abgeschlossen ist? */
export function auslosungWartetAufCheckin(z: Pick<TurnierZustand, 'checkinPflicht'>, k: KonkurrenzZustand): boolean {
  return z.checkinPflicht && !k.checkinFertig && !k.gestartet.gruppen && !k.gestartet.ko;
}
