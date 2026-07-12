/* ================================
   JAIFORE ADMIN — JS
   frontend/admin/admin.js
   ================================ */

const API = 'https://jai-fore-production.up.railway.app';

// ── STATE ───────────────────────────────────────────
let token       = localStorage.getItem('jaifore_admin_token');
let adminUser   = JSON.parse(localStorage.getItem('jaifore_admin_user') || 'null');
let editingProductId = null;
let calYear, calMonth;

// ── INIT ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (token && adminUser?.role === 'admin') {
    showDashboard();
  } else {
    showLogin();
  }
});

// ── LOGIN ────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('adminName').textContent = `Welcome, ${adminUser?.name || 'Admin'}`;
  switchTab('overview');
}

// Password toggle
document.getElementById('togglePw').addEventListener('click', function () {
  const input = document.getElementById('loginPassword');
  input.type = input.type === 'password' ? 'text' : 'password';
  this.textContent = input.type === 'password' ? 'show' : 'hide';
});


const forgotBtn = document.getElementById("forgotBtn");
const forgotModal = document.getElementById("forgotModal");
const closeForgotBtn = document.getElementById("closeForgotBtn");
const sendResetBtn = document.getElementById("sendResetBtn");
const forgotMsg = document.getElementById("forgotMsg");

forgotBtn.addEventListener("click", () => {
  forgotModal.classList.remove("hidden");
});

closeForgotBtn.addEventListener("click", () => {
  forgotModal.classList.add("hidden");
});

sendResetBtn.addEventListener("click", () => {
  const email = document.getElementById("forgotEmail").value;

  if(!email){
    forgotMsg.textContent = "Please enter your email.";
    return;
  }

  forgotMsg.textContent = "Reset link sent successfully.";
  
  // backend API call here
  // fetch("/api/admin/forgot-password", {...})
});

// Login button
document.getElementById('loginBtn').addEventListener('click', async () => {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btnText  = document.getElementById('loginBtnText');
  const spinner  = document.getElementById('loginSpinner');

  if (!email || !password) { errEl.textContent = 'Email and password are required.'; return; }

  btnText.classList.add('hidden');
  spinner.classList.remove('hidden');
  errEl.textContent = '';

  try {
    const res  = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok)                        { errEl.textContent = data.error || 'Login failed.'; return; }
    if (data.user.role !== 'admin')     { errEl.textContent = 'Access denied. Admins only.'; return; }

    token     = data.token;
    adminUser = data.user;
    localStorage.setItem('jaifore_admin_token', token);
    localStorage.setItem('jaifore_admin_user',  JSON.stringify(adminUser));
    showDashboard();

  } catch { errEl.textContent = 'Network error. Try again.'; }
  finally {
    btnText.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
});

// Allow Enter key on login
document.getElementById('loginPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});


// Logout
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('jaifore_admin_token');
  localStorage.removeItem('jaifore_admin_user');
  token = null; adminUser = null;
  showLogin();
});

