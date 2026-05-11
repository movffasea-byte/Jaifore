/* ================================
   JAIFORE — DESIGN CONFIGURATOR
   configurator.js (cart lives in cart.js)
   ================================ */

const API = 'https://jai-fore-website.onrender.com';

// ── STATE ──────────────────────────────────────────────
let selectedProduct  = null;
let selectedSize     = null;
let appliedDesigns   = [];
let allDesigns       = [];
let filteredDesigns  = [];

// ── CANVAS STATE ───────────────────────────────────────
const canvas      = document.getElementById('main-canvas');
const ctx         = canvas.getContext('2d');
let layers        = [];
let selectedLayer = null;
let dragState     = null;
const HANDLE_SIZE = 10;
const CANVAS_PAD  = 40;

// ── MOCK DATA ──────────────────────────────────────────
const MOCK_PRODUCTS = [
  { _id:'p1', name:'Black Tee',    emoji:'👕', price:8500,  sizes:['XS','S','M','L','XL','XXL'] },
  { _id:'p2', name:'Hoodie',       emoji:'🧥', price:18500, sizes:['S','M','L','XL','XXL']      },
  { _id:'p3', name:'Cargo Shorts', emoji:'🩳', price:12000, sizes:['S','M','L','XL']            },
  { _id:'p4', name:'Backpack',     emoji:'🎒', price:22000, sizes:['ONE SIZE']                  },
  { _id:'p5', name:'Mug',          emoji:'☕', price:5500,  sizes:['Standard']                  },
  { _id:'p6', name:'Phone Case',   emoji:'📱', price:4500,  sizes:['iPhone 15','Samsung S24']   },
];

const MOCK_DESIGNS = [
  { _id:'d1',  name:'Abstract Waves',     emoji:'🌊', category:'abstract',   price:3500, color:'#4a90d9' },
  { _id:'d2',  name:'Urban Tiger',        emoji:'🐯', category:'animals',    price:4500, color:'#e8a020' },
  { _id:'d3',  name:'Street Tag',         emoji:'✏️', category:'typography', price:2500, color:'#e040fb' },
  { _id:'d4',  name:'Geo Diamond',        emoji:'💎', category:'geometric',  price:3000, color:'#00bcd4' },
  { _id:'d5',  name:'Flame Burst',        emoji:'🔥', category:'abstract',   price:4000, color:'#ff5722' },
  { _id:'d6',  name:'Sacred Geometry',    emoji:'⬡',  category:'geometric',  price:3500, color:'#9c27b0' },
  { _id:'d7',  name:'Lagos Skyline',      emoji:'🏙️', category:'places',     price:5000, color:'#607d8b' },
  { _id:'d8',  name:'Pan-African Shield', emoji:'🛡️', category:'cultural',   price:5500, color:'#388e3c' },
  { _id:'d9',  name:'Neon Script',        emoji:'⚡', category:'typography', price:3000, color:'#ffeb3b' },
  { _id:'d10', name:'Botanical Print',    emoji:'🌿', category:'nature',     price:4000, color:'#66bb6a' },
  { _id:'d11', name:'Afro Retro',         emoji:'✊', category:'cultural',   price:5000, color:'#ff7043' },
  { _id:'d12', name:'Minimal Logo',       emoji:'◉',  category:'minimal',    price:2000, color:'#90a4ae' },
];

// ── UTILS ──────────────────────────────────────────────
function formatPrice(n) { return `₦${Number(n).toLocaleString('en-NG')}`; }

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 2500);
}

