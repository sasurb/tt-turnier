/*
 * Service Worker der Turnier-App – nur für Mitteilungen bei Spielaufruf (keine Zwischenspeicherung,
 * keine Push-Dienste). Ein Tipp auf die Mitteilung holt die geöffnete App nach vorn.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
      for (const f of fenster) if ('focus' in f) return f.focus();
      return self.clients.openWindow ? self.clients.openWindow('./') : undefined;
    }),
  );
});
