/* ================================
   JAIFORE — CONFIGURATOR
   scripts/configurator.js
   ================================ */

const API = 'https://jai-fore-website.onrender.com';

// ── MOCKUPS (populated after product fetch + gender selection) ───
const MOCKUPS = {
  male:   { front: '', back: '' },
  female: { front: '', back: '' },
};

// ── PRINT ZONES (as % of canvas) ────────────────────
const PRINT_ZONES = {
  front: { top: '22%', left: '25%', width: '50%', height: '30%' },
  back:  { top: '18%', left: '20%', width: '60%', height: '38%' },
};

// ── STATE ───────────────────────────────────────────
let product           = null;
let currentView       = 'front';
let currentGender     = null;   // 'male' | 'female'
let designs           = [];
let selectedDesign    = null;
let history           = [];
let selectedSize      = null;
let printPricing      = [];
let selectedPrintSize = null;
let cheapestPrice     = 1;
let uploadFee         = 0.50;
const MAX_DESIGNS     = 5;

// ── INIT ────────────────────────────────────────────
const params    = new URLSearchParams(window.location.search);
const productId = params.get('product');

async function init() {
  if (!productId) {
    document.getElementById('studioProductName').textContent = 'No product selected.';
    document.getElementById('studioMsg').textContent = 'Please select a product from the services page.';
    return;
  }

  try {
    const [productRes, pricingRes] = await Promise.all([
      fetch(`${API}/api/products/${productId}`),
      fetch(`${API}/api/print-pricing`)
    ]);

    product      = await productRes.json();
    printPricing = await pricingRes.json();

    document.getElementById('studioProductName').textContent = product.name;
    document.getElementById('panelMerchName').textContent    = product.name;
    document.getElementById('panelMerchPrice').textContent   =
      window.JaiforeCurrency?.isReady()
        ? window.JaiforeCurrency.format(product.price)
        : `$${parseFloat(product.price).toFixed(2)}`;
    document.title = `Design — ${product.name} | Jai'fore`;

    // Set cheapest for upload fee
    if (printPricing.length) {
      cheapestPrice = Math.min(...printPricing.map(p => parseFloat(p.price)));
      uploadFee     = parseFloat((cheapestPrice / 2).toFixed(2));
    }

    renderPrintSizes();

    // Populate all 4 mockup slots from product fields
    MOCKUPS.male.front   = product.front_male   || product.image_url || '';
    MOCKUPS.male.back    = product.back_male    || product.image_url || '';
    MOCKUPS.female.front = product.front_female || product.image_url || '';
    MOCKUPS.female.back  = product.back_female  || product.image_url || '';

    // Show gender modal before anything else
    showGenderModal();

  } catch (err) {
    console.error('Init error:', err);
    document.getElementById('studioProductName').textContent = 'Product not found';
  }

  updateTotal();
  loadGraphicDesigns();
  updateSlots();
}

// ── GENDER MODAL ─────────────────────────────────────
function showGenderModal() {
  // Remove any existing modal
  const existing = document.getElementById('genderModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'genderModal';
  overlay.innerHTML = `
    <div class="gender-modal-box">
      <div class="gender-modal-title">Who are you designing for?</div>
      <div class="gender-modal-sub">Choose a view to start designing on</div>
      <div class="gender-modal-options">
        <button class="gender-opt" data-gender="male">
          <span class="gender-icon">👨</span>
          <span class="gender-label">Male</span>
        </button>
        <button class="gender-opt" data-gender="female">
          <span class="gender-icon">👩</span>
          <span class="gender-label">Female</span>
        </button>
      </div>
    </div>
  `;

  overlay.querySelectorAll('.gender-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      selectGender(btn.dataset.gender);
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.remove(), 300);
    });
  });

  document.body.appendChild(overlay);

  // Slight delay so transition is visible
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

// ── SELECT GENDER ─────────────────────────────────────
function selectGender(gender) {
  currentGender = gender;

  // Sync gender toggle buttons
  document.querySelectorAll('.gender-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.gender === gender);
  });

  // Re-render current view with new gender
  setView(currentView);
}

// ── RENDER PRINT SIZES ────────────────────────────────
function renderPrintSizes() {
  const wrap = document.getElementById('printSizeRow');
  if (!wrap) return;
  wrap.innerHTML = '';

  printPricing.forEach(p => {
    const btn = document.createElement('button');
    btn.className   = 'print-size-btn';
    btn.dataset.id  = p.id;
    btn.dataset.price = p.price;
    btn.innerHTML   = `
      <span class="ps-label">${p.size_label}</span>
      <span class="ps-dim">${p.dimensions}</span>
      <span class="ps-price">+$${parseFloat(p.price).toFixed(2)}</span>
    `;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.print-size-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPrintSize = p;
      updateTotal();
    });
    wrap.appendChild(btn);
  });
}

