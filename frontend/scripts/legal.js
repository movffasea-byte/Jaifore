/* ================================
   JAIFORE MEDIA — LEGAL PAGES JS
   scripts/legal.js
   ================================ */

// Highlight the current page's link in the footer legal links
document.addEventListener('DOMContentLoaded', () => {
  // Pages are served without .html (cleanUrls), links still carry it.
  const bare = s => (s || '').replace(/\.html$/, '');
  const current = bare(window.location.pathname.split('/').pop());
  document.querySelectorAll('.footer-legal a').forEach(link => {
    if (bare(link.getAttribute('href')) === current) {
      link.style.color = '#8932bb';
      link.style.fontWeight = '700';
    }
  });
});