/* ================================
   JAIFORE — CHECKOUT JS
   scripts/checkout.js

   Pays through Stripe Checkout:
   1. The cart (from data/cart.js) is sent to the server, which recomputes
      every price from the database and returns the real totals (quote).
   2. "Continue to Payment" asks the server for a Stripe Checkout URL and
      sends the customer there. Stripe collects the delivery address and
      the payment (and calculates tax when it's enabled).
   3. Stripe sends the customer back here with ?payment=success. The order
      itself is created by the server when Stripe confirms the payment.

   Prices are USD. Visitors in other countries see an estimate in their own
   currency, but are charged in USD.

   Needs data/cart.js loaded first — it provides: cart, updateCartQty,
   removeFromCart, cartLineSignature, saveCart, formatPrice.
   ================================ */

const API = 'https://jai-fore-production.up.railway.app';

// ── AUTH GUARD ───────────────────────────────────────
const token = localStorage.getItem('jaifore_token');
const user  = JSON.parse(localStorage.getItem('jaifore_user') || 'null');
const isSignedIn = !!(token && user);

if (!isSignedIn) {
  sessionStorage.setItem('jaifore_return', 'checkout.html');
  window.location.href = 'loginsys.html';
}

// Latest server-priced quote for the current cart (null until it loads)
let quote      = null;
let quoteError = '';
let quoteSeq   = 0; // ignores slow, out-of-date quote responses
let quotePending = false; // true while the server quote is in flight (summary shows skeletons)

// ── HELPERS ──────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function isImageSrc(value) {
  return typeof value === 'string' && /^(https?:|data:image)/i.test(value);
}