// ── VIEW TOGGLE ─────────────────────────────────────
function setView(view) {
  currentView = view;
  const gender  = currentGender || 'male';
  const mockup  = document.getElementById('merchMockup');
  const src     = MOCKUPS[gender][view] || '';

  mockup.style.opacity = '0';
  setTimeout(() => {
    mockup.src = src;
    mockup.style.opacity = '1';
  }, 200);

  const zone = document.getElementById('printZone');
  if (zone) {
    const z = PRINT_ZONES[view];
    zone.style.top    = z.top;
    zone.style.left   = z.left;
    zone.style.width  = z.width;
    zone.style.height = z.height;
  }
}

// Side toggle (Front / Back)
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setView(btn.dataset.view);
  });
});

// Gender toggle (Male / Female) — wired up after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.gender-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectGender(btn.dataset.gender);
    });
  });
});

// ── LOAD GRAPHIC DESIGNS ─────────────────────────────
async function loadGraphicDesigns() {
  const grid = document.getElementById('graphicGrid');
  try {
    const res  = await fetch(`${API}/api/products?category=Graphic%20Design`);
    const data = await res.json();
    grid.innerHTML = '';

    if (!data.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;color:#aaa;font-size:0.8rem">No graphic designs available yet.</div>`;
      return;
    }

    document.querySelector('.upload-text').innerHTML =
      `Click to upload<br/><span>PNG, JPG, SVG — max 5MB</span><br/>
       <span style="color:#7b5ea7;font-weight:600">Print fee: $${uploadFee.toFixed(2)}</span>`;

    data.forEach(gd => {
      const item = document.createElement('div');
      item.className = 'gd-item';
      item.innerHTML = gd.image_url
        ? `<img src="${gd.image_url}" alt="${gd.name}"/>
           <div class="gd-name">${gd.name}<br/>$${parseFloat(gd.price).toFixed(2)}</div>`
        : `<div class="gd-placeholder">🎨</div>
           <div class="gd-name">${gd.name}<br/>$${parseFloat(gd.price).toFixed(2)}</div>`;

      item.addEventListener('click', () => addDesign(gd.image_url || null, gd.name, parseFloat(gd.price) || 0));
      grid.appendChild(item);
    });
  } catch {
    grid.innerHTML = `<div style="grid-column:1/-1;color:#aaa;font-size:0.8rem">Failed to load designs.</div>`;
  }
}

// ── ADD DESIGN TO CANVAS ─────────────────────────────
function addDesign(src, name, price = 0) {
  if (designs.length >= MAX_DESIGNS) { showMsg('Maximum 5 designs allowed.'); return; }
  if (!src) { showMsg('This design has no image yet.'); return; }

  saveHistory();

  const container = document.getElementById('canvasContainer');
  const cw = container.offsetWidth;
  const ch = container.offsetHeight;

  const zone  = PRINT_ZONES[currentView];
  const zLeft = parseFloat(zone.left) / 100 * cw;
  const zTop  = parseFloat(zone.top) / 100 * ch;
  const zW    = parseFloat(zone.width) / 100 * cw;
  const zH    = parseFloat(zone.height) / 100 * ch;

  const w = Math.round(zW * 0.5);
  const h = Math.round(zH * 0.5);
  const x = Math.round(zLeft + (zW - w) / 2);
  const y = Math.round(zTop  + (zH - h) / 2);

  const el = document.createElement('div');
  el.className = 'design-layer';
  el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
  el.innerHTML = `
    <img src="${src}" alt="${name}" draggable="false"/>
    <div class="resize-handle"></div>
  `;

  const id     = Date.now();
  const design = { id, src, name, price, view: currentView, el, x, y, w, h };
  designs.push(design);

  makeDraggable(el, design);
  makeResizable(el, design);

  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    selectDesign(design);
  });

  container.appendChild(el);
  selectDesign(design);
  updateSlots();
  updateTotal();
  showMsg('');
}

// ── SELECT DESIGN ────────────────────────────────────
function selectDesign(design) {
  designs.forEach(d => d.el.classList.remove('selected'));
  selectedDesign = design;
  if (design) design.el.classList.add('selected');
}

// ── DRAG ─────────────────────────────────────────────
function makeDraggable(el, design) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    e.preventDefault();
    const startX    = e.clientX;
    const startY    = e.clientY;
    const startLeft = design.x;
    const startTop  = design.y;
    const container = document.getElementById('canvasContainer');
    const cw = container.offsetWidth;
    const ch = container.offsetHeight;

    function onMove(e) {
      design.x = Math.max(0, Math.min(cw - design.w, startLeft + (e.clientX - startX)));
      design.y = Math.max(0, Math.min(ch - design.h, startTop  + (e.clientY - startY)));
      el.style.left = design.x + 'px';
      el.style.top  = design.y + 'px';
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  });
}

// ── RESIZE ───────────────────────────────────────────
function makeResizable(el, design) {
  const handle = el.querySelector('.resize-handle');
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = design.w,  startH = design.h;

    function onMove(e) {
      design.w = Math.max(40, startW + (e.clientX - startX));
      design.h = Math.max(40, startH + (e.clientY - startY));
      el.style.width  = design.w + 'px';
      el.style.height = design.h + 'px';
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  });
}

