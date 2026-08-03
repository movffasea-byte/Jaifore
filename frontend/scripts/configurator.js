/* ================================
   JAIFORE — CONFIGURATOR
   scripts/configurator.js
   ================================ */

const API = 'https://jai-fore-production.up.railway.app';

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
let undoStack         = [];
let redoStack         = [];
let selectedSize      = null;
let printPricing      = [];
let selectedPrintSize = null;
let cheapestPrice     = 1;
let uploadFee         = 0.50;
const MAX_DESIGNS     = 5;

// item 18 — quantity for the whole configured garment. All designs + print
// fees scale together as N identical physical shirts (product decision:
// "whole bundle x qty" — each unit is a fully printed, separate shirt).
let quantity          = 1;
const MIN_QUANTITY    = 1;

// ── ZOOM ─────────────────────────────────────────────
let zoomLevel   = 1;
const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 3;

// item 20 — draft persistence, so an in-progress design survives navigating
// away and back within a 45-minute window. Single GLOBAL draft (not
// per-product) — product decision. Stored in localStorage since this is
// pre-cart state, nothing to send to a backend for.
const DRAFT_KEY          = 'jaifore_configurator_draft';
const DRAFT_EXPIRY_MS    = 45 * 60 * 1000; // 45 minutes

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      productId:      productId,
      currentGender:  currentGender,
      currentView:    currentView,
      designsByView:  serializeDesignsByView(),
      lastActivity:   Date.now(),
    }));
  } catch (e) {
    console.error('[draft] Failed to save:', e.message);
  }
}

// Design objects normally hold a live DOM element reference (`el`), which
// can't survive JSON serialization — strip it out for storage, the same way
// saveToUndo()'s snapshots already do for the undo/redo stack.
function serializeDesignsByView() {
  const out = {};
  for (const key of Object.keys(designsByView)) {
    out[key] = designsByView[key].map(d => ({
      id: d.id, src: d.src, name: d.name, price: d.price,
      viewKey: d.viewKey, x: d.x, y: d.y, w: d.w, h: d.h
    }));
  }
  return out;
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft.lastActivity || (Date.now() - draft.lastActivity) > DRAFT_EXPIRY_MS) {
      clearDraft(); // stale — clean it up rather than leave dead data sitting around
      return null;
    }
    return draft;
  } catch (e) {
    console.error('[draft] Failed to load:', e.message);
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (e) {
    console.error('[draft] Failed to clear:', e.message);
  }
}

// Rebuilds designsByView + DOM layers from a saved draft's plain data,
// mirroring restoreSnapshot()'s approach for the undo/redo stack (same
// reasoning: designs need real DOM elements + drag/resize handlers wired
// back up, not just the plain data restored).
function restoreDraftDesigns(draftDesignsByView, draftGender) {
  const container = document.getElementById('canvasContainer');
  for (const key of Object.keys(draftDesignsByView)) {
    const list = draftDesignsByView[key];
    designsByView[key] = [];
    list.forEach(d => {
      const el = document.createElement('div');
      el.className     = 'design-layer';
      el.style.cssText = `left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px;`;
      el.innerHTML = `
        <img src="${d.src}" alt="${d.name}" draggable="false"/>
        <div class="resize-handle"></div>
      `;
      const design = { ...d, el };

      // Only the currently-active gender/view combo should be visible on
      // load — everything else stays in memory but hidden, same convention
      // setView()/restoreSnapshot() already use elsewhere in this file.
      if (key !== `${draftGender || 'male'}_${currentView}`) {
        el.style.display = 'none';
      }

      designsByView[key].push(design);
      makeDraggable(el, design);
      makeResizable(el, design);
      el.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('resize-handle')) return;
        selectDesign(design);
      });
      container.appendChild(el);
    });
  }
}

