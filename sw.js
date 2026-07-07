// SINC2026 portal service worker — just enough to (a) make the site
// installable (PWA requirement) and (b) receive Web Push notifications and
// show them, plus route a click on one to the right page. Deliberately no
// offline caching here — this is a live congress admin tool, so serving
// stale data offline would be worse than no service worker at all.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'SINC2026', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'SINC2026';
  const options = {
    body: data.body || '',
    icon: 'img/icon-192.png',
    badge: 'img/icon-192.png',
    data: { url: data.url || 'login.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || 'login.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