// ── FETCH ──────────────────────────────────────────────
async function fetchApparel() {
  try {
    const res  = await fetch(`${API}/api/products?category=apparel`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return Array.isArray(data) ? data : data.products || [];
  } catch { return MOCK_PRODUCTS; }
}

async function fetchDesigns() {
  try {
    const res  = await fetch(`${API}/api/products?category=design`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return Array.isArray(data) ? data : data.products || [];
  } catch { return MOCK_DESIGNS; }
}

// ── CANVAS RESIZE ──────────────────────────────────────
function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const size = Math.min(wrap.clientWidth - CANVAS_PAD * 2, wrap.clientHeight - CANVAS_PAD * 2, 520);
  canvas.width  = size;
  canvas.height = size;
  redraw();
}

// ── DRAW PRODUCT BG ────────────────────────────────────
function drawProductBg(product) {
  const s = canvas.width;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = '#f5f0e8';
  ctx.fillRect(0, 0, s, s);
  ctx.font         = `${s * 0.55}px serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha  = 0.12;
  ctx.fillStyle    = '#111';
  ctx.fillText(product.emoji, s / 2, s / 2);
  ctx.globalAlpha  = 1;
  // Print zone guide
  const zone = s * 0.6, zx = (s - zone) / 2, zy = (s - zone) / 2;
  ctx.strokeStyle = 'rgba(74,45,122,0.2)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(zx, zy, zone, zone);
  ctx.setLineDash([]);
  ctx.font         = `500 ${s * 0.025}px Karla, sans-serif`;
  ctx.fillStyle    = 'rgba(74,45,122,0.4)';
  ctx.textBaseline = 'top';
  ctx.fillText('PRINT ZONE', s / 2, zy + 6);
}

// ── EMOJI CACHE ────────────────────────────────────────
const emojiCache = {};
function getEmojiCanvas(emoji, size) {
  const key = `${emoji}_${Math.round(size)}`;
  if (emojiCache[key]) return emojiCache[key];
  const c = document.createElement('canvas');
  c.width = c.height = Math.max(size, 40);
  const x = c.getContext('2d');
  x.font         = `${c.width * 0.75}px serif`;
  x.textAlign    = 'center';
  x.textBaseline = 'middle';
  x.fillText(emoji, c.width / 2, c.height / 2);
  emojiCache[key] = c;
  return c;
}

// ── DRAW LAYER ─────────────────────────────────────────
function drawLayer(layer, isSelected) {
  ctx.save();
  ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
  ctx.rotate(layer.rotation || 0);
  ctx.scale(layer.scaleX || 1, 1);
  const src = layer.img || getEmojiCanvas(layer.emoji, layer.w);
  ctx.drawImage(src, -layer.w / 2, -layer.h / 2, layer.w, layer.h);
  if (isSelected) {
    ctx.strokeStyle = '#4a2d7a';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(-layer.w / 2, -layer.h / 2, layer.w, layer.h);
    ctx.setLineDash([]);
    const hw = HANDLE_SIZE / 2;
    [[-layer.w/2,-layer.h/2],[layer.w/2,-layer.h/2],[layer.w/2,layer.h/2],[-layer.w/2,layer.h/2]].forEach(([cx,cy]) => {
      ctx.fillStyle   = '#4a2d7a';
      ctx.fillRect(cx - hw, cy - hw, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 1;
      ctx.strokeRect(cx - hw, cy - hw, HANDLE_SIZE, HANDLE_SIZE);
    });
    ctx.beginPath();
    ctx.moveTo(0, -layer.h / 2);
    ctx.lineTo(0, -layer.h / 2 - 20);
    ctx.strokeStyle = 'rgba(74,45,122,0.6)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -layer.h / 2 - 20, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#7b5ea7';
    ctx.fill();
  }
  ctx.restore();
}

function redraw() {
  if (!selectedProduct) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  drawProductBg(selectedProduct);
  layers.forEach(l => drawLayer(l, l === selectedLayer));
}

// ── HIT TEST ───────────────────────────────────────────
function getLayerAt(mx, my) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const dx = mx-(l.x+l.w/2), dy = my-(l.y+l.h/2);
    const cos = Math.cos(-(l.rotation||0)), sin = Math.sin(-(l.rotation||0));
    const lx = dx*cos - dy*sin, ly = dx*sin + dy*cos;
    if (Math.abs(lx) < l.w/2 && Math.abs(ly) < l.h/2) return l;
  }
  return null;
}

function getHandleAt(mx, my, layer) {
  if (!layer) return null;
  const cx = layer.x+layer.w/2, cy = layer.y+layer.h/2;
  const dx = mx-cx, dy = my-cy;
  const cos = Math.cos(-(layer.rotation||0)), sin = Math.sin(-(layer.rotation||0));
  const lx = dx*cos - dy*sin, ly = dx*sin + dy*cos;
  const hw = layer.w/2, hh = layer.h/2;
  for (const c of [{name:'tl',lx:-hw,ly:-hh},{name:'tr',lx:hw,ly:-hh},{name:'br',lx:hw,ly:hh},{name:'bl',lx:-hw,ly:hh}]) {
    if (Math.abs(lx-c.lx) < HANDLE_SIZE && Math.abs(ly-c.ly) < HANDLE_SIZE) return c.name;
  }
  if (Math.abs(lx) < 10 && Math.abs(ly-(-hh-20)) < 10) return 'rotate';
  return null;
}

function getCanvasPos(e) {
  const rect  = canvas.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;
  return {
    x: (touch.clientX - rect.left) * (canvas.width  / rect.width),
    y: (touch.clientY - rect.top)  * (canvas.height / rect.height),
  };
}

// ── POINTER EVENTS ─────────────────────────────────────
canvas.addEventListener('mousedown',  onPointerDown);
canvas.addEventListener('touchstart', onPointerDown, { passive:false });
canvas.addEventListener('mousemove',  onPointerMove);
canvas.addEventListener('touchmove',  onPointerMove, { passive:false });
canvas.addEventListener('mouseup',    onPointerUp);
canvas.addEventListener('touchend',   onPointerUp);

function onPointerDown(e) {
  e.preventDefault();
  if (!selectedProduct) return;
  const { x, y } = getCanvasPos(e);
  if (selectedLayer) {
    const handle = getHandleAt(x, y, selectedLayer);
    if (handle) {
      dragState = { type: handle==='rotate'?'rotate':'resize', handle, startX:x, startY:y, origX:selectedLayer.x, origY:selectedLayer.y, origW:selectedLayer.w, origH:selectedLayer.h, origRot:selectedLayer.rotation||0, cx:selectedLayer.x+selectedLayer.w/2, cy:selectedLayer.y+selectedLayer.h/2 };
      return;
    }
  }
  selectedLayer = getLayerAt(x, y);
  if (selectedLayer) dragState = { type:'move', startX:x, startY:y, origX:selectedLayer.x, origY:selectedLayer.y };
  redraw();
}

function onPointerMove(e) {
  e.preventDefault();
  if (!dragState || !selectedLayer) return;
  const { x, y } = getCanvasPos(e);
  const dx = x - dragState.startX, dy = y - dragState.startY;
  if (dragState.type === 'move') {
    selectedLayer.x = dragState.origX + dx;
    selectedLayer.y = dragState.origY + dy;
  } else if (dragState.type === 'rotate') {
    selectedLayer.rotation = dragState.origRot + (Math.atan2(y-dragState.cy,x-dragState.cx) - Math.atan2(dragState.startY-dragState.cy,dragState.startX-dragState.cx));
  } else if (dragState.type === 'resize') {
    const cos = Math.cos(selectedLayer.rotation||0), sin = Math.sin(selectedLayer.rotation||0);
    const ldx = dx*cos+dy*sin, ldy = -dx*sin+dy*cos;
    const h = dragState.handle; const min = 30;
    let nw = dragState.origW, nh = dragState.origH;
    if (h==='br'){nw=Math.max(min,dragState.origW+ldx);nh=Math.max(min,dragState.origH+ldy);}
    else if(h==='tr'){nw=Math.max(min,dragState.origW+ldx);nh=Math.max(min,dragState.origH-ldy);}
    else if(h==='tl'){nw=Math.max(min,dragState.origW-ldx);nh=Math.max(min,dragState.origH-ldy);}
    else if(h==='bl'){nw=Math.max(min,dragState.origW-ldx);nh=Math.max(min,dragState.origH+ldy);}
    selectedLayer.w = nw; selectedLayer.h = nh;
    selectedLayer.x = dragState.cx - nw/2; selectedLayer.y = dragState.cy - nh/2;
  }
  redraw();
}

function onPointerUp() { dragState = null; }

// ── ADD DESIGN TO CANVAS ───────────────────────────────
function addDesignToCanvas(design) {
  const s = canvas.width, size = s * 0.25;
  const layer = { id:Date.now(), designId:design._id, emoji:design.emoji, img:null, x:s/2-size/2+(layers.length%3)*20, y:s/2-size/2+(layers.length%3)*20, w:size, h:size, rotation:0, scaleX:1 };
  if (design.image) { const img = new Image(); img.crossOrigin='anonymous'; img.onload=()=>{layer.img=img;redraw();}; img.src=design.image; }
  layers.push(layer);
  selectedLayer = layer;
  appliedDesigns.push({ layerId:layer.id, _id:design._id, name:design.name, price:design.price, emoji:design.emoji });
  updateAppliedUI();
  updatePrice();
  updateDesignCount();
  document.getElementById('canvas-hint').classList.add('hidden');
  redraw();
  document.querySelectorAll(`.design-card[data-id="${design._id}"]`).forEach(c => c.classList.add('applied'));
  toast(`${design.emoji} ${design.name} added!`, 'success');
}

// ── REMOVE DESIGN ──────────────────────────────────────
function removeDesignByLayerId(layerId) {
  layers = layers.filter(l => l.id !== layerId);
  if (selectedLayer?.id === layerId) selectedLayer = null;
  const idx = appliedDesigns.findIndex(d => d.layerId === layerId);
  if (idx !== -1) {
    const removed = appliedDesigns.splice(idx, 1)[0];
    if (!appliedDesigns.some(d => d._id === removed._id)) {
      document.querySelectorAll(`.design-card[data-id="${removed._id}"]`).forEach(c => c.classList.remove('applied'));
    }
  }
  updateAppliedUI(); updatePrice(); updateDesignCount(); redraw();
}

// ── UI UPDATES ─────────────────────────────────────────
function updateAppliedUI() {
  const list    = document.getElementById('applied-list');
  const totalEl = document.getElementById('applied-total');
  if (!appliedDesigns.length) {
    list.innerHTML     = '<div class="applied-empty">No designs added yet</div>';
    totalEl.textContent = '₦0 in designs';
    return;
  }
  totalEl.textContent = `${formatPrice(appliedDesigns.reduce((s,d)=>s+d.price,0))} in designs`;
  list.innerHTML = appliedDesigns.map(d => `
    <div class="applied-item">
      <div class="applied-item-left">
        <span class="applied-item-emoji">${d.emoji}</span>
        <div class="applied-item-info">
          <div class="applied-item-name">${d.name}</div>
          <div class="applied-item-price">${formatPrice(d.price)}</div>
        </div>
      </div>
      <button class="applied-item-remove" data-layer-id="${d.layerId}">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.applied-item-remove').forEach(btn => {
    btn.addEventListener('click', () => removeDesignByLayerId(Number(btn.dataset.layerId)));
  });
}

