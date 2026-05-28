/* ================================
   JAIFORE — CHECKOUT JS
   scripts/checkout.js
   ================================ */

const API = 'https://jai-fore-website.onrender.com';

// ── AUTH GUARD ───────────────────────────────────────
const token = localStorage.getItem('jaifore_token');
const user  = JSON.parse(localStorage.getItem('jaifore_user') || 'null');

if (!token || !user) {
  sessionStorage.setItem('jaifore_return', 'checkout.html');
  window.location.href = 'loginsys.html';
}

// ── LOAD CART ────────────────────────────────────────
const cart = JSON.parse(localStorage.getItem('jaifore_cart') || '[]');

// ── FORMAT PRICE ─────────────────────────────────────
function formatPrice(amount) {
  if (window.JaiforeCurrency?.isReady()) return window.JaiforeCurrency.format(amount);
  return `$${Number(amount).toFixed(2)}`;
}

// ── RENDER ITEMS ─────────────────────────────────────
function renderItems() {
  const container   = document.getElementById('checkoutItems');
  const summaryLines = document.getElementById('summaryLines');

  if (!cart.length) {
    container.innerHTML = `<div class="checkout-empty">Your cart is empty. <a href="services.html">Go shopping →</a></div>`;
    return;
  }

  container.innerHTML = cart.map(item => `
    <div class="checkout-item">
      <div class="checkout-item-img">
        ${item.snapshot
          ? `<img src="${item.snapshot}" alt="${item.name}"/>`
          : '🛍'}
      </div>
      <div class="checkout-item-info">
        <div class="checkout-item-name">${item.name}</div>
        <div class="checkout-item-meta">
          ${item.size ? `Size: ${item.size} · ` : ''}Qty: ${item.qty}
          ${item.designs?.length ? ` · ${item.designs.length} design(s)` : ''}
        </div>
      </div>
      <div class="checkout-item-price">${formatPrice(item.price * item.qty)}</div>
    </div>
  `).join('');

  summaryLines.innerHTML = cart.map(item => `
    <div class="summary-line">
      <span class="summary-line-name">${item.name} x${item.qty}</span>
      <span>${formatPrice(item.price * item.qty)}</span>
    </div>
  `).join('');

  updateTotals();
}

// ── UPDATE TOTALS ────────────────────────────────────
function updateTotals() {
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  document.getElementById('summarySubtotal').textContent = formatPrice(subtotal);
  document.getElementById('summaryTotal').textContent    = formatPrice(subtotal);
}

// ── PREFILL USER INFO ─────────────────────────────────
function prefillUser() {
  if (!user) return;
  const names = user.name?.split(' ') || [];
  document.getElementById('sfFirstName').value = names[0] || '';
  document.getElementById('sfLastName').value  = names.slice(1).join(' ') || '';
  document.getElementById('sfEmail').value     = user.email || '';
}

// ── PLACE ORDER ───────────────────────────────────────
document.getElementById('placeOrderBtn').addEventListener('click', async () => {
  const msgEl   = document.getElementById('checkoutMsg');
  const btnText = document.getElementById('placeOrderText');
  const spinner = document.getElementById('placeOrderSpinner');

  // Validate cart
  if (!cart.length) { msgEl.textContent = 'Your cart is empty.'; return; }

  // Validate shipping
  const firstName = document.getElementById('sfFirstName').value.trim();
  const lastName  = document.getElementById('sfLastName').value.trim();
  const email     = document.getElementById('sfEmail').value.trim();
  const phone     = document.getElementById('sfPhone').value.trim();
  const address   = document.getElementById('sfAddress').value.trim();
  const city      = document.getElementById('sfCity').value.trim();
  const country   = document.getElementById('sfCountry').value.trim();

  if (!firstName || !lastName || !email || !phone || !address || !city || !country) {
    msgEl.textContent = 'Please fill in all required shipping details.';
    msgEl.className   = 'checkout-msg';
    return;
  }

  const shipping = {
    name:    `${firstName} ${lastName}`,
    email, phone, address,
    city,
    state:   document.getElementById('sfState').value.trim(),
    country,
    postal:  document.getElementById('sfPostal').value.trim(),
    notes:   document.getElementById('sfNotes').value.trim(),
  };

  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);

  btnText.classList.add('hidden');
  spinner.classList.remove('hidden');
  document.getElementById('placeOrderBtn').disabled = true;
  msgEl.textContent = '';

  try {
    const res  = await fetch(`${API}/api/orders`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ items: cart, total, shipping })
    });
    const data = await res.json();

    if (!res.ok) {
      msgEl.textContent = data.error || 'Failed to place order. Try again.';
      msgEl.className   = 'checkout-msg';
      return;
    }

    // Clear cart
    localStorage.removeItem('jaifore_cart');

    msgEl.textContent = '✓ Order placed successfully! Redirecting...';
    msgEl.className   = 'checkout-msg success';

    setTimeout(() => window.location.href = 'dashboard.html', 1500);

  } catch {
    msgEl.textContent = 'Network error. Please try again.';
    msgEl.className   = 'checkout-msg';
  } finally {
    btnText.classList.remove('hidden');
    spinner.classList.add('hidden');
    document.getElementById('placeOrderBtn').disabled = false;
  }
});

// ── INIT ─────────────────────────────────────────────
window.JaiforeCurrency?.init().then(() => {
  renderItems();
});

prefillUser();