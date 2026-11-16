/* ================================
   JAIFORE SERVICE WORKER
   frontend/sw.js

   Caches the app shell so pages still open offline, and NOTHING else:
   API traffic is never touched — in particular /api/auth, /api/cart,
   /api/stripe and /api/orders go straight to the network, so no account or
   payment data can ever be cached or replayed.

   - Pages / scripts / styles: network first (always fresh when online),
     cached copy when offline, offline.html as the last resort for pages.
   - Own images: cached copy shown instantly, refreshed in the background once it is
     a day old and never trusted past a week, so a replaced product photo shows up.
     Google Fonts never change: cache first.
   - Both caches are capped, so they cannot grow without limit.
   Bump CACHE_VERSION to drop old caches after a change here.
   ================================ */
const CACHE_VERSION = 'jaifore-v12';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const ASSET_CACHE   = `${CACHE_VERSION}-assets`;

const PRECACHE = ['offline', 'manifest.webmanifest', 'icons/icon-192.png', 'logo/jaifore-96.webp'];

const MAX_SHELL_ENTRIES = 80;   // pages, scripts, styles (one page per query string adds up)
const MAX_ASSET_ENTRIES = 200;  // images and fonts
const IMAGE_REFRESH_MS  = 24 * 60 * 60 * 1000;      // older than this: show it, refresh behind it
const IMAGE_MAX_AGE_MS  = 7 * 24 * 60 * 60 * 1000;  // older than this: ask the network first

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

// Keep a cache under max entries by removing the oldest (insertion order), never the
// precached shell pieces the offline page depends on.
async function trimCache(cache, max) {
  const keys = await cache.keys();
  const keep = (req) => PRECACHE.some(p => new URL(req.url).pathname === '/' + p);
  const removable = keys.filter(k => !keep(k));
  for (const key of removable.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) { await cache.put(request, res.clone()); trimCache(cache, MAX_SHELL_ENTRIES); }
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
  if (res.ok || res.type === 'opaque') { await cache.put(request, res.clone()); trimCache(cache, MAX_ASSET_ENTRIES); }
  return res;
}

// How old a cached response is, from its Date header. Unknown counts as very old.
function ageOf(response) {
  const t = Date.parse(response.headers.get('date') || '');
  return Number.isFinite(t) ? Date.now() - t : Infinity;
}

// Images we serve ourselves (product photos can be replaced under the same file name).
async function imageWithRefresh(request, cacheName, event) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const refresh = () => fetch(request).then(async (res) => {
    if (res.ok) { await cache.put(request, res.clone()); trimCache(cache, MAX_ASSET_ENTRIES); }
    return res;
  });

  if (cached) {
    const age = ageOf(cached);
    if (age < IMAGE_REFRESH_MS) return cached;            // fresh: no network at all
    if (age < IMAGE_MAX_AGE_MS) {                         // stale: show it now, update for next time
      event.waitUntil(refresh().catch(() => {}));
      return cached;
    }
    return refresh().catch(() => cached);                  // too old: network first, cache if offline
  }
  return refresh();
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
    event.respondWith(networkFirst(request, SHELL_CACHE, 'offline'));
    return;
  }

  // Own scripts and styles
  if (sameOrigin && /\.(js|css)$/.test(url.pathname)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // Own images
  if (sameOrigin && /\.(png|jpe?g|webp|svg|ico)$/.test(url.pathname)) {
    event.respondWith(imageWithRefresh(request, ASSET_CACHE, event));
    return;
  }

  // Own fonts and Google Fonts: they never change under the same URL
  if ((sameOrigin && /\.woff2?$/.test(url.pathname)) ||
      url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});
