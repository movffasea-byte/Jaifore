/* ================================
   JAIFORE — ACCESSIBILITY HELPERS
   frontend/scripts/a11y.js

   Small, idempotent fixes shared by every page:
   1. "Skip to content" link + a focusable main target.
   2. Accessible names for icon-only buttons and OTP boxes.
   3. Dialog behaviour for the page modals (product, size guide, contact,
      order detail): role=dialog, focus moved in on open, Tab trapped, Esc
      closes, focus returned to the opener.
   Loaded with defer on every customer page.
   ================================ */
(function () {
  // ── 1. Skip link ───────────────────────────────────────────
  function addSkipLink() {
    if (document.querySelector('.skip-link')) return;
    const target = document.querySelector('main') || document.querySelector('header, section');
    if (!target) return;
    if (!target.id) target.id = 'main-content';
    target.setAttribute('tabindex', '-1');
    const a = document.createElement('a');
    a.className = 'skip-link';
    a.href = '#' + target.id;
    a.textContent = 'Skip to content';
    a.addEventListener('click', () => setTimeout(() => target.focus(), 0));
    document.body.insertBefore(a, document.body.firstChild);
  }

  // ── 2. Names for icon-only controls ────────────────────────
  const NAMES = {
    '#modal-close, #orderModalClose, #sizeGuideClose': 'Close',
    '#zoomOutBtn': 'Zoom out',
    '#zoomInBtn': 'Zoom in',
    '.cart-btn, #cart-btn': 'Open cart',
    '.cart-close, .cd-close': 'Close cart'
  };
  function nameControls() {
    Object.keys(NAMES).forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', NAMES[sel]);
      });
    });
    document.querySelectorAll('.otp-box').forEach((el, i) => {
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', `Digit ${i % 4 + 1}`);
    });
    // <label> with no "for": link it to the input in the same group
    document.querySelectorAll('label:not([for])').forEach(label => {
      const input = label.parentElement && label.parentElement.querySelector('input, select, textarea');
      if (input && input.id && !label.querySelector('input')) label.setAttribute('for', input.id);
    });
    document.querySelectorAll('img:not([alt])').forEach(img => img.setAttribute('alt', ''));
  }

  // ── 3. Dialogs ─────────────────────────────────────────────
  const DIALOGS = [
    { sel: '.product-modal',       close: '.modal-close' },
    { sel: '.size-guide-modal',    close: '.size-guide-close' },
    { sel: '.contact-popup-modal', close: '.contact-popup-close' },
    { sel: '#orderModal',          close: '.order-modal-close', box: '.order-modal-box' }
  ];
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const opener = new WeakMap();

  const isOpen = (el) => el.classList.contains('open') ||
    (el.id === 'orderModal' && !el.classList.contains('hidden'));
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  function setupDialog(d) {
    document.querySelectorAll(d.sel).forEach(el => {
      const box = (d.box && el.querySelector(d.box)) || el;
      if (!box.hasAttribute('role')) box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      if (!box.hasAttribute('aria-label') && !box.hasAttribute('aria-labelledby')) {
        const h = box.querySelector('h1, h2, h3');
        if (h) { h.id = h.id || el.id + '-title'; box.setAttribute('aria-labelledby', h.id); }
        else box.setAttribute('aria-label', 'Dialog');
      }
      let wasOpen = isOpen(el);
      new MutationObserver(() => {
        const now = isOpen(el);
        if (now === wasOpen) return;
        wasOpen = now;
        if (now) {
          opener.set(el, document.activeElement);
          setTimeout(() => {
            const f = [...box.querySelectorAll(FOCUSABLE)].filter(visible);
            (f.find(x => !x.matches(d.close)) || f[0] || box).focus?.();
          }, 50);
        } else {
          const back = opener.get(el);
          if (back && document.contains(back)) back.focus();
        }
      }).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
  }

  document.addEventListener('keydown', (e) => {
    const d = DIALOGS.find(x => [...document.querySelectorAll(x.sel)].some(isOpen));
    if (!d) return;
    const el = [...document.querySelectorAll(d.sel)].find(isOpen);
    if (e.key === 'Escape') {
      const btn = el.querySelector(d.close);
      if (btn) { e.preventDefault(); btn.click(); }
      return;
    }
    if (e.key !== 'Tab') return;
    const box = (d.box && el.querySelector(d.box)) || el;
    const f = [...box.querySelectorAll(FOCUSABLE)].filter(visible);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function init() {
    addSkipLink();
    nameControls();
    DIALOGS.forEach(setupDialog);
    // Modals created later by other scripts (contact popup, size guide)
    new MutationObserver((muts, obs) => {
      if (muts.some(m => m.addedNodes.length)) { nameControls(); DIALOGS.forEach(setupDialog); }
    }).observe(document.body, { childList: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
