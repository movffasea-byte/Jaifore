/* ================================
   JAIFORE — SERVICES PAGE
   services.js (cart lives in cart.js)

   Prices are USD (database truth) and are displayed through the currency
   module, which shows visitors an estimate in their own currency.
   Mirrors the ordering rules in category.js: apparel needs a size, graphic
   designs need a print size, stock only applies to apparel.
   ================================ */

const API = 'https://jai-fore-production.up.railway.app';

// The products table has no `sizes` column, so apparel uses this list unless a
// product ever comes back with its own `sizes` array.
// KEEP IN SYNC with category.js and the size buttons (.sz-btn) in configurator.html.
const APPAREL_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

let selectedSize         = null;
let selectedPrintSize    = null;
let currentModalProduct  = null;

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

function formatPrice(amount) {
  if (window.JaiforeCurrency?.isReady()) {
    return window.JaiforeCurrency.format(amount);
  }
  return `$${Number(amount).toFixed(2)}`;
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

// ── WISHLIST HEART (item 19) ────────────────────────
function renderWishlistHeart(productId, category) {
  if (category === 'webdev') return '';
  return `<button class="wishlist-heart-btn" type="button" data-product-id="${productId}" onclick="event.stopPropagation()" aria-label="Save for later">♡</button>`;
}

let wishlistedProductIds = new Set();

const loadedProducts = {};

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
  } catch { /* silent — hearts default to empty */ }
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
  const product = Object.values(loadedProducts).flat().find(p => String(p.id) === String(productId));
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
    /* silent — matches category.js's same tradeoff */
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

function dbCategoryToKey(dbCat) {
  if (dbCat === 'Apparels & Merchandise' || dbCat === 'apparel') return 'apparel';
  if (dbCat === 'Graphic Design' || dbCat === 'design') return 'design';
  if (dbCat === 'Web Development' || dbCat === 'webdev') return 'webdev';
  return 'apparel';
}

// ── RECENTLY VIEWED (slider) ─────────────────────────
function recentlyViewedPriceLabel(item, category) {
  if (category === 'webdev') return '';
  const price = parseFloat(item.price);
  if (category === 'design') return price > 0 ? formatPrice(price) : 'Choose a print size';
  return isNaN(price) ? '' : formatPrice(price);
}

// The recently-viewed endpoint only returns a slim product, so open the modal
// from the full product (it carries print sizes, which graphic designs need).
async function openProductById(id, category, fallbackProduct) {
  let product = fallbackProduct;
  try {
    const res = await fetch(`${API}/api/products/${id}`);
    if (res.ok) product = await res.json();
  } catch { /* fall back to the slim product */ }

  if (!loadedProducts.recent) loadedProducts.recent = [];
  loadedProducts.recent.push(product);
  openModal(product, category);
}

function updateRecentlyViewedArrows() {
  const slider = document.getElementById('recentlyViewedSlider');
  const track  = document.getElementById('recently-viewed-grid');
  const prev   = document.getElementById('rvPrev');
  const next   = document.getElementById('rvNext');
  if (!slider || !track || !prev || !next) return;

  const maxScroll = track.scrollWidth - track.clientWidth;
  slider.classList.toggle('no-overflow', maxScroll <= 2);
  prev.disabled = track.scrollLeft <= 2;
  next.disabled = track.scrollLeft >= maxScroll - 2;
}

function initRecentlyViewedSlider() {
  const slider = document.getElementById('recentlyViewedSlider');
  const track  = document.getElementById('recently-viewed-grid');
  const prev   = document.getElementById('rvPrev');
  const next   = document.getElementById('rvNext');
  if (!slider || !track || !prev || !next || slider.dataset.ready) return;
  slider.dataset.ready = '1';

  // Scroll by most of the visible width so a few new cards slide in per click
  const step = () => Math.max(track.clientWidth * 0.8, 200);

  prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
  next.addEventListener('click', () => track.scrollBy({ left:  step(), behavior: 'smooth' }));

  track.addEventListener('scroll', updateRecentlyViewedArrows, { passive: true });
  window.addEventListener('resize', updateRecentlyViewedArrows);
}

