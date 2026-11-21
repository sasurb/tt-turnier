/**
 * Vorschläge für den Vereinsnamen: einmal eingegebene Vereine (auf diesem Gerät gemerkt) plus die Vereine
 * aus Spielerpool und Turnier. Nur Vereinsnamen, keine Personendaten.
 */
const SCHLUESSEL = 'tt-vereine';
const MAX = 200;

function gemerkt(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SCHLUESSEL) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Verein merken (zuletzt benutzte zuerst) */
export function vereinMerken(name: string | null | undefined) {
  const n = (name ?? '').trim().slice(0, 80);
  if (!n) return;
  const liste = [n, ...gemerkt().filter((x) => x.toLowerCase() !== n.toLowerCase())].slice(0, MAX);
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify(liste));
  } catch {
    /* Speicher voll oder gesperrt */
  }
}

/** Alle Vorschläge ohne Doppelte (Groß-/Kleinschreibung egal), gemerkte zuerst, dann alphabetisch */
export function vereinsVorschlaege(weitere: Iterable<string | null | undefined> = []): string[] {
  const aus: string[] = [];
  const gesehen = new Set<string>();
  const dazu = (v: string | null | undefined) => {
    const n = (v ?? '').trim();
    if (!n || gesehen.has(n.toLowerCase())) return;
    gesehen.add(n.toLowerCase());
    aus.push(n);
  };
  gemerkt().forEach(dazu);
  [...weitere].map((v) => (v ?? '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'de')).forEach(dazu);
  return aus.slice(0, MAX);
}