// ── TAB NAVIGATION ──────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Overview stat cards double as shortcuts to their underlying tab
document.querySelectorAll('.stat-card[data-tab]').forEach(card => {
  card.addEventListener('click', () => switchTab(card.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
  document.getElementById(`tab-${name}`).classList.remove('hidden');

  const titles = { overview: 'Overview', products: 'Products', orders: 'Orders', transactions: 'Transactions', users: 'Users' };
  document.getElementById('mainTitle').textContent = titles[name];

  if (name === 'overview')     loadOverview();
  if (name === 'products')     loadProducts();
  if (name === 'orders')       loadOrders();
  if (name === 'transactions') initCalendar();
  if (name === 'users')        loadUsers();
  if (name === 'pricing') loadPrintPricing();
}

// ── AUTH HEADER ──────────────────────────────────────
function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// ── OVERVIEW ─────────────────────────────────────────
async function loadOverview() {
  try {
    const [products, orders, transactions, users] = await Promise.all([
      fetch(`${API}/api/products`,     { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/api/orders`,       { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/api/transactions`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/api/users`,        { headers: authHeaders() }).then(r => r.json()),
    ]);

    document.getElementById('statProducts').textContent = Array.isArray(products) ? products.length : '—';
    document.getElementById('statOrders').textContent   = Array.isArray(orders)   ? orders.length   : '—';
    document.getElementById('statUsers').textContent    = Array.isArray(users)    ? users.length    : '—';

    const revenue = Array.isArray(transactions)
      ? transactions.filter(t => t.status === 'success').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0)
      : 0;
    document.getElementById('statRevenue').textContent = `₦${revenue.toLocaleString()}`;

    // item 14 — low stock banner. Same threshold and "untracked = skip" rule as the backend.
    // Guarded inside renderLowStockBanner itself in case the HTML banner element isn't present yet.
    renderLowStockBanner(Array.isArray(products) ? products : []);
  } catch (err) { console.error('Overview error:', err); }

  loadRevenueQuickTotals();
  loadRevenueChart(currentRevenuePeriod);
}

const LOW_STOCK_THRESHOLD = 5; // kept in sync with backend/routes/products.js

function renderLowStockBanner(products) {
  const banner = document.getElementById('lowStockBanner');
  if (!banner) return; // guard — does nothing if the HTML banner element isn't present

  const lowStockItems = products.filter(p => p.stock !== null && p.stock !== undefined && p.stock <= LOW_STOCK_THRESHOLD);

  if (!lowStockItems.length) {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');
  const names = lowStockItems.map(p => `${p.name} (${p.stock})`).join(', ');
  banner.innerHTML = `
    <span class="low-stock-icon">⚠</span>
    <span><strong>${lowStockItems.length}</strong> product${lowStockItems.length > 1 ? 's' : ''} low on stock: ${names}</span>
    <button class="low-stock-goto" onclick="switchTab('products')">View →</button>
  `;
}

// ── REVENUE DASHBOARD (item 11) ──────────────────────
let revenueChart = null;
let currentRevenuePeriod = 'daily';

async function loadRevenueQuickTotals() {
  try {
    const res  = await fetch(`${API}/api/orders/revenue/quick-totals`, { headers: authHeaders() });
    const data = await res.json();
    document.getElementById('revToday').textContent = `₦${Number(data.today).toLocaleString()}`;
    document.getElementById('revWeek').textContent   = `₦${Number(data.this_week).toLocaleString()}`;
    document.getElementById('revMonth').textContent  = `₦${Number(data.this_month).toLocaleString()}`;
  } catch (err) { console.error('Revenue quick totals error:', err); }
}

async function loadRevenueChart(period = 'daily') {
  currentRevenuePeriod = period;
  try {
    const res  = await fetch(`${API}/api/orders/revenue/summary?period=${period}`, { headers: authHeaders() });
    const data = await res.json();

    const labels = data.series.map(pt => formatRevenueLabel(pt.date, period));
    const values = data.series.map(pt => pt.revenue);

    const ctx = document.getElementById('revenueChart').getContext('2d');
    if (revenueChart) revenueChart.destroy();

    revenueChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Revenue (₦)',
          data: values,
          backgroundColor: 'rgba(124, 58, 237, 0.6)',
          borderColor: '#7c3aed',
          borderWidth: 1,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => `₦${Number(v).toLocaleString()}` } }
        }
      }
    });
  } catch (err) { console.error('Revenue chart error:', err); }
}

function formatRevenueLabel(dateStr, period) {
  const d = new Date(dateStr);
  if (period === 'monthly') return d.toLocaleDateString('en-NG', { month: 'short', year: '2-digit' });
  if (period === 'weekly')  return `Wk of ${d.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}`;
  return d.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
}

document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadRevenueChart(btn.dataset.period);
  });
});

// ── PRODUCTS ─────────────────────────────────────────
async function loadProducts() {
  try {
    const res  = await fetch(`${API}/api/products`, { headers: authHeaders() });
    const data = await res.json();
    const body = document.getElementById('productsBody');
    body.innerHTML = '';

    if (!data.length) { body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--ink-muted);padding:2rem">No products yet.</td></tr>`; return; }

    data.forEach(p => {
      const tr = document.createElement('tr');
      const isLowStock = (p.stock !== null && p.stock !== undefined && p.stock <= LOW_STOCK_THRESHOLD);
      const stockDisplay = (p.stock === null || p.stock === undefined)
        ? `<span class="stock-untracked">Untracked</span>`
        : `<button class="stock-btn" onclick="adjustStock(${p.id}, -1)">−</button>
           <span class="stock-count">${p.stock}</span>
           <button class="stock-btn" onclick="adjustStock(${p.id}, 1)">+</button>
           ${isLowStock ? `<span class="badge badge-lowstock">Low</span>` : ''}`;
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>${p.category || '—'}</td>
        <td>$${parseFloat(p.price).toFixed(2)}</td>
        <td>
          <div class="stock-cell">${stockDisplay}</div>
          <span class="badge ${p.in_stock ? 'badge-success' : 'badge-failed'}">${p.in_stock ? 'In Stock' : 'Out'}</span>
        </td>
        <td>
          <button class="action-btn" onclick="openEditProduct(${p.id})">Edit</button>
          <button class="action-btn danger" onclick="deleteProduct(${p.id})">Delete</button>
        </td>`;
      body.appendChild(tr);
    });
  } catch (err) { console.error('Products error:', err); }
}

// Quick stock +/- from the table (item 12) — skips the full edit form for routine adjustments
async function adjustStock(id, delta) {
  try {
    const res = await fetch(`${API}/api/products/${id}/stock`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ delta })
    });
    if (res.ok) loadProducts();
  } catch (err) { console.error('Stock adjust error:', err); }
}

// Open Add form
document.getElementById('openAddProduct').addEventListener('click', () => {
  editingProductId = null;
  document.getElementById('productFormTitle').textContent = 'Add Product';
  document.getElementById('pName').value     = '';
  document.getElementById('pPrice').value    = '';
  document.getElementById('pCategory').value = '';
  document.getElementById('pImage').value    = '';
  document.getElementById('pDesc').value     = '';
  document.getElementById('pStock').value    = 'true';
  document.getElementById('pStockCount').value = '';
  document.getElementById('productForm').classList.remove('hidden');
});

// Open Edit form
async function openEditProduct(id) {
  try {
    const res = await fetch(`${API}/api/products/${id}`, { headers: authHeaders() });
    const p   = await res.json();
    editingProductId = id;
    document.getElementById('productFormTitle').textContent = 'Edit Product';
    document.getElementById('pName').value     = p.name;
    document.getElementById('pPrice').value    = p.price;
    document.getElementById('pCategory').value = p.category || '';
    document.getElementById('pImage').value     = p.image_url  || '';
    document.getElementById('pBackImage').value = p.back_image || '';
    document.getElementById('pDesc').value     = p.description || '';
    document.getElementById('pStock').value    = p.in_stock ? 'true' : 'false';
    document.getElementById('pStockCount').value = (p.stock === null || p.stock === undefined) ? '' : p.stock;
    document.getElementById('productForm').classList.remove('hidden');
    document.getElementById('productForm').scrollIntoView({ behavior: 'smooth' });
  } catch (err) { console.error('Edit product error:', err); }
}

// Cancel form
document.getElementById('cancelProductBtn').addEventListener('click', () => {
  document.getElementById('productForm').classList.add('hidden');
  editingProductId = null;
});

// Save product
document.getElementById('saveProductBtn').addEventListener('click', async () => {
  const msgEl = document.getElementById('productMsg');
  const stockRaw = document.getElementById('pStockCount').value.trim();
  const body  = {
    name:        document.getElementById('pName').value.trim(),
    price:       document.getElementById('pPrice').value,
    category:    document.getElementById('pCategory').value.trim(),
    image_url:   document.getElementById('pImage').value.trim(),
    description: document.getElementById('pDesc').value.trim(),
    in_stock:    document.getElementById('pStock').value === 'true',
    stock:       stockRaw === '' ? null : parseInt(stockRaw, 10),
  };

  if (!body.name || !body.price) { msgEl.textContent = 'Name and price are required.'; msgEl.className = 'form-msg error'; return; }

  try {
    const url    = editingProductId ? `${API}/api/products/${editingProductId}` : `${API}/api/products`;
    const method = editingProductId ? 'PUT' : 'POST';
    const res    = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
    const data   = await res.json();

    if (!res.ok) { msgEl.textContent = data.error || 'Failed.'; msgEl.className = 'form-msg error'; return; }

    msgEl.textContent = editingProductId ? 'Product updated.' : 'Product added.';
    msgEl.className   = 'form-msg success';
    setTimeout(() => {
      document.getElementById('productForm').classList.add('hidden');
      editingProductId = null;
      loadProducts();
    }, 1000);
  } catch { msgEl.textContent = 'Network error.'; msgEl.className = 'form-msg error'; }
});

// Delete product
async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  try {
    await fetch(`${API}/api/products/${id}`, { method: 'DELETE', headers: authHeaders() });
    loadProducts();
  } catch (err) { console.error('Delete error:', err); }
}

// ── ORDERS ───────────────────────────────────────────
async function loadOrders() {
  try {
    const res  = await fetch(`${API}/api/orders`, { headers: authHeaders() });
    const data = await res.json();
    const body = document.getElementById('ordersBody');
    body.innerHTML = '';

    if (!data.length) { body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-muted);padding:2rem">No orders yet.</td></tr>`; return; }

    data.forEach(o => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>#${o.id}</td>
        <td>${o.customer_name || '—'}<br><small style="color:var(--ink-muted)">${o.customer_email || ''}</small></td>
        <td>₦${parseFloat(o.total).toLocaleString()}</td>
        <td><span class="badge badge-${o.status === 'completed' ? 'success' : o.status === 'cancelled' ? 'failed' : 'pending'}">${o.status}</span></td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
        <td>
          <select class="status-select" onchange="updateOrderStatus(${o.id}, this.value)">
            <option ${o.status === 'pending'   ? 'selected' : ''}>pending</option>
            <option ${o.status === 'completed' ? 'selected' : ''}>completed</option>
            <option ${o.status === 'cancelled' ? 'selected' : ''}>cancelled</option>
          </select>
          <button class="action-btn danger" onclick="refundOrder(${o.id}, ${o.total})"
            ${(o.payment_status === 'refunded' || !o.payment_ref) ? 'disabled' : ''}>
            ${o.payment_status === 'refunded' ? 'Refunded' : 'Refund'}
          </button>
        </td>`;
      body.appendChild(tr);
    });
  } catch (err) { console.error('Orders error:', err); }
}

async function refundOrder(id, total) {
  if (!confirm(`Refund order #${id} for ₦${Number(total).toLocaleString()}? This cannot be undone from here.`)) return;
  try {
    const res  = await fetch(`${API}/api/orders/${id}/refund`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}) // full refund by default
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Refund failed.'); return; }
    alert('Refund initiated successfully.');
    loadOrders();
  } catch (err) {
    console.error('Refund error:', err);
    alert('Network error — refund request failed.');
  }
}

async function updateOrderStatus(id, status) {
  try {
    await fetch(`${API}/api/orders/${id}/status`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ status })
    });
  } catch (err) { console.error('Update status error:', err); }
}

// ── CALENDAR / TRANSACTIONS ───────────────────────────
function initCalendar() {
  const now = new Date();
  calYear   = now.getFullYear();
  calMonth  = now.getMonth() + 1;
  renderCalendar();
}

document.getElementById('calPrev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 1) { calMonth = 12; calYear--; }
  renderCalendar();
});

document.getElementById('calNext').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 12) { calMonth = 1; calYear++; }
  renderCalendar();
});

async function renderCalendar() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calTitle').textContent = `${months[calMonth - 1]} ${calYear}`;

  // Fetch summary for dots
  let summary = [];
  try {
    const res = await fetch(`${API}/api/transactions/summary/${calYear}/${calMonth}`, { headers: authHeaders() });
    summary   = await res.json();
  } catch {}

  const datesWithData = new Set((Array.isArray(summary) ? summary : []).map(s => s.date?.slice(0, 10)));

  const grid     = document.getElementById('calGrid');
  grid.innerHTML = '';

  // Day name headers
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-day-name';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  // Empty cells
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const el = document.createElement('div');
    el.className = 'cal-day';
    if (dateStr === today)             el.classList.add('today');
    if (datesWithData.has(dateStr))    el.classList.add('has-data');
    el.textContent = d;
    el.addEventListener('click', () => loadDayTransactions(dateStr, el));
    grid.appendChild(el);
  }

  // Hide detail panel
  document.getElementById('txDetail').classList.add('hidden');
}

