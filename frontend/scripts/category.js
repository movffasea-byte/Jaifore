/* ================================
   JAIFORE — CATEGORY PAGE
   scripts/category.js
   ================================ */

const API = 'https://jai-fore-production.up.railway.app';

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

function formatPrice(amount) {
  if (window.JaiforeCurrency?.isReady()) {
    return window.JaiforeCurrency.format(amount);
  }
  return `$${Number(amount).toLocaleString()}`;
}

const productsByCategory = {};
let filteredProducts = [];
let displayedCount   = 0;
const PAGE_SIZE      = 12;
let currentCategory  = 'apparel';
let selectedSize     = null;
let currentProduct   = null;

const designQuantities = {};
const MIN_QUANTITY = 1;

function getDesignQty(productId) {
  return designQuantities[productId] || MIN_QUANTITY;
}

function setDesignQty(productId, newQty) {
  const parsed = parseInt(newQty, 10);
  const qty = (isNaN(parsed) || parsed < MIN_QUANTITY) ? MIN_QUANTITY : parsed;
  designQuantities[productId] = qty;

  document.querySelectorAll(`.qty-input[data-product-id="${productId}"]`).forEach(input => {
    input.value = qty;
  });
  document.querySelectorAll(`.qty-minus-btn[data-product-id="${productId}"]`).forEach(btn => {
    btn.disabled = qty <= MIN_QUANTITY;
  });
  return qty;
}

function renderQtyStepper(productId, category) {
  if (category !== 'design') return '';
  const qty = getDesignQty(productId);
  return `
    <div class="qty-stepper" onclick="event.stopPropagation()">
      <button class="qty-minus-btn" type="button" data-product-id="${productId}" ${qty <= MIN_QUANTITY ? 'disabled' : ''}>−</button>
      <input type="number" class="qty-input" data-product-id="${productId}" value="${qty}" min="${MIN_QUANTITY}" inputmode="numeric" aria-label="Quantity"/>
      <button class="qty-plus-btn" type="button" data-product-id="${productId}">+</button>
    </div>
  `;
}

document.addEventListener('click', (e) => {
  const minusBtn = e.target.closest('.qty-minus-btn');
  if (minusBtn) {
    const id = minusBtn.dataset.productId;
    setDesignQty(id, getDesignQty(id) - 1);
    return;
  }
  const plusBtn = e.target.closest('.qty-plus-btn');
  if (plusBtn) {
    const id = plusBtn.dataset.productId;
    setDesignQty(id, getDesignQty(id) + 1);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.classList.contains('qty-input')) {
    setDesignQty(e.target.dataset.productId, e.target.value);
  }
});

function renderWishlistHeart(productId, category) {
  if (category === 'webdev') return '';
  return `<button class="wishlist-heart-btn" type="button" data-product-id="${productId}" onclick="event.stopPropagation()" aria-label="Save for later">♡</button>`;
}

let wishlistedProductIds = new Set();

async function loadWishlistedIds() {
  const token = localStorage.getItem('jaifore_token');
  if (!token) return;
  try {
    const res = await fetch(`${API}/api/wishlist`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const items = await res.json();
    wishlistedProductIds = new Set(
      items.filter(i => !i.config_signature).map(i => String(i.product_id))
    );
  } catch { /* silent — hearts default to empty state, nothing breaks */ }
}

function syncWishlistHearts() {
  document.querySelectorAll('.wishlist-heart-btn').forEach(btn => {
    const saved = wishlistedProductIds.has(String(btn.dataset.productId));
    btn.classList.toggle('saved', saved);
    btn.textContent = saved ? '♥' : '♡';
  });
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.wishlist-heart-btn');
  if (!btn) return;

  const token = localStorage.getItem('jaifore_token');
  if (!token) { window.location.href = 'loginsys.html'; return; }

  const productId = btn.dataset.productId;
  const product = (productsByCategory[currentCategory] || []).find(p => String(p.id) === String(productId));
  if (!product) return;

  const alreadySaved = wishlistedProductIds.has(String(productId));
  btn.disabled = true;

  try {
    if (alreadySaved) {
      const listRes = await fetch(`${API}/api/wishlist`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const items = await listRes.json();
      const match = items.find(i => !i.config_signature && String(i.product_id) === String(productId));
      if (match) {
        await fetch(`${API}/api/wishlist/${match.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
      wishlistedProductIds.delete(String(productId));
    } else {
      await fetch(`${API}/api/wishlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          productId: product.id,
          name: product.name,
          price: product.price,
          snapshot: product.image_url || null
        })
      });
      wishlistedProductIds.add(String(productId));
    }
    syncWishlistHearts();
  } catch {
    // Silent failure
  } finally {
    btn.disabled = false;
  }
});

