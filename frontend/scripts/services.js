/* ═══════════════════════════════════════════
   JAIFORE — SERVICES PAGE SCRIPT
   services.js
   
   Connects to: https://a-m-site-design.onrender.com
   Endpoints used:
     GET /api/products          → all products
     GET /api/services          → service tier configs (optional)
   
   Falls back to local static data if backend
   is unavailable (cold start / offline).
════════════════════════════════════════════ */

'use strict';

/* ── CONFIG ──────────────────────────────── */
const API_BASE = 'https://a-m-site-design.onrender.com';
const PRODUCTS_PER_PAGE = 6;

/* ── SERVICE CARD STATIC DATA ────────────────
   Pricing / features for the 3-plan toggle.
   If your backend exposes a /api/services
   endpoint, loadServiceCards() will use that
   instead and these become a fallback.
════════════════════════════════════════════ */
const SERVICE_PLANS = {
  project: [
    {
      id: 'print',
      theme: 'theme-print',
      num: '01',
      icon: '🖨️',
      tag: 'Apparel & Print',
      title: 'Wear the Statement',
      desc: 'Custom prints on plain black tees, hoodies, joggers and more. Whether it\'s a brand drop, a merch line, or a single statement piece — we handle the ink, you wear the vision.',
      features: [
        'DTG & screen print on plain black apparel',
        'T-shirts, hoodies, joggers & more',
        'Bulk orders with tiered pricing',
        'Delivery across Nigeria',
      ],
      price: '₦8,500',
      priceNote: 'per piece (min. 5)',
      popular: false,
    },
    {
      id: 'design',
      theme: 'theme-design',
      num: '02',
      icon: '✦',
      tag: 'Graphic Design',
      title: 'Design That Speaks First',
      desc: 'Brand identity, social graphics, flyers, logos, and everything in between. Visual language built to hold attention and make the right statement every single time.',
      features: [
        'Logo & full brand identity systems',
        'Social media graphics & templates',
        'Flyers, banners & event materials',
        'Custom illustrations & art direction',
      ],
      price: '₦35,000',
      priceNote: 'starting / project',
      popular: true,
    },
    {
      id: 'web',
      theme: 'theme-web',
      num: '03',
      icon: '⌨️',
      tag: 'Web Development',
      title: 'Build What Lasts Online',
      desc: 'Full-stack web applications and sites — from sleek landing pages to robust business platforms with auth, payments, and databases. Built to perform, built to grow.',
      features: [
        'Landing pages & marketing sites',
        'Full-stack apps (Node.js, PostgreSQL)',
        'Payment & auth integration',
        'Hosting setup & ongoing maintenance',
      ],
      price: '₦120,000',
      priceNote: 'starting / project',
      popular: false,
    },
  ],
  retainer: [
    {
      id: 'print',
      theme: 'theme-print',
      num: '01',
      icon: '🖨️',
      tag: 'Apparel & Print',
      title: 'Wear the Statement',
      desc: 'Monthly print quota — no per-piece billing, priority queue, and free design revisions on all print assets. Ideal for brands with recurring drops.',
      features: [
        'Monthly print quota — no per-piece billing',
        'Priority queue on all orders',
        'Free design revisions for print assets',
        'Dedicated account manager',
      ],
      price: '₦65,000',
      priceNote: '/ month',
      popular: false,
    },
    {
      id: 'design',
      theme: 'theme-design',
      num: '02',
      icon: '✦',
      tag: 'Graphic Design',
      title: 'Design That Speaks First',
      desc: 'Up to 15 design assets per month with unlimited revisions, brand library maintenance, and 48hr priority turnaround. Your creative team, on demand.',
      features: [
        'Up to 15 design assets per month',
        'Unlimited revisions within scope',
        'Brand asset library maintenance',
        'Priority 48hr turnaround',
      ],
      price: '₦75,000',
      priceNote: '/ month',
      popular: true,
    },
    {
      id: 'web',
      theme: 'theme-web',
      num: '03',
      icon: '⌨️',
      tag: 'Web Development',
      title: 'Build What Lasts Online',
      desc: 'Ongoing dev, updates, bug fixes, and monthly performance audits. Priority support within 24hrs and new feature builds at a reduced rate.',
      features: [
        'Ongoing dev, updates & bug fixes',
        'Monthly performance audit & report',
        'Priority support within 24hrs',
        'New feature builds at reduced rate',
      ],
      price: '₦85,000',
      priceNote: '/ month',
      popular: false,
    },
  ],
  bundle: [
    {
      id: 'print',
      theme: 'theme-print',
      num: '01',
      icon: '🖨️',
      tag: 'Print + Design Bundle',
      title: 'Wear the Statement',
      desc: 'Print and graphic design combined into a single retainer. Coordinated creative production means your merch drops are always on-brand and on-time.',
      features: [
        'Print + graphic design combined',
        '25% off vs separate pricing',
        'Coordinated creative & production',
        'Merch drops made easy',
      ],
      price: '₦55,000',
      priceNote: '/ month',
      popular: false,
    },
    {
      id: 'design',
      theme: 'theme-design',
      num: '02',
      icon: '✦',
      tag: 'Design (Included)',
      title: 'Design That Speaks First',
      desc: 'Full design support included in the bundle. Designs are optimised for both print and digital — one brief, all outputs, consistent visual language.',
      features: [
        'Full brand design support included',
        'Designs optimised for print & digital',
        'Cross-service creative direction',
        'One brief, all outputs',
      ],
      price: 'Included',
      priceNote: 'in bundle',
      popular: true,
    },
    {
      id: 'web',
      theme: 'theme-web',
      num: '03',
      icon: '⌨️',
      tag: 'Site + Design Bundle',
      title: 'Build What Lasts Online',
      desc: 'Full site build plus a monthly design retainer. Consistent visual language across every channel, single point of contact, and a complete launch package.',
      features: [
        'Full site build + monthly design retainer',
        'Consistent visuals across all channels',
        'Single point of contact for everything',
        'Launch package: site + brand kit',
      ],
      price: '₦180,000',
      priceNote: 'site + ongoing design',
      popular: false,
    },
  ],
};

