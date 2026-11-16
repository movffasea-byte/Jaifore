/* ================================
   JAIFORE — SERVICE WORKER + HERO PERFORMANCE TESTS
   backend/test/frontend-perf.test.js

   Runs the real frontend/sw.js and frontend/scripts/hero-3d.js in a sandbox with
   fake caches, network and DOM. Run with: npx jest test/frontend-perf.test.js
   ================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const read = (f) => fs.readFileSync(path.join(FRONTEND, f), 'utf8');

const DAY = 24 * 60 * 60 * 1000;
const ORIGIN = 'https://jaifore.org';

// ── service worker harness ─────────────────────────────
class FakeCache {
  constructor() { this.map = new Map(); }
  async put(req, res) { this.map.set(req.url, [req, res]); }
  async match(req) { const e = this.map.get(req.url || req); return e ? e[1].clone() : undefined; }
  async keys() { return [...this.map.values()].map(e => e[0]); }
  async delete(req) { return this.map.delete(req.url); }
  async addAll(urls) { for (const u of urls) this.map.set(`${ORIGIN}/${u}`, [{ url: `${ORIGIN}/${u}` }, new Response('pre')]); }
}

function loadSW() {
  const stores = new Map();
  const listeners = {};
  const caches = {
    open: async (name) => { if (!stores.has(name)) stores.set(name, new FakeCache()); return stores.get(name); },
    keys: async () => [...stores.keys()],
    delete: async (k) => stores.delete(k),
    match: async (u) => { for (const s of stores.values()) { const m = await s.match({ url: `${ORIGIN}/${u}` }); if (m) return m; } },
  };
  const network = { fetch: jest.fn() };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {}, clients: { claim: () => {}, matchAll: async () => [] }, registration: {},
  };
  vm.runInNewContext(read('sw.js'), {
    self, caches, URL, Response, Date, Promise, console,
    fetch: (...a) => network.fetch(...a),
  });
  const handle = async (url, extra = {}) => {
    const request = { method: 'GET', url, mode: 'no-cors', ...extra };
    const waits = [];
    let responded;
    listeners.fetch({ request, respondWith: (p) => { responded = p; }, waitUntil: (p) => waits.push(p) });
    const response = responded ? await responded : undefined;
    await Promise.all(waits);
    return { response, handled: !!responded };
  };
  return { stores, network, handle, caches };
}

const img = (body, ageMs = 0) => new Response(body, { headers: { date: new Date(Date.now() - ageMs).toUTCString() } });
const seed = async (sw, url, body, ageMs) => (await sw.caches.open('jaifore-v12-assets')).put({ url }, img(body, ageMs));
const PHOTO = `${ORIGIN}/images/tee-front.jpg`;

describe('service worker: product photos', () => {
  it('fetches and stores a photo it has not seen', async () => {
    const sw = loadSW(); sw.network.fetch.mockResolvedValue(img('NEW'));
    const { response } = await sw.handle(PHOTO);
    expect(await response.text()).toBe('NEW');
    expect(sw.stores.get('jaifore-v12-assets').map.has(PHOTO)).toBe(true);
  });

  it('serves a photo under a day old from the cache without touching the network', async () => {
    const sw = loadSW(); await seed(sw, PHOTO, 'OLD', 2 * 60 * 60 * 1000);
    const { response } = await sw.handle(PHOTO);
    expect(await response.text()).toBe('OLD');
    expect(sw.network.fetch).not.toHaveBeenCalled();
  });

  it('shows a 2-day-old photo at once and refreshes it behind the scenes, so a replaced photo appears next visit', async () => {
    const sw = loadSW(); await seed(sw, PHOTO, 'OLD', 2 * DAY);
    sw.network.fetch.mockResolvedValue(img('REPLACED'));
    const first = await sw.handle(PHOTO);
    expect(await first.response.text()).toBe('OLD');          // instant
    expect(sw.network.fetch).toHaveBeenCalledTimes(1);          // refreshed behind it
    const second = await sw.handle(PHOTO);
    expect(await second.response.text()).toBe('REPLACED');      // the new photo shows up
  });

  it('never trusts a photo older than a week: network first', async () => {
    const sw = loadSW(); await seed(sw, PHOTO, 'ANCIENT', 10 * DAY);
    sw.network.fetch.mockResolvedValue(img('FRESH'));
    expect(await (await sw.handle(PHOTO)).response.text()).toBe('FRESH');
  });

  it('still shows an ancient cached photo when offline', async () => {
    const sw = loadSW(); await seed(sw, PHOTO, 'ANCIENT', 10 * DAY);
    sw.network.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await sw.handle(PHOTO)).response.text()).toBe('ANCIENT');
  });

  it('treats a photo with no Date header as stale (refreshes it)', async () => {
    const sw = loadSW(); await (await sw.caches.open('jaifore-v12-assets')).put({ url: PHOTO }, new Response('NODATE'));
    sw.network.fetch.mockResolvedValue(img('NEW'));
    await sw.handle(PHOTO);
    expect(sw.network.fetch).toHaveBeenCalled();
  });

  it('keeps the photo cache under its cap, dropping the oldest', async () => {
    const sw = loadSW(); sw.network.fetch.mockImplementation(async () => img('x'));
    for (let i = 0; i < 230; i++) await sw.handle(`${ORIGIN}/images/p${i}.jpg`);
    await new Promise(r => setImmediate(r));
    const cache = sw.stores.get('jaifore-v12-assets');
    expect(cache.map.size).toBeLessThanOrEqual(200);
    expect(cache.map.has(`${ORIGIN}/images/p229.jpg`)).toBe(true);   // newest kept
    expect(cache.map.has(`${ORIGIN}/images/p0.jpg`)).toBe(false);    // oldest dropped
  });
});

describe('service worker: pages and the rest', () => {
  it('caps the page cache but never evicts the offline page', async () => {
    const sw = loadSW();
    await (await sw.caches.open('jaifore-v12-shell')).addAll(['offline', 'manifest.webmanifest']);
    sw.network.fetch.mockImplementation(async () => new Response('page'));
    for (let i = 0; i < 120; i++) await sw.handle(`${ORIGIN}/category?cat=x${i}`, { mode: 'navigate' });
    await new Promise(r => setImmediate(r));
    const cache = sw.stores.get('jaifore-v12-shell');
    expect(cache.map.size).toBeLessThanOrEqual(80);
    expect(cache.map.has(`${ORIGIN}/offline`)).toBe(true);
    expect(cache.map.has(`${ORIGIN}/manifest.webmanifest`)).toBe(true);
  });

  it('falls back to the offline page when a page cannot be loaded', async () => {
    const sw = loadSW();
    await (await sw.caches.open('jaifore-v12-shell')).addAll(['offline']);
    sw.network.fetch.mockRejectedValue(new Error('offline'));
    const { response } = await sw.handle(`${ORIGIN}/services`, { mode: 'navigate' });
    expect(await response.text()).toBe('pre');
  });

  it('leaves API calls alone, including the sensitive ones', async () => {
    const sw = loadSW();
    for (const p of ['/api/auth/login', '/api/cart', '/api/stripe/quote', '/api/orders/my', '/api/products']) {
      expect((await sw.handle(`${ORIGIN}${p}`)).handled).toBe(false);
    }
  });

  it('leaves non-GET requests alone', async () => {
    const sw = loadSW();
    expect((await sw.handle(PHOTO, { method: 'POST' })).handled).toBe(false);
  });

  it('keeps Google Fonts cache-first', async () => {
    const sw = loadSW(); sw.network.fetch.mockResolvedValue(new Response('FONT'));
    const url = 'https://fonts.gstatic.com/s/dmsans/v1/x.woff2';
    await sw.handle(url);
    await sw.handle(url);
    expect(sw.network.fetch).toHaveBeenCalledTimes(1);
  });

  it('bumped the cache version so old caches are dropped', () => {
    expect(read('sw.js')).toMatch(/CACHE_VERSION = 'jaifore-v12'/);
  });
});

// ── 3D hero gate ───────────────────────────────────────
function runHero({ narrow = false, connection } = {}) {
  const created = [];
  const ring = { querySelector: () => ({}) };
  const document = {
    querySelector: () => ring,
    createElement: (tag) => { created.push(tag); return { getContext: () => null }; },
    head: { appendChild: () => {} },
    addEventListener: () => {},
  };
  const window = {
    matchMedia: (q) => ({ matches: /max-width/.test(q) ? narrow : false }),
    addEventListener: () => {},
  };
  vm.runInNewContext(read('scripts/hero-3d.js'), { window, document, navigator: { connection }, console, setTimeout, Promise });
  return created;
}

describe('3D hero logo', () => {
  it('does nothing on a phone-sized screen (keeps the flat logo, downloads no three.js)', () => {
    expect(runHero({ narrow: true })).toEqual([]);
  });

  it('does nothing in data-saver mode', () => {
    expect(runHero({ connection: { saveData: true, effectiveType: '4g' } })).toEqual([]);
  });

  it.each(['slow-2g', '2g', '3g'])('does nothing on a %s connection', (effectiveType) => {
    expect(runHero({ connection: { saveData: false, effectiveType } })).toEqual([]);
  });

  it('still proceeds on a desktop with a good connection', () => {
    expect(runHero({ connection: { saveData: false, effectiveType: '4g' } })).toEqual(['canvas']); // reached the WebGL check
    expect(runHero({})).toEqual(['canvas']);
  });
});
