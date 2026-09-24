/* ================================
   JAIFORE — SERVICES PAGE
   services.js (cart lives in cart.js)
   ================================ */

const API = 'https://jai-fore-production.up.railway.app';

let selectedSize         = null;
let currentModalProduct  = null;

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

async function loadRecentlyViewed() {
  const section = document.getElementById('recently-viewed-section');
  const grid    = document.getElementById('recently-viewed-grid');
  if (!section || !grid) return;

  const token = localStorage.getItem('jaifore_token');
  if (!token) { section.classList.add('hidden'); return; }

  try {
    const res = await fetch(`${API}/api/recently-viewed`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const items = await res.json();

    if (!items.length) { section.classList.add('hidden'); return; }

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
    section.classList.add('hidden');
  }
}

async function fetchRelatedItems(category, excludeProductId) {
  let pool = loadedProducts[category] || [];

  if (pool.length <= 1) {
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
      { id:'w1', name:'E-Commerce Starter',      description:'Full-featured online store with cart, payments, and admin panel.', live_link:'aminfinitybites.health', image:null },
      { id:'w2', name:'Creative Portfolio',      description:'Stunning portfolio site for creatives, artists, and agencies.',   live_link:null, image:null },
      { id:'w3', name:'Business Landing Page',   description:'High-converting landing page with contact forms and analytics.',  live_link:null, image:null },
    ]
  };
  return mocks[category] || [];
}

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

function formatPrice(amount) {
  if (window.JaiforeCurrency?.isReady()) {
    return window.JaiforeCurrency.format(amount);
  }
  return `$${Number(amount).toLocaleString()}`;
}

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

  // FIX: webdev's live link comes from product.live_link (real DB field),
  // never product.domain (that only ever existed in mock data).
  const domainHTML = isWebdev && product.live_link
    ? `<div class="site-domain">↗ ${product.live_link}</div>` : '';

  const qtyStepperHTML = renderQtyStepper(product.id, category);
  const wishlistHeartHTML = renderWishlistHeart(product.id, category);

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
      // FIX: webdev has no price to show — it's enquiry-only.
      : `${isWebdev ? '' : `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>`}
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

  card.addEventListener('click', (e) => {
    if (!e.target.classList.contains('card-action') &&
        !e.target.classList.contains('configure-btn') &&
        !e.target.closest('.qty-stepper') &&
        !e.target.closest('.wishlist-heart-btn')) {
      openModal(product, category);
    }
  });

  card.querySelector('.card-action')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isWebdev || (isApparel && product.sizes?.length)) {
      openModal(product, category);
    } else if (isDesign) {
      const qty = getDesignQty(product.id);
      for (let i = 0; i < qty; i++) {
        addToCart(product, null, category);
      }
      recordProductView(product.id);
    } else {
      addToCart(product, null, category);
      recordProductView(product.id);
    }
  });

  card.querySelector('.configure-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = `configurator.html?product=${product.id}`;
  });

  return card;
}

async function loadCategory(category) {
  const grid    = document.getElementById(`${category}-grid`);
  const products = await fetchProducts(category);
  grid.innerHTML = '';
  loadedProducts[category] = products;

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

  const qtyStepperModalHTML = isDesign
    ? `<div class="modal-qty-row">
         <label>Quantity</label>
         ${renderQtyStepper(product.id, category)}
       </div>`
    : '';

  const modalWishlistHeartHTML = !isWebdev
    ? `<button class="modal-wishlist-heart-btn wishlist-heart-btn" type="button" data-product-id="${product.id}" aria-label="Save for later">♡</button>`
    : '';

  // FIX: "Visit Live Site" now uses product.live_link (real DB field),
  // never product.siteUrl (mock-only). Also normalizes a bare domain
  // (e.g. "aminfinitybites.health") into a working https:// link, since
  // admins may type either form into the Live Link field.
  const liveLinkHref = product.live_link
    ? (product.live_link.startsWith('http') ? product.live_link : `https://${product.live_link}`)
    : null;

  const actionHTML = isWebdev
    ? `<button class="modal-link modal-enquire-btn" type="button" style="background:none;border:none;cursor:pointer;padding:0;font:inherit">✉ Enquire About This Site →</button>
       ${liveLinkHref ? `<a href="${liveLinkHref}" target="_blank" class="modal-link">🌐 Visit Live Site →</a>` : ''}`
    : isApparel
      ? `<button class="modal-configure-btn" onclick="window.location.href='configurator.html?product=${product.id}'">🎨 Design It in Studio</button>
         <button class="modal-add-btn">Add to Cart</button>`
      : `<button class="modal-add-btn">Order Now</button>`;

  // FIX: webdev's category line shows product.live_link (real DB field),
  // never product.domain (mock-only).
  const domainLine = isWebdev && product.live_link
    ? `<div class="modal-category">↗ ${product.live_link}</div>`
    : `<div class="modal-category">${category.charAt(0).toUpperCase() + category.slice(1)}</div>`;

  // FIX: webdev has no price — it's enquiry-only, so don't render ₦0.00.
  const priceLine = isWebdev
    ? ''
    : `<div class="modal-price">${formatPrice(product.price)}</div>`;

  document.getElementById('modal-inner').innerHTML = `
    <div class="modal-grid">
      <div class="modal-img">${imgHTML}</div>
      <div class="modal-details">
        ${domainLine}
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
          addToCart(product, selectedSize, category);
        }
      } else {
        addToCart(product, selectedSize, category);
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
  const related = await fetchRelatedItems(category, product.id);
  if (relatedContainer) {
    relatedContainer.innerHTML = renderRelatedItemsHTML(related);
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

window.JaiforeCurrency?.init().then(() => {
  loadWishlistedIds().then(syncWishlistHearts);
  loadRecentlyViewed();
  loadCategory('apparel');
  loadCategory('design');
  loadCategory('webdev');
  loadWebdevServices();
});