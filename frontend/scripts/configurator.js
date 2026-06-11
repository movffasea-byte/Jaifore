/* ================================
   JAIFORE — CONFIGURATOR
   scripts/configurator.js
   ================================ */

const API = 'https://jai-fore-website.onrender.com';

// ── MOCKUPS ──────────────────────────────────────────
const MOCKUPS = {
  male:   { front: '', back: '' },
  female: { front: '', back: '' },
};

// ── PRINT ZONES (as % of canvas) ────────────────────
const PRINT_ZONES = {
  front: { top: '22%', left: '25%', width: '50%', height: '30%' },
  back:  { top: '18%', left: '20%', width: '60%', height: '38%' },
};

// ── SIZE PREVIEW DATA ────────────────────────────────
const SIZE_DATA = {
  XS:  { scaleX: 0.72, scaleY: 0.90, fit: 'Extra Slim Fit', silW: 38 },
  S:   { scaleX: 0.82, scaleY: 0.93, fit: 'Slim Fit',       silW: 44 },
  M:   { scaleX: 0.91, scaleY: 0.97, fit: 'Regular Fit',    silW: 50 },
  L:   { scaleX: 1.00, scaleY: 1.00, fit: 'Standard Fit',   silW: 56 },
  XL:  { scaleX: 1.09, scaleY: 1.02, fit: 'Relaxed Fit',    silW: 62 },
  XXL: { scaleX: 1.18, scaleY: 1.04, fit: 'Oversized',      silW: 70 },
};

// ── STATE ───────────────────────────────────────────
let product           = null;
let currentView       = 'front';
let currentGender     = null;

const designsByView = {
  male_front:   [],
  male_back:    [],
  female_front: [],
  female_back:  [],
};

let selectedDesign    = null;
let history           = [];
let selectedSize      = null;
let printPricing      = [];
let selectedPrintSize = null;
let cheapestPrice     = 1;
let uploadFee         = 0.50;
const MAX_DESIGNS     = 5;

// ── ZOOM (image-only) ────────────────────────────────
let zoomLevel   = 1;
const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 3;

// ── HELPERS ─────────────────────────────────────────
function viewKey() {
  return `${currentGender || 'male'}_${currentView}`;
}
function currentDesigns() {
  return designsByView[viewKey()];
}

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

    if (printPricing.length) {
      cheapestPrice = Math.min(...printPricing.map(p => parseFloat(p.price)));
      uploadFee     = parseFloat((cheapestPrice / 2).toFixed(2));
    }

    renderPrintSizes();

    MOCKUPS.male.front   = product.front_male   || product.image_url || '';
    MOCKUPS.male.back    = product.back_male    || product.image_url || '';
    MOCKUPS.female.front = product.front_female || product.image_url || '';
    MOCKUPS.female.back  = product.back_female  || product.image_url || '';

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
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

// ── SELECT GENDER ─────────────────────────────────────
function selectGender(gender) {
  currentGender = gender;
  document.querySelectorAll('.gender-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.gender === gender);
  });
  setView(currentView);
}

