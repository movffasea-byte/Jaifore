/* ================================
   JAIFORE — SERVICES PAGE
   services.js (cart lives in cart.js)
   ================================ */

const API = 'https://jai-fore-production.up.railway.app';

let selectedSize         = null;
let currentModalProduct  = null;

// item 18b — quantity for STANDALONE design products, shared with the same
// pattern used in category.js. Kept as a separate object per file since
// services.js and category.js are two different pages/scripts that never
// run together, so there's no risk of them stepping on each other.
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

// Delegated listeners — same reasoning as category.js: loadCategory()
// rebuilds each grid's innerHTML on load, so binding on document (rather
// than per-card) survives any future re-render without re-attaching.
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
// Same feature as category.js — see that file for the fuller reasoning.
// Only the product-lookup source differs here (loadedProducts below),
// since this file has no per-category cache the way category.js does.
function renderWishlistHeart(productId, category) {
  if (category === 'webdev') return '';
  return `<button class="wishlist-heart-btn" type="button" data-product-id="${productId}" onclick="event.stopPropagation()" aria-label="Save for later">♡</button>`;
}

let wishlistedProductIds = new Set();

// services.js previously had no reason to keep fetched products around
// after rendering; the wishlist heart's click handler needs to look a
// product back up by id (to read its name/price/image for the POST body),
// so loadCategory() below now stashes its result here. Item 20's related-
// items row also reuses this cache first before falling back to a fetch.
const loadedProducts = {}; // { apparel: [...], design: [...], webdev: [...] }

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
  // Search across all three loaded category buckets, since this page
  // (unlike category.js) doesn't track a single "current" category — all
  // three sections (apparel/design/webdev) are on screen simultaneously.
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
          price: product.price,
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

