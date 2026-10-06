/* ================================
   JAIFORE — THEME (light / dark / auto)
   frontend/scripts/theme.js

   Load in <head>, right after tokens.css, WITHOUT defer so the theme is set
   before first paint (no flash). The choice is stored in localStorage
   ('jaifore_theme': light | dark | auto, default light). "auto" follows the
   OS and is resolved here, so CSS only ever sees data-theme="light|dark".
   The toggle button is injected next to #nav-actions (or floats on pages
   without a nav, like login).
   ================================ */
(function () {
  const KEY = 'jaifore_theme';
  const ORDER = ['light', 'dark', 'auto'];
  const LABEL = { light: 'Light', dark: 'Dark', auto: 'Auto' };
  const ICON = {
    light: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    auto:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>'
  };
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function read() {
    try { const v = localStorage.getItem(KEY); return ORDER.includes(v) ? v : 'light'; }
    catch { return 'light'; }
  }

  function apply(pref) {
    const dark = pref === 'dark' || (pref === 'auto' && mq && mq.matches);
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-pref', pref);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0f0d1a' : '#4a2d7a');
  }

  function paint(btn, pref) {
    btn.innerHTML = ICON[pref];
    btn.setAttribute('aria-label', `Theme: ${LABEL[pref]}. Click to change.`);
    btn.title = `Theme: ${LABEL[pref]}`;
  }

  function mount() {
    if (document.querySelector('.theme-toggle')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    paint(btn, read());
    btn.addEventListener('click', () => {
      const next = ORDER[(ORDER.indexOf(read()) + 1) % ORDER.length];
      try { localStorage.setItem(KEY, next); } catch {}
      apply(next);
      paint(btn, next);
    });
    const actions = document.getElementById('nav-actions');
    if (actions && actions.parentNode) actions.parentNode.insertBefore(btn, actions);
    else { btn.classList.add('theme-toggle--float'); document.body.appendChild(btn); }
  }

  apply(read());
  if (mq) mq.addEventListener('change', () => { if (read() === 'auto') apply('auto'); });
  document.addEventListener('DOMContentLoaded', mount);
})();
