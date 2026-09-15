/* ================================
   JAIFORE — CART SYSTEM
   cart.js

   item 21: cross-device cart sync. Guests behave exactly as before —
   localStorage only, zero backend calls. Logged-in users get the same
   instant local update + UI, but every mutation also fires an async
   call to /api/cart in the background so the cart follows them across
   devices. Background sync failures never block or revert the UI —
   same "degrade gracefully" philosophy as the backend's redis cache.
   ================================ */

let cart = JSON.parse(localStorage.getItem('jaifore_cart') || '[]');

// Same Railway backend URL used in loginsys.js's `const API`. That constant
// is scoped to loginsys.js only, so cart.js needs its own copy rather than
// assuming a global — if this URL ever changes, update it in both places
// (or better, promote it to a single shared config script loaded on every
// page, so it only needs to change once).
const CART_API_BASE = 'https://jai-fore-production.up.railway.app/api/cart';

function getToken() {
  return localStorage.getItem('jaifore_token');
}

function isLoggedIn() {
  return !!getToken();
}

// ── FORMAT PRICE ─────────────────────────────────────────
function formatPrice(amount) {
  if (window.JaiforeCurrency?.isReady()) return window.JaiforeCurrency.format(amount);
  return `$${Number(amount).toFixed(2)}`;
}

// ── CONFIG SIGNATURE (item 18) ────────────────────────────
// Plain products (no customDesigns) have no signature — they match purely on
// id + size, exactly as before. Configured items get a signature built from
// WHICH designs are used (by name, sorted so order doesn't matter) plus
// gender and print size — deliberately excluding x/y position and w/h, since
// dragging/resizing the same designs should still count as the same cart line.
//
// Kept identical to the backend's copy in cart.js (routes) — no shared build
// step between frontend and backend, so both copies must stay in sync by hand.
function configSignature(item) {
  const designs = item.designs || [];
  if (!designs.length) return null; // not a custom item — no signature needed

  const designKey = designs
    .map(d => d.name || d.src || '')
    .slice()
    .sort()
    .join('|');

  const printSizeKey = item.printSize?.id ?? item.printSize?.size_label ?? '';

  return `${designKey}::${item.gender || ''}::${printSizeKey}`;
}

// ── SERVER SYNC HELPERS ────────────────────────────────────
// All of these are fire-and-forget from the caller's perspective — they
// never throw up to the UI layer, matching the guest/localStorage code
// path's behavior of never failing visibly. Errors are logged to console
// only, so a flaky connection never breaks add-to-cart for a logged-in user.

async function apiRequest(method, path, body) {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch(`${CART_API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      console.error(`[cart sync] ${method} ${path} failed:`, res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    // Network failure, offline, etc. — never surface this to the user,
    // the local cart already has the correct state.
    console.error(`[cart sync] ${method} ${path} error:`, err.message);
    return null;
  }
}

// Fire-and-forget wrapper so call sites don't need to await/catch —
// mirrors the "never blocks the UI" requirement.
function syncToServer(method, path, body) {
  apiRequest(method, path, body);
}

// ── ADD TO CART ────────────────────────────────────────────
// Uses `id` consistently (matches product schema from the API / configurator),
// not `_id` — that mismatch previously caused every cart match check to fail
// silently, since product._id was always undefined.
//
// item 18: matching now also checks configSignature() when the incoming item
// is a custom configured product. Two configured shirts with the same id and
// size but DIFFERENT designs on them no longer silently merge into one line —
// they only merge if the design set (+ gender + print size) also matches.
// Plain (non-custom) products are completely unaffected: configSignature()
// returns null for them, so the extra check is skipped exactly as before.
//
// item 21: for logged-in users, the same add is mirrored to the server in
// the background via POST /api/cart, which the backend also merges on
// id+signature+size — so local and server merge logic stay consistent.
function addToCart(product, size, category) {
  const incomingSig = configSignature({
    designs:   product.customDesigns || product.designs || [],
    gender:    product.gender,
    printSize: product.printSize
  });

  const existing = cart.find(i => {
    if (i.id !== product.id || i.size !== size) return false;
    if (incomingSig === null) return configSignature(i) === null; // both plain
    return configSignature(i) === incomingSig;
  });

  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      id:        product.id,
      name:      product.name,
      price:     product.price,
      category:  category,
      size:      size || null,
      qty:       1,
      snapshot:  product.snapshot || product.image_url || null,
      designs:   product.customDesigns || product.designs || [],
      gender:    product.gender || null,
      printSize: product.printSize || null,
    });
  }
  saveCart();
  updateCartCount();
  showCartNotification(product.name);

  if (isLoggedIn()) {
    syncToServer('POST', '', {
      productId: product.id,
      name:      product.name,
      price:     product.price,
      category:  category,
      size:      size || null,
      qty:       1, // POST always adds one — matches backend's increment semantics
      snapshot:  product.snapshot || product.image_url || null,
      designs:   product.customDesigns || product.designs || [],
      gender:    product.gender || null,
      printSize: product.printSize || null,
    });
  }
}

// ── REMOVE FROM CART ───────────────────────────────────────
// item 21: for logged-in users, also fires DELETE /api/cart/:cartItemId
// in the background. Guests (or any local item that hasn't synced yet
// and has no cartItemId) skip the server call entirely — nothing to
// delete server-side.
function removeFromCart(id, size) {
  const target = cart.find(i => i.id === id && i.size === size);
  cart = cart.filter(i => !(i.id === id && i.size === size));
  saveCart();
  updateCartCount();

  if (isLoggedIn() && target?.cartItemId) {
    syncToServer('DELETE', `/${target.cartItemId}`);
  }
}

// ── UPDATE QUANTITY ─────────────────────────────────────────
// New in item 21 — checkout's +/- editor needs a way to set an absolute
// qty rather than only incrementing via addToCart(). Mirrors the backend's
// PATCH semantics exactly (set qty directly, not add to it).
function updateCartQty(id, size, newQty) {
  if (newQty < 1) return; // matches backend's PATCH validation (qty must be >= 1)

  const item = cart.find(i => i.id === id && i.size === size);
  if (!item) return;

  item.qty = newQty;
  saveCart();
  updateCartCount();

  if (isLoggedIn() && item.cartItemId) {
    syncToServer('PATCH', `/${item.cartItemId}`, { qty: newQty });
  }
}

// ── SAVE ─────────────────────────────────────────────────
function saveCart() {
  localStorage.setItem('jaifore_cart', JSON.stringify(cart));
}

// ── UPDATE COUNT BADGE ─────────────────────────────────────
function updateCartCount() {
  const total = cart.reduce((sum, i) => sum + i.qty, 0);
  const el = document.getElementById('cart-count');
  if (el) el.textContent = total;
}

// ── CART NOTIFICATION ───────────────────────────────────────
function showCartNotification(name) {
  let toast = document.getElementById('cart-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cart-toast';
    toast.style.cssText = `
      position: fixed; bottom: 2rem; right: 2rem; z-index: 9999;
      background: #111; color: #fff;
      font-family: 'Karla', sans-serif; font-size: 0.85rem;
      padding: 0.8rem 1.4rem; border-radius: 2px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      transform: translateY(20px); opacity: 0;
      transition: all 0.3s ease;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = `✓ ${name} added to cart`;
  toast.style.transform = 'translateY(0)';
  toast.style.opacity = '1';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';
  }, 2500);
}

