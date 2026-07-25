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

// ── FORMAT PRICE ───────────────────────────────────────
// Pre-existing bug fix (item 17): this file called formatPrice() in
// openModal() without ever defining or importing it (category.html loads
// currency.js directly, not services.js, so the global services.js version
// was never in scope). Mirrors the same pattern services.js already uses.
function formatPrice(amount) {
  if (window.JaiforeCurrency?.isReady()) {
    return window.JaiforeCurrency.format(amount);
  }
  return `$${Number(amount).toLocaleString()}`;
}

// ── STATE ───────────────────────────────────────────
// item 17: products are now cached per-category in memory, so switching the
// category dropdown back and forth doesn't refetch a category we already have.
const productsByCategory = {}; // { apparel: [...], design: [...], webdev: [...] }
let filteredProducts = [];
let displayedCount   = 0;
const PAGE_SIZE      = 12;
let currentCategory  = 'apparel';
let selectedSize     = null;
let currentProduct   = null;

// item 18b — quantity for STANDALONE design products (not the configurator,
// which has its own separate quantity from the first half of item 18). Keyed
// by product id so the count is shared/synced between a product's card and
// its modal, and independent per product on the page. Only meaningful for
// the 'design' category — apparel goes through the configurator instead,
// webdev is a one-off enquiry, so quantity doesn't apply to either.
const designQuantities = {}; // { [productId]: qty }
const MIN_QUANTITY = 1;

function getDesignQty(productId) {
  return designQuantities[productId] || MIN_QUANTITY;
}

function setDesignQty(productId, newQty) {
  const parsed = parseInt(newQty, 10);
  const qty = (isNaN(parsed) || parsed < MIN_QUANTITY) ? MIN_QUANTITY : parsed;
  designQuantities[productId] = qty;

  // Sync every stepper for this product currently on screen — card AND
  // modal (if open) — so they never show different numbers for the same item.
  document.querySelectorAll(`.qty-input[data-product-id="${productId}"]`).forEach(input => {
    input.value = qty;
  });
  document.querySelectorAll(`.qty-minus-btn[data-product-id="${productId}"]`).forEach(btn => {
    btn.disabled = qty <= MIN_QUANTITY;
  });
  return qty;
}

// Builds the stepper markup shared by card + modal. Returns an empty string
// for non-design categories, so apparel/webdev cards are completely unaffected.
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

// Delegated listeners — cards/modal content get re-created on every render
// and filter pass, so binding once on a stable ancestor avoids re-attaching
// listeners (and losing them) every time the DOM is rebuilt.
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

// ── INIT ────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
currentCategory = params.get('cat') || 'apparel';
if (!CATEGORY_META[currentCategory]) currentCategory = 'apparel';

// ── UPDATE HERO + DROPDOWN FOR ACTIVE CATEGORY ──────
// Keeps the page's title/tag/description in sync with whichever category is
// active, since the dropdown can now change this without a page navigation.
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

// ── FETCH ONE CATEGORY (with in-memory cache) ───────
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

// ── FILTER & SORT ───────────────────────────────────
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

// ── LOAD PAGE ───────────────────────────────────────
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

  const loadMoreWrap = document.getElementById('loadMoreWrap');
  if (displayedCount >= filteredProducts.length) {
    loadMoreWrap.classList.add('hidden');
  } else {
    loadMoreWrap.classList.remove('hidden');
  }
}

// ── RENDER CARD ─────────────────────────────────────
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

  const domainHTML = isWebdev && product.domain
    ? `<div class="site-domain">↗ ${product.domain}</div>` : '';

  const stockBadge = !product.in_stock
    ? `<span class="card-badge out-of-stock">Out of Stock</span>`
    : `<span class="card-badge">${meta.tag}</span>`;

  // item 18b: design products get a qty stepper next to Order Now.
  const qtyStepperHTML = renderQtyStepper(product.id, currentCategory);

  const footerHTML = isApparel
    ? `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>
       <div style="display:flex;gap:0.4rem">
         <button class="configure-btn" data-id="${product.id}">🎨 Design</button>
         <button class="card-action" data-id="${product.id}" ${!product.in_stock ? 'disabled' : ''}>Add to Cart</button>
       </div>`
    : isDesign
      ? `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>
         <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
           ${qtyStepperHTML}
           <button class="card-action" data-id="${product.id}">Order Now</button>
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
        !e.target.classList.contains('configure-btn') &&
        !e.target.closest('.qty-stepper')) {
      openModal(product);
    }
  });

  card.querySelector('.card-action')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isWebdev || (isApparel && product.sizes?.length)) {
      openModal(product);
    } else if (isDesign) {
      // item 18b: loop addToCart() qty times, same accumulation pattern as
      // the configurator half — no cart.js changes needed, existing.qty += 1
      // naturally accumulates to the right count across repeated calls.
      const qty = getDesignQty(product.id);
      for (let i = 0; i < qty; i++) {
        addToCart(product, null, currentCategory);
      }
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

  // item 18b: same stepper component as the card, synced via shared
  // designQuantities state — opening the modal shows whatever qty was
  // already set on the card, not reset back to 1.
  const qtyStepperModalHTML = isDesign
    ? `<div class="modal-qty-row">
         <label>Quantity</label>
         ${renderQtyStepper(product.id, currentCategory)}
       </div>`
    : '';

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
        ${qtyStepperModalHTML}
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

// ── CATEGORY SWITCH (item 17) ───────────────────────
// Filters within the page — no navigation — using the in-memory per-category
// cache. Fetches from the API only the first time a given category is picked.
document.getElementById('categorySelect').addEventListener('change', async (e) => {
  const newCat = e.target.value;
  if (!CATEGORY_META[newCat]) return;

  currentCategory = newCat;
  updateHeroForCategory(newCat);

  // Show skeletons only if this category hasn't been fetched before —
  // switching back to an already-cached category should feel instant.
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

// ── SEARCH (item 17, live/debounced) ────────────────
let searchDebounceTimer = null;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(applyFilters, 300);
});

// ── OTHER FILTER EVENTS ──────────────────────────────
document.getElementById('sortSelect').addEventListener('change', applyFilters);
document.getElementById('stockSelect').addEventListener('change', applyFilters);

// ── START ────────────────────────────────────────────
(async () => {
  document.getElementById('catCount').textContent = 'Loading...';
  await fetchCategory(currentCategory);

  if (!(productsByCategory[currentCategory] || []).length) {
    document.getElementById('cat-grid').innerHTML = '';
    document.getElementById('catEmpty').classList.remove('hidden');
    document.getElementById('loadMoreWrap').classList.add('hidden');
    document.getElementById('catCount').textContent = '0 products';
    return;
  }

  applyFilters();
})();