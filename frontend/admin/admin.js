/* ================================
   JAIFORE ADMIN — JS
   frontend/admin/admin.js
   ================================ */

const API = 'https://jai-fore-website.onrender.com';

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
  } catch (err) { console.error('Overview error:', err); }
}

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
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>${p.category || '—'}</td>
        <td>₦${parseFloat(p.price).toLocaleString()}</td>
        <td><span class="badge ${p.in_stock ? 'badge-success' : 'badge-failed'}">${p.in_stock ? 'In Stock' : 'Out'}</span></td>
        <td>
          <button class="action-btn" onclick="openEditProduct(${p.id})">Edit</button>
          <button class="action-btn danger" onclick="deleteProduct(${p.id})">Delete</button>
        </td>`;
      body.appendChild(tr);
    });
  } catch (err) { console.error('Products error:', err); }
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
    document.getElementById('pImage').value    = p.image_url || '';
    document.getElementById('pDesc').value     = p.description || '';
    document.getElementById('pStock').value    = p.in_stock ? 'true' : 'false';
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
  const body  = {
    name:        document.getElementById('pName').value.trim(),
    price:       document.getElementById('pPrice').value,
    category:    document.getElementById('pCategory').value.trim(),
    image_url:   document.getElementById('pImage').value.trim(),
    description: document.getElementById('pDesc').value.trim(),
    in_stock:    document.getElementById('pStock').value === 'true',
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
        </td>`;
      body.appendChild(tr);
    });
  } catch (err) { console.error('Orders error:', err); }
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
}