// ── UPDATE TOTAL ─────────────────────────────────────
function updateTotal() {
  const merchPrice   = parseFloat(product?.price || 0);
  const designsTotal = designs.reduce((sum, d) => sum + (d.price || 0), 0);
  const printTotal   = selectedPrintSize
    ? parseFloat(selectedPrintSize.price) * designs.length
    : 0;
  const total = merchPrice + designsTotal + printTotal;

  const formatted = window.JaiforeCurrency?.isReady()
    ? window.JaiforeCurrency.format(total)
    : `$${total.toFixed(2)}`;
  document.getElementById('cartBtnPrice').textContent = formatted;
}

// ── SLOTS ────────────────────────────────────────────
function updateSlots() {
  const wrap = document.getElementById('designSlots');
  wrap.innerHTML = '';
  document.getElementById('designCount').textContent = `${designs.length} / ${MAX_DESIGNS}`;

  for (let i = 0; i < MAX_DESIGNS; i++) {
    const slot = document.createElement('div');
    slot.className = 'design-slot' + (designs[i] ? ' filled' : '');
    if (designs[i]) {
      const d = designs[i];
      slot.innerHTML = `
        <img src="${d.src}" alt="${d.name}"/>
        <button class="slot-remove" data-id="${d.id}">✕</button>
      `;
      slot.querySelector('.slot-remove').addEventListener('click', () => removeDesignById(d.id));
    } else {
      slot.textContent = `${i + 1}`;
    }
    wrap.appendChild(slot);
  }
}

// ── REMOVE DESIGN ─────────────────────────────────────
function removeDesignById(id) {
  saveHistory();
  const idx = designs.findIndex(d => d.id === id);
  if (idx === -1) return;
  designs[idx].el.remove();
  designs.splice(idx, 1);
  if (selectedDesign?.id === id) selectedDesign = null;
  updateSlots();
  updateTotal();
}

document.getElementById('removeBtn').addEventListener('click', () => {
  if (!selectedDesign) { showMsg('Select a design first.'); return; }
  removeDesignById(selectedDesign.id);
});

document.getElementById('clearBtn').addEventListener('click', () => {
  saveHistory();
  designs.forEach(d => d.el.remove());
  designs = []; selectedDesign = null;
  updateSlots(); updateTotal();
});

// ── UNDO ─────────────────────────────────────────────
function saveHistory() {
  history.push(designs.map(d => ({
    id: d.id, src: d.src, name: d.name, price: d.price, view: d.view,
    x: d.x, y: d.y, w: d.w, h: d.h
  })));
  if (history.length > 20) history.shift();
}

document.getElementById('undoBtn').addEventListener('click', () => {
  if (!history.length) { showMsg('Nothing to undo.'); return; }
  designs.forEach(d => d.el.remove());
  designs = []; selectedDesign = null;
  const prev = history.pop();
  prev.forEach(d => addDesign(d.src, d.name, d.price));
  updateSlots(); updateTotal();
});

// ── UPLOAD ───────────────────────────────────────────
document.getElementById('uploadInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showMsg('File too large. Max 5MB.'); return; }
  const reader  = new FileReader();
  reader.onload = (ev) => addDesign(ev.target.result, file.name, uploadFee);
  reader.readAsDataURL(file);
  e.target.value = '';
});

// ── SIZE ─────────────────────────────────────────────
document.querySelectorAll('.sz-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sz-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedSize = btn.dataset.size;
  });
});

// ── ADD TO CART ───────────────────────────────────────
document.getElementById('addToCartBtn').addEventListener('click', () => {
  if (!selectedSize)      { showMsg('Please select a garment size first.'); return; }
  if (!designs.length)    { showMsg('Add at least one design to your merch.'); return; }
  if (!selectedPrintSize) { showMsg('Please select a print size.'); return; }

  const designsTotal = designs.reduce((sum, d) => sum + (d.price || 0), 0);
  const printTotal   = parseFloat(selectedPrintSize.price) * designs.length;
  const totalPrice   = parseFloat(product.price) + designsTotal + printTotal;

  const cartProduct = {
    ...product,
    id:           product.id,
    price:        totalPrice,
    gender:       currentGender,
    customDesigns: designs.map(d => ({
      src: d.src, name: d.name, price: d.price,
      view: d.view, x: d.x, y: d.y, w: d.w, h: d.h
    })),
    printSize:    selectedPrintSize,
    selectedSize,
    notes:        document.getElementById('designNotes').value.trim(),
    isCustom:     true
  };

  addToCart(cartProduct, selectedSize, 'apparel');
  showMsg('✓ Added to cart! Redirecting...');
  setTimeout(() => window.location.href = 'services.html', 1200);
});

// ── MSG ───────────────────────────────────────────────
function showMsg(text) {
  document.getElementById('studioMsg').textContent = text;
}

// ── MERCH IMAGE TRANSITION ────────────────────────────
document.getElementById('merchMockup').style.transition = 'opacity 0.2s ease';

// ── START ─────────────────────────────────────────────
window.JaiforeCurrency?.init().then(() => {
  init();
}).catch(() => init());