/* ================================
   JAIFORE — CART SYSTEM
   cart.js
   ================================ */

const API = 'https://jai-fore-website.onrender.com';

let cart = JSON.parse(localStorage.getItem('jaifore_cart') || '[]');

// ── FORMAT PRICE ───────────────────────────────────────
function formatPrice(amount) {
  return `₦${Number(amount).toLocaleString('en-NG')}`;
}

// ── ADD TO CART ────────────────────────────────────────
function addToCart(product, size, category) {
  const existing = cart.find(i => i._id === product._id && i.size === size);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      _id:      product._id,
      name:     product.name,
      price:    product.price,
      category: category,
      size:     size || null,
      qty:      1,
      snapshot: product.snapshot || null,
      designs:  product.designs  || [],
    });
  }
  saveCart();
  renderCart();
  updateCartCount();
}

// ── REMOVE FROM CART ───────────────────────────────────
function removeFromCart(id, size) {
  cart = cart.filter(i => !(i._id === id && i.size === size));
  saveCart();
  renderCart();
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

// ── RENDER CART SIDEBAR ────────────────────────────────
function renderCart() {
  const container = document.getElementById('cart-items');
  const totalEl   = document.getElementById('cart-total');
  if (!container) return;

  if (!cart.length) {
    container.innerHTML = '<div class="cart-empty">Your cart is empty.</div>';
    if (totalEl) totalEl.textContent = '₦0';
    return;
  }

  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      ${item.snapshot
        ? `<img class="cart-item-snapshot" src="${item.snapshot}" alt="${item.name}"/>`
        : ''}
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-meta">
          ${item.size ? `Size: ${item.size} · ` : ''}Qty: ${item.qty}
        </div>
        ${item.designs?.length
          ? `<div class="cart-item-designs">+${item.designs.length} design${item.designs.length > 1 ? 's' : ''} applied</div>`
          : ''}
        <div class="cart-item-price">${formatPrice(item.price * item.qty)}</div>
      </div>
      <button class="cart-item-remove"
        data-id="${item._id}"
        data-size="${item.size || ''}">✕</button>
    </div>
  `).join('');

  const grandTotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  if (totalEl) totalEl.textContent = formatPrice(grandTotal);

  container.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () =>
      removeFromCart(btn.dataset.id, btn.dataset.size || null)
    );
  });
}

// ── OPEN / CLOSE CART ──────────────────────────────────
function openCart() {
  document.getElementById('cart-sidebar')?.classList.add('open');
  document.getElementById('cart-overlay')?.classList.add('open');
}

function closeCart() {
  document.getElementById('cart-sidebar')?.classList.remove('open');
  document.getElementById('cart-overlay')?.classList.remove('open');
}

// ── CART BUTTON LISTENERS ──────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cart-btn')?.addEventListener('click', openCart);
  document.getElementById('cart-close')?.addEventListener('click', closeCart);
  document.getElementById('cart-overlay')?.addEventListener('click', () => {
    if (!document.getElementById('product-modal')?.classList.contains('open')) {
      closeCart();
    }
  });

  // ── CHECKOUT ─────────────────────────────────────────
  document.getElementById('checkout-btn')?.addEventListener('click', async () => {
    const token = localStorage.getItem('jaifore_token');
    if (!token) { window.location.href = 'auth.html'; return; }
    if (!cart.length) return;

    try {
      const res = await fetch(`${API}/api/cart`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ items: cart })
      });

      if (res.ok) {
        cart = [];
        saveCart();
        renderCart();
        updateCartCount();
        closeCart();
        window.location.href = 'checkout.html';
      } else {
        alert('Failed to process cart. Please try again.');
      }
    } catch {
      alert('Network error. Please try again.');
    }
  });

  // Init on load
  renderCart();
  updateCartCount();
});