/* SANDY service worker: shows reminder notifications (Web Push). No offline caching.
   New installs wait until the page posts {type:'SKIP_WAITING'} (update banner tap, or
   first-visit auto-activate in push.js) so a deploy never silently swaps the running page. */
self.addEventListener('install', () => {
  /* stay in waiting until SKIP_WAITING — do not call skipWaiting() here */
});
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'SANDY', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SANDY reminder', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: 'icons/icon-192.png', badge: 'icons/badge-72.png',
    data: { url: d.url || './' }, timestamp: Date.now(),
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  // Only open URLs under this app's scope (ignore absolute third-party links in the push payload).
  let url = self.registration.scope;
  try {
    const raw = (e.notification.data && e.notification.data.url) || './';
    const abs = new URL(raw, self.registration.scope);
    if (abs.href.startsWith(self.registration.scope)) url = abs.href;
  } catch (_) {}
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); try { await c.navigate(url); } catch (_) {} return; }
    }
    await self.clients.openWindow(url);
  })());
});