// ── RECENTLY VIEWED (item 20) ───────────────────────
// Records a view on ENGAGEMENT only — opening the modal, or (for apparel)
// going straight to the configurator — not on every card that merely
// renders into a grid. A card existing in a scrollable grid isn't the
// same as a person actually looking at it; recording on render would
// fire a dozen network calls for a single scroll past a category.
// Server-backed + logged-in only per product decision: silently does
// nothing for a logged-out visitor, same convention as the wishlist heart.
function recordProductView(productId) {
  const token = localStorage.getItem('jaifore_token');
  if (!token) return; // not logged in — nothing to record, no error state needed

  // Fire-and-forget: this is instrumentation, not a user-facing action.
  // Nothing in the response is read, and a failure here should never
  // interrupt the actual navigation/modal-open the user is doing.
  fetch(`${API}/api/recently-viewed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify({ productId })
  }).catch(() => { /* silent — see reasoning above */ });
}

// Maps a DB category string (as returned by the recently-viewed/products
// API) back to this file's short category keys ('apparel'/'design'/
// 'webdev'), since openModal() and renderCard() both key off the short
// form throughout this file.
function dbCategoryToKey(dbCat) {
  if (dbCat === 'Apparels & Merchandise' || dbCat === 'apparel') return 'apparel';
  if (dbCat === 'Graphic Design' || dbCat === 'design') return 'design';
  if (dbCat === 'Web Development' || dbCat === 'webdev') return 'webdev';
  return 'apparel';
}

// ── RECENTLY VIEWED STRIP (item 20 display) ─────────
// New homepage section per product decision. Rendered once on load,
// independent of the three category grids below — this is the user's OWN
// browsing history, not tied to whichever category section it sits near.
async function loadRecentlyViewed() {
  const section = document.getElementById('recently-viewed-section');
  const grid    = document.getElementById('recently-viewed-grid');
  if (!section || !grid) return; // section only exists on services.html

  const token = localStorage.getItem('jaifore_token');
  if (!token) { section.classList.add('hidden'); return; } // nothing to show a logged-out visitor

  try {
    const res = await fetch(`${API}/api/recently-viewed`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const items = await res.json();

    if (!items.length) { section.classList.add('hidden'); return; } // nothing viewed yet — don't show an empty section

    section.classList.remove('hidden');
    grid.innerHTML = '';
    items.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'product-card recently-viewed-card';
      card.style.animationDelay = `${i * 0.05}s`;
      card.innerHTML = `
        <div class="card-img">
          ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" loading="lazy"/>` : `<div class="card-img-placeholder">📦</div>`}
        </div>
        <div class="card-body">
          <div class="card-name">${item.name}</div>
          <div class="card-price"><span class="currency">₦</span>${Number(item.price).toLocaleString('en-NG')}</div>
        </div>
      `;
      // Reopens the EXACT product's own modal directly, per product
      // decision — not a redirect to its category page. The recently-viewed
      // API already returns full product fields (name/price/image_url/
      // category/in_stock via its JOIN), which is everything openModal()
      // and renderCard() need — no extra fetch required to reopen it.
      card.addEventListener('click', () => {
        const category = dbCategoryToKey(item.category);
        const product = {
          id: item.product_id, name: item.name, price: item.price,
          image_url: item.image_url, in_stock: item.in_stock
        };
        openModal(product, category);
      });
      grid.appendChild(card);
    });
  } catch {
    section.classList.add('hidden'); // fail quiet — this is a nice-to-have section, not core page content
  }
}

// ── RELATED ITEMS (item 20 addition) ────────────────
// Shown at the end of every product modal: 3–4 OTHER items from the same
// category, per product decision. "Same category" always excludes the
// currently-open product itself — showing a product as "related to itself"
// would read as a bug, not a recommendation.
async function fetchRelatedItems(category, excludeProductId) {
  // Reuse whatever's already loaded for this category first — avoids a
  // second network call in the common case (a visitor who's already seen
  // this category's teaser row on the page).
  let pool = loadedProducts[category] || [];

  if (pool.length <= 1) {
    // Not enough cached to pick from — fetch a slightly larger pool just
    // for this. Not cached into loadedProducts itself, since that array
    // deliberately mirrors "what's shown in the teaser row" elsewhere in
    // this file, and overwriting it here would be a confusing side effect.
    pool = await fetchProducts(category, 8);
  }

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

// ── PLACEHOLDERS ───────────────────────────────────────
const PLACEHOLDERS = {
  apparel: ['👕','👖','🩳','🧥','🎒','☕','📱'],
  design:  ['🎨','✏️','🖌️','🖼️','💡','🌀','⚡'],
  webdev:  ['🌐','💻','🖥️','⚙️','🚀','📡','🔮']
};

function getPlaceholder(category, index) {
  const arr = PLACEHOLDERS[category] || ['📦'];
  return arr[index % arr.length];
}

// ── MOCK DATA ──────────────────────────────────────────
function getMockProducts(category) {
  const mocks = {
    apparel: [
      { id:'a1', name:'Classic Black Tee',   description:'Premium 100% cotton blank tee. Clean cut, heavyweight feel.',         price:8500,   category:'apparel', sizes:['XS','S','M','L','XL','XXL'], image:null },
      { id:'a2', name:'Relaxed Fit Hoodie',  description:'Heavyweight fleece hoodie. Oversized fit, kangaroo pocket.',          price:18500,  category:'apparel', sizes:['S','M','L','XL','XXL'],      image:null },
      { id:'a3', name:'Cargo Shorts',        description:'Multi-pocket cargo shorts. Durable cotton twill, mid-rise.',          price:12000,  category:'apparel', sizes:['S','M','L','XL'],            image:null },
    ],
    design: [
      { id:'d1', name:'Abstract Waves',         description:'Bold fluid wave pattern. Available in mono or full colour print.', price:15000,  category:'design', image:null },
      { id:'d2', name:'Custom Logo Design',     description:'Bring your idea — we craft a professional logo from scratch.',     price:35000,  category:'design', image:null },
      { id:'d3', name:'Street Art Illustration',description:'Urban-inspired illustration pack. Ready to print on any surface.', price:22000,  category:'design', image:null },
    ],
    webdev: [
      { id:'w1', name:'E-Commerce Starter',      description:'Full-featured online store with cart, payments, and admin panel.', price:250000, category:'webdev', domain:'aminfinitybites.health',   siteUrl:'https://aminfinitybites.health', image:null },
      { id:'w2', name:'Creative Portfolio',      description:'Stunning portfolio site for creatives, artists, and agencies.',   price:120000, category:'webdev', domain:'example-portfolio.com',    siteUrl:null, image:null },
      { id:'w3', name:'Business Landing Page',   description:'High-converting landing page with contact forms and analytics.',  price:80000,  category:'webdev', domain:'example-business.com',     siteUrl:null, image:null },
    ]
  };
  return mocks[category] || [];
}

// ── FETCH ──────────────────────────────────────────────
// `limit` now optional (defaults to 3, the original teaser-row size) — the
// related-items feature above requests a larger pool (8) so it has more
// than 3 candidates to exclude the current product from and still have
// enough left over.
async function fetchProducts(category, limit = 3) {
   const categoryMap = {
    apparel: 'Apparels & Merchandise',
    design:  'Graphic Design',
    webdev:  'Web Development'
  };
  try {
    const cat = encodeURIComponent(categoryMap[category] || category);
   const res = await fetch(`${API}/api/products?category=${cat}&limit=${limit}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return Array.isArray(data) ? data : data.products || [];
  } catch {
    return getMockProducts(category);
  }
}

