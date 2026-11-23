import { name, platzierungen, runden, tabelle } from './abfragen';
import { ergebnisText } from './ergebnis';
import { rundenName, baumRunden, trostPlatzierungen } from './ko';
import { gruppeTitel, istSchweizerArt, punkteText, type KonkurrenzZustand, type Spiel } from './modell';
import { istRundenModus, kaiserTabelle, letzteRunde, schweizerTabelle } from './runden';
import { zurueckgezogen, type TurnierZustand } from './zustand';

/**
 * Lesbarer Stand als Text (für die Sicherungsmail und zum Teilen).
 * Bewusst schlicht: Tabellen mit festen Spaltenbreiten, damit es in jedem Mailprogramm lesbar ist.
 */

function rechts(t: string | number, n: number) {
  return String(t).padStart(n);
}
function links(t: string, n: number) {
  return t.length > n ? t.slice(0, n - 1) + '…' : t.padEnd(n);
}

function spielZeile(z: TurnierZustand, s: Spiel): string {
  const a = s.aFrei ? 'Freilos' : name(z, s.a);
  const b = s.bFrei ? 'Freilos' : name(z, s.b);
  let erg = '';
  if (s.status === 'freilos') erg = s.id.startsWith('ks-') ? 'setzt aus' : 'Freilos';
  else if (s.status === 'entfallen') erg = 'entfällt';
  else if (s.ergebnis) erg = ergebnisText(s.ergebnis) + (s.gestrichen ? ' (gestrichen)' : '');
  else if (s.status === 'wartet') erg = 'wartet';
  else erg = 'offen';
  if (s.stand === 'angefochten') erg += ' – ANGEFOCHTEN';
  if (s.stand === 'konflikt') erg += ' – KONFLIKT';
  return `  ${links(a, 24)} – ${links(b, 24)} ${erg}`;
}

function konkurrenzText(z: TurnierZustand, k: KonkurrenzZustand): string {
  const l: string[] = [];
  const titel = `${k.einst.name} (${k.meldungen.length} Teilnehmer)`;
  l.push(titel, '='.repeat(titel.length));
  if (!k.gestartet.gruppen && !k.gestartet.ko) {
    l.push('Noch nicht gestartet.', '');
    return l.join('\n');
  }
  if (istRundenModus(k.einst.modus)) {
    l.push(...rundenText(z, k), '');
    return l.join('\n');
  }
  for (const g of k.gruppen) {
    const t = tabelle(k, g.nr);
    l.push('', gruppeTitel(k, g.nr));
    l.push(`  ${'Pl'.padEnd(3)}${links('Name', 26)}${rechts('Sp', 3)}${rechts('S:N', 7)}${rechts('Sätze', 8)}${rechts('Bälle', 10)}`);
    for (const r of t.zeilen) {
      l.push(
        `  ${rechts(r.platz, 2)} ${links(name(z, r.id) + (r.zurueckgezogen ? ' (zur.)' : ''), 26)}${rechts(r.spiele, 3)}${rechts(`${r.siege}:${r.niederlagen}`, 7)}${rechts(`${r.saetzeG}:${r.saetzeV}`, 8)}${rechts(`${r.baelleG}:${r.baelleV}`, 10)}`,
      );
    }
    if (t.losGruppen.length && t.fertig) l.push('  Gleichstand – Los nötig.');
    const spiele = k.reihenfolge.map((id) => k.spiele[id]!).filter((s) => s.gruppe === g.nr);
    for (const s of spiele) l.push(spielZeile(z, s));
  }
  if (k.gestartet.ko) {
    const R = runden(k);
    for (let r = 1; r <= R; r++) {
      l.push('', rundenName(r, R));
      for (const id of k.reihenfolge) {
        const s = k.spiele[id]!;
        if (s.phase === 'ko' && s.baum === 'haupt' && s.runde === r && !s.platz3) l.push(spielZeile(z, s));
      }
      if (r === R) {
        const p3 = Object.values(k.spiele).find((s) => s.platz3);
        if (p3) l.push('', 'Spiel um Platz 3', spielZeile(z, p3));
      }
    }
    for (const baum of ['verlierer', 'finale', 'trost'] as const) {
      const RB = baumRunden(k, baum);
      for (let r = 1; r <= RB; r++) {
        l.push('', rundenName(r, RB, baum));
        for (const id of k.reihenfolge) {
          const s = k.spiele[id]!;
          if (s.phase === 'ko' && s.baum === baum && s.runde === r && s.status !== 'entfallen') l.push(spielZeile(z, s));
        }
      }
    }
    const p = platzierungen(k);
    if (p.length) {
      l.push('', 'Platzierungen');
      for (const x of p) l.push(`  ${rechts(x.bezeichnung, 6)}  ${name(z, x.id)}`);
    }
    const tp = trostPlatzierungen(k);
    if (tp.length) {
      l.push('', 'Platzierungen der Trostrunde');
      for (const x of tp) l.push(`  ${rechts(x.bezeichnung, 6)}  ${name(z, x.id)}`);
    }
  }
  l.push('');
  return l.join('\n');
}