// ── GO TO CHECKOUT ───────────────────────────────────────────
function goToCheckout() {
  if (!cart.length) {
    showCartNotification('Your cart is empty');
    return;
  }
  const token = localStorage.getItem('jaifore_token');
  if (!token) {
    sessionStorage.setItem('jaifore_return', 'checkout.html');
    window.location.href = 'loginsys.html';
    return;
  }
  window.location.href = 'checkout.html';
}

// ── LOGIN-TIME SYNC (item 21) ─────────────────────────────────
// Call this right after a successful login/OTP-verify, once jaifore_token
// is set. Not wired to any button here — login.js (wherever the login
// success handler lives) should call window.syncCartOnLogin() at that point.
//
// Behavior:
//  - If the server cart is empty and local has items, or vice versa, no
//    real conflict exists — the merge endpoint keeps both sides' lines
//    automatically, so this just calls it plainly and adopts the result.
//  - If BOTH sides have overlapping lines (same product+signature+size),
//    that's a genuine conflict — this shows a simple confirm-style prompt
//    asking the user which to keep, matching the planned "merge-conflict
//    modal" from the roadmap, kept intentionally simple (native confirm())
//    for a first pass rather than a full custom modal.
async function syncCartOnLogin() {
  if (!isLoggedIn()) return;

  // First, fetch what's on the server BEFORE merging, purely to detect
  // whether a real conflict exists (both sides have a matching line).
  const serverCart = await apiRequest('GET', '');
  if (serverCart === null) return; // sync failed silently, keep local cart as-is

  const hasConflict = cart.some(localItem => {
    const sig = configSignature(localItem);
    return serverCart.some(serverItem =>
      serverItem.id === localItem.id &&
      serverItem.size === localItem.size &&
      configSignature(serverItem) === sig
    );
  });

  let keepLocal = true; // default when there's no conflict — local additions win
  if (hasConflict) {
    keepLocal = window.confirm(
      'You have items in your cart on this device and on your account.\n\n' +
      'Press OK to keep THIS DEVICE\'S quantities for overlapping items.\n' +
      'Press Cancel to keep your ACCOUNT\'S saved quantities instead.'
    );
  }

  const merged = await apiRequest('POST', '/merge', { localCart: cart, keepLocal });
  if (merged === null) return; // merge failed, keep local cart as-is

  cart = merged;
  saveCart();
  updateCartCount();
}

// Exposed globally so the login success handler can call it without an
// import — matches how other cross-file calls already work in this codebase.
window.syncCartOnLogin = syncCartOnLogin;

// ── CART BUTTON LISTENERS ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Cart icon → go to checkout page
  document.getElementById('cart-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    goToCheckout();
  });

  // Checkout button (in any sidebar remnants)
  document.getElementById('checkout-btn')?.addEventListener('click', goToCheckout);

  updateCartCount();
});