/* ── STATE ───────────────────────────────── */
let allProducts      = [];   // raw from backend
let filteredProducts = [];   // after category filter
let currentPage      = 1;
let currentCategory  = 'all';
let activePlan       = 'project';


/* ═══════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initServiceCards();
  initPlanToggle();
  loadProducts();
  initScrollReveal();
  initModal();
});


/* ═══════════════════════════════════════════
   NAV — scroll shadow + hamburger
════════════════════════════════════════════ */
function initNav() {
  const nav        = document.getElementById('nav');
  const hamburger  = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');

  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  hamburger.addEventListener('click', () => {
    const isOpen = hamburger.classList.toggle('open');
    mobileMenu.classList.toggle('open', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  // close mobile menu on link click
  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
    });
  });
}


/* ═══════════════════════════════════════════
   SERVICE CARDS
════════════════════════════════════════════ */
function initServiceCards() {
  renderServiceCards(SERVICE_PLANS[activePlan]);
}

function renderServiceCards(cards) {
  const grid = document.getElementById('cardsGrid');
  grid.innerHTML = cards.map(buildServiceCard).join('');
}

function buildServiceCard(card) {
  const popularBadge = card.popular
    ? `<div class="popular-badge">Most popular</div>`
    : '';

  const features = card.features
    .map(f => `<li>${escHtml(f)}</li>`)
    .join('');

  return `
    <div class="service-card ${escHtml(card.theme)}">
      <div class="card-bg-shape"></div>
      ${popularBadge}
      <div class="card-num">${escHtml(card.num)}</div>
      <div class="card-icon-wrap">${card.icon}</div>
      <span class="card-tag">${escHtml(card.tag)}</span>
      <h3 class="card-title">${escHtml(card.title)}</h3>
      <p class="card-desc">${escHtml(card.desc)}</p>
      <ul class="card-features">${features}</ul>
      <div class="card-price-row">
        <span class="card-price">${escHtml(card.price)}</span>
        <span class="card-price-note">${escHtml(card.priceNote)}</span>
      </div>
      <button class="card-btn" data-service="${escHtml(card.tag)}">
        ${card.id === 'print' ? 'Order prints' : card.id === 'design' ? 'Start a project' : 'Build with us'} →
      </button>
    </div>
  `;
}

