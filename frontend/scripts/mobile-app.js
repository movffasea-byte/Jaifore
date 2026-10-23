/* ================================
   JAIFORE — MOBILE APP LAYER
   frontend/scripts/mobile-app.js

   Two things, injected by JS so no page repeats the markup:
   1. A bottom tab bar on phones (Home, Shop, Wishlist, Cart, Account).
   2. A cart drawer — a bottom sheet on phones, a right-hand panel on
      desktop — opened from the nav cart button or the Cart tab.

   The drawer uses data/cart.js (cart, updateCartQty, removeFromCart,
   cartLineSignature, goToCheckout), so server sync is unchanged. Load this
   AFTER data/cart.js. On pages without cart.js (Home, Dashboard) the tab bar
   still works; the Cart tab simply goes to checkout.
   Swipe a drawer line left to remove it.
   ================================ */
(function () {
  const hasCart = typeof updateCartQty === 'function' && typeof removeFromCart === 'function';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (typeof formatPrice === 'function' ? formatPrice(n) : `$${Number(n).toFixed(2)}`);
  const isImage = (src) => typeof src === 'string' && /^(https?:|data:image|blob:|\/|[\w.-]+\/)/.test(src);

  function cartCount() {
    if (hasCart) return cart.reduce((n, i) => n + (Number(i.qty) || 0), 0);
    try {
      return JSON.parse(localStorage.getItem('jaifore_cart') || '[]')
        .reduce((n, i) => n + (Number(i.qty) || 0), 0);
    } catch { return 0; }
  }

  function lineMeta(item) {
    const parts = [];
    if (item.size) parts.push(`Size: ${item.size}`);
    if (item.gender) parts.push(item.gender.charAt(0).toUpperCase() + item.gender.slice(1));
    const perDesign = item.designs?.some(d => d?.printSize);
    const label = item.printSize?.size_label ?? item.printSize?.id ?? null;
    if (label && !perDesign) parts.push(`Print: ${label}`);
    if (item.designs?.length) parts.push(`${item.designs.length} design${item.designs.length > 1 ? 's' : ''}`);
    return parts.join(' · ');
  }

  function goCheckout() {
    if (typeof goToCheckout === 'function') goToCheckout();
    else window.location.href = 'checkout.html';
  }

  // ── Cart drawer ───────────────────────────────────────────
  let drawer, backdrop, lastFocus;

  function buildDrawer() {
    backdrop = document.createElement('div');
    backdrop.className = 'cd-backdrop';
    backdrop.addEventListener('click', closeDrawer);

    drawer = document.createElement('aside');
    drawer.className = 'cd-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'Your cart');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = `
      <div class="cd-grip" aria-hidden="true"></div>
      <header class="cd-head">
        <h2 class="cd-title">Your cart</h2>
        <button class="cd-close" type="button" aria-label="Close cart">&times;</button>
      </header>
      <div class="cd-body"></div>
      <footer class="cd-foot"></footer>`;

    drawer.querySelector('.cd-close').addEventListener('click', closeDrawer);
    drawer.addEventListener('click', onDrawerClick);
    drawer.addEventListener('keydown', trapFocus);
    attachSwipe(drawer.querySelector('.cd-body'));

    document.body.append(backdrop, drawer);
  }

  function renderDrawer() {
    if (!drawer) return;
    const body = drawer.querySelector('.cd-body');
    const foot = drawer.querySelector('.cd-foot');

    if (!cart.length) {
      body.innerHTML = `<div class="cd-empty">Your cart is empty.<a href="services.html">Browse the shop →</a></div>`;
      foot.innerHTML = '';
      return;
    }

    body.innerHTML = cart.map((item, i) => `
      <div class="cd-line" data-index="${i}">
        <div class="cd-remove-hint" aria-hidden="true">Remove</div>
        <div class="cd-line-inner">
          <div class="cd-img">${isImage(item.snapshot) ? `<img src="${esc(item.snapshot)}" alt="" loading="lazy"/>` : '🛍'}</div>
          <div class="cd-info">
            <div class="cd-name">${esc(item.name)}</div>
            <div class="cd-meta">${esc(lineMeta(item))}</div>
            <div class="cd-qty">
              <button type="button" data-act="dec" aria-label="Decrease quantity">−</button>
              <span>${item.qty}</span>
              <button type="button" data-act="inc" aria-label="Increase quantity">+</button>
              <button type="button" class="cd-rm" data-act="rm">Remove</button>
            </div>
          </div>
          <div class="cd-price">${money((Number(item.price) || 0) * item.qty)}</div>
        </div>
      </div>`).join('');

    const subtotal = cart.reduce((s, i) => s + (Number(i.price) || 0) * i.qty, 0);
    foot.innerHTML = `
      <div class="cd-sub"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
      <p class="cd-note">Shipping and final prices are confirmed at checkout.</p>
      <button type="button" class="cd-checkout" data-act="checkout">Checkout</button>`;
  }

  function onDrawerClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'checkout') { goCheckout(); return; }

    const row = btn.closest('.cd-line');
    const item = row && cart[Number(row.dataset.index)];
    if (!item) return;
    const sig = cartLineSignature(item);

    if (btn.dataset.act === 'inc') updateCartQty(item.id, item.size, item.qty + 1, sig);
    else if (btn.dataset.act === 'dec' && item.qty > 1) updateCartQty(item.id, item.size, item.qty - 1, sig);
    else if (btn.dataset.act === 'rm' || btn.dataset.act === 'dec') removeFromCart(item.id, item.size, sig);
    renderDrawer();
  }

  // Swipe a line left past 80px to remove it
  function attachSwipe(body) {
    let row = null, inner = null, startX = 0, startY = 0, dx = 0, locked = null;

    body.addEventListener('touchstart', (e) => {
      row = e.target.closest('.cd-line');
      if (!row) return;
      inner = row.querySelector('.cd-line-inner');
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      dx = 0; locked = null;
      inner.style.transition = 'none';
    }, { passive: true });

    body.addEventListener('touchmove', (e) => {
      if (!row) return;
      const mx = e.touches[0].clientX - startX;
      const my = e.touches[0].clientY - startY;
      if (locked === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (locked !== 'x') return;
      dx = Math.min(0, mx);
      inner.style.transform = `translateX(${dx}px)`;
    }, { passive: true });

    body.addEventListener('touchend', () => {
      if (!row) return;
      inner.style.transition = '';
      const item = cart[Number(row.dataset.index)];
      if (locked === 'x' && dx < -80 && item) {
        removeFromCart(item.id, item.size, cartLineSignature(item));
        renderDrawer();
      } else {
        inner.style.transform = '';
      }
      row = inner = null;
    });
  }

  function trapFocus(e) {
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    const f = [...drawer.querySelectorAll('a[href], button:not([disabled])')];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function openDrawer() {
    if (!hasCart) { goCheckout(); return; }
    if (!drawer) buildDrawer();
    lastFocus = document.activeElement;
    renderDrawer();
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('open');
    drawer.classList.add('open');
    document.body.classList.add('cd-lock');
    drawer.querySelector('.cd-close').focus();
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('cd-lock');
    lastFocus?.focus?.();
  }

  // ── Tab bar ───────────────────────────────────────────────
  const tabs = [
    { key: 'home',     label: 'Home',     href: 'index.html',    match: /(^|\/)(index\.html)?$/,
      icon: '<path d="M3 11l9-8 9 8v10a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1z"/>' },
    { key: 'shop',     label: 'Shop',     href: 'services.html', match: /services|category/,
      icon: '<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>' },
    { key: 'wishlist', label: 'Wishlist', href: 'wishlist.html', match: /wishlist/,
      icon: '<path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 000-7.8z"/>' },
    { key: 'cart',     label: 'Cart',     href: 'checkout.html', match: /checkout/, cart: true,
      icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 002 1.6h9.7a2 2 0 002-1.6L23 6H6"/>' },
    { key: 'account',  label: 'Account',  href: 'dashboard.html', match: /dashboard|loginsys/,
      icon: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
  ];

  function buildTabbar() {
    const path = location.pathname;
    const signedIn = !!localStorage.getItem('jaifore_token');
    const bar = document.createElement('nav');
    bar.className = 'tabbar';
    bar.setAttribute('aria-label', 'Main');

    bar.innerHTML = tabs.map(t => {
      const href = t.key === 'account' && !signedIn ? 'loginsys.html' : t.href;
      const active = t.match.test(path) ? ' aria-current="page"' : '';
      const badge = t.cart ? `<span class="tab-badge" id="tab-cart-count" hidden>0</span>` : '';
      return `<a class="tab" href="${href}" data-tab="${t.key}"${active}>
        <span class="tab-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.icon}</svg>${badge}</span>
        <span class="tab-label">${t.label}</span></a>`;
    }).join('');

    // Cart tab opens the drawer (except on checkout, which is the cart page)
    bar.querySelector('[data-tab="cart"]').addEventListener('click', (e) => {
      if (/checkout/.test(path)) return;
      e.preventDefault();
      openDrawer();
    });

    document.body.appendChild(bar);
    document.body.classList.add('has-tabbar');
    refreshBadge();
  }

  function refreshBadge() {
    const el = document.getElementById('tab-cart-count');
    if (!el) return;
    const n = cartCount();
    el.textContent = n > 99 ? '99+' : n;
    el.hidden = n === 0;
  }

  // ── Wire up ───────────────────────────────────────────────
  // Keep the badge and open drawer in step with every cart change
  if (hasCart && typeof updateCartCount === 'function') {
    const original = window.updateCartCount;
    window.updateCartCount = function () {
      original.apply(this, arguments);
      refreshBadge();
      if (drawer?.classList.contains('open')) renderDrawer();
    };
  }
  window.addEventListener('storage', refreshBadge);

  document.addEventListener('DOMContentLoaded', () => {
    // The configurator has its own bottom sheet, so no tab bar there
    if (!/configurator/.test(location.pathname)) buildTabbar();

    // Nav cart button → drawer (capture phase, so it wins over cart.js's
    // go-to-checkout listener). Checkout itself keeps the old behaviour.
    if (hasCart && !/checkout/.test(location.pathname)) {
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#cart-btn')) return;
        e.preventDefault();
        e.stopPropagation();
        openDrawer();
      }, true);
    }
  });
})();
