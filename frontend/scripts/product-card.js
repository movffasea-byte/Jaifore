/* ================================
   JAIFORE — SHARED PRODUCT CARD
   frontend/scripts/product-card.js

   One card for the Services and Category pages (they used to carry two
   near-identical copies). Image-led: photo, name, price, then the actions.
   The wishlist heart sits on the photo. Load before services.js / category.js.

   buildProductCard(product, {
     category,      'apparel' | 'design' | 'webdev'
     tag,           badge text, e.g. 'Merch'
     placeholder,   emoji shown when there is no image
     delay,         animation delay in seconds
     getSizes, getPrintSizes, getPriceLabel, renderWishlistHeart,   // page helpers
     open           () => open this product's modal
   })
   ================================ */
function buildProductCard(product, ctx) {
  const {
    category, tag, placeholder, delay = 0,
    getSizes, getPrintSizes, getPriceLabel, renderWishlistHeart, open,
  } = ctx;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const isWebdev  = category === 'webdev';
  const isApparel = category === 'apparel';
  const isDesign  = category === 'design';

  const card = document.createElement('div');
  card.className = 'product-card';
  card.style.animationDelay = `${delay}s`;

  // Thumbnail first; the full-size image is only used in the modal
  const thumb = product.thumb_url || product.image_url;
  const imgHTML = thumb
    ? `<img src="${esc(thumb)}" alt="${esc(product.name)}" width="400" height="500" loading="lazy" decoding="async"/>`
    : `<div class="card-img-placeholder">${placeholder || '📦'}</div>`;

  const printSizes    = getPrintSizes(product);
  const hasPrintSizes = printSizes.length > 0;

  let sizeHTML = '';
  if (isApparel) {
    const sizes = getSizes(product);
    sizeHTML = `<div class="size-chips">
        ${sizes.slice(0, 4).map(s => `<span class="size-chip">${esc(s)}</span>`).join('')}
        ${sizes.length > 4 ? `<span class="size-chip">+${sizes.length - 4}</span>` : ''}
       </div>`;
  } else if (isDesign && hasPrintSizes) {
    sizeHTML = `<div class="size-chips">
        ${printSizes.map(s => `<span class="size-chip">${esc(s.size_label)}</span>`).join('')}
       </div>`;
  }

  const domainHTML = isWebdev && product.live_link
    ? `<div class="site-domain">↗ ${esc(product.live_link)}</div>` : '';

  // "Out of stock" only ever applies to apparel
  const badgeHTML = (isApparel && product.in_stock === false)
    ? `<span class="card-badge out-of-stock">Out of Stock</span>`
    : `<span class="card-badge">${esc(tag)}</span>`;

  const priceLabel = getPriceLabel(product, category);
  const priceHTML  = isWebdev ? '' : `<div class="card-price">${priceLabel || (isDesign ? 'Not available yet' : '')}</div>`;

  let actionsHTML;
  if (isApparel) {
    actionsHTML = `<button class="configure-btn" data-id="${product.id}">🎨 Design</button>
       <button class="card-action" data-id="${product.id}" ${product.in_stock === false ? 'disabled' : ''}>Add to Cart</button>`;
  } else if (isDesign) {
    actionsHTML = `<button class="card-action" data-id="${product.id}" ${hasPrintSizes ? '' : 'disabled'}>Order Now</button>`;
  } else {
    actionsHTML = `<button class="card-action" data-id="${product.id}">Enquire</button>`;
  }

  card.innerHTML = `
    <div class="card-img">
      ${imgHTML}
      ${badgeHTML}
      ${renderWishlistHeart(product.id, category)}
    </div>
    <div class="card-body">
      ${domainHTML}
      <div class="card-name">${esc(product.name)}</div>
      ${priceHTML}
      ${sizeHTML}
      <div class="card-actions">${actionsHTML}</div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (!e.target.classList.contains('card-action') &&
        !e.target.classList.contains('configure-btn') &&
        !e.target.closest('.qty-stepper') &&
        !e.target.closest('.wishlist-heart-btn')) {
      open();
    }
  });

  // Every "add" button opens the modal: apparel needs a size chosen, graphic
  // designs need a print size chosen, web development is an enquiry.
  card.querySelector('.card-action')?.addEventListener('click', (e) => {
    e.stopPropagation();
    open();
  });

  card.querySelector('.configure-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = `configurator.html?product=${product.id}`;
  });

  return card;
}
