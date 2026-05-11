/* ================================
   JAIFORE ADMIN — LOGIC
   admin.js
   ================================ */

const API = 'https://jai-fore-website.onrender.com';
let token    = localStorage.getItem('jaifore_token');
let adminUser = null;
let allProducts = [];
let allOrders   = [];
let allUsers    = [];
let editingProductId = null;

// ── AUTH GUARD ─────────────────────────────────────────
async function checkAuth() {
  if (!token) { window.location.href = '../auth.html'; return; }
  try {
    const res = await fetch(`${API}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.user.role !== 'admin') {
      alert('Access denied. Admins only.');
      window.location.href = '../auth.html';
      return;
    }
    adminUser = data.user;
    document.getElementById('admin-name').textContent = adminUser.name;
  } catch {
    localStorage.removeItem('jaifore_token');
    window.location.href = '../auth.html';
  }
}

// ── UTILS ──────────────────────────────────────────────
function formatPrice(n) { return `₦${Number(n).toLocaleString('en-NG')}`; }

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' });
}

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 2800);
}

function statusBadge(status) {
  return `<span class="badge badge-${status}">${status}</span>`;
}

function categoryBadge(cat) {
  return `<span class="badge badge-${cat}">${cat}</span>`;
}

// ── TAB NAVIGATION ─────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('.dash-link').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === `tab-${tab}`));
  document.getElementById('topbar-title').textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
  if (tab === 'products') loadProducts();
  if (tab === 'orders')   loadOrders();
  if (tab === 'users')    loadUsers();
}

// ── MOBILE MENU ────────────────────────────────────────
document.getElementById('menu-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ── LOGOUT ─────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('jaifore_token');
  localStorage.removeItem('jaifore_user');
  window.location.href = '../auth.html';
});

// ── DASHBOARD ──────────────────────────────────────────
async function loadDashboard() {
  try {
    const [usersRes, ordersRes, productsRes] = await Promise.all([
      fetch(`${API}/api/admin/users`,    { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API}/api/admin/orders`,   { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API}/api/products`,       { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const users    = usersRes.ok    ? await usersRes.json()    : [];
    const orders   = ordersRes.ok   ? await ordersRes.json()   : [];
    const products = productsRes.ok ? await productsRes.json() : [];

    const usersArr    = Array.isArray(users)    ? users    : users.users    || [];
    const ordersArr   = Array.isArray(orders)   ? orders   : orders.orders  || [];
    const productsArr = Array.isArray(products) ? products : products.products || [];

    const revenue = ordersArr.reduce((s, o) => s + (o.total || 0), 0);

    document.getElementById('stat-users').textContent    = usersArr.length;
    document.getElementById('stat-orders').textContent   = ordersArr.length;
    document.getElementById('stat-products').textContent = productsArr.length;
    document.getElementById('stat-revenue').textContent  = formatPrice(revenue);

    // Recent orders
    const recentOrders = document.getElementById('recent-orders');
    if (!ordersArr.length) {
      recentOrders.innerHTML = '<div class="recent-row"><td class="table-empty">No orders yet</td></div>';
    } else {
      recentOrders.innerHTML = ordersArr.slice(0,5).map(o => `
        <div class="recent-row">
          <div>
            <div class="recent-name">${o.customer_name || o.user_name || 'Customer'}</div>
            <div class="recent-meta">${formatDate(o.created_at)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem">
            ${statusBadge(o.status || 'pending')}
            <span class="recent-val">${formatPrice(o.total || 0)}</span>
          </div>
        </div>
      `).join('');
    }

    // Recent users
    const recentUsers = document.getElementById('recent-users');
    if (!usersArr.length) {
      recentUsers.innerHTML = '<div class="recent-row"><span class="table-empty">No users yet</span></div>';
    } else {
      recentUsers.innerHTML = usersArr.slice(0,5).map(u => `
        <div class="recent-row">
          <div>
            <div class="recent-name">${u.name}</div>
            <div class="recent-meta">${u.email}</div>
          </div>
          <span class="recent-meta">${formatDate(u.created_at)}</span>
        </div>
      `).join('');
    }

  } catch (err) {
    console.error('Dashboard load error:', err);
    // Show zeros if backend not ready
    ['stat-users','stat-orders','stat-products'].forEach(id => {
      document.getElementById(id).textContent = '0';
    });
    document.getElementById('stat-revenue').textContent = '₦0';
    document.getElementById('recent-orders').innerHTML = '<div class="recent-row" style="justify-content:center;color:var(--muted2);font-size:0.78rem;padding:1rem">No data yet</div>';
    document.getElementById('recent-users').innerHTML  = '<div class="recent-row" style="justify-content:center;color:var(--muted2);font-size:0.78rem;padding:1rem">No data yet</div>';
  }
}

// ── PRODUCTS ───────────────────────────────────────────
async function loadProducts(filter = 'all') {
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Loading...</td></tr>';
  try {
    const res  = await fetch(`${API}/api/products`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    allProducts = Array.isArray(data) ? data : data.products || [];
  } catch { allProducts = []; }

  const filtered = filter === 'all' ? allProducts : allProducts.filter(p => p.category === filter);

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No products found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => `
    <tr>
      <td>
        <div style="font-weight:600">${p.name}</div>
        <div style="font-size:0.7rem;color:var(--muted2);margin-top:2px">${(p.description||'').slice(0,50)}${(p.description||'').length>50?'…':''}</div>
      </td>
      <td>${categoryBadge(p.category)}</td>
      <td style="color:var(--gold);font-family:var(--font-d);font-weight:700">${formatPrice(p.price)}</td>
      <td>${statusBadge(p.status || 'active')}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon" onclick="editProduct('${p._id || p.id}')">✏️ Edit</button>
          <button class="btn-icon danger" onclick="deleteProduct('${p._id || p.id}')">🗑 Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// Product filter chips
document.querySelectorAll('.filter-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadProducts(btn.dataset.filter);
  });
});

// ── ADD / EDIT PRODUCT MODAL ───────────────────────────
document.getElementById('add-product-btn').addEventListener('click', () => openProductModal());

function openProductModal(product = null) {
  editingProductId = product ? (product._id || product.id) : null;
  document.getElementById('product-modal-title').textContent = product ? 'Edit Product' : 'Add Product';
  document.getElementById('p-name').value        = product?.name        || '';
  document.getElementById('p-category').value    = product?.category    || '';
  document.getElementById('p-description').value = product?.description || '';
  document.getElementById('p-price').value       = product?.price       || '';
  document.getElementById('p-sizes').value       = (product?.sizes||[]).join(', ');
  document.getElementById('p-image').value       = product?.image       || '';
  document.getElementById('p-domain').value      = product?.domain      || '';
  toggleDomainField();
  document.getElementById('product-modal-overlay').classList.add('open');
  document.getElementById('product-modal').classList.add('open');
}

function closeProductModal() {
  document.getElementById('product-modal-overlay').classList.remove('open');
  document.getElementById('product-modal').classList.remove('open');
  editingProductId = null;
}

document.getElementById('product-modal-close').addEventListener('click',  closeProductModal);
document.getElementById('product-modal-cancel').addEventListener('click', closeProductModal);
document.getElementById('product-modal-overlay').addEventListener('click', closeProductModal);

document.getElementById('p-category').addEventListener('change', toggleDomainField);

function toggleDomainField() {
  const cat = document.getElementById('p-category').value;
  document.getElementById('domain-group').style.display = cat === 'webdev' ? 'flex' : 'none';
}

document.getElementById('product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sizesRaw = document.getElementById('p-sizes').value;
  const body = {
    name:        document.getElementById('p-name').value.trim(),
    category:    document.getElementById('p-category').value,
    description: document.getElementById('p-description').value.trim(),
    price:       Number(document.getElementById('p-price').value),
    sizes:       sizesRaw ? sizesRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
    image:       document.getElementById('p-image').value.trim() || null,
    domain:      document.getElementById('p-domain').value.trim() || null,
  };

  const url    = editingProductId ? `${API}/api/products/${editingProductId}` : `${API}/api/products`;
  const method = editingProductId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json(); toast(d.error || 'Failed to save product.', 'error'); return; }
    toast(editingProductId ? 'Product updated!' : 'Product added!', 'success');
    closeProductModal();
    loadProducts();
  } catch {
    toast('Network error. Try again.', 'error');
  }
});