// ── FORMAT PRICE ───────────────────────────────────────
function formatPrice(amount) {
  if (window.JaiforeCurrency?.isReady()) {
    return window.JaiforeCurrency.format(amount);
  }
  return `$${Number(amount).toLocaleString()}`;
}

// ── RENDER CARD ────────────────────────────────────────
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

  const sizeHTML = isApparel && product.sizes?.length
    ? `<div class="size-chips">
        ${product.sizes.slice(0,4).map(s => `<span class="size-chip">${s}</span>`).join('')}
        ${product.sizes.length > 4 ? `<span class="size-chip">+${product.sizes.length - 4}</span>` : ''}
       </div>`
    : '';

  const domainHTML = isWebdev && product.domain
    ? `<div class="site-domain">↗ ${product.domain}</div>` : '';

  // item 18b: design products get a qty stepper alongside Order Now.
  const qtyStepperHTML = renderQtyStepper(product.id, category);
  // item 19: apparel + design cards get a wishlist heart; webdev does not.
  const wishlistHeartHTML = renderWishlistHeart(product.id, category);

  // Apparel gets two buttons — Add to Cart + Design It
  const footerHTML = isApparel
    ? `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>
       <div style="display:flex;gap:0.4rem">
         ${wishlistHeartHTML}
         <button class="configure-btn" data-id="${product.id}">🎨 Design</button>
         <button class="card-action"   data-id="${product.id}">Add to Cart</button>
       </div>`
    : isDesign
      ? `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>
         <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
           ${wishlistHeartHTML}
           ${qtyStepperHTML}
           <button class="card-action" data-id="${product.id}">Order Now</button>
         </div>`
      : `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>
         <button class="card-action" data-id="${product.id}">${isWebdev ? 'Enquire' : 'Order Now'}</button>`;

  card.innerHTML = `
    <div class="card-img">
      ${imgHTML}
      <span class="card-badge">${isApparel ? 'Merch' : isDesign ? 'Design' : 'Web'}</span>
    </div>
    <div class="card-body">
      ${domainHTML}
      <div class="card-name">${product.name}</div>
      <div class="card-desc">${product.description}</div>
      ${sizeHTML}
      <div class="card-footer">${footerHTML}</div>
    </div>
  `;

  // Card click → modal (item 20: this IS the engagement moment for
  // non-apparel/non-sized-apparel products, so record the view here)
  card.addEventListener('click', (e) => {
    if (!e.target.classList.contains('card-action') &&
        !e.target.classList.contains('configure-btn') &&
        !e.target.closest('.qty-stepper')) {
      openModal(product, category);
    }
  });

  // Add to cart button
  card.querySelector('.card-action')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isWebdev || (isApparel && product.sizes?.length)) {
      openModal(product, category);
    } else if (isDesign) {
      // item 18b: loop addToCart() qty times — same accumulation pattern
      // as the configurator, no cart.js changes needed for this to work.
      const qty = getDesignQty(product.id);
      for (let i = 0; i < qty; i++) {
        addToCart(product, null, category);
      }
      recordProductView(product.id); // item 20 — Order Now is a real engagement even without opening the modal
    } else {
      addToCart(product, null, category);
      recordProductView(product.id); // item 20
    }
  });

  // Design It button — go to configurator (item 20: configurator.js
  // records the view itself once it loads the product there, so nothing
  // extra needed at this specific click — just the navigation)
  card.querySelector('.configure-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = `configurator.html?product=${product.id}`;
  });

  return card;
}

// ── LOAD CATEGORY ──────────────────────────────────────
async function loadCategory(category) {
  const grid    = document.getElementById(`${category}-grid`);
  const products = await fetchProducts(category);
  grid.innerHTML = '';
  loadedProducts[category] = products; // item 19 — stash for the wishlist heart's product lookup; item 20 reuses this too

  if (!products.length) {
    grid.innerHTML = `<div style="color:var(--muted);font-size:0.85rem;padding:2rem 0;grid-column:1/-1">No products found.</div>`;
    return;
  }
  products.slice(0, 3).forEach((p, i) => grid.appendChild(renderCard(p, i, category)));
  syncWishlistHearts(); // item 19 — apply saved state to this batch's hearts
}

// ── LOAD MORE → category page ──────────────────────────
document.querySelectorAll('.load-more-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    window.location.href = `category.html?cat=${btn.dataset.category}`;
  });
});

