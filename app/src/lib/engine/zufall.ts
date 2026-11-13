/**
 * Reproduzierbarer Zufall: Aus demselben Zufallswert entsteht immer dieselbe Auslosung.
 * (mulberry32 – klein, schnell und für Auslosungen völlig ausreichend)
 */
export type Zufall = () => number;

export function zufallAus(wert: number): Zufall {
  let a = wert >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Neuer Zufallswert für eine Auslosung (wird im Ereignis gespeichert). */
export function neuerZufallswert(): number {
  const b = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
  else b[0] = Math.floor(Math.random() * 2 ** 32);
  return b[0]!;
}

/** Fisher-Yates, gibt eine neue Liste zurück */
export function mischen<T>(liste: readonly T[], z: Zufall): T[] {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(z() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function waehle<T>(liste: readonly T[], z: Zufall): T {
  return liste[Math.floor(z() * liste.length)]!;
}
