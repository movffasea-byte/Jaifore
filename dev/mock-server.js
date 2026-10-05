/* ================================
   JAIFORE LOCAL MOCK SERVER (dev only)
   dev/mock-server.js

   Serves frontend/ and fakes /api/* with in-memory data so the UI can be
   viewed with no backend, database or internet. Zero dependencies.

     node dev/mock-server.js            -> http://localhost:5173

   The hard-coded Railway URL in the served JS/HTML is rewritten to this
   server on the fly; the files on disk are never modified.

   Test the loader/error states from the browser:
     /__mock/offline?on=1   every /api call fails (error + Retry states)
     /__mock/offline?on=0   back to normal
     /__mock/slow?ms=4000   delay every /api response (see skeletons)
   Logins: admin@jaifore.test / admin123  (admin) — anything else = customer
   ================================ */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT     = parseInt(process.env.PORT, 10) || 5173;
const ROOT     = path.join(__dirname, '..', 'frontend');
const ORIGIN   = `http://localhost:${PORT}`;
const RAILWAY  = 'https://jai-fore-production.up.railway.app';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

// ── Fake data ────────────────────────────────────────
const DAY = 86400000;
const ago = (d, h = 0) => new Date(Date.now() - d * DAY - h * 3600000).toISOString();

const PRINT = [
  { id: 1, size_label: 'Small',  dimensions: '3 x 3 in',   price: '2.00' },
  { id: 2, size_label: 'Medium', dimensions: '6 x 6 in',   price: '5.00' },
  { id: 3, size_label: 'Large',  dimensions: '10 x 10 in', price: '8.00' },
];

const images = fs.existsSync(path.join(ROOT, 'images'))
  ? fs.readdirSync(path.join(ROOT, 'images')).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort()
  : [];
const img = i => (images.length ? `/images/${images[i % images.length]}` : '');

const APPAREL = ['Classic Tee', 'Oversized Hoodie', 'Crew Sweatshirt', 'Polo Shirt', 'Tank Top', 'Long Sleeve Tee',
                 'Zip Hoodie', 'Cap', 'Tote Bag', 'Joggers', 'Varsity Jacket', 'Mug'];
const stockFor = [24, 3, 40, 12, 2, 18, 9, 60, 5, 14, 30, 8];
let nextProductId = 1;
const products = [];
APPAREL.forEach((name, i) => products.push({
  id: nextProductId++, name, category: 'Apparels & Merchandise', price: (12 + i * 3.5).toFixed(2),
  description: `${name} — soft, durable and ready for your design.`, image_url: img(i), thumb_url: null,
  stock: stockFor[i], in_stock: stockFor[i] > 0, print_size_ids: [], print_sizes: [], created_at: ago(40 - i),
}));
for (let i = 0; i < 141; i++) {
  const ids = i % 5 === 0 ? [1, 2, 3] : i % 3 === 0 ? [2, 3] : [1, 2];
  products.push({
    id: nextProductId++, name: `Graphic Design ${String(i + 1).padStart(3, '0')}`, category: 'Graphic Design',
    price: null, description: 'Ready-to-print artwork.', image_url: img(12 + i), thumb_url: null, stock: null,
    in_stock: true, print_size_ids: ids, print_sizes: ids.map(id => PRINT.find(p => p.id === id)), created_at: ago(30, i),
  });
}
['Landing Page', 'Online Store'].forEach(name => products.push({
  id: nextProductId++, name, category: 'Web Development', price: null, description: 'Enquiry only.',
  image_url: img(3), thumb_url: null, stock: null, in_stock: true, print_size_ids: [], print_sizes: [], created_at: ago(20),
}));