async function apiPost(path, body, timeoutMs = 30000) {
  try {
    const res  = await fetchWithTimeout(`${API}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify(body),
    }, timeoutMs);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: friendlyError(err) } };
  }
}

function redirectToLogin() {
  sessionStorage.setItem('jaifore_return', 'checkout.html');
  window.location.href = 'loginsys.html';
}

// ── FORMAT CONFIG META (size, gender, print size, designs) ───
// "Medium" for a design's own print size, falling back to the old line-level size
function designSizeLabel(design, item) {
  const ps = design?.printSize || item?.printSize;
  return ps?.size_label ?? ps?.id ?? null;
}

function formatConfigMeta(item) {
  const parts = [];
  if (item.size) parts.push(`Size: ${item.size}`);
  if (item.gender) parts.push(item.gender.charAt(0).toUpperCase() + item.gender.slice(1));

  // Print sizes now live on each design (shown below the name and in the
  // details modal); only legacy lines still carry one line-level size.
  const perDesign = item.designs?.some(d => d?.printSize);
  const printSizeLabel = item.printSize?.size_label ?? item.printSize?.id ?? null;
  if (printSizeLabel && !perDesign) parts.push(`Print: ${printSizeLabel}`);

  if (item.designs?.length) parts.push(`${item.designs.length} design${item.designs.length > 1 ? 's' : ''}`);

  return parts.join(' · ');
}

// The price to show for a cart line: the server's price when we have a quote,
// otherwise whatever the cart says until the quote arrives.
function unitPriceFor(index) {
  const fromServer = quote?.lines?.[index]?.unit_price;
  return Number.isFinite(fromServer) ? fromServer : Number(cart[index].price) || 0;
}

// ── CHANGE QUANTITY ──────────────────────────────────
// Targets the exact cart line (id + size + configuration), so two different
// designs on the same shirt size are never edited together. Goes through
// cart.js, so a signed-in customer's server cart stays in step as well.
function changeQty(index, delta) {
  const line = cart[index];
  if (!line) return;

  const newQty    = line.qty + delta;
  const signature = cartLineSignature(line);

  if (newQty < 1) removeFromCart(line.id, line.size, signature);
  else            updateCartQty(line.id, line.size, newQty, signature);

  renderItems();
  refreshQuote();
}

// ── ITEM DETAILS MODAL ───────────────────────────────
// Clicking a cart row (anywhere except the qty buttons) opens a modal
// showing what that product contains.
let itemModalEl  = null;
let itemModalSeq = 0; // guards against a slow description fetch landing in a newer modal

function renderDesignList(designs, item) {
  if (!Array.isArray(designs) || !designs.length) return '';

  const rows = designs.map((d, i) => {
    if (typeof d === 'string') {
      return isImageSrc(d)
        ? `<li><img class="item-modal-thumb" src="${escapeHtml(d)}" alt="Design ${i + 1}"/><span>Design ${i + 1}</span></li>`
        : `<li><span>${escapeHtml(d)}</span></li>`;
    }

    const baseLabel = d?.name || d?.title || d?.label || d?.id || `Design ${i + 1}`;
    const sizeLabel = designSizeLabel(d, item);
    const label = sizeLabel ? `${baseLabel} — ${sizeLabel}` : baseLabel;
    const img   = d?.src || d?.image || d?.url || d?.preview || d?.snapshot;
    return `<li>${isImageSrc(img) ? `<img class="item-modal-thumb" src="${escapeHtml(img)}" alt="${escapeHtml(label)}"/>` : ''}<span>${escapeHtml(label)}</span></li>`;
  }).join('');

  return `
    <div class="item-modal-block">
      <div class="item-modal-label">Designs included</div>
      <ul class="item-modal-designs">${rows}</ul>
    </div>`;
}

function ensureItemModal() {
  if (itemModalEl) return itemModalEl;

  itemModalEl = document.createElement('div');
  itemModalEl.className = 'item-modal-overlay';
  itemModalEl.setAttribute('aria-hidden', 'true');
  itemModalEl.innerHTML = `
    <div class="item-modal" role="dialog" aria-modal="true" aria-labelledby="itemModalTitle">
      <button type="button" class="item-modal-close" id="itemModalClose" aria-label="Close">×</button>
      <div class="item-modal-content" id="itemModalContent"></div>
    </div>
  `;
  document.body.appendChild(itemModalEl);

  itemModalEl.addEventListener('click', (e) => {
    if (e.target === itemModalEl) closeItemModal();
  });
  itemModalEl.querySelector('#itemModalClose').addEventListener('click', closeItemModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && itemModalEl.classList.contains('open')) closeItemModal();
  });

  return itemModalEl;
}

function openItemModal(index) {
  const item = cart[index];
  if (!item) return;

  const modal   = ensureItemModal();
  const content = modal.querySelector('#itemModalContent');
  const seq     = ++itemModalSeq;

  const printSizeLabel = item.printSize?.size_label ?? item.printSize?.id ?? null;
  const gender = item.gender ? item.gender.charAt(0).toUpperCase() + item.gender.slice(1) : null;
  const unit   = unitPriceFor(index);

  const detailRows = [
    item.size      ? ['Size', item.size]            : null,
    gender         ? ['Gender', gender]             : null,
    (printSizeLabel && !item.designs?.some(d => d?.printSize)) ? ['Print size', printSizeLabel] : null,
    ['Quantity', item.qty],
    ['Unit price', formatPrice(unit)],
    ['Line total', formatPrice(unit * item.qty)],
  ].filter(Boolean).map(([k, v]) =>
    `<div class="item-modal-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`
  ).join('');

  const knownDescription = item.description || item.details || '';

  content.innerHTML = `
    <div class="item-modal-head">
      <div class="item-modal-img">
        ${isImageSrc(item.snapshot) ? `<img src="${escapeHtml(item.snapshot)}" alt="${escapeHtml(item.name)}"/>` : '🛍'}
      </div>
      <h3 class="item-modal-title" id="itemModalTitle">${escapeHtml(item.name)}</h3>
    </div>
    <p class="item-modal-desc" id="itemModalDesc" ${knownDescription ? '' : 'hidden'}>${escapeHtml(knownDescription)}</p>
    <div class="item-modal-block">
      <div class="item-modal-label">Order details</div>
      ${detailRows}
    </div>
    ${renderDesignList(item.designs, item)}
    ${item.notes ? `<div class="item-modal-block"><div class="item-modal-label">Your notes</div><p class="item-modal-desc">${escapeHtml(item.notes)}</p></div>` : ''}
  `;

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('item-modal-open');
  modal.querySelector('#itemModalClose').focus();

  if (!knownDescription) loadProductDescription(item, seq);
}

function closeItemModal() {
  if (!itemModalEl) return;
  itemModalEl.classList.remove('open');
  itemModalEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('item-modal-open');
}

// Pulls the product description from the API (GET /api/products/:id).
// Optional — if it fails the modal just shows the cart's own details.
async function loadProductDescription(item, seq) {
  try {
    const res = await fetch(`${API}/api/products/${encodeURIComponent(item.id)}`);
    if (!res.ok) return;
    const data = await res.json();
    const text = data.description || data.details;
    if (!text || seq !== itemModalSeq) return;

    const el = document.getElementById('itemModalDesc');
    if (el) {
      el.textContent = text;
      el.hidden = false;
    }
  } catch {
    /* description is optional — ignore */
  }
}

// One delegated listener on the container (survives every re-render).
// Qty buttons keep their own behaviour; everything else on a row opens details.
(function wireItemClicks() {
  const container = document.getElementById('checkoutItems');
  if (!container) return;

  function rowIndex(target) {
    if (target.closest('.qty-btn')) return -1;
    const row = target.closest('.checkout-item');
    if (!row) return -1;
    return Number(row.dataset.index);
  }

  container.addEventListener('click', (e) => {
    const idx = rowIndex(e.target);
    if (idx >= 0) openItemModal(idx);
  });

  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const idx = rowIndex(e.target);
    if (idx >= 0) {
      e.preventDefault();
      openItemModal(idx);
    }
  });
})();