function recordProductView(productId) {
  const token = localStorage.getItem('jaifore_token');
  if (!token) return;
  fetch(`${API}/api/recently-viewed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify({ productId })
  }).catch(() => { /* silent */ });
}

function getRelatedItems(category, excludeProductId) {
  const pool = productsByCategory[category] || [];
  return pool
    .filter(p => String(p.id) !== String(excludeProductId))
    .slice(0, 4);
}

function renderRelatedItemsHTML(items) {
  if (!items.length) return '';
  return `
    <div class="modal-related-section">
      <div class="modal-related-label">You Might Also Like</div>
      <div class="modal-related-row">
        ${items.map(p => `
          <div class="modal-related-card" data-id="${p.id}">
            <div class="modal-related-img">
              ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" loading="lazy"/>` : '📦'}
            </div>
            <div class="modal-related-name">${p.name}</div>
            <div class="modal-related-price">₦${Number(p.price).toLocaleString('en-NG')}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

const params = new URLSearchParams(window.location.search);
currentCategory = params.get('cat') || 'apparel';
if (!CATEGORY_META[currentCategory]) currentCategory = 'apparel';

function updateHeroForCategory(cat) {
  const meta = CATEGORY_META[cat] || CATEGORY_META.apparel;
  document.getElementById('catTag').textContent   = meta.tag;
  document.getElementById('catTitle').textContent = meta.title;
  document.getElementById('catDesc').textContent  = meta.desc;
  document.getElementById('catEmptyMsg').textContent = `No products found in ${meta.title.toLowerCase()} yet.`;
  document.title = `Jai'fore — ${meta.title}`;
}

updateHeroForCategory(currentCategory);
document.getElementById('categorySelect').value = currentCategory;

async function fetchCategory(cat) {
  if (productsByCategory[cat]) return productsByCategory[cat];

  const meta = CATEGORY_META[cat] || CATEGORY_META.apparel;
  try {
    const dbCat = encodeURIComponent(meta.dbCat);
    const res = await fetch(`${API}/api/products?category=${dbCat}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    productsByCategory[cat] = Array.isArray(data) ? data : [];
  } catch {
    productsByCategory[cat] = [];
  }
  return productsByCategory[cat];
}

function applyFilters() {
  const searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
  const sort  = document.getElementById('sortSelect').value;
  const stock = document.getElementById('stockSelect').value;

  let result = [...(productsByCategory[currentCategory] || [])];

  if (searchTerm) {
    result = result.filter(p =>
      (p.name || '').toLowerCase().includes(searchTerm) ||
      (p.description || '').toLowerCase().includes(searchTerm)
    );
  }

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

function loadNextPage() {
  const grid  = document.getElementById('cat-grid');
  const slice = filteredProducts.slice(displayedCount, displayedCount + PAGE_SIZE);

  if (!filteredProducts.length && displayedCount === 0) {
    document.getElementById('catEmpty').classList.remove('hidden');
    document.getElementById('loadMoreWrap').classList.add('hidden');
    return;
  }
  document.getElementById('catEmpty').classList.add('hidden');

  slice.forEach((p, i) => grid.appendChild(renderCard(p, displayedCount + i)));
  displayedCount += slice.length;
  syncWishlistHearts();

  const loadMoreWrap = document.getElementById('loadMoreWrap');
  if (displayedCount >= filteredProducts.length) {
    loadMoreWrap.classList.add('hidden');
  } else {
    loadMoreWrap.classList.remove('hidden');
  }
}

function renderCard(product, index) {
  const meta = CATEGORY_META[currentCategory] || CATEGORY_META.apparel;
  const card = document.createElement('div');
  card.className = 'product-card';
  card.style.animationDelay = `${(index % PAGE_SIZE) * 0.05}s`;

  const isWebdev  = currentCategory === 'webdev';
  const isApparel = currentCategory === 'apparel';
  const isDesign  = currentCategory === 'design';
  const placeholder = PLACEHOLDERS[currentCategory]?.[index % 7] || '📦';

  const imgHTML = product.image_url
    ? `<img src="${product.image_url}" alt="${product.name}" loading="lazy"/>`
    : `<div class="card-img-placeholder">${placeholder}</div>`;

  const sizeHTML = isApparel && product.sizes?.length
    ? `<div class="size-chips">
        ${product.sizes.slice(0,4).map(s => `<span class="size-chip">${s}</span>`).join('')}
        ${product.sizes.length > 4 ? `<span class="size-chip">+${product.sizes.length - 4}</span>` : ''}
       </div>` : '';

  // FIX: webdev's live link comes from product.live_link (real DB field),
  // never product.domain (that only ever existed in mock data).
  const domainHTML = isWebdev && product.live_link
    ? `<div class="site-domain">↗ ${product.live_link}</div>` : '';

  const stockBadge = !product.in_stock
    ? `<span class="card-badge out-of-stock">Out of Stock</span>`
    : `<span class="card-badge">${meta.tag}</span>`;

  const qtyStepperHTML = renderQtyStepper(product.id, currentCategory);
  const wishlistHeartHTML = renderWishlistHeart(product.id, currentCategory);

  const footerHTML = isApparel
    ? `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>
       <div style="display:flex;gap:0.4rem">
         ${wishlistHeartHTML}
         <button class="configure-btn" data-id="${product.id}">🎨 Design</button>
         <button class="card-action" data-id="${product.id}" ${!product.in_stock ? 'disabled' : ''}>Add to Cart</button>
       </div>`
    : isDesign
      ? `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>
         <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
           ${wishlistHeartHTML}
           ${qtyStepperHTML}
           <button class="card-action" data-id="${product.id}">Order Now</button>
         </div>`
      // FIX: webdev has no price to show — it's enquiry-only.
      : `${isWebdev ? '' : `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>`}
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
        !e.target.classList.contains('configure-btn') &&
        !e.target.closest('.qty-stepper') &&
        !e.target.closest('.wishlist-heart-btn')) {
      openModal(product);
    }
  });

  card.querySelector('.card-action')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isWebdev || (isApparel && product.sizes?.length)) {
      openModal(product);
    } else if (isDesign) {
      const qty = getDesignQty(product.id);
      for (let i = 0; i < qty; i++) {
        addToCart(product, null, currentCategory);
      }
      recordProductView(product.id);
    } else {
      addToCart(product, null, currentCategory);
      recordProductView(product.id);
    }
  });

  card.querySelector('.configure-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = `configurator.html?product=${product.id}`;
  });

  return card;
}