function rundenText(z: TurnierZustand, k: KonkurrenzZustand): string[] {
  const l: string[] = [];
  const zur = zurueckgezogen(k);
  const zusatz = (id: string, zr: boolean) => name(z, id) + (zr ? ' (zur.)' : '');
  if (istSchweizerArt(k.einst.modus)) {
    l.push('', k.einst.modus === 'cup' ? 'Rangliste (Cup-System)' : 'Rangliste (Schweizer System)');
    l.push(`  ${'Pl'.padEnd(3)}${links('Name', 26)}${rechts('Pkt', 4)}${rechts('Buchholz', 9)}${rechts('Fein', 6)}${rechts('Sätze', 8)}`);
    for (const r of schweizerTabelle(k, zur))
      l.push(`  ${rechts(r.platz, 2)} ${links(zusatz(r.id, r.zurueckgezogen), 26)}${rechts(punkteText(r.punkte), 4)}${rechts(r.buchholz, 9)}${rechts(r.feinbuchholz, 6)}${rechts(`${r.saetzeG}:${r.saetzeV}`, 8)}`);
  } else {
    const t = kaiserTabelle(k, zur);
    l.push('', `Rangleiter (Kaiserturnier, nach Runde ${t.nachRunde})`);
    l.push(`  ${'Pl'.padEnd(3)}${links('Name', 26)}${rechts('S:N', 7)}${rechts('Kaisertisch', 12)}`);
    for (const r of t.zeilen)
      l.push(`  ${rechts(r.platz, 2)} ${links(zusatz(r.id, r.zurueckgezogen), 26)}${rechts(`${r.siege}:${r.niederlagen}`, 7)}${rechts(r.kaiserSiege, 12)}`);
  }
  for (let r = 1; r <= letzteRunde(k); r++) {
    l.push('', `Runde ${r}`);
    for (const id of k.reihenfolge) {
      const s = k.spiele[id]!;
      if (s.phase === 'gruppen' && s.runde === r) l.push(spielZeile(z, s));
    }
  }
  return l;
}

export function uebersichtText(z: TurnierZustand): string {
  const kopf = [`${z.name}${z.datum ? ' – ' + new Date(z.datum).toLocaleDateString('de-DE') : ''}${z.ort ? ' – ' + z.ort : ''}`];
  kopf.push(`${z.spielerReihe.length} Spieler, ${z.konkurrenzReihe.length} Konkurrenz${z.konkurrenzReihe.length === 1 ? '' : 'en'}`, '');
  return [...kopf, ...z.konkurrenzReihe.map((id) => konkurrenzText(z, z.konkurrenzen[id]!))].join('\n');
}
