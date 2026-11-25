import { standardEinstellungen, type KonkurrenzEinstellungen } from './modell';
import { einstellungenLesen } from './zustand';

/** Vorgabe (Favorit) geprüft wie ein Eintrag – Favoriten können von anderen Mitgliedern der Sparte stammen (ab 0.18) */
export function alsVorgabe(e: unknown): KonkurrenzEinstellungen {
  try {
    return einstellungenLesen(JSON.parse(JSON.stringify(e ?? {})), standardEinstellungen());
  } catch {
    return standardEinstellungen();
  }
}
