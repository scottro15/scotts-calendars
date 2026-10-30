/* SANDY service worker: reminder notifications (Web Push) + an offline fallback.
   New installs wait until the page posts {type:'SKIP_WAITING'} (update banner tap, or
   first-visit auto-activate in push.js) so a deploy never silently swaps the running page.
   Caching (t135u): precache the app shell + offline.html; pages are NETWORK-FIRST (updates land
   immediately, the offline page only shows when the network fails); same-origin static files are
   network-first with the last good copy as fallback. Never touched: other origins (Supabase API,
   auth, storage, CDNs), version.json (update check), sw.js, non-GET requests. */
const CACHE = 'sandy-shell-v1';
const SHELL = ['./', 'index.html', 'offline.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/fullcalendar.min.js', 'vendor/supabase.min.js',
  'storage.js', 'places.js', 'titleac.js', 'motion.js', 'push.js', 'update.js', 'nav.js', 'navbar.js', 'app.js', 'quicksheet.js', 'ai.js', 'backnav.js', 'install.js'];

self.addEventListener('install', e => {
  /* stay in waiting until SKIP_WAITING — do not call skipWaiting() here.
     Precache best-effort: a missing file must never fail the install (that would block updates). */
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u =>
    fetch(new Request(u, { cache: 'reload' })).then(r => { if (r.ok) return c.put(new URL(u, self.registration.scope).href, r); })))));
});
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith('sandy-') && k !== CACHE).map(k => caches.delete(k)));
  try { if (self.registration.navigationPreload) await self.registration.navigationPreload.enable(); } catch (_) {}
  await self.clients.claim();
})()));

const SKIP = /\/(version\.json|sw\.js|config\.js)$/;
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !req.url.startsWith(self.registration.scope)) return; // Supabase & CDNs: untouched
  if (SKIP.test(url.pathname) || url.pathname.endsWith('.json')) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const pre = e.preloadResponse ? await e.preloadResponse : null;
        return pre || await fetch(req);
      } catch (_) {
        const c = await caches.open(CACHE);
        return (await c.match(new URL('offline.html', self.registration.scope).href)) || Response.error();
      }
    })());
    return;
  }
  if (!/\.(js|css|png|svg|webmanifest|ico|woff2?)$/.test(url.pathname)) return;
  e.respondWith((async () => {
    const key = url.origin + url.pathname; // one copy per file, whatever the ?v= tag
    try {
      const r = await fetch(req);
      if (r && r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {}); }
      return r;
    } catch (err) {
      const hit = await caches.match(key);
      if (hit) return hit;
      throw err;
    }
  })());
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'SANDY', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SANDY reminder', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: 'icons/icon-192.png', badge: 'icons/badge-72.png',
    data: { url: d.url || './' }, timestamp: Date.now(),
  }));
});

// The browser rotated or expired this device's push subscription: get a new one with the same key.
// The app re-saves it to the server the next time it opens (push.js resync); the old one 410s and is removed.
self.addEventListener('pushsubscriptionchange', e => {
  const opts = e.oldSubscription && e.oldSubscription.options;
  if (!opts || !opts.applicationServerKey) return;
  e.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: opts.applicationServerKey }).catch(() => {}));
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
