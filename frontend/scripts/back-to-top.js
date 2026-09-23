/* ================================
   JAIFORE — BACK TO TOP BUTTON
   scripts/back-to-top.js

   Shared by services.html and category.html. Injects its own button
   markup on load (so neither page needs HTML changes — just this script
   tag), shows it once the page has been scrolled down a bit, and scrolls
   smoothly to the top on click.
   ================================ */

(function () {
  const SHOW_AFTER_PX = 400; // how far down before the button appears

  const btn = document.createElement('button');
  btn.id = 'backToTopBtn';
  btn.className = 'back-to-top-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7"/>
    </svg>
  `;
  document.body.appendChild(btn);

  function toggleVisibility() {
    if (window.scrollY > SHOW_AFTER_PX) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }

  // Passive listener — this only reads scroll position, never blocks it
  window.addEventListener('scroll', toggleVisibility, { passive: true });
  toggleVisibility(); // in case the page loads already scrolled (e.g. anchor link)

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();