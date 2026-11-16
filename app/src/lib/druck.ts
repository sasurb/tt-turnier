/** Druckvorlagen und ihre Einstellungen – je Gerät und Turnier (Logo bleibt nur auf diesem Gerät) */
export const DRUCK_ARTEN = ['spielzettel', 'gruppen', 'baum', 'ergebnisse', 'teilnehmer', 'aushang', 'urkunden'] as const;
export type DruckArt = (typeof DRUCK_ARTEN)[number];

export interface DruckEinstellungen {
  /** '' = alle Konkurrenzen */
  konkurrenz: string;
  zettel: 'aufgerufen' | 'naechste' | 'offen';
  zettelAnzahl: number;
  sortierung: 'name' | 'verein';
  urkundePlaetze: number;
  urkundeTrost: boolean;
  unterschrift: string;
  /** Logo als data:-URL (höchstens 400 kB), nur auf diesem Gerät gespeichert */
  logo: string;
}

export const DRUCK_STANDARD: DruckEinstellungen = {
  konkurrenz: '',
  zettel: 'aufgerufen',
  zettelAnzahl: 12,
  sortierung: 'name',
  urkundePlaetze: 3,
  urkundeTrost: false,
  unterschrift: '',
  logo: '',
};

export function druckEinstellungen(turnier: string): DruckEinstellungen {
  try {
    const t = localStorage.getItem(`tt-druck-${turnier}`);
    const e = t ? { ...DRUCK_STANDARD, ...(JSON.parse(t) as Partial<DruckEinstellungen>) } : { ...DRUCK_STANDARD };
    // nur Bilder als data:-URL zulassen
    if (e.logo && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(e.logo)) e.logo = '';
    return e;
  } catch {
    return { ...DRUCK_STANDARD };
  }
}

export function setzeDruckEinstellungen(turnier: string, e: DruckEinstellungen) {
  try {
    localStorage.setItem(`tt-druck-${turnier}`, JSON.stringify(e));
  } catch {
    // Speicher voll (großes Logo): ohne Logo speichern
    try {
      localStorage.setItem(`tt-druck-${turnier}`, JSON.stringify({ ...e, logo: '' }));
    } catch {
      /* privater Modus */
    }
  }
}
