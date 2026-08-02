/* ================================
   JAIFORE — WISHLIST PAGE JS
   scripts/wishlist.js
   ================================ */

const API = 'https://jai-fore-production.up.railway.app';

// ── AUTH GUARD ───────────────────────────────────────
// Identical convention to dashboard.js — wishlist is logged-in only per
// product decision, so this page never even attempts a fetch without a
// token, same as dashboard.js does for orders.
const token = localStorage.getItem('jaifore_token');
const user  = JSON.parse(localStorage.getItem('jaifore_user') || 'null');

if (!token || !user) {
  sessionStorage.setItem('jaifore_return', 'wishlist.html');
  window.location.href = 'loginsys.html';
}

// ── POPULATE PROFILE (sidebar) ───────────────────────
const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
document.getElementById('dashAvatar').textContent = initials;
document.getElementById('dashName').textContent   = user?.name  || '—';
document.getElementById('dashEmail').textContent  = user?.email || '—';

// ── LOGOUT ───────────────────────────────────────────
document.getElementById('dashLogout').addEventListener('click', () => {
  localStorage.removeItem('jaifore_token');
  localStorage.removeItem('jaifore_user');
  window.location.href = 'loginsys.html';
});

// ── AUTH HEADERS ─────────────────────────────────────
function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// ── FORMAT PRICE ─────────────────────────────────────
function formatPrice(amount) {
  if (window.JaiforeCurrency?.isReady()) return window.JaiforeCurrency.format(amount);
  return `$${Number(amount).toFixed(2)}`;
}

let wishlistData = [];

// ── LOAD WISHLIST ─────────────────────────────────────
async function loadWishlist() {
  const list = document.getElementById('wishlistList');
  list.innerHTML = `<div class="dash-empty" style="grid-column:1/-1"><div class="dash-empty-icon">♡</div><p>Loading wishlist...</p></div>`;

  try {
    const res  = await fetch(`${API}/api/wishlist`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to load');
    wishlistData = await res.json();

    if (!wishlistData.length) {
      list.innerHTML = `
        <div class="dash-empty" style="grid-column:1/-1">
          <div class="dash-empty-icon">♡</div>
          <p>Nothing saved yet.</p>
          <a href="services.html">Browse Products →</a>
        </div>`;
      return;
    }

    list.innerHTML = '';
    wishlistData.forEach(item => {
      const data         = item.snapshot_data;
      const isConfigured = Boolean(item.config_signature);

      const card = document.createElement('div');
      card.className = 'wl-card';
      card.innerHTML = `
        <div class="wl-card-img">
          ${data.snapshot ? `<img src="${data.snapshot}" alt="${data.name}"/>` : '🛍'}
          ${isConfigured ? '<span class="wl-card-badge">Your Design</span>' : ''}
        </div>
        <div class="wl-card-info">
          <div class="wl-card-name">${data.name}</div>
          ${isConfigured
            ? `<div class="wl-card-meta">${data.selectedSize ? `Size: ${data.selectedSize} · ` : ''}${data.customDesigns?.length || 0} design${data.customDesigns?.length !== 1 ? 's' : ''}</div>`
            : ''}
          <div class="wl-card-price">${formatPrice(data.price)}</div>
          <div class="wl-card-actions">
            <button class="wl-action-btn primary" data-action="move" data-id="${item.id}">
              ${isConfigured ? 'Continue Design' : 'Move to Cart'}
            </button>
            <button class="wl-action-btn" data-action="remove" data-id="${item.id}">Remove</button>
          </div>
        </div>`;
      list.appendChild(card);
    });
  } catch {
    list.innerHTML = `<div class="dash-empty" style="grid-column:1/-1"><div class="dash-empty-icon">⚠</div><p>Failed to load wishlist.</p></div>`;
  }
}

// ── MOVE TO CART ──────────────────────────────────────
// Two paths, matching the product decision from this session:
//  - Configured item ("Continue Design") → send the user back into the
//    configurator with ?wishlist=<id>, so configurator.js's
//    tryResumeFromWishlist() rehydrates the full design for review before
//    they actually add it to cart.
//  - Plain product ("Move to Cart") → add directly via cart.js's
//    addToCart(), same as clicking a product card elsewhere — no
//    intermediate review needed since there's no configuration to check.
function moveToCart(id) {
  const item = wishlistData.find(i => i.id === Number(id));
  if (!item) return;

  if (item.config_signature) {
    window.location.href = `configurator.html?product=${item.product_id}&wishlist=${item.id}`;
    return;
  }

  const data = item.snapshot_data;
  addToCart(
    { id: item.product_id, name: data.name, price: data.price, snapshot: data.snapshot },
    null,
    'general'
  );
  goToCheckout(); // reuses cart.js's own nav — consistent with how Add to
                   // Cart elsewhere on the site behaves after a successful add
}

// ── REMOVE ─────────────────────────────────────────────
async function removeFromWishlist(id) {
  try {
    const res = await fetch(`${API}/api/wishlist/${id}`, {
      method:  'DELETE',
      headers: authHeaders()
    });
    if (!res.ok) throw new Error('Remove failed');
    wishlistData = wishlistData.filter(i => i.id !== Number(id));
    loadWishlist(); // re-render from the now-empty-if-last-item list, so the
                     // empty state shows correctly if this was the last item
  } catch {
    // showCartNotification is defined in cart.js, already loaded on this
    // page — reused here rather than building a second toast mechanism.
    showCartNotification('Could not remove item — try again');
  }
}

// ── DELEGATED CLICK HANDLER ───────────────────────────
// Same reasoning as the item 18 design-qty-stepper: this grid is rebuilt
// wholesale on every loadWishlist() call (e.g. after a removal), so a
// listener attached once to the container survives re-renders where a
// per-card listener would not.
document.getElementById('wishlistList').addEventListener('click', (e) => {
  const btn = e.target.closest('.wl-action-btn');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'move')   moveToCart(id);
  if (btn.dataset.action === 'remove') removeFromWishlist(id);
});

// ── INIT ───────────────────────────────────────────────
window.JaiforeCurrency?.init().then(() => {
  loadWishlist();
}).catch(() => loadWishlist());