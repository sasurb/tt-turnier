/*
 * Service Worker der Turnier-App (wird beim Bauen aus app/sw/sw-vorlage.js erzeugt).
 *
 * 1. Offline: Die App selbst (HTML, Skripte, Stile) liegt zwischengespeichert auf dem Gerät. So öffnet
 *    sie sich auch ohne Netz – z. B. in der Halle beim Training, um vorab gezahltes Startgeld zu buchen.
 *    Turnierdaten speichert die App ohnehin in IndexedDB und trägt Einträge nach, sobald wieder Netz da ist.
 *    Die Schnittstelle (api/) wird nie zwischengespeichert.
 * 2. Mitteilungen bei Spielaufruf: Ein Tipp auf die Mitteilung holt die geöffnete App nach vorn.
 */
const VERSION = '__VERSION__';
const CACHE = `tt-turnier-${VERSION}`;
const DATEIEN = __DATEIEN__;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(DATEIEN.map((d) => new Request(d, { cache: 'reload' }))))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((namen) => Promise.all(namen.filter((n) => n.startsWith('tt-turnier-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/** Netz zuerst, aber nicht ewig warten (schwaches Hallen-WLAN): nach 4 s die gespeicherte Seite */
function mitFrist(anfrage, ms) {
  return new Promise((ok, fehler) => {
    const t = setTimeout(() => fehler(new Error('Zeit')), ms);
    fetch(anfrage).then(
      (r) => {
        clearTimeout(t);
        ok(r);
      },
      (x) => {
        clearTimeout(t);
        fehler(x);
      },
    );
  });
}

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin) return;
  const basis = new URL('./', self.location.href).pathname;
  if (!url.pathname.startsWith(basis)) return;
  const pfad = url.pathname.slice(basis.length);
  // Schnittstelle, Versionsdatei und Einrichtung immer live
  if (pfad.startsWith('api/') || pfad === 'version.txt' || pfad === 'sw.js') return;

  if (r.mode === 'navigate') {
    e.respondWith(
      mitFrist(r, 4000)
        .then((antwort) => {
          if (antwort.ok && (pfad === '' || pfad === 'index.html')) {
            const kopie = antwort.clone();
            void caches.open(CACHE).then((c) => c.put('./', kopie));
          }
          return antwort;
        })
        .catch(() => caches.open(CACHE).then((c) => c.match('./').then((m) => m || c.match('./index.html')).then((m) => m || Response.error()))),
    );
    return;
  }
  // Dateien mit Prüfsumme im Namen ändern sich nie: zuerst aus dem Zwischenspeicher
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(r).then(
        (m) =>
          m ||
          fetch(r).then((antwort) => {
            if (antwort.ok && antwort.type === 'basic' && pfad.startsWith('assets/')) void c.put(r, antwort.clone());
            return antwort;
          }),
      ),
    ),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
      for (const f of fenster) if ('focus' in f) return f.focus();
      return self.clients.openWindow ? self.clients.openWindow('./') : undefined;
    }),
  );
});