// ── MODAL ──────────────────────────────────────────────
async function openModal(product, category) {
  currentModalProduct = product;
  selectedSize        = null;

  const isWebdev  = category === 'webdev';
  const isApparel = category === 'apparel';
  const isDesign  = category === 'design';
  const placeholder = getPlaceholder(category, 0);

  const imgHTML = product.image_url
    ? `<img src="${product.image_url}" alt="${product.name}"/>`
    : `<div class="modal-img-placeholder">${placeholder}</div>`;

  const sizesHTML = isApparel && product.sizes?.length
    ? `<div class="modal-sizes">
        <label>Select Size <button class="size-guide-link" onclick="openSizeGuide()">Size Guide</button></label>
        <div class="modal-size-opts">
          ${product.sizes.map(s => `<button class="size-opt" data-size="${s}">${s}</button>`).join('')}
        </div>
       </div>` : '';

  // item 18b: same stepper as the card, synced via shared designQuantities —
  // opening the modal reflects whatever quantity was already set on the card.
  const qtyStepperModalHTML = isDesign
    ? `<div class="modal-qty-row">
         <label>Quantity</label>
         ${renderQtyStepper(product.id, category)}
       </div>`
    : '';

  // item 19 — wishlist heart in the modal, apparel + design only.
  const modalWishlistHeartHTML = !isWebdev
    ? `<button class="modal-wishlist-heart-btn wishlist-heart-btn" type="button" data-product-id="${product.id}" aria-label="Save for later">♡</button>`
    : '';

  const actionHTML = isWebdev
    ? `<a href="mailto:hello@jaifore.com?subject=Enquiry: ${encodeURIComponent(product.name)}" class="modal-link">✉ Enquire About This Site →</a>
       ${product.siteUrl ? `<a href="${product.siteUrl}" target="_blank" class="modal-link">🌐 Visit Live Site →</a>` : ''}`
    : isApparel
      ? `<button class="modal-configure-btn" onclick="window.location.href='configurator.html?product=${product.id}'">🎨 Design It in Studio</button>
         <button class="modal-add-btn">Add to Cart</button>`
      : `<button class="modal-add-btn">Order Now</button>`;

  const domainLine = isWebdev && product.domain
    ? `<div class="modal-category">↗ ${product.domain}</div>`
    : `<div class="modal-category">${category.charAt(0).toUpperCase() + category.slice(1)}</div>`;

  document.getElementById('modal-inner').innerHTML = `
    <div class="modal-grid">
      <div class="modal-img">${imgHTML}</div>
      <div class="modal-details">
        ${domainLine}
        <div class="modal-name">${product.name}</div>
        <div class="modal-price">${formatPrice(product.price)}</div>
        <div class="modal-desc">${product.description}</div>
        ${sizesHTML}
        ${qtyStepperModalHTML}
        ${modalWishlistHeartHTML}
        ${actionHTML}
      </div>
    </div>
    <div id="modalRelatedContainer"></div>
  `;

  // Size selection
  document.querySelectorAll('.size-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedSize = btn.dataset.size;
    });
  });

  // Add to cart from modal
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
          addToCart(product, selectedSize, category);
        }
      } else {
        addToCart(product, selectedSize, category);
      }
      closeModal();
      openCart();
    });
  }

  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('product-modal').classList.add('open');

  syncWishlistHearts(); // item 19 — the modal's own heart needs its saved state applied too
  recordProductView(product.id); // item 20 — opening the modal IS the engagement moment

  // item 20 — related items load AFTER the modal is already visible and
  // interactive, rather than blocking the whole modal open on this fetch.
  // The rest of the modal (price, Add to Cart, wishlist heart) is fully
  // usable immediately; the related row fills in a moment later.
  const relatedContainer = document.getElementById('modalRelatedContainer');
  const related = await fetchRelatedItems(category, product.id);
  if (relatedContainer) {
    relatedContainer.innerHTML = renderRelatedItemsHTML(related);
    relatedContainer.querySelectorAll('.modal-related-card').forEach(cardEl => {
      cardEl.addEventListener('click', () => {
        const relatedProduct = related.find(p => String(p.id) === cardEl.dataset.id);
        if (relatedProduct) openModal(relatedProduct, category); // re-opens the modal in place, for THIS related item
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

// ── SCROLL REVEAL ──────────────────────────────────────
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

// ── INIT ───────────────────────────────────────────────

window.JaiforeCurrency?.init().then(() => {
  loadWishlistedIds(); // item 19 — fires alongside the three loads below;
                        // each loadCategory() call syncs its own hearts once
                        // its cards exist, so exact ordering isn't required
  loadRecentlyViewed(); // item 20 — new homepage section
  loadCategory('apparel');
  loadCategory('design');
  loadCategory('webdev');
});