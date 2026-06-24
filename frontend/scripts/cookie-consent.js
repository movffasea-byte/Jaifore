/* ================================
   JAIFORE — COOKIE CONSENT BANNER
   scripts/cookie-consent.js
   ================================ */

(function () {
  // Don't show if already accepted or declined
  if (localStorage.getItem('jaifore_cookie_consent')) return;

  const banner = document.createElement('div');
  banner.id = 'cookieBanner';
  banner.style.cssText = `
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: #1a1a2e;
    color: #f5f0e8;
    padding: 1.2rem 2rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    flex-wrap: wrap;
    z-index: 99999;
    box-shadow: 0 -4px 24px rgba(0,0,0,0.3);
    font-family: 'Karla', sans-serif;
    font-size: 0.85rem;
    line-height: 1.6;
    transform: translateY(100%);
    transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  `;

  banner.innerHTML = `
    <div style="flex:1;min-width:240px;">
      🍪 We use essential cookies and localStorage to keep you logged in and maintain your cart.
      We do not use advertising or tracking cookies.
      <a href="privacy-policy.html" style="color:#c4a8f0;text-decoration:underline;margin-left:4px;">Learn more</a>
    </div>
    <div style="display:flex;gap:0.6rem;flex-shrink:0;">
      <button id="cookieDecline" style="
        background: transparent;
        border: 1px solid rgba(255,255,255,0.3);
        color: #f5f0e8;
        padding: 0.5rem 1.2rem;
        border-radius: 8px;
        font-family: 'Karla', sans-serif;
        font-size: 0.82rem;
        cursor: pointer;
        transition: all 0.2s;
      ">Decline</button>
      <button id="cookieAccept" style="
        background: #7b5ea7;
        border: none;
        color: #fff;
        padding: 0.5rem 1.4rem;
        border-radius: 8px;
        font-family: 'Karla', sans-serif;
        font-size: 0.82rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
      ">Accept</button>
    </div>
  `;

  document.body.appendChild(banner);

  // Slide in after a short delay
  setTimeout(() => {
    banner.style.transform = 'translateY(0)';
  }, 800);

  function dismiss(choice) {
    localStorage.setItem('jaifore_cookie_consent', choice);
    banner.style.transform = 'translateY(100%)';
    setTimeout(() => banner.remove(), 400);
  }

  document.getElementById('cookieAccept').addEventListener('click', () => dismiss('accepted'));
  document.getElementById('cookieDecline').addEventListener('click', () => dismiss('declined'));
})();