/* CTA buttons inside cards → mailto */
document.addEventListener('click', e => {
  const btn = e.target.closest('.card-btn');
  if (!btn) return;
  const service = btn.dataset.service || 'our services';
  const subject = encodeURIComponent(`Jaifore Inquiry — ${service}`);
  const body    = encodeURIComponent(
    `Hi Jaifore,\n\nI'm interested in your ${service} service.\n\nPlease share more details.`
  );
  window.location.href = `mailto:hello@jaifore.com?subject=${subject}&body=${body}`;
});


/* ═══════════════════════════════════════════
   PLAN TOGGLE
════════════════════════════════════════════ */
function initPlanToggle() {
  const toggleWrap = document.getElementById('planToggle');
  toggleWrap.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleWrap.querySelectorAll('.toggle-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      activePlan = btn.dataset.plan;
      renderServiceCards(SERVICE_PLANS[activePlan]);
    });
  });
}


/* ═══════════════════════════════════════════
   LOAD PRODUCTS FROM BACKEND
════════════════════════════════════════════ */
async function loadProducts() {
  showProductSkeletons();

  try {
    const res = await fetch(`${API_BASE}/api/products`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) throw new Error(`Server responded ${res.status}`);

    const data = await res.json();

    /* Support both { products: [...] } and plain array responses */
    allProducts = Array.isArray(data) ? data : (data.products || []);

    if (allProducts.length === 0) {
      showEmptyState();
      return;
    }

    buildFilterBar(allProducts);
    applyFilterAndRender();

  } catch (err) {
    console.error('[Jaifore] Failed to load products:', err);
    showCatalogueError();
  }
}


/* ═══════════════════════════════════════════
   FILTER BAR
════════════════════════════════════════════ */
function buildFilterBar(products) {
  const categories = ['all', ...new Set(products.map(p => p.category).filter(Boolean))];
  const filterBar  = document.getElementById('filterBar');

  filterBar.innerHTML = categories.map(cat => `
    <button
      class="filter-btn${cat === currentCategory ? ' active' : ''}"
      data-cat="${escHtml(cat)}"
    >${cat === 'all' ? 'All' : escHtml(cat)}</button>
  `).join('');

  filterBar.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.cat;
      currentPage     = 1;
      applyFilterAndRender();
    });
  });
}


/* ═══════════════════════════════════════════
   FILTER + RENDER PRODUCTS
════════════════════════════════════════════ */
function applyFilterAndRender() {
  filteredProducts = currentCategory === 'all'
    ? allProducts
    : allProducts.filter(p => p.category === currentCategory);

  currentPage = 1;
  renderProductPage(true);
}