async function openModal(product) {
  const meta = CATEGORY_META[currentCategory] || CATEGORY_META.apparel;
  currentProduct = product;
  selectedSize   = null;

  const isWebdev  = currentCategory === 'webdev';
  const isApparel = currentCategory === 'apparel';
  const isDesign  = currentCategory === 'design';
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

  const qtyStepperModalHTML = isDesign
    ? `<div class="modal-qty-row">
         <label>Quantity</label>
         ${renderQtyStepper(product.id, currentCategory)}
       </div>`
    : '';

  const modalWishlistHeartHTML = !isWebdev
    ? `<button class="modal-wishlist-heart-btn wishlist-heart-btn" type="button" data-product-id="${product.id}" aria-label="Save for later">♡</button>`
    : '';

  // FIX: "Visit Live Site" now uses product.live_link (real DB field),
  // never product.siteUrl (mock-only). Normalizes a bare domain into a
  // working https:// link.
  const liveLinkHref = product.live_link
    ? (product.live_link.startsWith('http') ? product.live_link : `https://${product.live_link}`)
    : null;

  const actionHTML = isWebdev
    ? `<button class="modal-link modal-enquire-btn" type="button" style="background:none;border:none;cursor:pointer;padding:0;font:inherit">✉ Enquire About This Site →</button>
       ${liveLinkHref ? `<a href="${liveLinkHref}" target="_blank" class="modal-link">🌐 Visit Live Site →</a>` : ''}`
    : isApparel
      ? `<button class="modal-configure-btn" onclick="window.location.href='configurator.html?product=${product.id}'">🎨 Design It in Studio</button>
         <button class="modal-add-btn" ${!product.in_stock ? 'disabled' : ''}>Add to Cart</button>`
      : `<button class="modal-add-btn">Order Now</button>`;

  // FIX: webdev has no price — it's enquiry-only.
  const priceLine = isWebdev
    ? ''
    : `<div class="modal-price">${formatPrice(product.price)}</div>`;

  document.getElementById('modal-inner').innerHTML = `
    <div class="modal-grid">
      <div class="modal-img">${imgHTML}</div>
      <div class="modal-details">
        <div class="modal-category">${meta.tag}</div>
        <div class="modal-name">${product.name}</div>
        ${priceLine}
        <div class="modal-desc">${product.description}</div>
        ${sizesHTML}
        ${qtyStepperModalHTML}
        ${modalWishlistHeartHTML}
        ${actionHTML}
      </div>
    </div>
    <div id="modalRelatedContainer"></div>
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
      if (isDesign) {
        const qty = getDesignQty(product.id);
        for (let i = 0; i < qty; i++) {
          addToCart(product, selectedSize, currentCategory);
        }
      } else {
        addToCart(product, selectedSize, currentCategory);
      }
      closeModal();
      openCart();
    });
  }

  // FIX: the webdev "Enquire" button in the modal now opens the shared
  // contact popup instead of the old mailto: link.
  document.querySelector('.modal-enquire-btn')?.addEventListener('click', () => {
    openContactPopup();
  });

  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('product-modal').classList.add('open');

  syncWishlistHearts();
  recordProductView(product.id);

  const relatedContainer = document.getElementById('modalRelatedContainer');
  const related = getRelatedItems(currentCategory, product.id);
  if (relatedContainer) {
    relatedContainer.innerHTML = renderRelatedItemsHTML(related);
    relatedContainer.querySelectorAll('.modal-related-card').forEach(cardEl => {
      cardEl.addEventListener('click', () => {
        const relatedProduct = related.find(p => String(p.id) === cardEl.dataset.id);
        if (relatedProduct) openModal(relatedProduct);
      });
    });
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('product-modal').classList.remove('open');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', closeModal);

document.getElementById('loadMoreBtn').addEventListener('click', loadNextPage);

document.getElementById('categorySelect').addEventListener('change', async (e) => {
  const newCat = e.target.value;
  if (!CATEGORY_META[newCat]) return;

  currentCategory = newCat;
  updateHeroForCategory(newCat);

  if (!productsByCategory[newCat]) {
    document.getElementById('cat-grid').innerHTML =
      Array(6).fill('<div class="skeleton-card"></div>').join('');
    document.getElementById('loadMoreWrap').classList.add('hidden');
    document.getElementById('catEmpty').classList.add('hidden');
    document.getElementById('catCount').textContent = 'Loading...';
  }

  await fetchCategory(newCat);
  applyFilters();
});

let searchDebounceTimer = null;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(applyFilters, 300);
});

document.getElementById('sortSelect').addEventListener('change', applyFilters);
document.getElementById('stockSelect').addEventListener('change', applyFilters);

(async () => {
  document.getElementById('catCount').textContent = 'Loading...';
  await Promise.all([fetchCategory(currentCategory), loadWishlistedIds()]);

  if (!(productsByCategory[currentCategory] || []).length) {
    document.getElementById('cat-grid').innerHTML = '';
    document.getElementById('catEmpty').classList.remove('hidden');
    document.getElementById('loadMoreWrap').classList.add('hidden');
    document.getElementById('catCount').textContent = '0 products';
    return;
  }

  applyFilters();
})();