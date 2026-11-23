import { ALLE_ARTEN, ALLES_AUSWAEHLBAR, MODI, MODI_MANNSCHAFT, type KonkurrenzArt, type KonkurrenzAuswahl, type Modus } from './modell';
import { teilnahmen } from './abfragen';
import { begonnen, type TurnierZustand } from './zustand';

/**
 * Angebotene Konkurrenzarten und Spielsysteme (ab 0.16): Der Startassistent legt fest, was das Turnier anbietet;
 * unter „Einstellungen“ lässt es sich ändern. Unter „Konkurrenzen“ stehen nur diese zur Wahl.
 */

/** Vorschlag des Startassistenten: Einzel mit den drei gängigsten Spielsystemen */
export const STANDARD_AUSWAHL: KonkurrenzAuswahl = { arten: ['einzel'], modi: ['gruppen_ko', 'jgj', 'ko'] };

/** Was das Turnier anbietet (ältere Turniere ohne Festlegung: alles) */
export function angeboten(z: Pick<TurnierZustand, 'konkurrenzarten'>): KonkurrenzAuswahl {
  return z.konkurrenzarten ?? ALLES_AUSWAEHLBAR;
}

/** Spielsysteme, die für eine Art in Frage kommen (Mannschaften nur Gruppen, jeder gegen jeden, K.-o.) */
export function modiFuerArt(a: Pick<KonkurrenzAuswahl, 'modi'>, art: KonkurrenzArt): Modus[] {
  return MODI.filter((m) => a.modi.includes(m) && (art !== 'mannschaft' || MODI_MANNSCHAFT.includes(m)));
}

/** Auswahl prüfen: mindestens eine Art, ein Spielsystem, und für jede Art ein passendes System. null = in Ordnung */
export function auswahlPruefen(a: KonkurrenzAuswahl): string | null {
  if (!a.arten.length) return 'Bitte mindestens eine Konkurrenzart wählen.';
  if (!a.modi.length) return 'Bitte mindestens ein Spielsystem wählen.';
  if (a.arten.includes('mannschaft') && !modiFuerArt(a, 'mannschaft').length)
    return 'Für Mannschaften passt keins der gewählten Spielsysteme – bitte „Gruppen + K.-o.“, „Gruppen + Platzierungsgruppen“, „Jeder gegen jeden“ oder „K.-o.“ dazunehmen.';
  return null;
}

/** Auswahl in fester Reihenfolge und ohne Doppelte */
export function auswahlOrdnen(a: KonkurrenzAuswahl): KonkurrenzAuswahl {
  return { arten: ALLE_ARTEN.filter((x) => a.arten.includes(x)), modi: MODI.filter((m) => a.modi.includes(m)) };
}

export interface AuswahlFolgen {
  /** Konkurrenzen, deren Art abgewählt wird und die (ohne Ergebnisse) gelöscht werden */
  entfernen: string[];
  /** Konkurrenzen, deren Spielsystem abgewählt wird und die (noch nicht gestartet) ein anderes bekommen */
  umstellen: { id: string; nach: Modus }[];
  /** Gründe, warum die Auswahl so nicht geht (gestartete Konkurrenzen, Ergebnisse) */
  gesperrt: string[];
  /** Spieler, die danach in keiner Konkurrenz mehr gemeldet sind */
  ohneKonkurrenz: string[];
}

/**
 * Was passiert, wenn die Auswahl so geändert wird? Abgewählte Arten löschen deren Konkurrenzen (nur ohne Ergebnisse),
 * abgewählte Spielsysteme stellen noch nicht gestartete Konkurrenzen auf das erste passende System um. Spieler bleiben
 * im Turnier; wer danach nirgends mehr gemeldet ist, steht in `ohneKonkurrenz`.
 */
export function auswahlFolgen(z: TurnierZustand, neu: KonkurrenzAuswahl): AuswahlFolgen {
  const aus: AuswahlFolgen = { entfernen: [], umstellen: [], gesperrt: [], ohneKonkurrenz: [] };
  for (const id of z.konkurrenzReihe) {
    const k = z.konkurrenzen[id]!;
    if (!neu.arten.includes(k.einst.art)) {
      const mitErgebnis = Object.values(k.spiele).some((s) => s.eintrag) || Object.values(k.begegnungen).some((b) => Object.keys(b.teile).length > 0);
      if (mitErgebnis) aus.gesperrt.push(`„${k.einst.name}“ hat schon Ergebnisse und bleibt – die Art lässt sich deshalb nicht abwählen.`);
      else aus.entfernen.push(id);
      continue;
    }
    const passend = modiFuerArt(neu, k.einst.art);
    if (passend.includes(k.einst.modus)) continue;
    if (begonnen(k)) aus.gesperrt.push(`„${k.einst.name}“ läuft schon mit diesem Spielsystem – es lässt sich deshalb nicht abwählen.`);
    else if (passend.length) aus.umstellen.push({ id, nach: passend[0]! });
  }
  const weg = new Set(aus.entfernen);
  for (const sp of z.spielerReihe) {
    const t = teilnahmen(z, sp);
    if (t.length && t.every((kid) => weg.has(kid))) aus.ohneKonkurrenz.push(sp);
  }
  return aus;
}

/** Spieler, die in keiner Konkurrenz gemeldet sind (nur sinnvoll, wenn es Konkurrenzen gibt) */
export function ohneKonkurrenz(z: TurnierZustand): string[] {
  if (!z.konkurrenzReihe.length) return [];
  return z.spielerReihe.filter((sp) => teilnahmen(z, sp).length === 0);
}
