/* ================================
   JAIFORE — CONFIGURATOR
   scripts/configurator.js
   ================================ */

const API = 'https://jai-fore-website.onrender.com';

// ── MOCKUP IMAGES ───────────────────────────────────
// Using placeholder SVG mockups — replace src with real black tee/hoodie images
const MOCKUPS = {
  tee: {
    front: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Black_T-Shirt.jpg/800px-Black_T-Shirt.jpg',
    back:  'https://via.placeholder.com/480x640/1a1a1a/ffffff?text=Back+View',
    side:  'https://via.placeholder.com/480x640/1a1a1a/ffffff?text=Side+View'
  },
  hoodie: {
    front: 'https://via.placeholder.com/480x640/1a1a1a/ffffff?text=Hoodie+Front',
    back:  'https://via.placeholder.com/480x640/1a1a1a/ffffff?text=Hoodie+Back',
    side:  'https://via.placeholder.com/480x640/1a1a1a/ffffff?text=Hoodie+Side'
  }
};

// ── STATE ───────────────────────────────────────────
let product        = null;
let currentView    = 'front';
let designs        = [];       // { id, src, el, x, y, w, h }
let selectedDesign = null;
let history        = [];
let selectedSize   = null;
const MAX_DESIGNS  = 5;

// ── INIT ────────────────────────────────────────────
const params    = new URLSearchParams(window.location.search);
const productId = params.get('product');

async function init() {
  if (!productId) { window.location.href = 'services.html'; return; }

  try {
    const res  = await fetch(`${API}/api/products/${productId}`);
    product    = await res.json();

    document.getElementById('studioProductName').textContent = product.name;
    document.getElementById('panelMerchName').textContent    = product.name;
    document.getElementById('panelMerchPrice').textContent   = `₦${Number(product.price).toLocaleString('en-NG')}`;
    document.getElementById('cartBtnPrice').textContent      = `₦${Number(product.price).toLocaleString('en-NG')}`;
    document.title = `Design — ${product.name} | Jai'fore`;

    // Set mockup based on product name
    const type = product.name.toLowerCase().includes('hoodie') ? 'hoodie' : 'tee';
    setView('front', type);

  } catch {
    document.getElementById('studioProductName').textContent = 'Product not found';
  }

  loadGraphicDesigns();
}

// ── VIEW TOGGLE ─────────────────────────────────────
function setView(view, type) {
  currentView = view;
  const merchType = product?.name?.toLowerCase().includes('hoodie') ? 'hoodie' : 'tee';
  const t = type || merchType;
  const mockup = MOCKUPS[t] || MOCKUPS.tee;

  document.getElementById('merchMockup').src = mockup[view] || mockup.front;

  // Show/hide zones
  document.getElementById('zoneChest').style.display = view === 'front' ? 'flex' : 'none';
  document.getElementById('zoneBack').style.display  = view === 'back'  ? 'flex' : 'none';
  document.getElementById('zoneSide').style.display  = view === 'side'  ? 'flex' : 'none';
}

document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setView(btn.dataset.view);
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

    data.forEach(gd => {
      const item = document.createElement('div');
      item.className = 'gd-item';
      item.innerHTML = gd.image_url
        ? `<img src="${gd.image_url}" alt="${gd.name}"/><div class="gd-name">${gd.name}</div>`
        : `<div class="gd-placeholder">🎨</div><div class="gd-name">${gd.name}</div>`;

      item.addEventListener('click', () => addDesign(gd.image_url || null, gd.name));
      grid.appendChild(item);
    });
  } catch {
    grid.innerHTML = `<div style="grid-column:1/-1;color:#aaa;font-size:0.8rem">Failed to load designs.</div>`;
  }
}

// ── ADD DESIGN TO CANVAS ─────────────────────────────
function addDesign(src, name) {
  if (designs.length >= MAX_DESIGNS) {
    showMsg('Maximum 5 designs allowed.'); return;
  }
  if (!src) { showMsg('This design has no image yet.'); return; }

  saveHistory();

  const container = document.getElementById('canvasContainer');
  const cw = container.offsetWidth;
  const ch = container.offsetHeight;

  const w  = Math.round(cw * 0.3);
  const h  = Math.round(ch * 0.3);
  const x  = Math.round((cw - w) / 2);
  const y  = Math.round((ch - h) / 2);

  const el = document.createElement('div');
  el.className = 'design-layer';
  el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;

  el.innerHTML = `
    <img src="${src}" alt="${name}" draggable="false"/>
    <div class="resize-handle"></div>
  `;

  const id = Date.now();
  const design = { id, src, name, el, x, y, w, h };
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
  let startX, startY, startLeft, startTop;

  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    e.preventDefault();
    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = design.x;
    startTop  = design.y;

    const container = document.getElementById('canvasContainer');
    const cw = container.offsetWidth;
    const ch = container.offsetHeight;

    function onMove(e) {
      const dx  = e.clientX - startX;
      const dy  = e.clientY - startY;
      design.x  = Math.max(0, Math.min(cw - design.w, startLeft + dx));
      design.y  = Math.max(0, Math.min(ch - design.h, startTop  + dy));
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
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = design.w;
    const startH = design.h;

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
}

document.getElementById('removeBtn').addEventListener('click', () => {
  if (!selectedDesign) { showMsg('Select a design first.'); return; }
  removeDesignById(selectedDesign.id);
});

document.getElementById('clearBtn').addEventListener('click', () => {
  saveHistory();
  designs.forEach(d => d.el.remove());
  designs = [];
  selectedDesign = null;
  updateSlots();
});

// ── UNDO ─────────────────────────────────────────────
function saveHistory() {
  history.push(designs.map(d => ({
    id: d.id, src: d.src, name: d.name,
    x: d.x, y: d.y, w: d.w, h: d.h
  })));
  if (history.length > 20) history.shift();
}

document.getElementById('undoBtn').addEventListener('click', () => {
  if (!history.length) { showMsg('Nothing to undo.'); return; }
  designs.forEach(d => d.el.remove());
  designs = [];
  selectedDesign = null;
  const prev = history.pop();
  prev.forEach(d => addDesign(d.src, d.name));
  updateSlots();
});

// ── UPLOAD ───────────────────────────────────────────
document.getElementById('uploadInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showMsg('File too large. Max 5MB.'); return; }

  const reader = new FileReader();
  reader.onload = (ev) => addDesign(ev.target.result, file.name);
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
  if (!selectedSize) { showMsg('Please select a size first.'); return; }
  if (!designs.length) { showMsg('Add at least one design to your merch.'); return; }

  const cartProduct = {
    ...product,
    customDesigns: designs.map(d => ({ src: d.src, name: d.name })),
    selectedSize,
    notes: document.getElementById('designNotes').value.trim(),
    isCustom: true
  };

  addToCart(cartProduct, selectedSize, 'apparel');
  showMsg('Added to cart!');
  setTimeout(() => window.location.href = 'services.html', 1200);
});

// ── MSG ───────────────────────────────────────────────
function showMsg(text) {
  document.getElementById('studioMsg').textContent = text;
}

// ── START ─────────────────────────────────────────────
init();
updateSlots();