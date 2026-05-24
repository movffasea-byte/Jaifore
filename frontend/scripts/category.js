/* ================================
   JAIFORE — CATEGORY PAGE
   scripts/category.js
   ================================ */

const API = 'https://jai-fore-website.onrender.com';

const CATEGORY_META = {
  apparel: {
    title: 'Apparel & Merchandise',
    tag:   'Merch',
    desc:  'Premium blank canvas pieces — yours to wear, gift, or brand. Select size, quantity, and we ship worldwide.',
    dbCat: 'Apparels & Merchandise'
  },
  design: {
    title: 'Graphic Design',
    tag:   'Design',
    desc:  'Pick from our curated designs or bring your vision — we\'ll bring it to life on any surface.',
    dbCat: 'Graphic Design'
  },
  webdev: {
    title: 'Web Development',
    tag:   'Web',
    desc:  'Sites we\'ve built, live and breathing. Want something similar? Let\'s talk scope and we\'ll build yours.',
    dbCat: 'Web Development'
  }
};

const PLACEHOLDERS = {
  apparel: ['👕','👖','🩳','🧥','🎒','☕','📱'],
  design:  ['🎨','✏️','🖌️','🖼️','💡','🌀','⚡'],
  webdev:  ['🌐','💻','🖥️','⚙️','🚀','📡','🔮']
};

// ── STATE ───────────────────────────────────────────
let allProducts      = [];
let filteredProducts = [];
let displayedCount   = 0;
const PAGE_SIZE      = 12;
let currentCategory  = 'apparel';
let selectedSize     = null;
let currentProduct   = null;

// ── INIT ────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
currentCategory = params.get('cat') || 'apparel';
const meta = CATEGORY_META[currentCategory] || CATEGORY_META.apparel;

document.getElementById('catTag').textContent   = meta.tag;
document.getElementById('catTitle').textContent = meta.title;
document.getElementById('catDesc').textContent  = meta.desc;
document.title = `Jai'fore — ${meta.title}`;

// ── FETCH ALL ───────────────────────────────────────
async function fetchAll() {
  try {
    const cat = encodeURIComponent(meta.dbCat);
    const res = await fetch(`${API}/api/products?category=${cat}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

// ── FILTER & SORT ───────────────────────────────────
function applyFilters() {
  const sort  = document.getElementById('sortSelect').value;
  const stock = document.getElementById('stockSelect').value;

  let result = [...allProducts];

  if (stock === 'instock') result = result.filter(p => p.in_stock);

  if (sort === 'price-asc')  result.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') result.sort((a, b) => b.price - a.price);
  if (sort === 'newest')     result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  filteredProducts = result;
  displayedCount   = 0;
  document.getElementById('cat-grid').innerHTML = '';
  document.getElementById('catCount').textContent = `${filteredProducts.length} product${filteredProducts.length !== 1 ? 's' : ''}`;
  loadNextPage();
}

// ── LOAD PAGE ───────────────────────────────────────
function loadNextPage() {
  const grid  = document.getElementById('cat-grid');
  const slice = filteredProducts.slice(displayedCount, displayedCount + PAGE_SIZE);

  if (!filteredProducts.length && displayedCount === 0) {
    document.getElementById('catEmpty').classList.remove('hidden');
    document.getElementById('loadMoreWrap').classList.add('hidden');
    return;
  }

  slice.forEach((p, i) => grid.appendChild(renderCard(p, displayedCount + i)));
  displayedCount += slice.length;

  const loadMoreWrap = document.getElementById('loadMoreWrap');
  if (displayedCount >= filteredProducts.length) {
    loadMoreWrap.classList.add('hidden');
  } else {
    loadMoreWrap.classList.remove('hidden');
  }
}

// ── RENDER CARD ─────────────────────────────────────
function renderCard(product, index) {
  const card = document.createElement('div');
  card.className = 'product-card';
  card.style.animationDelay = `${(index % PAGE_SIZE) * 0.05}s`;

  const isWebdev  = currentCategory === 'webdev';
  const isApparel = currentCategory === 'apparel';
  const placeholder = PLACEHOLDERS[currentCategory]?.[index % 7] || '📦';

  const imgHTML = product.image_url
    ? `<img src="${product.image_url}" alt="${product.name}" loading="lazy"/>`
    : `<div class="card-img-placeholder">${placeholder}</div>`;

  const sizeHTML = isApparel && product.sizes?.length
    ? `<div class="size-chips">
        ${product.sizes.slice(0,4).map(s => `<span class="size-chip">${s}</span>`).join('')}
        ${product.sizes.length > 4 ? `<span class="size-chip">+${product.sizes.length - 4}</span>` : ''}
       </div>` : '';

  const domainHTML = isWebdev && product.domain
    ? `<div class="site-domain">↗ ${product.domain}</div>` : '';

  const stockBadge = !product.in_stock
    ? `<span class="card-badge out-of-stock">Out of Stock</span>`
    : `<span class="card-badge">${meta.tag}</span>`;

  const footerHTML = isApparel
    ? `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>
       <div style="display:flex;gap:0.4rem">
         <button class="configure-btn" data-id="${product.id}">🎨 Design</button>
         <button class="card-action" data-id="${product.id}" ${!product.in_stock ? 'disabled' : ''}>Add to Cart</button>
       </div>`
    : `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>
       <button class="card-action" data-id="${product.id}">${isWebdev ? 'Enquire' : 'Order Now'}</button>`;

  card.innerHTML = `
    <div class="card-img">
      ${imgHTML}
      ${stockBadge}
    </div>
    <div class="card-body">
      ${domainHTML}
      <div class="card-name">${product.name}</div>
      <div class="card-desc">${product.description}</div>
      ${sizeHTML}
      <div class="card-footer">${footerHTML}</div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (!e.target.classList.contains('card-action') &&
        !e.target.classList.contains('configure-btn')) {
      openModal(product);
    }
  });

  card.querySelector('.card-action')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isWebdev || (isApparel && product.sizes?.length)) {
      openModal(product);
    } else {
      addToCart(product, null, currentCategory);
    }
  });

  card.querySelector('.configure-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = `configurator.html?product=${product.id}`;
  });

  return card;
}

