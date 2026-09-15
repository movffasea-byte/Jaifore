/* ================================
   JAIFORE — CHECKOUT JS
   scripts/checkout.js
   ================================ */

const API = 'https://jai-fore-production.up.railway.app';

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

// ── FORMAT CONFIG META (gender + print size) ─────────
// Verification pass (checkout gender/printSize item): the cart data itself
// was already flowing through to order creation intact — verifyAndCreateOrder()
// sends the whole `cart` array unmodified, so gender/printSize were never
// lost. What WAS missing is showing them back to the customer before they
// pay. printSize is an object (not a plain string) — same shape cart.js's
// own configSignature() already expects: { id: '...' } or
// { size_label: '...' } — so this reads it the same way, rather than
// assuming a single field name.
function formatConfigMeta(item) {
  const parts = [];
  if (item.size) parts.push(`Size: ${item.size}`);
  if (item.gender) parts.push(item.gender.charAt(0).toUpperCase() + item.gender.slice(1));

  const printSizeLabel = item.printSize?.id ?? item.printSize?.size_label ?? null;
  if (printSizeLabel) parts.push(`Print: ${printSizeLabel}`);

  if (item.designs?.length) parts.push(`${item.designs.length} design(s)`);

  return parts.join(' · ');
}

// ── CHANGE QUANTITY ──────────────────────────────────
// Matches by id + size, same pairing cart.js uses to tell line items apart.
// Decreasing a quantity of 1 removes the item from the cart entirely.
function changeQty(id, size, delta) {
  const idx = cart.findIndex(i => Number(i.id) === Number(id) && (i.size || '') === (size || ''));
  if (idx === -1) return;

  cart[idx].qty += delta;

  if (cart[idx].qty <= 0) {
    cart.splice(idx, 1);
  }

  localStorage.setItem('jaifore_cart', JSON.stringify(cart));
  renderItems();
}

// ── RENDER ITEMS ─────────────────────────────────────
function renderItems() {
  const container    = document.getElementById('checkoutItems');
  const summaryLines = document.getElementById('summaryLines');

  if (!cart.length) {
    container.innerHTML = `<div class="checkout-empty">Your cart is empty. <a href="services.html">Go shopping →</a></div>`;
    summaryLines.innerHTML = '';
    document.getElementById('summarySubtotal').textContent = formatPrice(0);
    document.getElementById('summaryTotal').textContent    = formatPrice(0);
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
        <div class="checkout-item-meta">${formatConfigMeta(item)}</div>
        <div class="checkout-item-qty">
          <button class="qty-btn" onclick="changeQty(${item.id}, '${item.size || ''}', -1)" aria-label="Decrease quantity">−</button>
          <span class="qty-value">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${item.id}, '${item.size || ''}', 1)" aria-label="Increase quantity">+</button>
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

// ── COLLECT & VALIDATE SHIPPING ───────────────────────
function collectShipping() {
  const firstName = document.getElementById('sfFirstName').value.trim();
  const lastName  = document.getElementById('sfLastName').value.trim();
  const email     = document.getElementById('sfEmail').value.trim();
  const phone     = document.getElementById('sfPhone').value.trim();
  const address   = document.getElementById('sfAddress').value.trim();
  const city      = document.getElementById('sfCity').value.trim();
  const country   = document.getElementById('sfCountry').value.trim();

  if (!firstName || !lastName || !email || !phone || !address || !city || !country) {
    return { error: 'Please fill in all required shipping details.' };
  }

  return {
    name:    `${firstName} ${lastName}`,
    email, phone, address, city,
    state:   document.getElementById('sfState').value.trim(),
    country,
    postal:  document.getElementById('sfPostal').value.trim(),
    notes:   document.getElementById('sfNotes').value.trim(),
  };
}

// ── SHOW / HIDE BUTTON STATE ──────────────────────────
function setLoading(on) {
  const btn     = document.getElementById('placeOrderBtn');
  const btnText = document.getElementById('placeOrderText');
  const spinner = document.getElementById('placeOrderSpinner');
  btn.disabled  = on;
  btnText.classList.toggle('hidden', on);
  spinner.classList.toggle('hidden', !on);
}

function showMsg(text, isSuccess = false) {
  const el      = document.getElementById('checkoutMsg');
  el.textContent = text;
  el.className   = 'checkout-msg' + (isSuccess ? ' success' : '');
}

// ── GENERATE UNIQUE TX REF ────────────────────────────
function txRef() {
  return `JAIFORE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// ── FLUTTERWAVE PAYMENT ───────────────────────────────
// total is the raw NGN amount from the cart (database truth).
// We ALWAYS charge in NGN — Flutterwave's own checkout UI shows
// the customer their local-currency equivalent automatically.
// This avoids double-conversion bugs and keeps settlement simple.
function launchFlutterwave(shipping, total, ref) {
  const amountInNGN = parseFloat(total.toFixed(2));

  FlutterwaveCheckout({
    public_key: 'FLWPUBK_TEST-5a9198e86e6dac9a62d878731aec566e-X', // ← replace with your actual key
    tx_ref:     ref,
    amount:     amountInNGN,
    currency:   'NGN',
    payment_options: 'card, mobilemoney, ussd, banktransfer',
    customer: {
      email:       shipping.email,
      phone_number: shipping.phone,
      name:        shipping.name,
    },
    customizations: {
      title:       "Jai'fore Creative Studio",
      description: `Order of ${cart.length} item(s)`,
      logo:        'https://jai-fore.vercel.app/logo/rooted2.jpg',
    },
    callback: async (response) => {
      // response.status === 'successful' or 'completed'
      if (response.status === 'successful' || response.status === 'completed') {
        showMsg('Payment received. Confirming your order...');
        await verifyAndCreateOrder(response.transaction_id, ref, shipping, amountInNGN);
      } else {
        setLoading(false);
        showMsg('Payment was not completed. Please try again.');
      }
    },
    onclose: () => {
      // User closed the popup without paying
      setLoading(false);
      showMsg('Payment cancelled. Your cart is still saved.');
    },
  });
}

// ── VERIFY PAYMENT + CREATE ORDER ─────────────────────
async function verifyAndCreateOrder(transactionId, ref, shipping, total) {
  try {
    const res  = await fetch(`${API}/api/orders/verify-payment`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        tx_ref:         ref,
        items:          cart,
        total,
        shipping,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg(data.error || 'Payment verification failed. Contact support.');
      setLoading(false);
      return;
    }

    // Success — clear cart and redirect
    localStorage.removeItem('jaifore_cart');
    showMsg('✓ Order placed successfully! Redirecting...', true);
    setTimeout(() => window.location.href = 'dashboard.html', 1800);

  } catch {
    showMsg('Network error during verification. Please contact support.');
    setLoading(false);
  }
}

// ── PLACE ORDER BUTTON ────────────────────────────────
document.getElementById('placeOrderBtn').addEventListener('click', () => {
  showMsg('');

  if (!cart.length) { showMsg('Your cart is empty.'); return; }

  const shipping = collectShipping();
  if (shipping.error) { showMsg(shipping.error); return; }

  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);

  setLoading(true);
  showMsg('Opening payment...');

  const ref = txRef();

  // Small delay so the loading state renders before FLW popup opens
  setTimeout(() => launchFlutterwave(shipping, total, ref), 300);
});

// ── INIT ─────────────────────────────────────────────
window.JaiforeCurrency?.init().then(() => {
  renderItems();
}).catch(() => renderItems());

prefillUser();