// ── RENDER ITEMS ─────────────────────────────────────
function renderItems() {
  const container    = document.getElementById('checkoutItems');
  const summaryLines = document.getElementById('summaryLines');

  if (!cart.length) {
    container.innerHTML = `<div class="checkout-empty">Your cart is empty. <a href="services.html">Go shopping →</a></div>`;
    summaryLines.innerHTML = '';
    renderSummary();
    return;
  }

  container.innerHTML = cart.map((item, index) => `
    <div class="checkout-item checkout-item-clickable" data-index="${index}" tabindex="0" role="button" aria-label="View details for ${escapeHtml(item.name)}">
      <div class="checkout-item-img">
        ${isImageSrc(item.snapshot)
          ? `<img src="${escapeHtml(item.snapshot)}" alt="${escapeHtml(item.name)}"/>`
          : '🛍'}
      </div>
      <div class="checkout-item-info">
        <div class="checkout-item-name">${escapeHtml(item.name)}</div>
        <div class="checkout-item-meta">${escapeHtml(formatConfigMeta(item))}</div>
        <div class="checkout-item-hint">Tap to see what's included</div>
        <div class="checkout-item-qty">
          <button class="qty-btn" onclick="changeQty(${index}, -1)" aria-label="Decrease quantity">−</button>
          <span class="qty-value">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${index}, 1)" aria-label="Increase quantity">+</button>
        </div>
      </div>
      <div class="checkout-item-price">${formatPrice(unitPriceFor(index) * item.qty)}</div>
    </div>
  `).join('');

  summaryLines.innerHTML = cart.map((item, index) => `
    <div class="summary-line">
      <span class="summary-line-name">${escapeHtml(item.name)} x${item.qty}</span>
      <span>${formatPrice(unitPriceFor(index) * item.qty)}</span>
    </div>
  `).join('');

  renderSummary();
}

// ── SUMMARY (totals, shipping, currency note) ────────
function renderSummary() {
  const subtotalEl = document.getElementById('summarySubtotal');
  const shippingEl = document.getElementById('summaryShipping');
  const totalEl    = document.getElementById('summaryTotal');
  const hintEl     = document.getElementById('shippingHint');
  const taxEl      = document.getElementById('summaryTax');
  const noteEl     = document.getElementById('checkoutCurrencyNote');

  if (!cart.length) {
    subtotalEl.textContent = formatPrice(0);
    shippingEl.textContent = '—';
    totalEl.textContent    = formatPrice(0);
    hintEl.textContent     = '';
    noteEl.textContent     = '';
    return;
  }

  if (!quote) {
    // No server numbers yet (still loading, or the cart couldn't be priced)
    const localSubtotal = cart.reduce((sum, item) => sum + (Number(item.price) || 0) * item.qty, 0);
    subtotalEl.textContent = formatPrice(localSubtotal);
    if (quotePending) {
      // The server's shipping and total are on their way
      showStatSkeleton([shippingEl, totalEl]);
    } else {
      shippingEl.textContent = '—';
      totalEl.textContent    = formatPrice(localSubtotal);
    }
    hintEl.textContent     = '';
    noteEl.textContent     = '';
    return;
  }

  subtotalEl.textContent = formatPrice(quote.subtotal);
  shippingEl.textContent = quote.shipping_fee > 0 ? formatPrice(quote.shipping_fee) : 'Free';
  totalEl.textContent    = formatPrice(quote.total_before_tax);
  taxEl.textContent      = quote.tax_enabled ? 'Calculated at payment' : '—';

  if (quote.shipping_fee > 0) {
    const remaining = quote.free_shipping_threshold - quote.subtotal;
    hintEl.textContent = `Add ${formatPrice(remaining)} more for free shipping.`;
  } else {
    hintEl.textContent = 'You\u2019ve unlocked free shipping.';
  }

  // Non-USD visitors see estimates; the charge is always in USD
  if (window.JaiforeCurrency?.isConverted?.()) {
    const code = window.JaiforeCurrency.getInfo().code;
    noteEl.textContent =
      `Amounts are shown in ${code} as an estimate. You'll be charged ${window.JaiforeCurrency.formatUSD(quote.total_before_tax)} (USD) before tax — Stripe shows the exact amount at payment.`;
  } else {
    noteEl.textContent = '';
  }
}

