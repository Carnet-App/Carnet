// Push notifications for Carnet (loaded into the main service worker).
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Carnet', body: event.data?.text() }; }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Carnet', {
      body: d.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: d.tag,
      data: { url: d.url || '/' },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) { c.navigate?.(url); return c.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
