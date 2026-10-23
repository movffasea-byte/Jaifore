/* ================================
   JAIFORE PWA — shared registration
   frontend/scripts/pwa.js

   Loaded by every page. Registers the service worker (web only — the
   Capacitor app bundles its files instead) and shows a small banner when
   the device goes offline, so a dead connection never looks like a blank page.
   ================================ */
(function () {
  const isNativeApp = !!window.Capacitor?.isNativePlatform?.();
  const canRegister = 'serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost') && !isNativeApp;

  if (canRegister) {
    // sw.js lives at the site root so its scope covers every page (incl. /admin/)
    const swUrl = new URL('../sw.js', document.currentScript.src).href;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(swUrl).catch(() => { /* PWA is optional — ignore */ });
    });
  }

  let banner = null;
  function setOffline(offline) {
    if (offline && !banner) {
      banner = document.createElement('div');
      banner.setAttribute('role', 'status');
      banner.textContent = "You're offline — some things may not load.";
      banner.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:0.6rem 1rem;' +
        'background:#111;color:#fff;font:600 0.85rem system-ui,sans-serif;text-align:center;';
      document.body.appendChild(banner);
    } else if (!offline && banner) {
      banner.remove();
      banner = null;
    }
  }
  window.addEventListener('offline', () => setOffline(true));
  window.addEventListener('online',  () => setOffline(false));
  if (!navigator.onLine) document.addEventListener('DOMContentLoaded', () => setOffline(true));
})();
