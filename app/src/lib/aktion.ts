/**
 * Mehrere Einträge als eine Aktion („Alle melden“, „Zusammenlegen“, Spieler aus dem Pool …):
 * Was innerhalb von `alsEineAktion` gespeichert wird, macht „Rückgängig“ auf einmal rückgängig.
 * Alles andere ist je Eintrag eine eigene Aktion.
 */
let aktuelle: string | null = null;
let zaehler = 0;

export async function alsEineAktion<T>(f: () => Promise<T>): Promise<T> {
  if (aktuelle) return f(); // schon innerhalb einer Aktion
  aktuelle = `a${++zaehler}`;
  try {
    return await f();
  } finally {
    aktuelle = null;
  }
}

export function aktuelleAktion(): string | null {
  return aktuelle;
}