// ── RECENTLY VIEWED (item 20) ────────────────────────
// Same implementation as services.js/category.js — see those files for the
// fuller reasoning on why this is engagement-only, not render-based.
// configurator.js has exactly one call site for this: right after init()
// confirms a real product loaded, since simply landing on this page with a
// valid ?product= param already IS the engagement (there's no separate
// "card" to click first, unlike the grid pages).
function recordProductView(productId) {
  const token = localStorage.getItem('jaifore_token');
  if (!token) return;
  fetch(`${API}/api/recently-viewed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify({ productId })
  }).catch(() => { /* silent — fire-and-forget instrumentation */ });
}

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

    // item 20 — recording the view here, right after the product is
    // confirmed to have actually loaded (not at the top of init(), before
    // we know productId resolved to something real). Matches services.js/
    // category.js's rule: engagement, not mere page-existence.
    recordProductView(product.id);

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

    // item 19 — a wishlist resume takes priority over the item 20 draft
    // flow entirely: arriving here via ?wishlist=<id> is an explicit,
    // deliberate action (clicking Move to Cart on the wishlist page), so
    // there's nothing to prompt about the way there is with an incidental
    // leftover draft. Falls through to the normal draft/gender-modal flow
    // if no wishlist param is present, or if the fetch fails for any reason.
    const wishlistId = params.get('wishlist');
    let resumedFromWishlist = false;

    if (wishlistId) {
      resumedFromWishlist = await tryResumeFromWishlist(wishlistId);
    }

    if (!resumedFromWishlist) {
      // item 20 — check for an existing draft BEFORE showing the gender modal,
      // since the prompt (if needed) must appear on load, ahead of anything else.
      const draft = loadDraft();

      if (draft && String(draft.productId) === String(productId)) {
        // Same product as the draft — restore directly, no prompt needed at all.
        // ORDER MATTERS: currentGender/currentView must be set from the draft
        // BEFORE selectGender() runs below. selectGender() calls setView(),
        // which only hides/shows designs when viewKey() changes between calls
        // (prevKey !== nextKey) — since these two globals already match the
        // draft's values by the time selectGender() re-sets them to the same
        // thing, prevKey === nextKey, so the just-restored designs correctly
        // stay visible instead of being hidden by that visibility-toggle logic.
        currentGender = draft.currentGender;
        currentView   = draft.currentView;
        restoreDraftDesigns(draft.designsByView, draft.currentGender);
        selectGender(draft.currentGender); // sets active toggle state + calls setView()
      } else if (draft) {
        // Draft belongs to a DIFFERENT product — ask before doing anything else.
        showDraftPromptModal(
          draft,
          () => {
            // Continue: redirect to the draft's own product. That reload will
            // hit the "same product" branch above and restore cleanly.
            window.location.href = `configurator.html?product=${draft.productId}`;
          },
          () => {
            // Start fresh: discard the old draft, proceed normally for THIS product.
            clearDraft();
            showGenderModal();
          }
        );
      } else {
        // No draft at all — completely normal flow.
        showGenderModal();
      }
    }

  } catch (err) {
    console.error('Init error:', err);
    document.getElementById('studioProductName').textContent = 'Product not found';
  }

  updateTotal();
  loadGraphicDesigns();
  updateSlots();
  updateUndoRedoBtns();
  updateQuantityUI();
}

// ── RESUME FROM WISHLIST (item 19) ────────────────────
// Rehydrates a saved wishlist item back into the configurator. Reuses
// restoreDraftDesigns() (built for item 20's draft system) since the shape
// needed is identical: a designsByView-keyed object of plain design data
// that needs real DOM elements + drag/resize handlers wired back up. Also
// restores selectedSize / selectedPrintSize / notes / gender, none of
// which the draft system needed to touch (a draft is pre-cart, so it never
// captured print size or garment size — only in-progress canvas state).
async function tryResumeFromWishlist(wishlistId) {
  const token = localStorage.getItem('jaifore_token');
  if (!token) return false; // not logged in — nothing to resume, fall through normally

  try {
    const res = await fetch(`${API}/api/wishlist`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return false;

    const items = await res.json();
    const item  = items.find(i => String(i.id) === String(wishlistId));
    if (!item || !item.config_signature) return false; // plain products have nothing to rehydrate

    const data = item.snapshot_data;
    if (!data.customDesigns?.length) return false;

    currentGender = data.gender || 'male';
    currentView   = 'front';

    // Rebuild a designsByView-shaped object from the flat customDesigns
    // list, keyed the same way addDesign()/restoreDraftDesigns() expect —
    // each design already carries its own viewKey from when it was saved.
    const rebuilt = { male_front: [], male_back: [], female_front: [], female_back: [] };
    data.customDesigns.forEach(d => {
      const key = d.viewKey || `${currentGender}_front`;
      if (!rebuilt[key]) rebuilt[key] = [];
      rebuilt[key].push({ ...d, id: d.id || Date.now() + Math.random() });
    });

    restoreDraftDesigns(rebuilt, currentGender);
    selectGender(currentGender);

    // Restore the panel selections a draft never needed to carry.
    if (data.selectedSize) {
      selectedSize = data.selectedSize;
      document.querySelectorAll('.sz-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.size === data.selectedSize);
      });
    }
    if (data.printSize) {
      selectedPrintSize = data.printSize;
      // printPricing/renderPrintSizes() has already run by this point in
      // init(), so the buttons exist to match against.
      document.querySelectorAll('.print-size-btn').forEach(b => {
        b.classList.toggle('selected', String(b.dataset.id) === String(data.printSize.id));
      });
    }
    if (data.notes) {
      document.getElementById('designNotes').value = data.notes;
    }

    showMsg('Picked up your saved design — review and add to cart when ready.');
    return true;
  } catch (e) {
    console.error('[wishlist] resume failed:', e.message);
    return false;
  }
}

// ── DRAFT CONTINUE/RESTART MODAL (item 20) ───────────
// Shown on page load ONLY when a fresh (non-expired) draft exists for a
// DIFFERENT product than the one currently being opened. Fires before the
// gender modal or any product setup, per product decision ("on page load").
function showDraftPromptModal(draft, onContinue, onStartFresh) {
  const existing = document.getElementById('draftPromptModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'draftPromptModal';
  overlay.innerHTML = `
    <div class="gender-modal-box">
      <div class="gender-modal-title">Continue your last design?</div>
      <div class="gender-modal-sub">You have an unfinished design on another product. Pick up where you left off, or start fresh here.</div>
      <div class="gender-modal-options">
        <button class="gender-opt" data-choice="continue">
          <span class="gender-icon">↩</span>
          <span class="gender-label">Continue Draft</span>
        </button>
        <button class="gender-opt" data-choice="fresh">
          <span class="gender-icon">✕</span>
          <span class="gender-label">Start Fresh</span>
        </button>
      </div>
    </div>
  `;

  overlay.querySelectorAll('.gender-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const choice = btn.dataset.choice;
      overlay.classList.add('fade-out');
      setTimeout(() => {
        overlay.remove();
        if (choice === 'continue') onContinue(draft);
        else onStartFresh();
      }, 300);
    });
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));
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
    mockup.src           = src;
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

function updatePrintZoneVisibility() {
  const zone = document.getElementById('printZone');
  if (!zone) return;
  zone.style.transition = 'opacity 0.4s ease';
  zone.style.opacity    = currentDesigns().length > 0 ? '0' : '1';
}

// ── SIDE TOGGLE ──────────────────────────────────────
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setView(btn.dataset.view);
  });
});

// ── GENDER TOGGLE ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.gender-btn').forEach(btn => {
    btn.addEventListener('click', () => selectGender(btn.dataset.gender));
  });
});

// ── DESELECT ON CANVAS BACKGROUND CLICK ─────────────
document.getElementById('canvasContainer').addEventListener('pointerdown', (e) => {
  if (
    e.target.id === 'canvasContainer' ||
    e.target.id === 'merchMockup'     ||
    e.target.id === 'printZone'
  ) {
    selectedDesign = null;
    designs_deselect_all();
  }
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

  saveToUndo();

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
  updateUndoRedoBtns();
  saveDraft();
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
    let moved = false;

    function onMove(e) {
      moved = true;
      design.x = Math.max(0, Math.min(cw - design.w, startL + (e.clientX - startX)));
      design.y = Math.max(0, Math.min(ch - design.h, startT + (e.clientY - startY)));
      el.style.left = design.x + 'px';
      el.style.top  = design.y + 'px';
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);
      if (moved) saveToUndo();
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
      saveToUndo();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  });
}

// ── UPDATE TOTAL ─────────────────────────────────────
// item 18: the whole bundle (merch + designs + print fees) now scales by
// quantity — "5 separate shirts, each fully printed" per product decision,
// not just the garment price scaling while print/design fees stay flat.
function updateTotal() {
  const merchPrice   = parseFloat(product?.price || 0);
  const allDesigns   = Object.values(designsByView).flat();
  const designsTotal = allDesigns.reduce((sum, d) => sum + (d.price || 0), 0);
  const printTotal   = selectedPrintSize
    ? parseFloat(selectedPrintSize.price) * allDesigns.length
    : 0;
  const unitTotal = merchPrice + designsTotal + printTotal;
  const total     = unitTotal * quantity;

  const formatted = window.JaiforeCurrency?.isReady()
    ? window.JaiforeCurrency.format(total)
    : `$${total.toFixed(2)}`;
  document.getElementById('cartBtnPrice').textContent = formatted;
}

// ── QUANTITY (item 18) ───────────────────────────────
// Stepper (-/+) with an editable number input in between, per product
// decision. No upper cap requested — only enforces a floor of MIN_QUANTITY
// (can't go to 0 or negative). Typing a non-numeric or sub-minimum value
// snaps back to the minimum rather than silently accepting bad input.
function updateQuantityUI() {
  const input = document.getElementById('quantityInput');
  if (input) input.value = quantity;

  const minusBtn = document.getElementById('qtyMinusBtn');
  if (minusBtn) minusBtn.disabled = quantity <= MIN_QUANTITY;
}

function setQuantity(newQty) {
  const parsed = parseInt(newQty, 10);
  quantity = (isNaN(parsed) || parsed < MIN_QUANTITY) ? MIN_QUANTITY : parsed;
  updateQuantityUI();
  updateTotal();
}

document.getElementById('qtyMinusBtn')?.addEventListener('click', () => {
  setQuantity(quantity - 1);
});

document.getElementById('qtyPlusBtn')?.addEventListener('click', () => {
  setQuantity(quantity + 1);
});

document.getElementById('quantityInput')?.addEventListener('change', (e) => {
  setQuantity(e.target.value);
});

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
  saveToUndo();
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
  updateUndoRedoBtns();
  saveDraft();
}

document.getElementById('removeBtn').addEventListener('click', () => {
  if (!selectedDesign) { showMsg('Select a design first.'); return; }
  removeDesignById(selectedDesign.id);
});

document.getElementById('clearBtn').addEventListener('click', () => {
  saveToUndo();
  currentDesigns().forEach(d => d.el.remove());
  designsByView[viewKey()] = [];
  selectedDesign = null;
  updateSlots();
  updateTotal();
  updatePrintZoneVisibility();
  updateUndoRedoBtns();
  saveDraft();
});

// ── UNDO / REDO ───────────────────────────────────────
function saveToUndo() {
  undoStack.push({
    key:      viewKey(),
    snapshot: currentDesigns().map(d => ({
      id: d.id, src: d.src, name: d.name, price: d.price,
      viewKey: d.viewKey, x: d.x, y: d.y, w: d.w, h: d.h
    }))
  });
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
  updateUndoRedoBtns();
}

function restoreSnapshot(key, snapshot) {
  (designsByView[key] || []).forEach(d => d.el.remove());
  designsByView[key] = [];
  selectedDesign = null;

  const savedView   = currentView;
  const savedGender = currentGender;
  const parts       = key.split('_');
  currentGender     = parts[0];
  currentView       = parts[1];

  snapshot.forEach(d => {
    const container = document.getElementById('canvasContainer');
    const el = document.createElement('div');
    el.className     = 'design-layer';
    el.style.cssText = `left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px;`;
    el.innerHTML = `
      <img src="${d.src}" alt="${d.name}" draggable="false"/>
      <div class="resize-handle"></div>
    `;
    const design = { ...d, el };

    if (key !== `${savedGender || 'male'}_${savedView}`) {
      el.style.display = 'none';
    }

    designsByView[key].push(design);
    makeDraggable(el, design);
    makeResizable(el, design);
    el.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('resize-handle')) return;
      selectDesign(design);
    });
    container.appendChild(el);
  });

  currentGender = savedGender;
  currentView   = savedView;
}

document.getElementById('undoBtn').addEventListener('click', () => {
  if (!undoStack.length) { showMsg('Nothing to undo.'); return; }

  redoStack.push({
    key:      viewKey(),
    snapshot: currentDesigns().map(d => ({
      id: d.id, src: d.src, name: d.name, price: d.price,
      viewKey: d.viewKey, x: d.x, y: d.y, w: d.w, h: d.h
    }))
  });

  const { key, snapshot } = undoStack.pop();
  restoreSnapshot(key, snapshot);
  updateSlots(); updateTotal(); updatePrintZoneVisibility(); updateUndoRedoBtns();
  saveDraft();
  showMsg('');
});

document.getElementById('redoBtn').addEventListener('click', () => {
  if (!redoStack.length) { showMsg('Nothing to redo.'); return; }

  undoStack.push({
    key:      viewKey(),
    snapshot: currentDesigns().map(d => ({
      id: d.id, src: d.src, name: d.name, price: d.price,
      viewKey: d.viewKey, x: d.x, y: d.y, w: d.w, h: d.h
    }))
  });

  const { key, snapshot } = redoStack.pop();
  restoreSnapshot(key, snapshot);
  updateSlots(); updateTotal(); updatePrintZoneVisibility(); updateUndoRedoBtns();
  saveDraft();
  showMsg('');
});

function updateUndoRedoBtns() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

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

// ── GARMENT SIZE — selection only, no image effect ───
document.querySelectorAll('.sz-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sz-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedSize = btn.dataset.size;
  });
});

// ── ADD TO CART ───────────────────────────────────────
// item 18: quantity is fulfilled by calling addToCart() N times (Option A —
// no changes needed to cart.js's accumulation model). cart.js's existing
// `existing.qty += 1` logic naturally accumulates to the right count, and the
// item 18 config-signature fix in cart.js ensures these N calls always merge
// into ONE line (same designs/gender/printSize) rather than creating N
// separate lines or accidentally merging into an unrelated configuration.
document.getElementById('addToCartBtn').addEventListener('click', () => {
  if (!selectedSize) { showMsg('Please select a garment size first.'); return; }

  const allDesigns = Object.values(designsByView).flat();
  if (!allDesigns.length) { showMsg('Add at least one design to your merch.'); return; }
  if (!selectedPrintSize) { showMsg('Please select a print size.'); return; }

  const designsTotal = allDesigns.reduce((sum, d) => sum + (d.price || 0), 0);
  const printTotal   = parseFloat(selectedPrintSize.price) * allDesigns.length;
  const unitPrice    = parseFloat(product.price) + designsTotal + printTotal;

  // Use the mockup currently shown (front view of the selected gender) as the
  // cart/checkout thumbnail, so the customer sees their configured product,
  // not a blank icon.
  const gender          = currentGender || 'male';
  const snapshotImage   = MOCKUPS[gender]?.front || product.image_url || '';

  const cartProduct = {
    ...product,
    _id:           product.id,   // addToCart() in cart.js matches on _id — must align with product schema
    id:            product.id,
    price:         unitPrice,    // per-unit price — addToCart() is called `quantity` times below, cart.js accumulates qty
    gender:        currentGender,
    snapshot:      snapshotImage,
    customDesigns: allDesigns.map(d => ({
      src: d.src, name: d.name, price: d.price,
      viewKey: d.viewKey, x: d.x, y: d.y, w: d.w, h: d.h
    })),
    printSize:    selectedPrintSize,
    selectedSize,
    notes:        document.getElementById('designNotes').value.trim(),
    isCustom:     true
  };

  for (let i = 0; i < quantity; i++) {
    addToCart(cartProduct, selectedSize, 'apparel');
  }

  // item 20 — once added to cart, this design is no longer "in progress";
  // clear the draft so it doesn't linger and incorrectly prompt to
  // "continue" a design that's already been purchased.
  clearDraft();

  showMsg(`✓ Added ${quantity} to cart! Redirecting to checkout...`);
  setTimeout(() => window.location.href = 'checkout.html', 1200);
});

// ── SAVE FOR LATER (item 19) ──────────────────────────
// Deliberately mirrors addToCartBtn's own validation (size / at least one
// design / print size required) rather than allowing a half-configured
// design to be wishlisted — a saved design should be just as "complete" as
// one that was actually added to cart, since Move to Cart later re-opens
// the configurator expecting a fully valid state to redisplay.
document.getElementById('saveForLaterBtn')?.addEventListener('click', async () => {
  const token = localStorage.getItem('jaifore_token');
  if (!token) {
    // Same redirect convention cart.js's goToCheckout() already uses for
    // an unauthenticated user, so Save for Later doesn't silently fail.
    sessionStorage.setItem('jaifore_return', window.location.href);
    window.location.href = 'loginsys.html';
    return;
  }

  if (!selectedSize) { showMsg('Please select a garment size first.'); return; }

  const allDesigns = Object.values(designsByView).flat();
  if (!allDesigns.length) { showMsg('Add at least one design to your merch.'); return; }
  if (!selectedPrintSize) { showMsg('Please select a print size.'); return; }

  const designsTotal = allDesigns.reduce((sum, d) => sum + (d.price || 0), 0);
  const printTotal   = parseFloat(selectedPrintSize.price) * allDesigns.length;
  const unitPrice     = parseFloat(product.price) + designsTotal + printTotal;

  const gender        = currentGender || 'male';
  const snapshotImage = MOCKUPS[gender]?.front || product.image_url || '';

  const payload = {
    productId:     product.id,
    name:          product.name,
    price:         unitPrice,
    snapshot:      snapshotImage,
    gender:        currentGender,
    printSize:     selectedPrintSize,
    customDesigns: allDesigns.map(d => ({
      src: d.src, name: d.name, price: d.price,
      viewKey: d.viewKey, x: d.x, y: d.y, w: d.w, h: d.h
    })),
    selectedSize:  selectedSize,
    notes:         document.getElementById('designNotes').value.trim(),
  };

  const btn = document.getElementById('saveForLaterBtn');
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/api/wishlist`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Save failed');

    btn.classList.add('saved');
    btn.textContent = '♥ Saved';
    showMsg('Saved to your wishlist.');
  } catch {
    showMsg('Could not save — please try again.');
  } finally {
    btn.disabled = false;
  }
});

