/**
 * Spielfolge „Jeder gegen jeden“ nach dem Rundenverfahren (Berger).
 * Positionen 0…n-1 (0 = Gruppenkopf). Bei ungerader Zahl hat je Runde einer spielfrei.
 * Die Runden sind so geordnet, dass sich die Positionen 1 und 2 zuletzt treffen.
 */
export function rundenplan(n: number): [number, number][][] {
  if (n < 2) return [];
  const m = n % 2 === 0 ? n : n + 1;
  const kreis = Array.from({ length: m }, (_, i) => i);
  const runden: [number, number][][] = [];
  for (let r = 0; r < m - 1; r++) {
    const runde: [number, number][] = [];
    for (let i = 0; i < m / 2; i++) {
      const x = kreis[i]!;
      const y = kreis[m - 1 - i]!;
      if (x >= n || y >= n) continue; // spielfrei
      runde.push(x < y ? [x, y] : [y, x]);
    }
    runde.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    runden.push(runde);
    // Position 0 bleibt, die anderen rücken eins weiter
    kreis.splice(1, 0, kreis.pop()!);
  }
  const letzte = runden.findIndex((r) => r.some(([x, y]) => x === 0 && y === 1));
  if (letzte >= 0) runden.push(...runden.splice(letzte, 1));
  return runden;
}