const users = [
  { id: 1, name: 'Admin',         email: 'admin@jaifore.test', role: 'admin', verified: true,  created_at: ago(90) },
  { id: 2, name: 'Ada Obi',       email: 'ada@example.com',    role: 'user',  verified: true,  created_at: ago(40) },
  { id: 3, name: 'Tunde Bello',   email: 'tunde@example.com',  role: 'user',  verified: true,  created_at: ago(25) },
  { id: 4, name: 'Chioma Eze',    email: 'chioma@example.com', role: 'user',  verified: false, created_at: ago(8)  },
  { id: 5, name: 'Sam Carter',    email: 'sam@example.com',    role: 'user',  verified: true,  created_at: ago(3)  },
];

const STATUSES = ['processing', 'shipped', 'delivered', 'delivered', 'delivered', 'cancelled'];
const orders = [], transactions = [];
for (let i = 0; i < 28; i++) {
  const u = users[1 + (i % 4)], p = products[i % 12];
  const total = +(p.price * (1 + (i % 3)) + 5 * (i % 4)).toFixed(2);
  const status = STATUSES[i % STATUSES.length];
  const created = ago(Math.floor(i * 1.1), i % 9);
  const refunded = i === 11;
  orders.push({
    id: 100 + i, user_id: u.id, customer_name: u.name, customer_email: u.email, total: total.toFixed(2), currency: 'USD',
    status, payment_status: refunded ? 'refunded' : 'paid', payment_ref: `cs_test_${1000 + i}`, created_at: created,
    items: [{ id: p.id, name: p.name, quantity: 1 + (i % 3), price: p.price, image: p.image_url,
              designs: [{ name: 'Graphic Design 004', printSize: PRINT[i % 3] }] }],
  });
  transactions.push({
    id: 500 + i, order_id: 100 + i, user_id: u.id, customer_name: u.name, customer_email: u.email,
    amount: total.toFixed(2), reference: `pi_test_${2000 + i}`, status: i % 9 === 8 ? 'failed' : 'success',
    payment_method: 'stripe', created_at: created,
  });
}

const qrCodes = [
  { id: 1, slug: 'summer-sale', destination_url: 'https://jai-fore.vercel.app/category.html', label: 'Summer sale flyer', is_active: true,  created_at: ago(30), scan_count: 42 },
  { id: 2, slug: 'tee-tag',     destination_url: 'https://jai-fore.vercel.app/services.html', label: 'T-shirt hang tag',  is_active: true,  created_at: ago(14), scan_count: 7  },
  { id: 3, slug: 'old-promo',   destination_url: 'https://jai-fore.vercel.app/',               label: 'Old promo',         is_active: false, created_at: ago(60), scan_count: 0  },
];

let wishlist = [], recent = [], nextId = 9000;
let offline = false, slowMs = 0;

// ── Helpers ──────────────────────────────────────────
const dateKey = iso => iso.slice(0, 10);
const sum = (arr, f) => arr.reduce((s, x) => s + parseFloat(f(x) || 0), 0);
const paid = () => orders.filter(o => o.payment_status === 'paid' && o.status !== 'cancelled');

function userFrom(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  if (t === 'mock-admin') return users[0];
  if (t === 'mock-user')  return users[1];
  return null;
}

function revenueSeries(period) {
  const buckets = new Map();
  const n = period === 'monthly' ? 12 : period === 'weekly' ? 12 : 30;
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * (period === 'daily' ? DAY : period === 'weekly' ? 7 * DAY : 30 * DAY));
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  const keys = [...buckets.keys()];
  paid().forEach(o => {
    const k = keys.filter(k => k <= dateKey(o.created_at)).pop();
    if (k) buckets.set(k, buckets.get(k) + parseFloat(o.total));
  });
  return [...buckets].map(([date, revenue]) => ({ date, revenue: +revenue.toFixed(2) }));
}

function qrSvg(slug) {
  let cells = '';
  let h = 0; for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
    h = (h * 1103515245 + 12345) >>> 0;
    if ((h >> 16) & 1) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 23 23" width="256" height="256"><rect x="-1" y="-1" width="23" height="23" fill="#fff"/>${cells}</svg>`;
}

