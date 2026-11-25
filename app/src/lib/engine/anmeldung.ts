import { ART, ID_MUSTER, type AnmeldeForm, type AnmeldungEintrag, type AnmeldungKonkurrenz, type GruppenPerson } from '@shared/protokoll';
import { begonnen, teilnehmerVon, type TurnierZustand } from './zustand';
import { staerkeVon } from './mannschaft';

/**
 * Online-Anmeldung → Turnier. Die Anmeldungen liegen auf dem Server (mit E-Mail), ins Turnier kommen
 * sie erst, wenn die Leitung sie übernimmt: als Spieler (ID = Anmelde-ID) mit Meldungen für die
 * Einzel-Konkurrenzen, in denen sie einen Platz haben. Doppel/Mixed bildet die Leitung von Hand
 * (der Partnerwunsch steht in der Liste).
 */

/** Konkurrenzen, wie die Anmeldeseite sie anbietet (aus dem aktuellen Turnier) */
export function anmeldeKonkurrenzen(z: TurnierZustand, auswahl: string[], formen: Record<string, AnmeldeForm> = {}): AnmeldungKonkurrenz[] {
  return z.konkurrenzReihe
    .filter((id) => auswahl.includes(id))
    .map((id) => {
      const k = z.konkurrenzen[id]!;
      const art = k.einst.art;
      const aus: AnmeldungKonkurrenz = { id, name: k.einst.name, art, max: k.einst.maxTeilnehmer, startgeld: k.einst.startgeld };
      // ab 0.18: Anmeldeform und Sollstärke (Mannschaft)
      if (art !== 'einzel') aus.form = formen[id] ?? standardForm(art);
      if (art === 'mannschaft') {
        const st = staerkeVon(k.einst);
        aus.min = st.min;
        aus.maxSpieler = st.max;
      }
      return aus;
    });
}

export function standardForm(art: AnmeldungKonkurrenz['art']): AnmeldeForm {
  return art === 'einzel' ? 'einzel' : art === 'mannschaft' ? 'gruppe' : 'beides';
}

/** Spieler-ID einer Person aus einer Gruppenanmeldung („…p2“) bzw. der Mannschaftsleitung als Begleitperson („…l“) */
export function gruppenSpielerId(anmeldung: string, pid: string): string {
  return pid === 'leitung' ? `${anmeldung}l` : `${anmeldung}${pid}`;
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
    if (a.typ === 'gruppe') {
      gruppeUebernehmen(z, a, schritte, hinweise);
      if (!a.spieler) uebernommen.push(a.id);
      continue;
    }
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
        if (x.status === 'platz' && !gemeldet)
          hinweise.push(k.einst.art === 'mannschaft' ? `${name}: ${k.einst.name} – einer Mannschaft zuordnen.` : `${name}: ${k.einst.name} – Paar von Hand bilden${x.partner ? ` (Partner/in: ${x.partner})` : ''}.`);
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

/**
 * Gruppenanmeldung (ab 0.18) übernehmen: Personen mit mindestens einem sicheren Platz als Spieler (ID Anmelde-ID + pid),
 * die Mannschaftsleitung als Begleitperson, wenn sie eine Mannschaft führt; Einzel melden, Paare und Mannschaften
 * mit festen IDs bilden. Läuft eine Konkurrenz schon, gibt es einen Hinweis statt einer Meldung.
 */
function gruppeUebernehmen(z: TurnierZustand, a: AnmeldungEintrag, schritte: UebernahmeSchritt[], hinweise: string[]) {
  const personen = new Map<string, GruppenPerson>((a.personen ?? []).map((p) => [p.pid, p]));
  const name = (pid: string) => (pid === 'leitung' ? `${a.vorname} ${a.nachname}` : `${personen.get(pid)?.vorname ?? ''} ${personen.get(pid)?.nachname ?? ''}`.trim());
  const mitPlatz = a.konkurrenzen.filter((x) => x.status === 'platz' && Array.isArray(x.wer));
  const brauche = new Set<string>();
  for (const x of mitPlatz) {
    for (const pid of x.wer!) brauche.add(pid);
    if (x.mannschaft?.fuehrer === 'leitung') brauche.add('leitung');
  }
  for (const pid of brauche) {
    const sid = gruppenSpielerId(a.id, pid);
    if (z.spieler[sid] || !ID_MUSTER.test(sid)) continue;
    const daten: Record<string, unknown> = { id: sid, vorname: pid === 'leitung' ? a.vorname : personen.get(pid)?.vorname ?? '', nachname: pid === 'leitung' ? a.nachname : personen.get(pid)?.nachname ?? '', verein: a.verein };
    if (pid === 'leitung') daten.begleitung = true;
    const p = personen.get(pid);
    if (p) {
      if (z.angaben.includes('ttr') && p.ttr !== null) {
        daten.ttr = p.ttr;
        if (p.ttrGeschaetzt) daten.ttrGeschaetzt = true;
      }
      if (z.angaben.includes('klasse') && p.klasse) daten.klasse = p.klasse;
      if (z.angaben.includes('geschlecht') && p.geschlecht) daten.geschlecht = p.geschlecht;
      if (z.angaben.includes('jahrgang') && p.jahrgang !== null) daten.jahrgang = p.jahrgang;
    }
    schritte.push({ id: `anm-${sid}`, art: ART.spielerAngelegt, daten, text: `${name(pid)}: ${pid === 'leitung' ? 'Begleitperson' : 'Spieler'} anlegen` });
  }
  for (const x of mitPlatz) {
    const k = z.konkurrenzen[x.id];
    if (!k) continue;
    const ids = x.wer!.map((pid) => gruppenSpielerId(a.id, pid));
    const wer = x.wer!.map(name).join(' / ');
    const nr = x.eintrag ?? 0;
    if (ids.some((sid) => teilnehmerVon(k, sid))) continue;
    if (begonnen(k)) {
      hinweise.push(`${wer}: „${k.einst.name}“ läuft schon – bitte unter „Konkurrenzen“ nachmelden.`);
      continue;
    }
    if (k.einst.art === 'einzel' || (ids.length === 1 && !x.mannschaft)) {
      if (k.einst.art === 'einzel') schritte.push({ id: null, art: ART.teilnehmerGemeldet, daten: { konkurrenz: k.id, id: ids[0] }, text: `${wer}: in „${k.einst.name}“ melden` });
      else hinweise.push(`${wer}: ${k.einst.name} – ${k.einst.art === 'mannschaft' ? 'einer Mannschaft zuordnen' : 'Paar von Hand bilden'}.`);
    } else if (k.einst.art === 'mannschaft' && x.mannschaft) {
      const fuehrer = x.mannschaft.fuehrer ? gruppenSpielerId(a.id, x.mannschaft.fuehrer) : null;
      schritte.push({
        id: null,
        art: ART.mannschaftGemeldet,
        daten: { konkurrenz: k.id, id: `m-${a.id}${nr}`, name: x.mannschaft.name, verein: a.verein, spieler: ids, fuehrer, wechsler: x.mannschaft.wechsler.map((pid) => gruppenSpielerId(a.id, pid)) },
        text: `${x.mannschaft.name}: Mannschaft in „${k.einst.name}“ melden`,
      });
    } else if (ids.length === 2) {
      schritte.push({ id: null, art: ART.paarGemeldet, daten: { konkurrenz: k.id, id: `p-${a.id}${nr}`, spieler: ids }, text: `${wer}: Paar in „${k.einst.name}“ melden` });
    }
  }
}