// ── RENDER PRINT SIZES ────────────────────────────────
function renderPrintSizes() {
  const wrap = document.getElementById('printSizeRow');
  if (!wrap) return;
  wrap.innerHTML = '';

  printPricing.forEach(p => {
    const btn = document.createElement('button');
    btn.className     = 'print-size-btn';
    btn.dataset.id    = p.id;
    btn.dataset.price = p.price;
    btn.innerHTML = `
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

// ── SET VIEW ─────────────────────────────────────────
function setView(view) {
  const prevKey = viewKey();
  currentView   = view;
  const nextKey = viewKey();

  const gender = currentGender || 'male';
  const mockup = document.getElementById('merchMockup');
  const src    = MOCKUPS[gender][view] || '';

  mockup.style.opacity = '0';
  setTimeout(() => {
    mockup.src = src;
    mockup.style.opacity = '1';
    // Re-apply zoom to new image
    applyMockupTransform();
  }, 200);

  // Update print zone position (label already hidden via CSS/HTML change)
  const zone = document.getElementById('printZone');
  if (zone) {
    const z = PRINT_ZONES[view];
    zone.style.top    = z.top;
    zone.style.left   = z.left;
    zone.style.width  = z.width;
    zone.style.height = z.height;
  }

  if (prevKey !== nextKey) {
    (designsByView[prevKey] || []).forEach(d => { d.el.style.display = 'none'; });
    (designsByView[nextKey] || []).forEach(d => { d.el.style.display = ''; });
  }

  selectedDesign = null;
  designs_deselect_all();
  updateSlots();
  updateTotal();
  updatePrintZoneVisibility();
}

function designs_deselect_all() {
  Object.values(designsByView).forEach(arr => {
    arr.forEach(d => d.el.classList.remove('selected'));
  });
}

// Fade print zone border out when this view has designs, back in when empty
function updatePrintZoneVisibility() {
  const zone = document.getElementById('printZone');
  if (!zone) return;
  zone.style.transition = 'opacity 0.4s ease';
  zone.style.opacity    = currentDesigns().length > 0 ? '0' : '1';
}

// Side toggle
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setView(btn.dataset.view);
  });
});

// Gender toggle
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.gender-btn').forEach(btn => {
    btn.addEventListener('click', () => selectGender(btn.dataset.gender));
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

// ── ADD DESIGN ───────────────────────────────────────
function addDesign(src, name, price = 0) {
  const cd = currentDesigns();
  if (cd.length >= MAX_DESIGNS) { showMsg('Maximum 5 designs allowed.'); return; }
  if (!src) { showMsg('This design has no image yet.'); return; }

  saveHistory();

  const container = document.getElementById('canvasContainer');
  const cw = container.offsetWidth;
  const ch = container.offsetHeight;

  const zone  = PRINT_ZONES[currentView];
  const zLeft = parseFloat(zone.left)   / 100 * cw;
  const zTop  = parseFloat(zone.top)    / 100 * ch;
  const zW    = parseFloat(zone.width)  / 100 * cw;
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
  const design = { id, src, name, price, viewKey: viewKey(), el, x, y, w, h };

  designsByView[viewKey()].push(design);
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
  updatePrintZoneVisibility();
  showMsg('');
}

function selectDesign(design) {
  designs_deselect_all();
  selectedDesign = design;
  if (design) design.el.classList.add('selected');
}

// ── DRAG ─────────────────────────────────────────────
function makeDraggable(el, design) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const startL = design.x,  startT = design.y;
    const container = document.getElementById('canvasContainer');
    const cw = container.offsetWidth, ch = container.offsetHeight;

    function onMove(e) {
      design.x = Math.max(0, Math.min(cw - design.w, startL + (e.clientX - startX)));
      design.y = Math.max(0, Math.min(ch - design.h, startT + (e.clientY - startY)));
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
  const allDesigns   = Object.values(designsByView).flat();
  const designsTotal = allDesigns.reduce((sum, d) => sum + (d.price || 0), 0);
  const printTotal   = selectedPrintSize
    ? parseFloat(selectedPrintSize.price) * allDesigns.length
    : 0;
  const total = merchPrice + designsTotal + printTotal;

  const formatted = window.JaiforeCurrency?.isReady()
    ? window.JaiforeCurrency.format(total)
    : `$${total.toFixed(2)}`;
  document.getElementById('cartBtnPrice').textContent = formatted;
}

// ── SLOTS ─────────────────────────────────────────────
function updateSlots() {
  const wrap = document.getElementById('designSlots');
  wrap.innerHTML = '';
  const cd = currentDesigns();
  document.getElementById('designCount').textContent = `${cd.length} / ${MAX_DESIGNS}`;

  for (let i = 0; i < MAX_DESIGNS; i++) {
    const slot = document.createElement('div');
    slot.className = 'design-slot' + (cd[i] ? ' filled' : '');
    if (cd[i]) {
      const d = cd[i];
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

// ── REMOVE ───────────────────────────────────────────
function removeDesignById(id) {
  saveHistory();
  for (const key of Object.keys(designsByView)) {
    const idx = designsByView[key].findIndex(d => d.id === id);
    if (idx !== -1) {
      designsByView[key][idx].el.remove();
      designsByView[key].splice(idx, 1);
      if (selectedDesign?.id === id) selectedDesign = null;
      break;
    }
  }
  updateSlots();
  updateTotal();
  updatePrintZoneVisibility();
}

document.getElementById('removeBtn').addEventListener('click', () => {
  if (!selectedDesign) { showMsg('Select a design first.'); return; }
  removeDesignById(selectedDesign.id);
});

document.getElementById('clearBtn').addEventListener('click', () => {
  saveHistory();
  currentDesigns().forEach(d => d.el.remove());
  designsByView[viewKey()] = [];
  selectedDesign = null;
  updateSlots();
  updateTotal();
  updatePrintZoneVisibility();
});

// ── UNDO ─────────────────────────────────────────────
function saveHistory() {
  history.push({
    key: viewKey(),
    snapshot: currentDesigns().map(d => ({
      id: d.id, src: d.src, name: d.name, price: d.price,
      viewKey: d.viewKey, x: d.x, y: d.y, w: d.w, h: d.h
    }))
  });
  if (history.length > 20) history.shift();
}

document.getElementById('undoBtn').addEventListener('click', () => {
  if (!history.length) { showMsg('Nothing to undo.'); return; }
  const { key, snapshot } = history.pop();
  (designsByView[key] || []).forEach(d => d.el.remove());
  designsByView[key] = [];
  selectedDesign = null;

  const savedView   = currentView;
  const savedGender = currentGender;
  const [g, v]      = key.split('_');
  currentGender = g; currentView = v;
  snapshot.forEach(d => addDesign(d.src, d.name, d.price));
  currentGender = savedGender; currentView = savedView;

  updateSlots();
  updateTotal();
});

// ── UPLOAD ───────────────────────────────────────────
document.getElementById('uploadInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showMsg('File too large. Max 5MB.'); return; }
  const reader = new FileReader();
  reader.onload = (ev) => addDesign(ev.target.result, file.name, uploadFee);
  reader.readAsDataURL(file);
  e.target.value = '';
});

// ── SIZE PREVIEW ─────────────────────────────────────

function ensureSilhouette() {
  let sil = document.getElementById('bodySilhouette');
  if (!sil) {
    sil = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sil.id = 'bodySilhouette';
    sil.setAttribute('viewBox', '0 0 100 160');
    sil.setAttribute('preserveAspectRatio', 'xMidYMax meet');
    sil.style.cssText = `
      position:absolute; inset:0; width:100%; height:100%;
      pointer-events:none; z-index:0;
      opacity:0; transition:opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.4,0.64,1);
    `;
    sil.innerHTML = `
      <ellipse cx="50" cy="14" rx="10" ry="13" fill="rgba(123,94,167,0.10)"/>
      <path d="M22,42 Q18,30 30,26 Q40,22 50,22 Q60,22 70,26 Q82,30 78,42
               L80,100 Q80,108 70,108 L30,108 Q20,108 20,100 Z"
            fill="rgba(123,94,167,0.10)"/>
    `;
    document.getElementById('canvasContainer').prepend(sil);
  }
  return sil;
}

function ensureFitBadge() {
  let badge = document.getElementById('fitBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'fitBadge';
    badge.style.cssText = `
      position:absolute; top:8px; right:8px;
      background:rgba(123,94,167,0.88); color:#fff;
      font-family:'Karla',sans-serif; font-size:0.72rem; font-weight:700;
      padding:4px 10px; border-radius:20px;
      letter-spacing:0.04em; text-transform:uppercase;
      pointer-events:none; z-index:20;
      opacity:0; transform:translateY(-4px);
      transition:opacity 0.3s ease, transform 0.3s ease;
    `;
    document.getElementById('canvasContainer').appendChild(badge);
  }
  return badge;
}

// Combines size scaleX/scaleY + zoom into one transform on the mockup image
function applyMockupTransform() {
  const mockup = document.getElementById('merchMockup');
  const data   = selectedSize ? SIZE_DATA[selectedSize] : null;
  const sx     = data ? data.scaleX * zoomLevel : zoomLevel;
  const sy     = data ? data.scaleY * zoomLevel : zoomLevel;
  mockup.style.transition      = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1), opacity 0.2s ease';
  mockup.style.transformOrigin = 'bottom center';
  mockup.style.transform       = `scaleX(${sx.toFixed(3)}) scaleY(${sy.toFixed(3)})`;
}

function applySizePreview(size) {
  const data = SIZE_DATA[size];
  if (!data) return;

  // 1. Shirt width/height via mockup transform (zoom-aware)
  applyMockupTransform();

  // 2. Silhouette
  const sil = ensureSilhouette();
  const silScale = data.silW / 56;
  sil.style.transform      = `scaleX(${silScale})`;
  sil.style.transformOrigin = 'bottom center';
  sil.style.opacity        = '1';

  // 3. Fit badge
  const badge = ensureFitBadge();
  badge.textContent     = data.fit;
  badge.style.opacity   = '1';
  badge.style.transform = 'translateY(0)';
}

document.querySelectorAll('.sz-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sz-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedSize = btn.dataset.size;
    applySizePreview(selectedSize);
  });
});

// ── ADD TO CART ───────────────────────────────────────
document.getElementById('addToCartBtn').addEventListener('click', () => {
  if (!selectedSize) { showMsg('Please select a garment size first.'); return; }

  const allDesigns = Object.values(designsByView).flat();
  if (!allDesigns.length) { showMsg('Add at least one design to your merch.'); return; }
  if (!selectedPrintSize) { showMsg('Please select a print size.'); return; }

  const designsTotal = allDesigns.reduce((sum, d) => sum + (d.price || 0), 0);
  const printTotal   = parseFloat(selectedPrintSize.price) * allDesigns.length;
  const totalPrice   = parseFloat(product.price) + designsTotal + printTotal;

  const cartProduct = {
    ...product,
    id:            product.id,
    price:         totalPrice,
    gender:        currentGender,
    customDesigns: allDesigns.map(d => ({
      src: d.src, name: d.name, price: d.price,
      viewKey: d.viewKey, x: d.x, y: d.y, w: d.w, h: d.h
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

// ── ZOOM (image only) ────────────────────────────────
function applyZoom() {
  document.getElementById('zoomLabel').textContent = `${Math.round(zoomLevel * 100)}%`;
  applyMockupTransform(); // zoom baked into mockup transform, not the container
}

document.getElementById('zoomInBtn').addEventListener('click', () => {
  if (zoomLevel < ZOOM_MAX) {
    zoomLevel = Math.min(ZOOM_MAX, +(zoomLevel + ZOOM_STEP).toFixed(2));
    applyZoom();
  }
});
document.getElementById('zoomOutBtn').addEventListener('click', () => {
  if (zoomLevel > ZOOM_MIN) {
    zoomLevel = Math.max(ZOOM_MIN, +(zoomLevel - ZOOM_STEP).toFixed(2));
    applyZoom();
  }
});
document.getElementById('zoomResetBtn').addEventListener('click', () => {
  zoomLevel = 1;
  applyZoom();
});

// ── MSG ───────────────────────────────────────────────
function showMsg(text) {
  document.getElementById('studioMsg').textContent = text;
}

// ── PRINT ZONE — hide the "Print Area" text label ────
// The zone border stays for visual guidance, just no text
document.addEventListener('DOMContentLoaded', () => {
  const zoneSpan = document.querySelector('#printZone span');
  if (zoneSpan) zoneSpan.style.display = 'none';
});

// ── MERCH IMAGE TRANSITION ────────────────────────────
document.getElementById('merchMockup').style.transition = 'transform 0.35s cubic-bezier(0.34,1.4,0.64,1), opacity 0.2s ease';

// ── START ─────────────────────────────────────────────
window.JaiforeCurrency?.init().then(() => {
  init();
}).catch(() => init());