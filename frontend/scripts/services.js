/* ================================
   JAIFORE — SERVICES PAGE
   services.js (cart lives in cart.js)
   ================================ */

const API = 'https://jai-fore-website.onrender.com';

let selectedSize         = null;
let currentModalProduct  = null;

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
async function fetchProducts(category) {
   const categoryMap = {
    apparel: 'Apparels & Merchandise',
    design:  'Graphic Design',
    webdev:  'Web Development'
  };
  try {
    const cat = encodeURIComponent(categoryMap[category] || category);
   const res = await fetch(`${API}/api/products?category=${cat}&limit=3`);
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

  // Apparel gets two buttons — Add to Cart + Design It
  const footerHTML = isApparel
    ? `<div class="card-price"><span class="currency">₦</span>${Number(product.price).toLocaleString('en-NG')}</div>
       <div style="display:flex;gap:0.4rem">
         <button class="configure-btn" data-id="${product.id}">🎨 Design</button>
         <button class="card-action"   data-id="${product.id}">Add to Cart</button>
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

  // Card click → modal
  card.addEventListener('click', (e) => {
    if (!e.target.classList.contains('card-action') &&
        !e.target.classList.contains('configure-btn')) {
      openModal(product, category);
    }
  });

  // Add to cart button
  card.querySelector('.card-action')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isWebdev || (isApparel && product.sizes?.length)) {
      openModal(product, category);
    } else {
      addToCart(product, null, category);
    }
  });

  // Design It button — go to configurator
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

  if (!products.length) {
    grid.innerHTML = `<div style="color:var(--muted);font-size:0.85rem;padding:2rem 0;grid-column:1/-1">No products found.</div>`;
    return;
  }
  products.slice(0, 3).forEach((p, i) => grid.appendChild(renderCard(p, i, category)));
}

// ── LOAD MORE → category page ──────────────────────────
document.querySelectorAll('.load-more-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    window.location.href = `category.html?cat=${btn.dataset.category}`;
  });
});

// ── MODAL ──────────────────────────────────────────────
function openModal(product, category) {
  currentModalProduct = product;
  selectedSize        = null;

  const isWebdev  = category === 'webdev';
  const isApparel = category === 'apparel';
  const placeholder = getPlaceholder(category, 0);

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
        ${actionHTML}
      </div>
    </div>
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
      addToCart(product, selectedSize, category);
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
  loadCategory('apparel');
  loadCategory('design');
  loadCategory('webdev');
});