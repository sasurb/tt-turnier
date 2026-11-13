/**
 * Einfache Navigation über den Teil nach „#“ – braucht keine Server-Regeln
 * und funktioniert auf jedem Webspace, auf GitHub Pages und in der Android-Zentrale.
 */
export interface Ziel {
  seite: string;
  param: string | null;
}

function lesen(): Ziel {
  const teile = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  return { seite: teile[0] ?? '', param: teile[1] ? decodeURIComponent(teile[1]) : null };
}

export const route = $state<Ziel>(lesen());

addEventListener('hashchange', () => {
  const z = lesen();
  route.seite = z.seite;
  route.param = z.param;
  scrollTo(0, 0);
});

export function gehe(pfad: string) {
  location.hash = '#/' + pfad.replace(/^\/+/, '');
}

export function linkZu(pfad: string) {
  return '#/' + pfad.replace(/^\/+/, '');
}
