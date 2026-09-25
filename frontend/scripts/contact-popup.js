/* ================================
   JAIFORE — CONTACT POPUP
   scripts/contact-popup.js

   New file. openContactPopup() was already being called from several
   places across the site (webdev product modal, per-service enquire
   buttons, the shared "Need ongoing support" button) but the function
   itself never existed anywhere in the codebase — every one of those
   calls has always silently failed. This is the first real
   implementation: injects its own modal markup on load (no HTML changes
   needed on any page), shows email, phone/WhatsApp, and Facebook.
   ================================ */

(function () {
  // Real contact details — update here if any of these ever change.
  const CONTACT = {
    email: 'jaifore@outlook.com',
    // US number, stored in international format (no +, no leading 0)
    // for wa.me; the same number is reused for the tel: link with a
    // leading + added.
    phoneIntl: '18062316569',
    facebookUrl: 'https://www.facebook.com/share/1FjZ6rmotV/?mibexid=wwXlfr'
  };

  let overlay, modal;

  function buildPopup() {
    overlay = document.createElement('div');
    overlay.className = 'contact-popup-overlay';
    overlay.id = 'contactPopupOverlay';

    modal = document.createElement('div');
    modal.className = 'contact-popup-modal';
    modal.id = 'contactPopupModal';

    modal.innerHTML = `
      <button type="button" class="contact-popup-close" id="contactPopupClose" aria-label="Close">✕</button>
      <div class="contact-popup-title">Get in Touch</div>
      <div class="contact-popup-sub">Reach us directly — we usually reply within a day.</div>
      <div class="contact-popup-links">
        <a class="contact-popup-link" href="mailto:${CONTACT.email}">
          <span class="contact-popup-link-icon">✉</span>
          <span class="contact-popup-link-text">
            <span class="contact-popup-link-label">Email</span>
            <span class="contact-popup-link-value">${CONTACT.email}</span>
          </span>
        </a>
        <a class="contact-popup-link" href="https://wa.me/${CONTACT.phoneIntl}" target="_blank" rel="noopener">
          <span class="contact-popup-link-icon">💬</span>
          <span class="contact-popup-link-text">
            <span class="contact-popup-link-label">WhatsApp</span>
            <span class="contact-popup-link-value">+${CONTACT.phoneIntl}</span>
          </span>
        </a>
        <a class="contact-popup-link" href="tel:+${CONTACT.phoneIntl}">
          <span class="contact-popup-link-icon">📞</span>
          <span class="contact-popup-link-text">
            <span class="contact-popup-link-label">Call</span>
            <span class="contact-popup-link-value">+${CONTACT.phoneIntl}</span>
          </span>
        </a>
        <a class="contact-popup-link" href="${CONTACT.facebookUrl}" target="_blank" rel="noopener">
          <span class="contact-popup-link-icon">📘</span>
          <span class="contact-popup-link-text">
            <span class="contact-popup-link-label">Facebook</span>
            <span class="contact-popup-link-value">Message us</span>
          </span>
        </a>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    document.getElementById('contactPopupClose').addEventListener('click', closeContactPopup);
    overlay.addEventListener('click', closeContactPopup);
  }

  window.openContactPopup = function () {
    if (!overlay) buildPopup();
    overlay.classList.add('open');
    modal.classList.add('open');
  };

  window.closeContactPopup = function () {
    if (!overlay) return;
    overlay.classList.remove('open');
    modal.classList.remove('open');
  };

  function closeContactPopup() {
    window.closeContactPopup();
  }
})()