function updatePrice() {
  const base    = selectedProduct ? selectedProduct.price : 0;
  const designs = appliedDesigns.reduce((s,d) => s+d.price, 0);
  document.getElementById('total-price').textContent = formatPrice(base + designs);
}

function updateDesignCount() {
  document.getElementById('design-count').textContent = appliedDesigns.length;
}

// ── PRODUCT TABS ───────────────────────────────────────
async function initProductTabs() {
  const products = await fetchApparel();
  const scroll   = document.getElementById('tabs-scroll');
  scroll.innerHTML = '';
  products.forEach(p => {
    const tab = document.createElement('button');
    tab.className = 'product-tab';
    tab.innerHTML = `<span class="tab-emoji">${p.emoji||'👕'}</span><span class="tab-name">${p.name}</span>`;
    tab.addEventListener('click', () => selectProduct(p, products));
    scroll.appendChild(tab);
  });
}

function selectProduct(product, products) {
  selectedProduct = product;
  layers = []; selectedLayer = null; appliedDesigns = [];
  document.querySelectorAll('.product-tab').forEach((t,i) => t.classList.toggle('active', products[i]._id === product._id));
  document.getElementById('product-name-display').textContent = product.name;
  document.getElementById('canvas-hint').classList.remove('hidden');
  const sizeOpts = document.getElementById('size-opts');
  sizeOpts.innerHTML = ''; selectedSize = null;
  (product.sizes||[]).forEach((s,i) => {
    const btn = document.createElement('button');
    btn.className   = 'size-opt-btn';
    btn.textContent = s;
    if (i===0) { btn.classList.add('selected'); selectedSize = s; }
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-opt-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected'); selectedSize = s;
    });
    sizeOpts.appendChild(btn);
  });
  updateAppliedUI(); updatePrice(); updateDesignCount(); resizeCanvas(); redraw();
}