function editProduct(id) {
  const p = allProducts.find(x => (x._id || x.id) === id);
  if (p) openProductModal(p);
}

async function deleteProduct(id) {
  if (!confirm('Delete this product? This cannot be undone.')) return;
  try {
    const res = await fetch(`${API}/api/products/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { toast('Failed to delete product.', 'error'); return; }
    toast('Product deleted.', 'success');
    loadProducts();
  } catch { toast('Network error.', 'error'); }
}

// ── ORDERS ─────────────────────────────────────────────
async function loadOrders(statusFilter = 'all') {
  const tbody = document.getElementById('orders-tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Loading...</td></tr>';
  try {
    const res  = await fetch(`${API}/api/admin/orders`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    allOrders = Array.isArray(data) ? data : data.orders || [];
  } catch { allOrders = []; }

  const filtered = statusFilter === 'all' ? allOrders : allOrders.filter(o => o.status === statusFilter);

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No orders found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(o => `
    <tr>
      <td style="font-family:var(--font-d);font-size:0.75rem;color:var(--muted2)">#${(o.id||o._id||'').toString().slice(-6).toUpperCase()}</td>
      <td>
        <div style="font-weight:600">${o.customer_name || o.user_name || '—'}</div>
        <div style="font-size:0.7rem;color:var(--muted2)">${o.customer_email || o.user_email || ''}</div>
      </td>
      <td style="color:var(--muted2)">${o.items?.length || 0} item(s)</td>
      <td style="color:var(--gold);font-family:var(--font-d);font-weight:700">${formatPrice(o.total||0)}</td>
      <td>
        <select class="select-input" style="font-size:0.7rem;padding:0.2rem 0.5rem"
          onchange="updateOrderStatus('${o.id||o._id}', this.value)">
          ${['pending','processing','shipped','delivered','cancelled'].map(s =>
            `<option value="${s}"${(o.status||'pending')===s?' selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`
          ).join('')}
        </select>
      </td>
      <td style="color:var(--muted2);font-size:0.75rem">${formatDate(o.created_at)}</td>
      <td>
        <button class="btn-icon" onclick="viewOrder('${o.id||o._id}')">👁 View</button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('order-status-filter').addEventListener('change', (e) => {
  loadOrders(e.target.value);
});

async function updateOrderStatus(id, status) {
  try {
    const res = await fetch(`${API}/api/admin/orders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    if (res.ok) toast(`Order status updated to ${status}`, 'success');
    else toast('Failed to update status.', 'error');
  } catch { toast('Network error.', 'error'); }
}

function viewOrder(id) {
  const order = allOrders.find(o => (o.id||o._id) === id);
  if (!order) return;
  alert(`Order #${id.toString().slice(-6).toUpperCase()}\nCustomer: ${order.customer_name||'—'}\nTotal: ${formatPrice(order.total||0)}\nStatus: ${order.status||'pending'}\nDate: ${formatDate(order.created_at)}`);
}

// ── USERS ──────────────────────────────────────────────
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Loading...</td></tr>';
  try {
    const res  = await fetch(`${API}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    allUsers = Array.isArray(data) ? data : data.users || [];
  } catch { allUsers = []; }
  renderUsersTable(allUsers);
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No users found.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => `
    <tr>
      <td style="font-weight:600">${u.name}</td>
      <td style="color:var(--muted2)">${u.email}</td>
      <td><span class="badge badge-${u.role||'user'}">${u.role||'user'}</span></td>
      <td style="color:var(--muted2);font-size:0.75rem">${formatDate(u.created_at)}</td>
      <td>
        <div class="action-btns">
          ${u.role !== 'admin'
            ? `<button class="btn-icon" onclick="promoteUser(${u.id})">⬆ Make Admin</button>`
            : `<button class="btn-icon" onclick="demoteUser(${u.id})">⬇ Remove Admin</button>`}
          <button class="btn-icon danger" onclick="deleteUser(${u.id})">🗑 Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// User search
document.getElementById('user-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allUsers.filter(u =>
    u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  );
  renderUsersTable(filtered);
});

async function promoteUser(id) {
  if (!confirm('Make this user an admin?')) return;
  try {
    const res = await fetch(`${API}/api/admin/users/${id}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: 'admin' }),
    });
    if (res.ok) { toast('User promoted to admin.', 'success'); loadUsers(); }
    else toast('Failed to update role.', 'error');
  } catch { toast('Network error.', 'error'); }
}

async function demoteUser(id) {
  if (!confirm('Remove admin role from this user?')) return;
  try {
    const res = await fetch(`${API}/api/admin/users/${id}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: 'user' }),
    });
    if (res.ok) { toast('Admin role removed.', 'success'); loadUsers(); }
    else toast('Failed to update role.', 'error');
  } catch { toast('Network error.', 'error'); }
}

async function deleteUser(id) {
  if (!confirm('Delete this user? This cannot be undone.')) return;
  try {
    const res = await fetch(`${API}/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) { toast('User deleted.', 'success'); loadUsers(); }
    else toast('Failed to delete user.', 'error');
  } catch { toast('Network error.', 'error'); }
}

// ── INIT ───────────────────────────────────────────────
async function init() {
  await checkAuth();
  loadDashboard();
}

init();