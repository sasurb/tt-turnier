import { ART, ID_MUSTER, type AnmeldungEintrag, type AnmeldungKonkurrenz } from '@shared/protokoll';
import { begonnen, teilnehmerVon, type TurnierZustand } from './zustand';

/**
 * Online-Anmeldung → Turnier. Die Anmeldungen liegen auf dem Server (mit E-Mail), ins Turnier kommen
 * sie erst, wenn die Leitung sie übernimmt: als Spieler (ID = Anmelde-ID) mit Meldungen für die
 * Einzel-Konkurrenzen, in denen sie einen Platz haben. Doppel/Mixed bildet die Leitung von Hand
 * (der Partnerwunsch steht in der Liste).
 */

/** Konkurrenzen, wie die Anmeldeseite sie anbietet (aus dem aktuellen Turnier) */
export function anmeldeKonkurrenzen(z: TurnierZustand, auswahl: string[]): AnmeldungKonkurrenz[] {
  return z.konkurrenzReihe
    // Mannschaften meldet die Leitung von Hand (keine Online-Anmeldung)
    .filter((id) => auswahl.includes(id) && z.konkurrenzen[id]!.einst.art !== 'mannschaft')
    .map((id) => {
      const k = z.konkurrenzen[id]!;
      return { id, name: k.einst.name, art: k.einst.art as AnmeldungKonkurrenz['art'], max: k.einst.maxTeilnehmer, startgeld: k.einst.startgeld };
    });
}

export interface UebernahmeSchritt {
  /** Feste Ereignis-ID bei spieler.angelegt (zwei Geräte legen den Spieler nicht doppelt an); sonst null */
  id: string | null;
  art: string;
  daten: Record<string, unknown>;
  /** Für die Anzeige */
  text: string;
}

export interface Uebernahme {
  schritte: UebernahmeSchritt[];
  /** Anmeldungen, die danach als übernommen gelten */
  uebernommen: string[];
  /** Hinweise für die Leitung (z. B. Doppel von Hand bilden, Konkurrenz läuft schon) */
  hinweise: string[];
}

/** Was fehlt im Turnier, damit es zu den Anmeldungen passt? (Nur bestätigte Anmeldungen) */
export function uebernahmePlanen(z: TurnierZustand, liste: AnmeldungEintrag[]): Uebernahme {
  const schritte: UebernahmeSchritt[] = [];
  const uebernommen: string[] = [];
  const hinweise: string[] = [];
  for (const a of liste) {
    if (!a.bestaetigt || !ID_MUSTER.test(a.id)) continue;
    const name = `${a.vorname} ${a.nachname}`.trim();
    const mitPlatz = a.konkurrenzen.filter((x) => x.status === 'platz');
    let spielerDa = !!z.spieler[a.id];
    if (!spielerDa && mitPlatz.length) {
      const daten: Record<string, unknown> = { id: a.id, vorname: a.vorname, nachname: a.nachname, verein: a.verein };
      if (z.angaben.includes('ttr') && a.ttr !== null) {
        daten.ttr = a.ttr;
        if (a.ttrGeschaetzt) daten.ttrGeschaetzt = true;
      }
      if (z.angaben.includes('klasse') && a.klasse) daten.klasse = a.klasse;
      if (z.angaben.includes('geschlecht') && a.geschlecht) daten.geschlecht = a.geschlecht;
      if (z.angaben.includes('jahrgang') && a.jahrgang !== null) daten.jahrgang = a.jahrgang;
      schritte.push({ id: `anm-${a.id}-sp`, art: ART.spielerAngelegt, daten, text: `${name}: Spieler anlegen` });
      spielerDa = true;
    }
    if (!spielerDa) continue;
    for (const x of a.konkurrenzen) {
      const k = z.konkurrenzen[x.id];
      if (!k) continue;
      const gemeldet = !!teilnehmerVon(k, a.id);
      if (k.einst.art !== 'einzel') {
        if (x.status === 'platz' && !gemeldet) hinweise.push(`${name}: ${k.einst.name} – Paar von Hand bilden${x.partner ? ` (Partner/in: ${x.partner})` : ''}.`);
        continue;
      }
      if (x.status === 'platz' && !gemeldet) {
        if (begonnen(k)) hinweise.push(`${name}: „${k.einst.name}“ läuft schon – bitte unter „Konkurrenzen“ nachmelden.`);
        else schritte.push({ id: null, art: ART.teilnehmerGemeldet, daten: { konkurrenz: k.id, id: a.id }, text: `${name}: in „${k.einst.name}“ melden` });
      } else if (x.status !== 'platz' && gemeldet && k.meldungen.includes(a.id)) {
        if (begonnen(k)) hinweise.push(`${name}: hat sich von „${k.einst.name}“ abgemeldet – die Konkurrenz läuft schon (Rückzug von Hand).`);
        else schritte.push({ id: null, art: ART.teilnehmerAbgemeldet, daten: { konkurrenz: k.id, id: a.id }, text: `${name}: Meldung in „${k.einst.name}“ streichen` });
      }
    }
    if (!a.spieler) uebernommen.push(a.id);
  }
  return { schritte, uebernommen, hinweise };
}