async function loadDayTransactions(dateStr, dayEl) {
  // Highlight selected
  document.querySelectorAll('.cal-day').forEach(d => d.classList.remove('selected'));
  dayEl.classList.add('selected');

  const detail = document.getElementById('txDetail');
  detail.classList.remove('hidden');
  document.getElementById('txDetailDate').textContent = new Date(dateStr + 'T00:00:00').toDateString();

  try {
    const [orders, payments] = await Promise.all([
      fetch(`${API}/api/orders/by-date/${dateStr}`,       { headers: authHeaders() }).then(r => r.json()),
      fetch(`${API}/api/transactions/by-date/${dateStr}`, { headers: authHeaders() }).then(r => r.json()),
    ]);

    // Orders
    const ordersEl = document.getElementById('txOrders');
    if (!orders.length) {
      ordersEl.innerHTML = `<p class="tx-empty">No orders on this date.</p>`;
    } else {
      ordersEl.innerHTML = orders.map(o => `
        <div class="tx-item">
          <span class="tx-item-label">#${o.id} — ${o.customer_name || 'Guest'}</span>
          <span class="tx-item-val">₦${parseFloat(o.total).toLocaleString()}</span>
        </div>`).join('');
    }

    // Payments
    const paymentsEl = document.getElementById('txPayments');
    if (!payments.length) {
      paymentsEl.innerHTML = `<p class="tx-empty">No payments on this date.</p>`;
    } else {
      paymentsEl.innerHTML = payments.map(t => `
        <div class="tx-item">
          <span class="tx-item-label">${t.reference || 'N/A'}</span>
          <span class="tx-item-val">₦${parseFloat(t.amount).toLocaleString()} <span class="badge badge-${t.status === 'success' ? 'success' : 'failed'}">${t.status}</span></span>
        </div>`).join('');
    }

  } catch (err) { console.error('Day transactions error:', err); }
}