// ── API router ───────────────────────────────────────
function api(req, url, body, send) {
  const m = req.method, p = url.pathname.replace(/^\/api/, ''), q = url.searchParams;
  const me = userFrom(req);
  const need  = () => { if (!me) { send(401, { error: 'Not logged in.' }); return false; } return true; };
  const admin = () => { if (!need()) return false; if (me.role !== 'admin') { send(403, { error: 'Admins only.' }); return false; } return true; };
  let r;

  // auth
  if (p === '/auth/login' && m === 'POST') {
    const email = (body.email || '').toLowerCase().trim();
    if (!email || !body.password) return send(400, { error: 'Email and password are required.' });
    const isAdmin = email === 'admin@jaifore.test' && body.password === 'admin123';
    if (email === 'admin@jaifore.test' && !isAdmin) return send(401, { error: 'Invalid credentials.' });
    const user = isAdmin ? users[0] : { id: 2, name: email.split('@')[0], email, role: 'user' };
    return send(200, { token: isAdmin ? 'mock-admin' : 'mock-user', user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  }
  if (p.startsWith('/auth/')) return send(200, { message: 'OK (mock).', valid: true, user: me || users[1], token: 'mock-user' });

  // products
  if (p === '/products' && m === 'GET') {
    let list = products.slice();
    const cat = q.get('category'), s = (q.get('search') || '').toLowerCase();
    if (cat) list = list.filter(x => x.category.toLowerCase() === cat.toLowerCase());
    if (s)   list = list.filter(x => (x.name + x.description).toLowerCase().includes(s));
    list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const off = parseInt(q.get('offset'), 10) || 0, lim = parseInt(q.get('limit'), 10);
    if (off) list = list.slice(off);
    if (lim) list = list.slice(0, lim);
    if (q.get('fields') === 'lite') list = list.map(({ id, name, image_url, thumb_url, print_size_ids }) => ({ id, name, image_url, thumb_url, print_size_ids }));
    return send(200, list);
  }
  if (p === '/products/alerts/low-stock') {
    if (!admin()) return;
    return send(200, { threshold: 5, products: products.filter(x => x.category === 'Apparels & Merchandise' && x.stock !== null && x.stock <= 5) });
  }
  if ((r = p.match(/^\/products\/(\d+)\/stock$/))) {
    const x = products.find(v => v.id === +r[1]); if (!x) return send(404, { error: 'Not found.' });
    x.stock = body.stock !== undefined ? +body.stock : Math.max(0, (x.stock || 0) + (+body.delta || +body.change || +body.adjustment || 0));
    x.in_stock = x.stock > 0; return send(200, x);
  }
  if ((r = p.match(/^\/products\/(\d+)$/))) {
    const x = products.find(v => v.id === +r[1]);
    if (!x) return send(404, { error: 'Product not found.' });
    if (m === 'GET') return send(200, x);
    if (!admin()) return;
    if (m === 'DELETE') { products.splice(products.indexOf(x), 1); return send(200, { success: true }); }
    Object.assign(x, body); return send(200, x);
  }
  if (p === '/products' && m === 'POST') {
    if (!admin()) return;
    const x = { id: nextProductId++, created_at: new Date().toISOString(), print_sizes: [], ...body };
    x.print_sizes = (x.print_size_ids || []).map(id => PRINT.find(s => s.id === id)).filter(Boolean);
    products.unshift(x); return send(201, x);
  }

  // print pricing
  if (p === '/print-pricing' && m === 'GET') return send(200, PRINT);
  if ((r = p.match(/^\/print-pricing\/(\d+)$/)) && m === 'PUT') {
    if (!admin()) return;
    const x = PRINT.find(v => v.id === +r[1]); if (!x) return send(404, { error: 'Price not found.' });
    x.price = (+body.price).toFixed(2); return send(200, x);
  }

  // orders
  if (p === '/orders' && m === 'GET') { if (!admin()) return; return send(200, orders); }
  if (p === '/orders/my')             { if (!need()) return; return send(200, orders.filter(o => o.user_id === me.id)); }
  if (p === '/orders/revenue/quick-totals') {
    if (!admin()) return;
    const t = Date.now(), within = ms => sum(paid().filter(o => t - new Date(o.created_at) < ms), o => o.total);
    return send(200, { today: within(DAY), this_week: within(7 * DAY), this_month: within(30 * DAY) });
  }
  if (p === '/orders/revenue/summary') { if (!admin()) return; return send(200, { period: q.get('period') || 'daily', series: revenueSeries(q.get('period') || 'daily') }); }
  if ((r = p.match(/^\/orders\/by-date\/(.+)$/))) { if (!admin()) return; return send(200, orders.filter(o => dateKey(o.created_at) === r[1])); }
  if ((r = p.match(/^\/orders\/(\d+)\/timeline$/))) return send(200, [
    { status: 'processing', created_at: ago(3) }, { status: 'shipped', created_at: ago(2) }]);
  if ((r = p.match(/^\/orders\/(\d+)\/status$/))) {
    if (!admin()) return;
    const o = orders.find(v => v.id === +r[1]); if (!o) return send(404, { error: 'Order not found.' });
    o.status = body.status; return send(200, o);
  }
  if ((r = p.match(/^\/orders\/(\d+)\/refund$/))) {
    if (!admin()) return;
    const o = orders.find(v => v.id === +r[1]); if (!o) return send(404, { error: 'Order not found.' });
    o.payment_status = 'refunded'; return send(200, { success: true, order: o });
  }

  // transactions
  if (p === '/transactions') { if (!admin()) return; return send(200, transactions); }
  if ((r = p.match(/^\/transactions\/by-date\/(.+)$/))) { if (!admin()) return; return send(200, transactions.filter(t => dateKey(t.created_at) === r[1])); }
  if ((r = p.match(/^\/transactions\/summary\/(\d+)\/(\d+)$/))) {
    if (!admin()) return;
    const by = {};
    transactions.forEach(t => {
      const d = new Date(t.created_at);
      if (d.getUTCFullYear() === +r[1] && d.getUTCMonth() + 1 === +r[2]) {
        const k = dateKey(t.created_at); by[k] = by[k] || { date: k, count: 0, total: 0 };
        by[k].count++; by[k].total += parseFloat(t.amount);
      }
    });
    return send(200, Object.values(by));
  }

  // users
  if (p === '/users') { if (!admin()) return; return send(200, users); }

  // QR
  if (p === '/qr' && m === 'GET') { if (!admin()) return; return send(200, qrCodes); }
  if (p === '/qr' && m === 'POST') {
    if (!admin()) return;
    if (!body.slug || !body.destinationUrl) return send(400, { error: 'slug and destinationUrl are required.' });
    if (qrCodes.some(c => c.slug === body.slug)) return send(409, { error: 'A QR code with this slug already exists.' });
    const c = { id: nextId++, slug: body.slug, destination_url: body.destinationUrl, label: body.label || null, is_active: true, created_at: new Date().toISOString(), scan_count: 0 };
    qrCodes.unshift(c); return send(201, c);
  }
  if ((r = p.match(/^\/qr\/(\d+)\/image$/))) {
    const c = qrCodes.find(v => v.id === +r[1]); if (!c) return send(404, { error: 'QR code not found.' });
    return send(200, qrSvg(c.slug), 'image/svg+xml');
  }
  if ((r = p.match(/^\/qr\/(\d+)\/stats$/))) {
    const c = qrCodes.find(v => v.id === +r[1]); if (!c) return send(404, { error: 'QR code not found.' });
    const dailyScans = Array.from({ length: 10 }, (_, i) => ({ day: ago(9 - i), count: c.scan_count ? 1 + ((i * 7 + c.id) % 9) : 0 })).filter(d => d.count);
    return send(200, { code: c, totalScans: sum(dailyScans, d => d.count), dailyScans });
  }
  if ((r = p.match(/^\/qr\/(\d+)$/))) {
    const c = qrCodes.find(v => v.id === +r[1]); if (!c) return send(404, { error: 'QR code not found.' });
    if (m === 'GET') return send(200, c);
    if (!admin()) return;
    if (m === 'DELETE') { qrCodes.splice(qrCodes.indexOf(c), 1); return send(200, { success: true }); }
    if (body.slug !== undefined) c.slug = body.slug;
    if (body.destinationUrl !== undefined) c.destination_url = body.destinationUrl;
    if (body.label !== undefined) c.label = body.label;
    if (body.isActive !== undefined) c.is_active = !!body.isActive;
    return send(200, c);
  }

  // cart (server sync is best-effort in the UI; empty server cart = local cart wins)
  if (p === '/cart' && m === 'GET')  return send(200, []);
  if (p === '/cart/merge')           return send(200, body.items || []);
  if (p === '/cart' && m === 'POST') return send(200, { id: nextId++, ...body });
  if (p.startsWith('/cart/'))        return send(200, { success: true });

  // wishlist
  if (p === '/wishlist' && m === 'GET')  { if (!need()) return; return send(200, wishlist); }
  if (p === '/wishlist' && m === 'POST') { if (!need()) return; const w = { id: nextId++, created_at: new Date().toISOString(), ...body }; wishlist.unshift(w); return send(201, w); }
  if ((r = p.match(/^\/wishlist\/(\d+)$/))) { wishlist = wishlist.filter(w => w.id !== +r[1]); return send(200, { success: true }); }

  // recently viewed
  if (p === '/recently-viewed' && m === 'GET') { if (!need()) return; return send(200, recent.map(id => products.find(x => x.id === id)).filter(Boolean)); }
  if (p === '/recently-viewed' && m === 'POST') {
    if (!need()) return;
    const id = +(body.productId || body.product_id); recent = [id, ...recent.filter(v => v !== id)].slice(0, 12);
    return send(200, { success: true });
  }

  // stripe — no real checkout offline
  if (p === '/stripe/session-status') return send(200, { status: 'open', payment_status: 'unpaid' });
  if (p.startsWith('/stripe/')) return send(503, { error: 'Stripe is not available in the local mock server.' });

  send(404, { error: `Mock: no handler for ${m} ${p}` });
}

// ── HTTP server ──────────────────────────────────────
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found: ' + rel); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (ext === '.js' || ext === '.html') buf = Buffer.from(buf.toString('utf8').split(RAILWAY).join(ORIGIN));
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, ORIGIN);

  if (url.pathname === '/__mock/offline') { offline = url.searchParams.get('on') !== '0'; res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(`offline = ${offline}`); }
  if (url.pathname === '/__mock/slow')    { slowMs = parseInt(url.searchParams.get('ms'), 10) || 0; res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(`slow = ${slowMs}ms`); }

  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);

  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {}
    const send = (status, data, type) => setTimeout(() => {
      if (offline) { res.writeHead(503, cors); return res.end(JSON.stringify({ error: 'Mock server is set offline.' })); }
      res.writeHead(status, { ...cors, 'Content-Type': type || 'application/json' });
      res.end(type ? data : JSON.stringify(data));
    }, slowMs);
    api(req, url, body, send);
  });
}).listen(PORT, () => {
  console.log(`Jai'fore mock site:  ${ORIGIN}/index.html`);
  console.log(`Admin:               ${ORIGIN}/admin/admin.html  (admin@jaifore.test / admin123)`);
  console.log(`Offline toggle:      ${ORIGIN}/__mock/offline?on=1   |   Slow: ${ORIGIN}/__mock/slow?ms=4000`);
});
