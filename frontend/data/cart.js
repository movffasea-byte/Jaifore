/* ================================
   JAIFORE — CART SYSTEM
   cart.js
   ================================ */

let cart = JSON.parse(localStorage.getItem('jaifore_cart') || '[]');

// ── FORMAT PRICE ───────────────────────────────────────
function formatPrice(amount) {
  if (window.JaiforeCurrency?.isReady()) return window.JaiforeCurrency.format(amount);
  return `$${Number(amount).toFixed(2)}`;
}

// ── CONFIG SIGNATURE (item 18) ──────────────────────────
// Plain products (no customDesigns) have no signature — they match purely on
// id + size, exactly as before. Configured items get a signature built from
// WHICH designs are used (by name, sorted so order doesn't matter) plus
// gender and print size — deliberately excluding x/y position and w/h, since
// dragging/resizing the same designs should still count as the same cart line.
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

// ── ADD TO CART ────────────────────────────────────────
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
}

// ── REMOVE FROM CART ───────────────────────────────────
function removeFromCart(id, size) {
  cart = cart.filter(i => !(i.id === id && i.size === size));
  saveCart();
  updateCartCount();
}

// ── SAVE ───────────────────────────────────────────────
function saveCart() {
  localStorage.setItem('jaifore_cart', JSON.stringify(cart));
}

// ── UPDATE COUNT BADGE ─────────────────────────────────
function updateCartCount() {
  const total = cart.reduce((sum, i) => sum + i.qty, 0);
  const el = document.getElementById('cart-count');
  if (el) el.textContent = total;
}

// ── CART NOTIFICATION ──────────────────────────────────
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

// ── GO TO CHECKOUT ─────────────────────────────────────
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

// ── CART BUTTON LISTENERS ──────────────────────────────
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