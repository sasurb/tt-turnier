/**
 * Einfache Navigation über den Teil nach „#“ – braucht keine Server-Regeln
 * und funktioniert auf jedem Webspace, auf GitHub Pages und in der Android-Zentrale.
 */
export interface Ziel {
  seite: string;
  param: string | null;
  /** weitere Teile, z. B. #/t/<id>/<reiter> */
  rest: string[];
}

function lesen(): Ziel {
  const teile = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);
  return { seite: teile[0] ?? '', param: teile[1] ?? null, rest: teile.slice(2) };
}

export const route = $state<Ziel>(lesen());

addEventListener('hashchange', () => {
  const z = lesen();
  const gleicheSeite = route.seite === z.seite && route.param === z.param;
  route.seite = z.seite;
  route.param = z.param;
  route.rest = z.rest;
  if (!gleicheSeite) scrollTo(0, 0);
});

export function gehe(pfad: string) {
  location.hash = '#/' + pfad.replace(/^\/+/, '');
}

/** Adresse ersetzen, ohne einen Eintrag im Verlauf (Zurück-Taste) anzulegen */
export function ersetze(pfad: string) {
  history.replaceState(null, '', '#/' + pfad.replace(/^\/+/, ''));
  const z = lesen();
  route.seite = z.seite;
  route.param = z.param;
  route.rest = z.rest;
}

export function linkZu(pfad: string) {
  return '#/' + pfad.replace(/^\/+/, '');
}