// ── MODAL ───────────────────────────────────────────
function openModal(product) {
  currentProduct = product;
  selectedSize   = null;

  const isWebdev  = currentCategory === 'webdev';
  const isApparel = currentCategory === 'apparel';
  const placeholder = PLACEHOLDERS[currentCategory]?.[0] || '📦';

  const imgHTML = product.image_url
    ? `<img src="${product.image_url}" alt="${product.name}"/>`
    : `<div class="modal-img-placeholder">${placeholder}</div>`;

  const sizesHTML = isApparel && product.sizes?.length
    ? `<div class="modal-sizes">
        <label>Select Size</label>
        <div class="modal-size-opts">
          ${product.sizes.map(s => `<button class="size-opt" data-size="${s}">${s}</button>`).join('')}
        </div>
       </div>` : '';

  const actionHTML = isWebdev
    ? `<a href="mailto:hello@jaifore.com?subject=Enquiry: ${encodeURIComponent(product.name)}" class="modal-link">✉ Enquire About This Site →</a>
       ${product.siteUrl ? `<a href="${product.siteUrl}" target="_blank" class="modal-link">🌐 Visit Live Site →</a>` : ''}`
    : isApparel
      ? `<button class="modal-configure-btn" onclick="window.location.href='configurator.html?product=${product.id}'">🎨 Design It in Studio</button>
         <button class="modal-add-btn" ${!product.in_stock ? 'disabled' : ''}>Add to Cart</button>`
      : `<button class="modal-add-btn">Order Now</button>`;

  document.getElementById('modal-inner').innerHTML = `
    <div class="modal-grid">
      <div class="modal-img">${imgHTML}</div>
      <div class="modal-details">
        <div class="modal-category">${meta.tag}</div>
        <div class="modal-name">${product.name}</div>
        <div class="modal-price">${formatPrice(product.price)}</div>
        <div class="modal-desc">${product.description}</div>
        ${sizesHTML}
        ${actionHTML}
      </div>
    </div>
  `;

  document.querySelectorAll('.size-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedSize = btn.dataset.size;
    });
  });

  const addBtn = document.querySelector('.modal-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (isApparel && product.sizes?.length && !selectedSize) {
        addBtn.textContent = 'Please select a size first';
        addBtn.style.background = '#b03030';
        setTimeout(() => { addBtn.textContent = 'Add to Cart'; addBtn.style.background = ''; }, 1500);
        return;
      }
      addToCart(product, selectedSize, currentCategory);
      closeModal();
      openCart();
    });
  }

  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('product-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('product-modal').classList.remove('open');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', closeModal);

// ── LOAD MORE ────────────────────────────────────────
document.getElementById('loadMoreBtn').addEventListener('click', loadNextPage);

// ── FILTER EVENTS ────────────────────────────────────
document.getElementById('sortSelect').addEventListener('change', applyFilters);
document.getElementById('stockSelect').addEventListener('change', applyFilters);

// ── START ────────────────────────────────────────────
(async () => {
  allProducts = await fetchAll();

  if (!allProducts.length) {
    document.getElementById('cat-grid').innerHTML = '';
    document.getElementById('catEmpty').classList.remove('hidden');
    document.getElementById('loadMoreWrap').classList.add('hidden');
    document.getElementById('catCount').textContent = '0 products';
    return;
  }

  applyFilters();
})();