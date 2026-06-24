/* ================================
   JAIFORE MEDIA — LEGAL PAGES JS
   scripts/legal.js
   ================================ */

// Highlight the current page's link in the footer legal links
document.addEventListener('DOMContentLoaded', () => {
  const current = window.location.pathname.split('/').pop();
  document.querySelectorAll('.footer-legal a').forEach(link => {
    if (link.getAttribute('href') === current) {
      link.style.color = '#7b5ea7';
      link.style.fontWeight = '700';
    }
  });
});