// ── DESIGN PANEL ───────────────────────────────────────
async function initDesigns() {
  allDesigns      = await fetchDesigns();
  filteredDesigns = [...allDesigns];
  renderDesignFilter();
  renderDesignGrid();
}

function renderDesignFilter() {
  const wrap = document.getElementById('design-filter');
  const cats = ['all', ...new Set(allDesigns.map(d => d.category).filter(Boolean))];
  wrap.innerHTML = cats.map(c =>
    `<button class="filter-btn${c==='all'?' active':''}" data-cat="${c}">${c.charAt(0).toUpperCase()+c.slice(1)}</button>`
  ).join('');
  wrap.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filteredDesigns = btn.dataset.cat==='all' ? [...allDesigns] : allDesigns.filter(d => d.category===btn.dataset.cat);
      renderDesignGrid();
    });
  });
}

function renderDesignGrid() {
  const grid = document.getElementById('design-grid');
  grid.innerHTML = '';
  filteredDesigns.forEach((design, i) => {
    const isApplied = appliedDesigns.some(a => a._id === design._id);
    const card = document.createElement('div');
    card.className    = `design-card${isApplied?' applied':''}`;
    card.dataset.id   = design._id;
    card.style.animationDelay = `${i*0.04}s`;
    const imgHTML = design.image
      ? `<img src="${design.image}" alt="${design.name}" loading="lazy"/>`
      : `<span style="font-size:2.5rem">${design.emoji}</span>`;
    card.innerHTML = `
      <div class="design-card-img" style="background:linear-gradient(135deg,var(--bg-soft),${design.color||'#ede8df'}22)">
        ${imgHTML}
        <span class="applied-badge">Applied</span>
      </div>
      <div class="design-card-body">
        <div class="design-card-name">${design.name}</div>
        <div class="design-card-price">${formatPrice(design.price)}</div>
      </div>
      <button class="design-add-chip" data-id="${design._id}">+ Add</button>
    `;
    const addDesign = () => {
      if (!selectedProduct) { toast('Please select a product first', 'error'); return; }
      addDesignToCanvas(design);
    };
    card.querySelector('.design-add-chip').addEventListener('click', e => { e.stopPropagation(); addDesign(); });
    card.addEventListener('click', addDesign);
    grid.appendChild(card);
  });
}

