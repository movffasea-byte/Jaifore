/* ================================
   JAIFORE — CART SYSTEM
   cart.js

   item 21: cross-device cart sync. Guests behave exactly as before —
   localStorage only, zero backend calls. Logged-in users get the same
   instant local update + UI, but every mutation also fires an async
   call to /api/cart in the background so the cart follows them across
   devices. Background sync failures never block or revert the UI —
   same "degrade gracefully" philosophy as the backend's redis cache.

   Prices in the cart are USD.

   This version also:
   - refuses graphic-design lines that have no print size (graphics are
     free, so the print size IS the product and its price),
   - refuses lines with a missing/invalid price,
   - removes any such invalid lines that are already sitting in a cart,
   - matches cart lines by id + size + configuration, so two prints of the
     same design in different sizes never merge or get edited together,
   - lets addToCart() add N at once (one sync call instead of N),
   - no longer crashes if localStorage is full.
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
// Plain products (no designs) have no signature — they match purely on
// id + size, exactly as before. Configured items get a signature built from
// WHICH designs are used (by name, sorted so order doesn't matter) plus
// gender and print size — deliberately excluding x/y position and w/h, since
// dragging/resizing the same designs should still count as the same cart line.
//
// Graphic-design lines carry their one design + chosen print size, so the
// same design in Small and in Large are different lines.
//
// Kept identical to the backend's copy in routes/cart.js — no shared build
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

// ── VALIDATION ─────────────────────────────────────────────
// A line is valid when it has a real price, and — for graphic designs —
// a chosen print size and a price above zero. Must match the backend's
// isValidCartLine() in routes/cart.js.
function isValidCartLine(item) {
  const price = Number(item.price);
  if (item.price === null || item.price === undefined || !Number.isFinite(price) || price < 0) return false;

  if (item.category === 'design') {
    const ps = item.printSize;
    if (!ps || (ps.id == null && !ps.size_label)) return false;
    if (price <= 0) return false;
  }
  return true;
}

// Matches a cart line by id + size, and — when a signature is given — by
// configuration too. Legacy callers that pass no signature keep the old
// id + size behaviour.
function lineMatches(line, id, size, signature) {
  if (line.id !== id || (line.size || null) !== (size || null)) return false;
  if (signature === undefined) return true;
  return configSignature(line) === signature;
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

// ── SAVE ─────────────────────────────────────────────────
// Returns false instead of throwing when the browser's storage is full
// (large uploaded images can exceed the quota).
function saveCart() {
  try {
    localStorage.setItem('jaifore_cart', JSON.stringify(cart));
    return true;
  } catch (err) {
    console.error('[cart] Could not save cart locally:', err.message);
    return false;
  }
}

// ── CLEAN UP INVALID LINES ─────────────────────────────────
// Removes any line that could never be paid for correctly — e.g. graphic
// designs added before the print-size rule existed (they sit in carts as
// $0 items). Also removes them from the server cart for logged-in users.
function sanitizeCart() {
  const bad = cart.filter(i => !isValidCartLine(i));
  if (!bad.length) return;

  cart = cart.filter(isValidCartLine);
  saveCart();
  updateCartCount();

  if (isLoggedIn()) {
    bad.forEach(i => {
      if (i.cartItemId) syncToServer('DELETE', `/${i.cartItemId}`);
    });
  }
}

// ── ADD TO CART ────────────────────────────────────────────
// Uses `id` consistently (matches product schema from the API / configurator),
// not `_id`.
//
// item 18: matching also checks configSignature() when the incoming item
// is a custom configured product, so two configured shirts with the same id
// and size but DIFFERENT designs never silently merge.
//
// item 21: for logged-in users, the same add is mirrored to the server in
// the background via POST /api/cart, which merges on the same key.
//
// qty (optional, default 1) adds that many in one go — used by the graphic
// design ordering so a quantity of 5 is one line update and one sync call.
//
// Returns true when the item was added, false when it was refused.
function addToCart(product, size, category, qty = 1) {
  const addQty  = Math.max(1, parseInt(qty, 10) || 1);
  const normSize = size || null;

  const candidate = {
    id:        product.id,
    name:      product.name,
    price:     product.price,
    category:  category,
    printSize: product.printSize || null,
  };

  if (!isValidCartLine(candidate)) {
    if (category === 'design') {
      showCartToast('Please choose a print size first.');
    } else {
      showCartToast('This item can’t be added right now.');
    }
    return false;
  }

  const incomingDesigns = product.customDesigns || product.designs || [];
  const incomingSig = configSignature({
    designs:   incomingDesigns,
    gender:    product.gender,
    printSize: product.printSize
  });

  const existing = cart.find(i => {
    if (i.id !== product.id || (i.size || null) !== normSize) return false;
    if (incomingSig === null) return configSignature(i) === null; // both plain
    return configSignature(i) === incomingSig;
  });

  if (existing) {
    existing.qty += addQty;
  } else {
    cart.push({
      id:        product.id,
      name:      product.name,
      price:     Number(product.price),
      category:  category,
      size:      normSize,
      qty:       addQty,
      snapshot:  product.snapshot || product.image_url || null,
      designs:   incomingDesigns,
      gender:    product.gender || null,
      printSize: product.printSize || null,
      notes:     product.notes || null,
    });
  }

  const saved = saveCart();
  updateCartCount();
  showCartNotification(product.name);
  if (!saved) {
    showCartToast('Cart saved for this visit only — your browser storage is full.');
  }

  if (isLoggedIn()) {
    syncToServer('POST', '', {
      productId: product.id,
      name:      product.name,
      price:     Number(product.price),
      category:  category,
      size:      normSize,
      qty:       addQty,
      snapshot:  product.snapshot || product.image_url || null,
      designs:   incomingDesigns,
      gender:    product.gender || null,
      printSize: product.printSize || null,
      notes:     product.notes || null,
    });
  }

  return true;
}

// ── REMOVE FROM CART ───────────────────────────────────────
// item 21: for logged-in users, also fires DELETE /api/cart/:cartItemId
// in the background. Guests (or any local item that hasn't synced yet
// and has no cartItemId) skip the server call entirely.
//
// Pass `signature` (from configSignature(line)) to remove exactly one
// configured line; omit it for the old id + size behaviour.
function removeFromCart(id, size, signature) {
  const target = cart.find(i => lineMatches(i, id, size, signature));
  cart = cart.filter(i => !lineMatches(i, id, size, signature));
  saveCart();
  updateCartCount();

  if (isLoggedIn() && target?.cartItemId) {
    syncToServer('DELETE', `/${target.cartItemId}`);
  }
}

// ── UPDATE QUANTITY ─────────────────────────────────────────
// Sets an absolute qty. Mirrors the backend's PATCH semantics exactly.
// Pass `signature` to target one configured line.
function updateCartQty(id, size, newQty, signature) {
  if (newQty < 1) return; // matches backend's PATCH validation (qty must be >= 1)

  const item = cart.find(i => lineMatches(i, id, size, signature));
  if (!item) return;

  item.qty = newQty;
  saveCart();
  updateCartCount();

  if (isLoggedIn() && item.cartItemId) {
    syncToServer('PATCH', `/${item.cartItemId}`, { qty: newQty });
  }
}

// ── UPDATE COUNT BADGE ─────────────────────────────────────
function updateCartCount() {
  const total = cart.reduce((sum, i) => sum + i.qty, 0);
  const el = document.getElementById('cart-count');
  if (el) el.textContent = total;
}

// ── TOAST ─────────────────────────────────────────────────────
function showCartToast(text) {
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
  toast.textContent = text;
  toast.style.transform = 'translateY(0)';
  toast.style.opacity = '1';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';
  }, 2500);
}

function showCartNotification(name) {
  showCartToast(`✓ ${name} added to cart`);
}

// ── GO TO CHECKOUT ───────────────────────────────────────────
function goToCheckout() {
  if (!cart.length) {
    showCartToast('Your cart is empty');
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
// is set (loginsys.js already does, via window.syncCartOnLogin?.()).
//
// Behavior:
//  - If the server cart is empty and local has items, or vice versa, no
//    real conflict exists — the merge endpoint keeps both sides' lines
//    automatically, so this just calls it plainly and adopts the result.
//  - If BOTH sides have overlapping lines (same product+signature+size),
//    that's a genuine conflict — this shows a simple confirm-style prompt
//    asking the user which to keep.
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
      (serverItem.size || null) === (localItem.size || null) &&
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

  const merged = await apiRequest('POST', '/merge', { localCart: cart.filter(isValidCartLine), keepLocal });
  if (merged === null) return; // merge failed, keep local cart as-is

  cart = merged;
  sanitizeCart();
  saveCart();
  updateCartCount();
}

// Exposed globally so the login success handler and checkout can call
// these without an import.
window.syncCartOnLogin  = syncCartOnLogin;
window.cartLineSignature = configSignature;

// Drop any invalid lines already sitting in this browser's cart
sanitizeCart();

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