// ── USERS ─────────────────────────────────────────────
async function loadUsers() {
  try {
    const res  = await fetch(`${API}/api/users`, { headers: authHeaders() });
    const data = await res.json();
    const body = document.getElementById('usersBody');
    body.innerHTML = '';

    if (!data.length) { body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--ink-muted);padding:2rem">No users yet.</td></tr>`; return; }

    data.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.name}</td>
        <td>${u.email}</td>
        <td><span class="badge badge-${u.role === 'admin' ? 'admin' : 'user'}">${u.role}</span></td>
        <td><span class="badge badge-${u.verified ? 'success' : 'pending'}">${u.verified ? 'Yes' : 'No'}</span></td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>`;
      body.appendChild(tr);
    });
  } catch (err) { console.error('Users error:', err); }

  // ── PRINT PRICING ─────────────────────────────────────
async function loadPrintPricing() {
  try {
    const res  = await fetch(`${API}/api/print-pricing`, { headers: authHeaders() });
    const data = await res.json();
    const body = document.getElementById('pricingBody');
    body.innerHTML = '';

    data.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.size_label}</td>
        <td>${p.dimensions}</td>
        <td>
          <input class="pricing-input" type="number" value="${p.price}" 
            step="0.01" min="0" data-id="${p.id}" 
            style="background:var(--surface2);border:1px solid var(--border);
            color:var(--ink);border-radius:6px;padding:0.3rem 0.6rem;width:80px"/>
        </td>
        <td>
          <button class="action-btn" onclick="savePrintPrice(${p.id})">Save</button>
        </td>`;
      body.appendChild(tr);
    });
  } catch (err) { console.error('Print pricing error:', err); }
}

async function savePrintPrice(id) {
  const input = document.querySelector(`.pricing-input[data-id="${id}"]`);
  const price = input?.value;
  if (!price) return;
  try {
    const res = await fetch(`${API}/api/print-pricing/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ price })
    });
    if (res.ok) {
      input.style.borderColor = 'var(--success)';
      setTimeout(() => input.style.borderColor = 'var(--border)', 1500);
    }
  } catch (err) { console.error('Save price error:', err); }
}

}