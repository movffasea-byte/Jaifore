/* ================================
   JAIFORE — SIZE GUIDE (item 16)
   scripts/size-guide.js
   Shared between services.html and configurator.html — include this
   script on both pages, then call openSizeGuide() from a trigger button.
   ================================ */

// PLACEHOLDER DATA — every "[FILL IN]" below must be replaced with real
// measurements before this goes live. Fabricated sizing risks a customer
// ordering the wrong size for real. Add or remove garment categories here
// as the catalog changes; each category needs its own `fields` (column
// headers) and `sizes` (one row per size, values matching field order).
const SIZE_GUIDE_DATA = {
  'Tees & Shirts': {
    fields: ['Chest (in)', 'Length (in)', 'Sleeve (in)'],
    sizes: {
      XS:  ['[FILL IN]', '[FILL IN]', '[FILL IN]'],
      S:   ['[FILL IN]', '[FILL IN]', '[FILL IN]'],
      M:   ['[FILL IN]', '[FILL IN]', '[FILL IN]'],
      L:   ['[FILL IN]', '[FILL IN]', '[FILL IN]'],
      XL:  ['[FILL IN]', '[FILL IN]', '[FILL IN]'],
      XXL: ['[FILL IN]', '[FILL IN]', '[FILL IN]'],
    }
  },
  'Shorts': {
    fields: ['Waist (in)', 'Length (in)'],
    sizes: {
      S:  ['[FILL IN]', '[FILL IN]'],
      M:  ['[FILL IN]', '[FILL IN]'],
      L:  ['[FILL IN]', '[FILL IN]'],
      XL: ['[FILL IN]', '[FILL IN]'],
    }
  },
  // Assumes caps are one-size/adjustable. If yours are actually sized
  // (S/M/L by head circumference), change this to match Shorts' shape.
  'Caps': {
    fields: ['Head Circumference (in)'],
    sizes: {
      'One Size': ['[FILL IN]'],
    }
  },
};

let sizeGuideInjected = false;

function injectSizeGuideModal() {
  if (sizeGuideInjected) return;
  sizeGuideInjected = true;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="size-guide-overlay" id="sizeGuideOverlay"></div>
    <div class="size-guide-modal" id="sizeGuideModal">
      <button class="size-guide-close" id="sizeGuideClose">✕</button>
      <h3 class="size-guide-title">Size Guide</h3>
      <div class="size-guide-tabs" id="sizeGuideTabs"></div>
      <div class="size-guide-table-wrap" id="sizeGuideTableWrap"></div>
      <p class="size-guide-note">Measurements in inches, garment laid flat. For the best fit, compare against a similar item you already own.</p>
    </div>
  `);

  document.getElementById('sizeGuideClose').addEventListener('click', closeSizeGuide);
  document.getElementById('sizeGuideOverlay').addEventListener('click', closeSizeGuide);

  renderSizeGuideTabs(Object.keys(SIZE_GUIDE_DATA)[0]);
}

function renderSizeGuideTabs(activeCategory) {
  const tabsEl = document.getElementById('sizeGuideTabs');
  tabsEl.innerHTML = Object.keys(SIZE_GUIDE_DATA).map(cat => `
    <button class="size-guide-tab ${cat === activeCategory ? 'active' : ''}" data-category="${cat}">${cat}</button>
  `).join('');

  tabsEl.querySelectorAll('.size-guide-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      tabsEl.querySelectorAll('.size-guide-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSizeGuideTable(btn.dataset.category);
    });
  });

  renderSizeGuideTable(activeCategory);
}

function renderSizeGuideTable(category) {
  const data = SIZE_GUIDE_DATA[category];
  const wrap = document.getElementById('sizeGuideTableWrap');
  if (!data) { wrap.innerHTML = '<p class="size-guide-empty">No size data for this category yet.</p>'; return; }

  const rows = Object.entries(data.sizes).map(([size, values]) => `
    <tr>
      <td class="sg-size-cell">${size}</td>
      ${values.map(v => `<td>${v}</td>`).join('')}
    </tr>
  `).join('');

  wrap.innerHTML = `
    <table class="size-guide-table">
      <thead>
        <tr>
          <th>Size</th>
          ${data.fields.map(f => `<th>${f}</th>`).join('')}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// category is optional — omit it to just open on whichever tab is currently active
function openSizeGuide(category) {
  injectSizeGuideModal();
  if (category && SIZE_GUIDE_DATA[category]) {
    document.querySelectorAll('.size-guide-tab').forEach(b => b.classList.toggle('active', b.dataset.category === category));
    renderSizeGuideTable(category);
  }
  document.getElementById('sizeGuideOverlay').classList.add('open');
  document.getElementById('sizeGuideModal').classList.add('open');
}

function closeSizeGuide() {
  document.getElementById('sizeGuideOverlay')?.classList.remove('open');
  document.getElementById('sizeGuideModal')?.classList.remove('open');
}