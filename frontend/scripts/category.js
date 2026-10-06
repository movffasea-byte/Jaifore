/* ================================
   JAIFORE — CATEGORY PAGE
   scripts/category.js

   Prices are USD (database truth) and are displayed through the currency
   module, which shows visitors an estimate in their own currency.
   ================================ */

const API = 'https://jai-fore-production.up.railway.app';

// The products table has no `sizes` column, so apparel uses this list unless a
// product ever comes back with its own `sizes` array.
// KEEP IN SYNC with the size buttons (.sz-btn) in configurator.html.
const APPAREL_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

const CATEGORY_META = {
  apparel: {
    title: 'Apparel & Merchandise',
    tag:   'Merch',
    desc:  'Premium blank canvas pieces — yours to wear, gift, or brand. Select size, quantity, and we ship worldwide.',
    dbCat: 'Apparels & Merchandise',
    searchHint: 'Search apparel...',
    sorts: [
      ['newest',     'Newest First'],
      ['price-asc',  'Price: Low to High'],
      ['price-desc', 'Price: High to Low']
    ],
    hasStock:       true,   // only apparel has stock
    hasPrintFilter: false
  },
  design: {
    title: 'Graphic Design',
    tag:   'Design',
    desc:  'Pick from our curated designs or bring your vision — we\'ll bring it to life on any surface.',
    dbCat: 'Graphic Design',
    searchHint: 'Search designs...',
    sorts: [
      ['newest',   'Newest First'],
      ['name-asc', 'Name: A to Z']
    ],
    hasStock:       false,
    hasPrintFilter: true
  },
  webdev: {
    title: 'Web Development',
    tag:   'Web',
    desc:  'Sites we\'ve built, live and breathing. Want something similar? Let\'s talk scope and we\'ll build yours.',
    dbCat: 'Web Development',
    searchHint: 'Search websites...',
    sorts: [
      ['newest',   'Newest First'],
      ['name-asc', 'Name: A to Z']
    ],
    hasStock:       false,
    hasPrintFilter: false
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
  return `$${Number(amount).toFixed(2)}`;
}

const productsByCategory = {};
let filteredProducts = [];
let displayedCount   = 0;
const PAGE_SIZE      = 12;
let currentCategory  = 'apparel';
let selectedSize     = null;
let selectedPrintSize = null;
let currentProduct   = null;

const designQuantities = {};
const MIN_QUANTITY = 1;

// ── PRODUCT HELPERS ──────────────────────────────────
function getSizes(product) {
  return Array.isArray(product.sizes) && product.sizes.length ? product.sizes : APPAREL_SIZES;
}

// Live-joined by the API: [{ id, size_label, dimensions, price }]
function getPrintSizes(product) {
  return Array.isArray(product.print_sizes) ? product.print_sizes : [];
}

// Graphic designs are free, so the base price is normally 0 — the print size
// chosen is what is actually bought.
function getDesignBasePrice(product) {
  const p = parseFloat(product.price);
  return isNaN(p) ? 0 : p;
}

function getLowestPrintPrice(product) {
  const sizes = getPrintSizes(product);
  if (!sizes.length) return null;
  return Math.min(...sizes.map(s => parseFloat(s.price)));
}

function getPriceLabel(product, category) {
  if (category === 'webdev') return '';
  if (category === 'design') {
    const from = getLowestPrintPrice(product);
    if (from === null) return '';
    return `From ${formatPrice(getDesignBasePrice(product) + from)}`;
  }
  return formatPrice(product.price);
}

// ── QUANTITY (graphic designs, shown in the modal) ───
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

// ── WISHLIST ─────────────────────────────────────────
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
          price: product.price ?? 0,
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

// ── RELATED ITEMS ────────────────────────────────────
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
              ${p.image_url ? `<img src="${p.thumb_url || p.image_url}" alt="${p.name}" width="400" height="300" loading="lazy" decoding="async"/>` : '📦'}
            </div>
            <div class="modal-related-name">${p.name}</div>
            <div class="modal-related-price">${getPriceLabel(p, currentCategory)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ── CATEGORY SETUP ───────────────────────────────────
const params = new URLSearchParams(window.location.search);
currentCategory = params.get('cat') || 'apparel';
if (!CATEGORY_META[currentCategory]) currentCategory = 'apparel';

function updateHeroForCategory(cat) {
  const meta = CATEGORY_META[cat] || CATEGORY_META.apparel;
  document.getElementById('catTag').textContent   = meta.tag;
  document.getElementById('catTitle').textContent = meta.title;
  document.getElementById('catDesc').textContent  = meta.desc;
  document.getElementById('catEmptyMsg').textContent = `No products found in ${meta.title.toLowerCase()} yet.`;
  document.getElementById('searchInput').placeholder = meta.searchHint;
  document.title = `Jai'fore — ${meta.title}`;
}

// Shows only the sort / filter controls that make sense for this category:
// stock filter for apparel only, print-size filter for graphic designs only,
// and a sort list without price options where items have no single price.
function configureToolbar(cat) {
  const meta = CATEGORY_META[cat] || CATEGORY_META.apparel;

  const sortSelect = document.getElementById('sortSelect');
  sortSelect.innerHTML = meta.sorts.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  sortSelect.value = 'newest';

  const stockSelect = document.getElementById('stockSelect');
  stockSelect.value = 'all';
  stockSelect.style.display = meta.hasStock ? '' : 'none';

  const printSelect = document.getElementById('printSizeSelect');
  if (printSelect) {
    printSelect.value = 'all';
    printSelect.style.display = meta.hasPrintFilter ? '' : 'none';
  }
}

// Builds the "print size" filter from the sizes the loaded designs actually offer
function populatePrintSizeFilter() {
  const select = document.getElementById('printSizeSelect');
  if (!select || !CATEGORY_META[currentCategory].hasPrintFilter) return;

  const seen = new Map(); // label -> price, so sizes list smallest-price first
  (productsByCategory[currentCategory] || []).forEach(p => {
    getPrintSizes(p).forEach(s => {
      if (!seen.has(s.size_label)) seen.set(s.size_label, parseFloat(s.price));
    });
  });

  const labels = [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
  const previous = select.value;

  select.innerHTML = '<option value="all">Any Print Size</option>' +
    labels.map(label => `<option value="${label}">${label} prints</option>`).join('');
  select.value = labels.includes(previous) ? previous : 'all';
}

updateHeroForCategory(currentCategory);
configureToolbar(currentCategory);
document.getElementById('categorySelect').value = currentCategory;

// Categories whose last fetch failed — applyFilters() shows an error + Retry for these
const failedCategories = new Set();

async function retryCategory() {
  const cat = currentCategory;
  document.getElementById('cat-grid').innerHTML = Array(6).fill('<div class="skeleton-card"></div>').join('');
  document.getElementById('catCount').innerHTML = '<span class="skel skel-line" style="width:90px;display:inline-block"></span>';
  await fetchCategory(cat);
  if (cat !== currentCategory) return; // the visitor switched category meanwhile
  populatePrintSizeFilter();
  applyFilters();
}

async function fetchCategory(cat) {
  // FIX: was `if (productsByCategory[cat])` — an empty array [] is truthy in JS,
  // so once a failed fetch cached [] for a category, every future call short-circuited
  // and returned that stale empty result forever, even after the API recovered.
  // Checking `!== undefined` still skips re-fetching a category that legitimately
  // came back empty, but no longer treats "never successfully fetched" the same way.
  if (productsByCategory[cat] !== undefined) return productsByCategory[cat];

  const meta = CATEGORY_META[cat] || CATEGORY_META.apparel;
  try {
    const dbCat = encodeURIComponent(meta.dbCat);
    const data = await fetchJson(`${API}/api/products?category=${dbCat}`);
    productsByCategory[cat] = Array.isArray(data) ? data : [];
    failedCategories.delete(cat);
  } catch {
    failedCategories.add(cat);
    // FIX: was `productsByCategory[cat] = [];` — that permanently poisoned the
    // cache on a transient failure. Now we just return [] for this one call
    // and leave the cache slot untouched, so the next call retries the real fetch.
    return [];
  }
  return productsByCategory[cat];
}

// ── FILTERING ────────────────────────────────────────
function applyFilters() {
  if (failedCategories.has(currentCategory) && productsByCategory[currentCategory] === undefined) {
    showError('cat-grid', 'We couldn’t load these products right now.', retryCategory);
    document.getElementById('catCount').textContent = '';
    document.getElementById('catEmpty').classList.add('hidden');
    document.getElementById('loadMoreWrap').classList.add('hidden');
    return;
  }

  const meta = CATEGORY_META[currentCategory] || CATEGORY_META.apparel;
  const searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
  const sort  = document.getElementById('sortSelect').value;
  const stock = document.getElementById('stockSelect').value;
  const printFilter = document.getElementById('printSizeSelect')?.value || 'all';

  let result = [...(productsByCategory[currentCategory] || [])];

  if (searchTerm) {
    result = result.filter(p =>
      (p.name || '').toLowerCase().includes(searchTerm) ||
      (p.description || '').toLowerCase().includes(searchTerm)
    );
  }

  // Stock only exists for apparel — never filter other categories by it
  if (meta.hasStock && stock === 'instock') result = result.filter(p => p.in_stock);

  if (meta.hasPrintFilter && printFilter !== 'all') {
    result = result.filter(p => getPrintSizes(p).some(s => s.size_label === printFilter));
  }

  if (sort === 'price-asc')  result.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') result.sort((a, b) => b.price - a.price);
  if (sort === 'name-asc')   result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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

// ── PRODUCT CARD ─────────────────────────────────────
function renderCard(product, index) {
  const meta = CATEGORY_META[currentCategory] || CATEGORY_META.apparel;
  return buildProductCard(product, {
    category:    currentCategory,
    tag:         meta.tag,
    placeholder: PLACEHOLDERS[currentCategory]?.[index % 7] || '📦',
    delay:       (index % PAGE_SIZE) * 0.05,
    getSizes, getPrintSizes, getPriceLabel, renderWishlistHeart,
    open:        () => openModal(product),
  });
}

// ── PRODUCT MODAL ────────────────────────────────────
async function openModal(product) {
  const meta = CATEGORY_META[currentCategory] || CATEGORY_META.apparel;
  currentProduct    = product;
  selectedSize      = null;
  selectedPrintSize = null;

  const isWebdev  = currentCategory === 'webdev';
  const isApparel = currentCategory === 'apparel';
  const isDesign  = currentCategory === 'design';
  const placeholder = PLACEHOLDERS[currentCategory]?.[0] || '📦';

  const printSizes    = getPrintSizes(product);
  const hasPrintSizes = printSizes.length > 0;

  const imgHTML = product.image_url
    ? `<img src="${product.image_url}" alt="${product.name}"/>`
    : `<div class="modal-img-placeholder">${placeholder}</div>`;

  const sizesHTML = isApparel
    ? `<div class="modal-sizes">
        <label>Select Size</label>
        <div class="modal-size-opts">
          ${getSizes(product).map(s => `<button class="size-opt" type="button" data-size="${s}">${s}</button>`).join('')}
        </div>
       </div>` : '';

  const printSizesHTML = isDesign
    ? (hasPrintSizes
        ? `<div class="modal-sizes">
            <label>Select Print Size</label>
            <div class="modal-size-opts">
              ${printSizes.map(s => `
                <button class="size-opt print-opt" type="button" data-print-id="${s.id}">
                  ${s.size_label} · ${s.dimensions} · ${formatPrice(getDesignBasePrice(product) + parseFloat(s.price))}
                </button>`).join('')}
            </div>
           </div>`
        : `<p class="modal-desc">This design isn't available to order yet.</p>`)
    : '';

  const qtyStepperModalHTML = (isDesign && hasPrintSizes)
    ? `<div class="modal-qty-row">
         <label>Quantity</label>
         ${renderQtyStepper(product.id, currentCategory)}
       </div>`
    : '';

  const modalWishlistHeartHTML = !isWebdev
    ? `<button class="modal-wishlist-heart-btn wishlist-heart-btn" type="button" data-product-id="${product.id}" aria-label="Save for later">♡</button>`
    : '';

  const liveLinkHref = product.live_link
    ? (product.live_link.startsWith('http') ? product.live_link : `https://${product.live_link}`)
    : null;

  const actionHTML = isWebdev
    ? `<button class="modal-link modal-enquire-btn" type="button" style="background:none;border:none;cursor:pointer;padding:0;font:inherit">✉ Enquire About This Site →</button>
       ${liveLinkHref ? `<a href="${liveLinkHref}" target="_blank" class="modal-link">🌐 Visit Live Site →</a>` : ''}`
    : isApparel
      ? `<button class="modal-configure-btn" onclick="window.location.href='configurator.html?product=${product.id}'">🎨 Design It in Studio</button>
         <button class="modal-add-btn" ${!product.in_stock ? 'disabled' : ''}>Add to Cart</button>`
      : `<button class="modal-add-btn" ${hasPrintSizes ? '' : 'disabled'}>Order Now</button>`;

  const priceLine = isWebdev
    ? ''
    : `<div class="modal-price" id="modalPriceLine">${getPriceLabel(product, currentCategory)}</div>`;

  document.getElementById('modal-inner').innerHTML = `
    <div class="modal-grid">
      <div class="modal-img">${imgHTML}</div>
      <div class="modal-details">
        <div class="modal-category">${meta.tag}</div>
        <div class="modal-name">${product.name}</div>
        ${priceLine}
        <div class="modal-desc">${product.description || ''}</div>
        ${sizesHTML}
        ${printSizesHTML}
        ${qtyStepperModalHTML}
        ${modalWishlistHeartHTML}
        ${actionHTML}
      </div>
    </div>
    <div id="modalRelatedContainer"></div>
  `;

  // Apparel size selection
  document.querySelectorAll('.size-opt[data-size]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-opt[data-size]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedSize = btn.dataset.size;
    });
  });

  // Graphic design print-size selection — also updates the price shown
  document.querySelectorAll('.print-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.print-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPrintSize = printSizes.find(s => String(s.id) === btn.dataset.printId) || null;
      const priceEl = document.getElementById('modalPriceLine');
      if (priceEl && selectedPrintSize) {
        priceEl.textContent = formatPrice(getDesignBasePrice(product) + parseFloat(selectedPrintSize.price));
      }
    });
  });

  const addBtn = document.querySelector('.modal-add-btn');
  if (addBtn) {
    const flashError = (message, restoreText) => {
      addBtn.textContent = message;
      addBtn.style.background = '#b03030';
      setTimeout(() => { addBtn.textContent = restoreText; addBtn.style.background = ''; }, 1500);
    };

    addBtn.addEventListener('click', () => {
      if (isApparel) {
        if (!selectedSize) { flashError('Please select a size first', 'Add to Cart'); return; }
        addToCart({ ...product, price: parseFloat(product.price) }, selectedSize, 'apparel');
      } else if (isDesign) {
        if (!selectedPrintSize) { flashError('Please select a print size first', 'Order Now'); return; }

        const basePrice = getDesignBasePrice(product);
        const added = addToCart({
          id:            product.id,
          name:          product.name,
          price:         basePrice + parseFloat(selectedPrintSize.price),
          image_url:     product.image_url,
          // The one design + its print size make up this line's identity, so
          // the same design in two print sizes stays as two separate lines.
          customDesigns: [{ name: product.name, src: product.image_url || '', price: basePrice }],
          printSize:     selectedPrintSize
        }, null, 'design', getDesignQty(product.id));

        if (!added) return;
      } else {
        addToCart(product, null, currentCategory);
      }

      closeModal();
      if (typeof openCart === 'function') openCart();
    });
  }

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

