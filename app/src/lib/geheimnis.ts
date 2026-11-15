/**
 * Geheimnis, mit dem die Hülle (Android-App oder Start am PC) die App geöffnet hat: …/?zentrale=<geheimnis>.
 * Nur mit diesem Geheimnis nimmt die Zentrale Geräte-Routen (zentrale.*) an – so kann keine fremde
 * Webseite im Browser des Handys die Zentrale über 127.0.0.1 steuern. Wird im Sitzungsspeicher gehalten
 * und aus der Adresse entfernt, damit es nicht in geteilten Links landet.
 */
const GEHEIMNIS_SCHLUESSEL = 'tt-zentrale-geheimnis';
export function zentraleGeheimnis(): string | null {
  try {
    const q = new URLSearchParams(location.search);
    const neu = q.get('zentrale');
    if (neu && /^[0-9a-f]{32}$/.test(neu)) {
      sessionStorage.setItem(GEHEIMNIS_SCHLUESSEL, neu);
      q.delete('zentrale');
      const rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    }
    return sessionStorage.getItem(GEHEIMNIS_SCHLUESSEL);
  } catch {
    return null;
  }
}