// ── ZOOM ─────────────────────────────────────────────
function applyZoom() {
  document.getElementById('zoomLabel').textContent = `${Math.round(zoomLevel * 100)}%`;

  const container = document.getElementById('canvasContainer');
  container.style.transition      = 'transform 0.2s ease';
  container.style.transformOrigin = 'top left';
  container.style.transform       = `scale(${zoomLevel})`;

  const outer = document.getElementById('canvasOuter');
  if (outer) {
    outer.style.overflowX = zoomLevel > 1 ? 'auto' : 'hidden';
    outer.style.overflowY = zoomLevel > 1 ? 'auto' : 'hidden';
    outer.style.minHeight = zoomLevel > 1
      ? `${container.offsetHeight * zoomLevel}px`
      : '';
  }
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
  const outer = document.getElementById('canvasOuter');
  if (outer) { outer.style.overflowX = ''; outer.style.overflowY = ''; outer.style.minHeight = ''; }
});

// ── MSG ───────────────────────────────────────────────
function showMsg(text) {
  document.getElementById('studioMsg').textContent = text;
}

// ── MERCH IMAGE — fade only, no transform ────────────
document.getElementById('merchMockup').style.transition = 'opacity 0.2s ease';

// ── START ─────────────────────────────────────────────
window.JaiforeCurrency?.init().then(() => {
  init();
}).catch(() => init());