import { endstand, nameLang, oeffentlich, platzText, sichtbar } from './engine/abfragen';
import { teilnehmerVon, type TurnierZustand } from './engine/zustand';
import { spielerVon } from './engine/zustand';
import { T } from './texte';

/**
 * Ergebnis-Nachricht nach dem Abschluss (ab 0.18): Ergebnisliste je Konkurrenz und die eigene Platzierung je
 * Spieler. Richtet sich nach den Einstellungen für Zuschauer – Namen in Kurzform, wenn so eingestellt oder bei
 * Jugendturnieren; verdeckte Konkurrenzen erscheinen ohne Stand und ohne Platzierung.
 */
export interface ErgebnisNachricht {
  liste: string;
  plaetze: { spieler: string; text: string }[];
  /** Konkurrenzen mit Endstand */
  mitStand: number;
  verdeckt: boolean;
}

const MAX_LISTE = 49_000;

export function ergebnisNachricht(z: TurnierZustand): ErgebnisNachricht {
  const oz = oeffentlich(z.jugend ? { ...z, namen: 'kurz' } : z);
  const teile: string[] = [[z.name, z.datum ? new Date(z.datum).toLocaleDateString('de-DE') : '', z.ort].filter(Boolean).join(' · ')];
  const je = new Map<string, string[]>();
  let mitStand = 0;
  let verdeckt = false;
  for (const kid of z.konkurrenzReihe) {
    const k = z.konkurrenzen[kid]!;
    if (!k.gestartet.gruppen && !k.gestartet.ko) continue;
    if (!sichtbar(z, k).tabellen) {
      verdeckt = true;
      teile.push(`${k.einst.name}: ${T.ergebnisMail.nichtVeroeffentlicht}`);
      continue;
    }
    const es = endstand(k);
    if (!es.length) continue;
    mitStand++;
    teile.push([k.einst.name, ...es.map((p) => `${p.bezeichnung}. ${nameLang(oz, p.id, k)}`)].join('\n'));
    for (const p of es) {
      for (const sid of spielerVon(k, p.id)) {
        if (teilnehmerVon(k, sid) !== p.id) continue;
        const l = je.get(sid) ?? [];
        l.push(`${k.einst.name}: ${platzText(p.bezeichnung)}`);
        je.set(sid, l);
      }
    }
  }
  let liste = teile.join('\n\n');
  if (liste.length > MAX_LISTE) liste = liste.slice(0, MAX_LISTE) + '\n…';
  const plaetze = z.spielerReihe.filter((sid) => je.has(sid)).map((sid) => ({ spieler: sid, text: je.get(sid)!.join('\n').slice(0, 600) }));
  return { liste, plaetze, mitStand, verdeckt };
}
