/* ================================
   JAIFORE SERVICE WORKER
   frontend/sw.js

   Caches the app shell so pages still open offline, and NOTHING else:
   API traffic is never touched — in particular /api/auth, /api/cart,
   /api/stripe and /api/orders go straight to the network, so no account or
   payment data can ever be cached or replayed.

   - Pages / scripts / styles: network first (always fresh when online),
     cached copy when offline, offline.html as the last resort for pages.
   - Images / fonts: cache first.
   Bump CACHE_VERSION to drop old caches after a change here.
   ================================ */
const CACHE_VERSION = 'jaifore-v7';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const ASSET_CACHE   = `${CACHE_VERSION}-assets`;

const PRECACHE = ['offline.html', 'manifest.webmanifest', 'icons/icon-192.png', 'logo/jaifore-96.webp'];

// Never answered from cache, whichever host serves them
const NETWORK_ONLY = ['/api/auth', '/api/cart', '/api/stripe', '/api/orders', '/api/wishlist', '/api/users', '/api/transactions', '/api/qr'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || (fallbackUrl ? caches.match(fallbackUrl) : Response.error());
  }
}

async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

// Web push from the backend (new-order alerts for the admin)
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* not JSON */ }
  event.waitUntil(self.registration.showNotification(data.title || "Jai'fore", {
    body: data.body || 'You have a new order.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'jaifore-order',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: '/admin/admin.html' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.includes(url) && 'focus' in c);
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API calls: leave to the browser. (Network-only list is explicit for the sensitive ones.)
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/') || NETWORK_ONLY.some(p => url.pathname.startsWith(p))) return;

  const sameOrigin = url.origin === self.location.origin;

  // Pages
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, 'offline.html'));
    return;
  }

  // Own scripts and styles
  if (sameOrigin && /\.(js|css)$/.test(url.pathname)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // Own images + Google Fonts
  if ((sameOrigin && /\.(png|jpe?g|webp|svg|ico|woff2?)$/.test(url.pathname)) ||
      url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});
