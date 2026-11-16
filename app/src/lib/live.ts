/** Einstellungen der Live-Anzeige – je Gerät und Turnier (Beamer-Laptop, Fernseher in der Halle) */
export interface LiveEinstellungen {
  /** Seitenwechsel in Sekunden (0 = aus, Blättern mit Pfeiltasten) */
  takt: number;
  ablauf: boolean;
  staende: boolean;
  baeume: boolean;
  /** Neue Aufrufe groß einblenden */
  einblenden: boolean;
  /** Neue Aufrufe ansagen (Sprachausgabe) */
  ansage: boolean;
  qr: boolean;
  /** Nur diese Konkurrenz zeigen ('' = alle) */
  nurKonkurrenz: string;
  thema: 'hell' | 'dunkel';
  groesse: 'normal' | 'gross';
}

export const LIVE_STANDARD: LiveEinstellungen = {
  takt: 20,
  ablauf: true,
  staende: true,
  baeume: true,
  einblenden: true,
  ansage: false,
  qr: true,
  nurKonkurrenz: '',
  thema: 'hell',
  groesse: 'normal',
};

export function liveEinstellungen(turnier: string): LiveEinstellungen {
  try {
    const t = localStorage.getItem(`tt-live-${turnier}`);
    return t ? { ...LIVE_STANDARD, ...(JSON.parse(t) as Partial<LiveEinstellungen>), ansage: false } : { ...LIVE_STANDARD };
  } catch {
    return { ...LIVE_STANDARD };
  }
}

export function setzeLiveEinstellungen(turnier: string, e: LiveEinstellungen) {
  try {
    localStorage.setItem(`tt-live-${turnier}`, JSON.stringify(e));
  } catch {
    /* privater Modus */
  }
}