// ── SERVER QUOTE ─────────────────────────────────────
async function refreshQuote() {
  const seq = ++quoteSeq;

  if (!cart.length) {
    quote = null;
    quoteError = '';
    renderSummary();
    return;
  }

  quotePending = true;
  renderSummary();

  const res = await apiPost('/api/stripe/quote', { items: cart }, FETCH_TIMEOUT_MS);
  if (seq !== quoteSeq) return; // a newer request has superseded this one
  quotePending = false;

  if (res.status === 401 || res.status === 403) { redirectToLogin(); return; }

  if (res.ok) {
    quote = res.data;
    quoteError = '';
  } else {
    quote = null;
    quoteError = res.data?.error || 'We couldn\u2019t price your cart right now. Please try again.';
  }

  renderItems();
  showMsg(quoteError);

  // A failed quote gets a Retry, so the summary never sits on "—" forever
  if (quoteError) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'load-error-retry';
    retry.textContent = 'Retry';
    retry.style.marginLeft = '0.6rem';
    retry.addEventListener('click', () => { retry.disabled = true; refreshQuote(); });
    document.getElementById('checkoutMsg').appendChild(retry);
  }
}

// ── PREFILL USER INFO ─────────────────────────────────
function prefillUser() {
  if (!user) return;
  const names = user.name?.split(' ') || [];
  document.getElementById('sfFirstName').value = names[0] || '';
  document.getElementById('sfLastName').value  = names.slice(1).join(' ') || '';
  document.getElementById('sfEmail').value     = user.email || '';
}

// ── COLLECT & VALIDATE CONTACT DETAILS ───────────────
function collectContact() {
  const firstName = document.getElementById('sfFirstName').value.trim();
  const lastName  = document.getElementById('sfLastName').value.trim();
  const email     = document.getElementById('sfEmail').value.trim();
  const phone     = document.getElementById('sfPhone').value.trim();

  if (!firstName || !lastName || !email || !phone) {
    return { error: 'Please fill in your name, email and phone number.' };
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { error: 'Please enter a valid email address.' };
  }

  return {
    name:  `${firstName} ${lastName}`,
    email,
    phone,
    notes: document.getElementById('sfNotes').value.trim(),
  };
}

// ── BUTTON / MESSAGE STATE ────────────────────────────
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

// ── CONTINUE TO PAYMENT ───────────────────────────────
async function placeOrder() {
  showMsg('');

  if (!cart.length) { showMsg('Your cart is empty.'); return; }
  if (quoteError)   { showMsg(quoteError); return; }

  const contact = collectContact();
  if (contact.error) { showMsg(contact.error); return; }

  setLoading(true);
  showMsg('Taking you to secure payment...');

  const res = await apiPost('/api/stripe/create-checkout-session', { items: cart, contact });

  if (res.status === 401 || res.status === 403) { redirectToLogin(); return; }

  if (!res.ok || !res.data?.url) {
    setLoading(false);
    showMsg(res.data?.error || 'We couldn\u2019t start the payment. Please try again.');
    return;
  }

  window.location.href = res.data.url; // Stripe's secure payment page
}

document.getElementById('placeOrderBtn').addEventListener('click', placeOrder);

// If the customer comes back with the browser's Back button, the button
// would otherwise stay stuck on its loading spinner.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) { setLoading(false); showMsg(''); }
});

// ── RETURN FROM STRIPE ────────────────────────────────
// Returns true when we're showing the "payment received" flow.
function handlePaymentReturn() {
  const params  = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  if (!payment) return false;

  // Tidy the address bar so a refresh doesn't repeat this
  history.replaceState(null, '', 'checkout.html');

  if (payment === 'cancelled') {
    showMsg('Payment cancelled. Your cart is still saved.');
    return false;
  }

  if (payment === 'success') {
    const sessionId = params.get('session_id');

    // The payment went through — empty the local cart so it can't be bought twice
    cart.length = 0;
    saveCart();
    updateCartCount();

    document.getElementById('placeOrderBtn').disabled = true;
    showMsg('Payment received. Confirming your order...', true);
    confirmOrder(sessionId);
    return true;
  }

  return false;
}

// The order is created by Stripe's webhook, which can take a few seconds.
async function confirmOrder(sessionId) {
  const finish = (text) => {
    showMsg(text, true);
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 2200);
  };

  if (!sessionId) { finish('✓ Payment received! Redirecting...'); return; }

  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const res  = await fetch(`${API}/api/stripe/session-status?session_id=${encodeURIComponent(sessionId)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.status === 'paid') {
        finish('✓ Order placed successfully! Redirecting...');
        return;
      }
    } catch { /* keep trying */ }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  finish('✓ Payment received! Your order is being finalised — you\u2019ll get a confirmation email shortly.');
}

// ── INIT ─────────────────────────────────────────────
async function initCheckout() {
  prefillUser();

  if (handlePaymentReturn()) {
    renderItems(); // shows the empty cart behind the message
    return;
  }

  renderItems();      // show the cart straight away with the prices it has
  await refreshQuote(); // then swap in the server's real prices
}

if (isSignedIn) {
  Promise.resolve(window.JaiforeCurrency?.init()).catch(() => {}).then(initCheckout);
}