// ── CONTROLS ─────────────────────────────────────────
document.getElementById('categorySelect').addEventListener('change', async (e) => {
  const newCat = e.target.value;
  if (!CATEGORY_META[newCat]) return;

  currentCategory = newCat;
  history.replaceState(null, '', `?cat=${newCat}`);
  updateHeroForCategory(newCat);
  configureToolbar(newCat); // swaps in the sort/filter controls that fit this category

  if (!productsByCategory[newCat]) {
    document.getElementById('cat-grid').innerHTML =
      Array(6).fill('<div class="skeleton-card"></div>').join('');
    document.getElementById('loadMoreWrap').classList.add('hidden');
    document.getElementById('catEmpty').classList.add('hidden');
    document.getElementById('catCount').innerHTML = '<span class="skel skel-line" style="width:90px;display:inline-block"></span>';
  }

  await fetchCategory(newCat);
  populatePrintSizeFilter();
  applyFilters();
});

let searchDebounceTimer = null;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(applyFilters, 300);
});

document.getElementById('sortSelect').addEventListener('change', applyFilters);
document.getElementById('stockSelect').addEventListener('change', applyFilters);
document.getElementById('printSizeSelect')?.addEventListener('change', applyFilters);

// If the currency finishes loading after the first render, redraw so prices
// show in the visitor's currency.
window.addEventListener('jaifore:currency-ready', () => {
  if (productsByCategory[currentCategory] !== undefined) applyFilters();
});

// ── START ────────────────────────────────────────────
(async () => {
  await Promise.all([
    fetchCategory(currentCategory),
    loadWishlistedIds(),
    (window.JaiforeCurrency?.init() || Promise.resolve()).catch(() => {})
  ]);
  populatePrintSizeFilter();
  applyFilters();
})();