function renderProductPage(reset = false) {
  const grid       = document.getElementById('productGrid');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const emptyState  = document.getElementById('emptyState');

  if (filteredProducts.length === 0) {
    grid.innerHTML = '';
    showEmptyState();
    loadMoreBtn.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  const start = (currentPage - 1) * PRODUCTS_PER_PAGE;
  const slice = filteredProducts.slice(0, currentPage * PRODUCTS_PER_PAGE);

  if (reset) {
    grid.innerHTML = slice.map((p, i) => buildProductCard(p, i)).join('');
  } else {
    // append only new items
    const newSlice = filteredProducts.slice(start, currentPage * PRODUCTS_PER_PAGE);
    newSlice.forEach((p, i) => {
      const card = document.createElement('div');
      card.innerHTML = buildProductCard(p, start + i);
      grid.appendChild(card.firstElementChild);
    });
  }

  const hasMore = currentPage * PRODUCTS_PER_PAGE < filteredProducts.length;
  loadMoreBtn.classList.toggle('hidden', !hasMore);
}

function buildProductCard(product, index) {
  const name     = escHtml(product.name || product.title || 'Untitled');
  const category = escHtml(product.category || '');
  const desc     = escHtml(product.description || '');
  const price    = formatPrice(product.price);
  const imgSrc   = product.image || product.imageUrl || '';
  const initials = name.slice(0, 2).toUpperCase();

  const imgMarkup = imgSrc
    ? `<img src="${escHtml(imgSrc)}" alt="${name}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />`
    : '';

  const delay = `animation-delay: ${(index % PRODUCTS_PER_PAGE) * 0.06}s`;

  return `
    <article class="product-card" style="${delay}"
      data-id="${escHtml(String(product._id || product.id || ''))}"
      data-name="${name}"
      data-category="${category}"
      data-desc="${desc}"
      data-price="${price}"
      data-img="${escHtml(imgSrc)}"
    >
      <div class="product-img-wrap">
        ${imgMarkup}
        <div class="product-img-placeholder" ${imgSrc ? 'style="display:none"' : ''}>${initials}</div>
      </div>
      <div class="product-body">
        ${category ? `<div class="product-cat">${category}</div>` : ''}
        <h3 class="product-name">${name}</h3>
        ${desc ? `<p class="product-desc">${desc}</p>` : ''}
        <div class="product-footer">
          <span class="product-price">${price}</span>
          <button class="product-order-btn">Order →</button>
        </div>
      </div>
    </article>
  `;
}


/* ═══════════════════════════════════════════
   LOAD MORE
════════════════════════════════════════════ */
document.getElementById('loadMoreBtn').addEventListener('click', () => {
  currentPage++;
  renderProductPage(false);
});


/* ═══════════════════════════════════════════
   PRODUCT MODAL
════════════════════════════════════════════ */
function initModal() {
  const overlay   = document.getElementById('modalOverlay');
  const closeBtn  = document.getElementById('modalClose');
  const orderBtn  = document.getElementById('modalOrderBtn');

  // Open modal on product card click
  document.getElementById('productGrid').addEventListener('click', e => {
    const card = e.target.closest('.product-card');
    if (!card) return;
    openModal(card.dataset);
  });

  // Close buttons
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // Order CTA
  orderBtn.addEventListener('click', () => {
    const title   = document.getElementById('modalTitle').textContent;
    const subject = encodeURIComponent(`Jaifore Order — ${title}`);
    const body    = encodeURIComponent(`Hi Jaifore,\n\nI'd like to order: ${title}\n\nPlease let me know the next steps.`);
    window.location.href = `mailto:hello@jaifore.com?subject=${subject}&body=${body}`;
  });
}

function openModal({ name, category, desc, price, img }) {
  document.getElementById('modalTitle').textContent    = name    || '';
  document.getElementById('modalCategory').textContent = category || '';
  document.getElementById('modalDesc').textContent     = desc    || '';
  document.getElementById('modalPrice').textContent    = price   || '';

  const modalImg         = document.getElementById('modalImg');
  const modalPlaceholder = document.getElementById('modalImgPlaceholder');

  if (img) {
    modalImg.src = img;
    modalImg.style.display = 'block';
    modalPlaceholder.style.display = 'none';
    modalImg.onerror = () => {
      modalImg.style.display = 'none';
      modalPlaceholder.style.display = 'flex';
      modalPlaceholder.textContent = (name || '').slice(0, 2).toUpperCase();
    };
  } else {
    modalImg.style.display = 'none';
    modalPlaceholder.style.display = 'flex';
    modalPlaceholder.textContent = (name || '').slice(0, 2).toUpperCase();
  }

  document.getElementById('modalOverlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.body.style.overflow = '';
}


/* ═══════════════════════════════════════════
   SCROLL REVEAL (why items)
════════════════════════════════════════════ */
function initScrollReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add('visible'), i * 100);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  items.forEach(el => observer.observe(el));
}


/* ═══════════════════════════════════════════
   UI STATE HELPERS
════════════════════════════════════════════ */
function showProductSkeletons() {
  const grid = document.getElementById('productGrid');
  grid.innerHTML = Array.from({ length: 6 }, () =>
    `<div class="product-skeleton"></div>`
  ).join('');
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('catalogueError').classList.add('hidden');
  document.getElementById('loadMoreBtn').classList.add('hidden');
}

function showEmptyState() {
  document.getElementById('emptyState').classList.remove('hidden');
  document.getElementById('productGrid').innerHTML = '';
}

function showCatalogueError() {
  document.getElementById('productGrid').innerHTML = '';
  document.getElementById('catalogueError').classList.remove('hidden');

  document.getElementById('catalogueRetryBtn').addEventListener('click', () => {
    document.getElementById('catalogueError').classList.add('hidden');
    loadProducts();
  }, { once: true });
}


/* ═══════════════════════════════════════════
   UTILS
════════════════════════════════════════════ */
function formatPrice(price) {
  if (price === undefined || price === null || price === '') return 'Contact us';
  const num = parseFloat(price);
  if (isNaN(num)) return String(price);
  return `₦${num.toLocaleString('en-NG')}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}