async function loadRecentlyViewed() {
  const section = document.getElementById('recently-viewed-section');
  const grid    = document.getElementById('recently-viewed-grid');
  if (!section || !grid) return;

  const token = localStorage.getItem('jaifore_token');
  if (!token) { section.classList.add('hidden'); return; }

  // Show the strip right away with placeholder cards; it hides again if there's nothing to show
  section.classList.remove('hidden');
  grid.innerHTML = Array(4).fill(
    `<div class="skel-card recently-viewed-card" aria-hidden="true"><span class="skel skel-img" style="aspect-ratio:4/3"></span><span class="skel skel-line" style="width:70%;margin-top:0.7rem"></span><span class="skel skel-line short"></span></div>`).join('');

  try {
    const items = await fetchJson(`${API}/api/recently-viewed`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!items.length) { section.classList.add('hidden'); return; }

    grid.innerHTML = '';
    items.forEach((item, i) => {
      const category = dbCategoryToKey(item.category);
      const priceLabel = recentlyViewedPriceLabel(item, category);

      const card = document.createElement('div');
      card.className = 'product-card recently-viewed-card';
      card.style.animationDelay = `${i * 0.05}s`;
      card.innerHTML = `
        <div class="card-img">
          ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" loading="lazy"/>` : `<div class="card-img-placeholder">📦</div>`}
        </div>
        <div class="card-body">
          <div class="card-name">${item.name}</div>
          ${priceLabel ? `<div class="card-price">${priceLabel}</div>` : ''}
        </div>
      `;
      card.addEventListener('click', () => {
        openProductById(item.product_id, category, {
          id: item.product_id, name: item.name, price: item.price,
          image_url: item.image_url, in_stock: item.in_stock, description: ''
        });
      });
      grid.appendChild(card);
    });

    initRecentlyViewedSlider();
    // Measure after the section is visible and the cards are in place
    requestAnimationFrame(() => { grid.scrollLeft = 0; updateRecentlyViewedArrows(); });
  } catch (err) {
    showError(grid, friendlyError(err), loadRecentlyViewed);
  }
}

// ── RELATED ITEMS ────────────────────────────────────
async function fetchRelatedItems(category, excludeProductId) {
  let pool = loadedProducts[category] || [];

  if (pool.length <= 1) {
    pool = (await fetchProducts(category, 8)) || [];
  }

  return pool
    .filter(p => String(p.id) !== String(excludeProductId))
    .slice(0, 4);
}

function renderRelatedItemsHTML(items, category) {
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
            <div class="modal-related-price">${getPriceLabel(p, category)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

const PLACEHOLDERS = {
  apparel: ['👕','👖','🩳','🧥','🎒','☕','📱'],
  design:  ['🎨','✏️','🖌️','🖼️','💡','🌀','⚡'],
  webdev:  ['🌐','💻','🖥️','⚙️','🚀','📡','🔮']
};

function getPlaceholder(category, index) {
  const arr = PLACEHOLDERS[category] || ['📦'];
  return arr[index % arr.length];
}

// ── WEB DEV SERVICES (hardcoded — rarely change, no admin CRUD needed) ──
// These are informational cards only, not purchasable products: no price,
// no per-card action. All 6 share a single "Enquire" button that lives in
// the section header (see services.html), which opens the same contact
// popup every other Enquire flow on the site uses.
const WEBDEV_SERVICES = [
  {
    id: 'svc-maintenance',
    name: 'Website Maintenance (Monthly)',
    description: 'Ongoing updates, backups, and uptime monitoring for your existing site.',
    icon: '🛠️'
  },
  {
    id: 'svc-hosting',
    name: 'Hosting Setup',
    description: 'Domain + hosting configuration, SSL, and deployment — done for you.',
    icon: '🌐'
  },
  {
    id: 'svc-bugfixes',
    name: 'Bug Fixes & Support',
    description: 'Something broken or behaving oddly? We diagnose and fix issues on your existing site.',
    icon: '🐞'
  },
  {
    id: 'svc-updates',
    name: 'Website Updates',
    description: 'Content changes, new pages, or feature additions to keep your site current.',
    icon: '✏️'
  },
  {
    id: 'svc-security',
    name: 'Security & Backups',
    description: 'Regular backups, security patches, and monitoring to keep your site safe.',
    icon: '🔒'
  },
  {
    id: 'svc-performance',
    name: 'Performance & Optimization',
    description: 'Speed audits and optimization so your site loads fast and ranks well.',
    icon: '🚀'
  }
];

function renderServiceCard(service, index) {
  const card = document.createElement('div');
  card.className = 'product-card service-card';
  card.style.animationDelay = `${index * 0.1}s`;

  // No price, no per-card button — enquiries for all 6 services go
  // through the single shared button in the section header instead.
  card.innerHTML = `
    <div class="card-img">
      <div class="card-img-placeholder">${service.icon || '🛠️'}</div>
      <span class="card-badge">Service</span>
    </div>
    <div class="card-body">
      <div class="card-name">${service.name}</div>
      <div class="card-desc">${service.description}</div>
    </div>
  `;

  return card;
}

function loadWebdevServices() {
  const grid = document.getElementById('webdev-services-grid');
  if (!grid) return;
  grid.innerHTML = '';
  WEBDEV_SERVICES.forEach((s, i) => grid.appendChild(renderServiceCard(s, i)));
}

// Single shared Enquire button for the whole "Need ongoing support
// instead?" section — lives in services.html's section header.
document.getElementById('webdevServicesEnquireBtn')?.addEventListener('click', () => {
  openContactPopup();
});

// ── FETCH ────────────────────────────────────────────
// Returns null when the products couldn't be loaded. (The old made-up
// fallback products are gone: they had fake ids and prices and could be
// added to a cart and ordered.)
async function fetchProducts(category, limit = 3) {
  const categoryMap = {
    apparel: 'Apparels & Merchandise',
    design:  'Graphic Design',
    webdev:  'Web Development'
  };
  try {
    const cat = encodeURIComponent(categoryMap[category] || category);
    const res = await fetchWithTimeout(`${API}/api/products?category=${cat}&limit=${limit}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return Array.isArray(data) ? data : data.products || [];
  } catch {
    return null;
  }
}

// ── PRODUCT CARD ─────────────────────────────────────
function renderCard(product, index, category) {
  const card        = document.createElement('div');
  card.className    = 'product-card';
  card.style.animationDelay = `${index * 0.1}s`;

  const isWebdev   = category === 'webdev';
  const isApparel  = category === 'apparel';
  const isDesign   = category === 'design';
  const placeholder = getPlaceholder(category, index);

  const imgHTML = product.image_url
    ? `<img src="${product.image_url}" alt="${product.name}" loading="lazy"/>`
    : `<div class="card-img-placeholder">${placeholder}</div>`;

  const printSizes    = getPrintSizes(product);
  const hasPrintSizes = printSizes.length > 0;

  let sizeHTML = '';
  if (isApparel) {
    const sizes = getSizes(product);
    sizeHTML = `<div class="size-chips">
        ${sizes.slice(0,4).map(s => `<span class="size-chip">${s}</span>`).join('')}
        ${sizes.length > 4 ? `<span class="size-chip">+${sizes.length - 4}</span>` : ''}
       </div>`;
  } else if (isDesign && hasPrintSizes) {
    sizeHTML = `<div class="size-chips">
        ${printSizes.map(s => `<span class="size-chip">${s.size_label}</span>`).join('')}
       </div>`;
  }

  // webdev's live link comes from product.live_link (real DB field)
  const domainHTML = isWebdev && product.live_link
    ? `<div class="site-domain">↗ ${product.live_link}</div>` : '';

  // "Out of stock" only ever applies to apparel
  const badgeHTML = (isApparel && product.in_stock === false)
    ? `<span class="card-badge out-of-stock">Out of Stock</span>`
    : `<span class="card-badge">${isApparel ? 'Merch' : isDesign ? 'Design' : 'Web'}</span>`;

  const wishlistHeartHTML = renderWishlistHeart(product.id, category);
  const priceLabel = getPriceLabel(product, category);

  let footerHTML;
  if (isApparel) {
    footerHTML = `<div class="card-price">${priceLabel}</div>
       <div style="display:flex;gap:0.4rem">
         ${wishlistHeartHTML}
         <button class="configure-btn" data-id="${product.id}">🎨 Design</button>
         <button class="card-action" data-id="${product.id}" ${product.in_stock === false ? 'disabled' : ''}>Add to Cart</button>
       </div>`;
  } else if (isDesign) {
    footerHTML = `<div class="card-price">${priceLabel || 'Not available yet'}</div>
       <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
         ${wishlistHeartHTML}
         <button class="card-action" data-id="${product.id}" ${hasPrintSizes ? '' : 'disabled'}>Order Now</button>
       </div>`;
  } else {
    // webdev has no price to show — it's enquiry-only.
    footerHTML = `<button class="card-action" data-id="${product.id}">Enquire</button>`;
  }

  card.innerHTML = `
    <div class="card-img">
      ${imgHTML}
      ${badgeHTML}
    </div>
    <div class="card-body">
      ${domainHTML}
      <div class="card-name">${product.name}</div>
      <div class="card-desc">${product.description || ''}</div>
      ${sizeHTML}
      <div class="card-footer">${footerHTML}</div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (!e.target.classList.contains('card-action') &&
        !e.target.classList.contains('configure-btn') &&
        !e.target.closest('.qty-stepper') &&
        !e.target.closest('.wishlist-heart-btn')) {
      openModal(product, category);
    }
  });

  // Every "add" button opens the modal: apparel needs a size chosen, graphic
  // designs need a print size chosen, web development is an enquiry.
  card.querySelector('.card-action')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openModal(product, category);
  });

  card.querySelector('.configure-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = `configurator.html?product=${product.id}`;
  });

  return card;
}

async function loadCategory(category) {
  const grid     = document.getElementById(`${category}-grid`);
  grid.innerHTML = Array(3).fill('<div class="skeleton-card"></div>').join('');
  const fetched  = await fetchProducts(category);
  const products = fetched || [];
  grid.innerHTML = '';
  loadedProducts[category] = products;

  if (fetched === null) {
    showError(grid, 'We couldn’t load these products right now.', () => loadCategory(category));
    return;
  }
  if (!products.length) {
    grid.innerHTML = `<div style="color:var(--muted);font-size:0.85rem;padding:2rem 0;grid-column:1/-1">No products found.</div>`;
    return;
  }
  products.slice(0, 3).forEach((p, i) => grid.appendChild(renderCard(p, i, category)));
  syncWishlistHearts();
}

document.querySelectorAll('.load-more-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    window.location.href = `category.html?cat=${btn.dataset.category}`;
  });
});

// ── PRODUCT MODAL ────────────────────────────────────
async function openModal(product, category) {
  currentModalProduct = product;
  selectedSize        = null;
  selectedPrintSize   = null;

  const isWebdev  = category === 'webdev';
  const isApparel = category === 'apparel';
  const isDesign  = category === 'design';
  const placeholder = getPlaceholder(category, 0);

  const printSizes    = getPrintSizes(product);
  const hasPrintSizes = printSizes.length > 0;

  const imgHTML = product.image_url
    ? `<img src="${product.image_url}" alt="${product.name}"/>`
    : `<div class="modal-img-placeholder">${placeholder}</div>`;

  const sizesHTML = isApparel
    ? `<div class="modal-sizes">
        <label>Select Size <button class="size-guide-link" type="button" onclick="openSizeGuide()">Size Guide</button></label>
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
                  <span>${s.size_label} · ${s.dimensions}</span>
                  <span>${formatPrice(getDesignBasePrice(product) + parseFloat(s.price))}</span>
                </button>`).join('')}
            </div>
           </div>`
        : `<p class="modal-desc">This design isn't available to order yet.</p>`)
    : '';

  const qtyStepperModalHTML = (isDesign && hasPrintSizes)
    ? `<div class="modal-qty-row">
         <label>Quantity</label>
         ${renderQtyStepper(product.id, category)}
       </div>`
    : '';

  const modalWishlistHeartHTML = !isWebdev
    ? `<button class="modal-wishlist-heart-btn wishlist-heart-btn" type="button" data-product-id="${product.id}" aria-label="Save for later">♡</button>`
    : '';

  // "Visit Live Site" uses product.live_link (real DB field) and normalizes a
  // bare domain (e.g. "aminfinitybites.health") into a working https:// link,
  // since admins may type either form into the Live Link field.
  const liveLinkHref = product.live_link
    ? (product.live_link.startsWith('http') ? product.live_link : `https://${product.live_link}`)
    : null;

  const actionHTML = isWebdev
    ? `<button class="modal-link modal-enquire-btn" type="button" style="background:none;border:none;cursor:pointer;padding:0;font:inherit">✉ Enquire About This Site →</button>
       ${liveLinkHref ? `<a href="${liveLinkHref}" target="_blank" class="modal-link">🌐 Visit Live Site →</a>` : ''}`
    : isApparel
      ? `<button class="modal-configure-btn" onclick="window.location.href='configurator.html?product=${product.id}'">🎨 Design It in Studio</button>
         <button class="modal-add-btn" ${product.in_stock === false ? 'disabled' : ''}>Add to Cart</button>`
      : `<button class="modal-add-btn" ${hasPrintSizes ? '' : 'disabled'}>Order Now</button>`;

  const domainLine = isWebdev && product.live_link
    ? `<div class="modal-category">↗ ${product.live_link}</div>`
    : `<div class="modal-category">${category.charAt(0).toUpperCase() + category.slice(1)}</div>`;

  // webdev has no price — it's enquiry-only.
  const priceLine = isWebdev
    ? ''
    : `<div class="modal-price" id="modalPriceLine">${getPriceLabel(product, category)}</div>`;

  document.getElementById('modal-inner').innerHTML = `
    <div class="modal-grid">
      <div class="modal-img">${imgHTML}</div>
      <div class="modal-details">
        ${domainLine}
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
        addToCart(product, null, category);
      }

      closeModal();
      if (typeof openCart === 'function') openCart();
    });
  }

  // The webdev "Enquire" button in the modal opens the shared contact popup.
  document.querySelector('.modal-enquire-btn')?.addEventListener('click', () => {
    openContactPopup();
  });

  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('product-modal').classList.add('open');

  syncWishlistHearts();
  recordProductView(product.id);

  const relatedContainer = document.getElementById('modalRelatedContainer');
  const related = await fetchRelatedItems(category, product.id);
  if (relatedContainer) {
    relatedContainer.innerHTML = renderRelatedItemsHTML(related, category);
    relatedContainer.querySelectorAll('.modal-related-card').forEach(cardEl => {
      cardEl.addEventListener('click', () => {
        const relatedProduct = related.find(p => String(p.id) === cardEl.dataset.id);
        if (relatedProduct) openModal(relatedProduct, category);
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

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.category-section').forEach(section => {
  section.style.opacity    = '0';
  section.style.transform  = 'translateY(30px)';
  section.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
  observer.observe(section);
});

// ── START ────────────────────────────────────────────
// Wait for the currency module so prices render in the visitor's currency;
// start regardless if it fails or isn't there.
Promise.resolve(window.JaiforeCurrency?.init()).catch(() => {}).then(() => {
  loadWishlistedIds().then(syncWishlistHearts);
  loadRecentlyViewed();
  loadCategory('apparel');
  loadCategory('design');
  loadCategory('webdev');
  loadWebdevServices();
});