// ── TOOLBAR ────────────────────────────────────────────
document.getElementById('btn-delete').addEventListener('click', () => {
  if (!selectedLayer) { toast('Select a design on the canvas first'); return; }
  removeDesignByLayerId(selectedLayer.id);
});
document.getElementById('btn-forward').addEventListener('click', () => {
  if (!selectedLayer) return;
  const i = layers.indexOf(selectedLayer);
  if (i < layers.length-1) { [layers[i],layers[i+1]]=[layers[i+1],layers[i]]; redraw(); }
});
document.getElementById('btn-back').addEventListener('click', () => {
  if (!selectedLayer) return;
  const i = layers.indexOf(selectedLayer);
  if (i > 0) { [layers[i],layers[i-1]]=[layers[i-1],layers[i]]; redraw(); }
});
document.getElementById('btn-flip').addEventListener('click', () => {
  if (!selectedLayer) return;
  selectedLayer.scaleX = (selectedLayer.scaleX||1) * -1; redraw();
});
document.getElementById('btn-clear').addEventListener('click', () => {
  layers=[]; selectedLayer=null; appliedDesigns=[];
  document.querySelectorAll('.design-card').forEach(c => c.classList.remove('applied'));
  updateAppliedUI(); updatePrice(); updateDesignCount();
  document.getElementById('canvas-hint').classList.remove('hidden');
  redraw(); toast('Canvas cleared');
});

// ── ADD TO CART ────────────────────────────────────────
document.getElementById('add-cart-btn').addEventListener('click', () => {
  if (!selectedProduct) { toast('Please select a product first', 'error'); return; }
  if (!selectedSize)    { toast('Please select a size', 'error'); return; }
  const snapshot = canvas.toDataURL('image/png');
  const cartProduct = {
    ...selectedProduct,
    price:    selectedProduct.price + appliedDesigns.reduce((s,d) => s+d.price, 0),
    designs:  appliedDesigns.map(d => ({ id:d._id, name:d.name, price:d.price })),
    snapshot,
  };
  addToCart(cartProduct, selectedSize, 'apparel');
  toast(`${selectedProduct.emoji} ${selectedProduct.name} added to cart!`, 'success');
  setTimeout(() => window.location.href = 'services.html', 1500);
});

// ── KEYBOARD ───────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (!selectedLayer || document.activeElement.tagName==='INPUT') return;
  if (e.key==='Delete'||e.key==='Backspace') removeDesignByLayerId(selectedLayer.id);
  if (e.key==='ArrowLeft')  { selectedLayer.x-=2; redraw(); }
  if (e.key==='ArrowRight') { selectedLayer.x+=2; redraw(); }
  if (e.key==='ArrowUp')    { selectedLayer.y-=2; redraw(); }
  if (e.key==='ArrowDown')  { selectedLayer.y+=2; redraw(); }
});

// ── URL PARAMS ─────────────────────────────────────────
function checkUrlParams() {
  const productId = new URLSearchParams(window.location.search).get('product');
  if (!productId) return;
  setTimeout(() => {
    const tabs = document.querySelectorAll('.product-tab');
    const idx  = MOCK_PRODUCTS.findIndex(p => p._id === productId);
    if (tabs[idx]) tabs[idx].click();
  }, 300);
}

// ── RESIZE ─────────────────────────────────────────────
new ResizeObserver(() => resizeCanvas()).observe(document.getElementById('canvas-wrap'));

// ── INIT ───────────────────────────────────────────────
async function init() {
  await initProductTabs();
  await initDesigns();
  resizeCanvas();
  checkUrlParams();
}

init();