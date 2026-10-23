/* ================================
   JAIFORE — IMAGE URL HELPER
   frontend/scripts/img.js

   Product images live in the database as the full-size print master
   ("images/012.png"). The browser should almost never download those. This maps
   an original URL to its small copy made by tools/optimize-images.js:

     jfThumb(url)  ->  images/thumb/012.webp   (grids, pickers, cart rows)
     jfWeb(url)    ->  images/web/012.webp     (modals, detail, canvas)

   Only DISPLAY urls are mapped. What gets stored — cart lines, wishlist rows,
   a design's `src` — must stay the original string: the server prices a
   catalog design by matching `src` against products.image_url exactly.

   URLs that are not a top-level site image (uploads, data: URLs, other hosts,
   already-mapped copies) pass through unchanged. If a mapped copy is missing,
   the page falls back to the original automatically.

   Load this BEFORE the scripts that call jfThumb / jfWeb.
   ================================ */
(function () {
  const SITE_HOSTS = ['jai-fore.vercel.app'];
  const ORIGINAL = /^((?:https?:\/\/[^/]+)?\/?(?:\.\/)?)images\/([^/?#]+)\.(jpe?g|png|webp)(\?[^#]*)?$/i;
  const MAPPED = /\/images\/(?:thumb|web)\/([^/?#]+)\.webp(?:\?[^#]*)?$/i;
  const FALLBACK_EXTS = ['jpg', 'png', 'jpeg', 'webp'];

  function isSiteUrl(prefix) {
    if (!/^https?:/i.test(prefix)) return true; // relative to this site
    try {
      const host = new URL(prefix).host;
      return SITE_HOSTS.includes(host) || host === window.location.host;
    } catch { return false; }
  }

  function mapTo(url, folder) {
    if (typeof url !== 'string') return url;
    const m = ORIGINAL.exec(url.trim());
    if (!m || !isSiteUrl(m[1])) return url;
    return `${m[1]}images/${folder}/${m[2]}.webp`;
  }

  window.jfThumb = url => mapTo(url, 'thumb');
  window.jfWeb   = url => mapTo(url, 'web');

  // A mapped copy that fails to load is retried as the original, whichever
  // extension the master has (the copies are all .webp, the masters are not).
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.dataset.jfStem) {
      const m = MAPPED.exec(img.getAttribute('src') || '');
      if (!m) return;
      img.dataset.jfStem = m[1];
      img.dataset.jfBase = img.src.replace(/\/images\/(?:thumb|web)\/.*$/i, '/images/');
    }
    const tried = Number(img.dataset.jfTry || 0);
    if (tried >= FALLBACK_EXTS.length) return;
    img.dataset.jfTry = String(tried + 1);
    img.src = `${img.dataset.jfBase}${img.dataset.jfStem}.${FALLBACK_EXTS[tried]}`;
  }, true);
})();
