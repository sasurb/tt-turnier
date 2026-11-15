// Aufruf ohne Schrägstrich am Ende (…/tt-turnier) korrigieren, damit relative Pfade stimmen.
// Eigene Datei statt Inline-Skript, damit die Content-Security-Policy ohne 'unsafe-inline' auskommt.
if (!/\/$|\.html$/.test(location.pathname)) location.replace(location.pathname + '/' + location.search + location.hash);
