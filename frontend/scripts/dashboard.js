/* ================================
   JAIFORE — DASHBOARD JS
   scripts/dashboard.js
   ================================ */

const API = 'https://jai-fore-website.onrender.com';

// ── AUTH GUARD ───────────────────────────────────────
const token = localStorage.getItem('jaifore_token');
const user  = JSON.parse(localStorage.getItem('jaifore_user') || 'null');

if (!token || !user) {
  window.location.href = 'loginsys.html';
}

// ── POPULATE PROFILE ─────────────────────────────────
const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
document.getElementById('dashAvatar').textContent = initials;
document.getElementById('dashName').textContent   = user?.name  || '—';
document.getElementById('dashEmail').textContent  = user?.email || '—';
document.getElementById('pfName').value           = user?.name  || '';
document.getElementById('pfEmail').value          = user?.email || '';

// ── LOGOUT ───────────────────────────────────────────
document.getElementById('dashLogout').addEventListener('click', () => {
  localStorage.removeItem('jaifore_token');
  localStorage.removeItem('jaifore_user');
  window.location.href = 'loginsys.html';
});

// ── TAB NAVIGATION ───────────────────────────────────
document.querySelectorAll('.dash-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dash-nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.dash-tab').forEach(t => t.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
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

// ── LOAD ORDERS ──────────────────────────────────────
async function loadOrders() {
  const list = document.getElementById('ordersList');
  list.innerHTML = `<div class="dash-empty"><div class="dash-empty-icon">◎</div><p>Loading orders...</p></div>`;

  try {
    const res  = await fetch(`${API}/api/orders/my`, { headers: authHeaders() });
    const data = await res.json();

    if (!data.length) {
      list.innerHTML = `
        <div class="dash-empty">
          <div class="dash-empty-icon">◎</div>
          <p>No orders yet.</p>
          <a href="services.html">Start Shopping →</a>
        </div>`;
      return;
    }

    list.innerHTML = '';
    data.forEach(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      const card  = document.createElement('div');
      card.className = 'order-card';
      card.innerHTML = `
        <div>
          <div class="order-id">Order #${o.id}</div>
          <div class="order-date">${new Date(o.created_at).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' })}</div>
          <div class="order-items">${items.length} item${items.length !== 1 ? 's' : ''}</div>
        </div>
        <div style="text-align:right">
          <div class="order-total">${formatPrice(o.total)}</div>
          <div class="order-status status-${o.status}">${o.status}</div>
        </div>`;
      list.appendChild(card);
    });
  } catch {
    list.innerHTML = `<div class="dash-empty"><div class="dash-empty-icon">⚠</div><p>Failed to load orders.</p></div>`;
  }
}

// ── LOAD SAVED DESIGNS ────────────────────────────────
function loadDesigns() {
  const list    = document.getElementById('designsList');
  const saved   = JSON.parse(localStorage.getItem('jaifore_saved_designs') || '[]');

  if (!saved.length) {
    list.innerHTML = `
      <div class="dash-empty" style="grid-column:1/-1">
        <div class="dash-empty-icon">🎨</div>
        <p>No saved designs yet.</p>
        <a href="services.html">Design Something →</a>
      </div>`;
    return;
  }

  list.innerHTML = '';
  saved.forEach((design, i) => {
    const card = document.createElement('div');
    card.className = 'design-card';
    card.innerHTML = `
      <div class="design-card-img">
        ${design.preview ? `<img src="${design.preview}" alt="${design.name}"/>` : '🎨'}
      </div>
      <div class="design-card-info">
        <div class="design-card-name">${design.name || 'Custom Design'}</div>
        <div class="design-card-date">${new Date(design.savedAt).toLocaleDateString()}</div>
        <div class="design-card-actions">
          <button class="design-action-btn" onclick="reorderDesign(${i})">Re-order</button>
          <button class="design-action-btn danger" onclick="deleteDesign(${i})">Delete</button>
        </div>
      </div>`;
    list.appendChild(card);
  });
}

function reorderDesign(index) {
  const saved = JSON.parse(localStorage.getItem('jaifore_saved_designs') || '[]');
  const design = saved[index];
  if (design?.productId) {
    window.location.href = `configurator.html?product=${design.productId}`;
  }
}

function deleteDesign(index) {
  const saved = JSON.parse(localStorage.getItem('jaifore_saved_designs') || '[]');
  saved.splice(index, 1);
  localStorage.setItem('jaifore_saved_designs', JSON.stringify(saved));
  loadDesigns();
}

// ── PROFILE SAVE ─────────────────────────────────────
document.getElementById('pfSaveBtn').addEventListener('click', async () => {
  const name       = document.getElementById('pfName').value.trim();
  const currentPw  = document.getElementById('pfCurrentPw').value;
  const newPw      = document.getElementById('pfNewPw').value;
  const confirmPw  = document.getElementById('pfConfirmPw').value;
  const msgEl      = document.getElementById('pfMsg');

  if (!name) { msgEl.textContent = 'Name is required.'; msgEl.className = 'pf-msg error'; return; }

  if (newPw || currentPw) {
    if (!currentPw) { msgEl.textContent = 'Enter your current password.'; msgEl.className = 'pf-msg error'; return; }
    if (newPw !== confirmPw) { msgEl.textContent = 'New passwords do not match.'; msgEl.className = 'pf-msg error'; return; }
    if (newPw.length < 8) { msgEl.textContent = 'New password must be at least 8 characters.'; msgEl.className = 'pf-msg error'; return; }
  }

  try {
    const body = { name };
    if (newPw) { body.currentPassword = currentPw; body.newPassword = newPw; }

    const res  = await fetch(`${API}/api/auth/update-profile`, {
      method:  'PUT',
      headers: authHeaders(),
      body:    JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok) { msgEl.textContent = data.error || 'Update failed.'; msgEl.className = 'pf-msg error'; return; }

    // Update local storage
    const updated = { ...user, name };
    localStorage.setItem('jaifore_user', JSON.stringify(updated));
    document.getElementById('dashName').textContent = name;
    document.getElementById('dashAvatar').textContent = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    msgEl.textContent = 'Profile updated successfully.';
    msgEl.className   = 'pf-msg success';

    // Clear password fields
    document.getElementById('pfCurrentPw').value = '';
    document.getElementById('pfNewPw').value      = '';
    document.getElementById('pfConfirmPw').value  = '';

  } catch { msgEl.textContent = 'Network error. Try again.'; msgEl.className = 'pf-msg error'; }
});

// ── INIT ─────────────────────────────────────────────
window.JaiforeCurrency?.init().then(() => {
  loadOrders();
});
loadDesigns();