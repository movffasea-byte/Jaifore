/* ================================
   JAIFORE MOBILE — build the web bundle
   mobile/scripts/build-web.js

   Copies the static site (../frontend) into mobile/www, which is what
   Capacitor packages into the app. Run from mobile/:  npm run build:web

   Left out of the app: the admin panel (customers shouldn't ship it) and
   the service worker (the app bundles its own files — see scripts/pwa.js).
   ================================ */
const fs   = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, '..', '..', 'frontend');
const DEST = path.join(__dirname, '..', 'www');

const SKIP = new Set(['admin', 'sw.js']);

if (!fs.existsSync(SRC)) {
  console.error(`Cannot find the site at ${SRC}`);
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, {
  recursive: true,
  filter: (src) => !SKIP.has(path.relative(SRC, src)) && !src.endsWith('.map'),
});

const count = fs.readdirSync(DEST, { recursive: true }).length;
console.log(`Copied ${count} entries from frontend/ to mobile/www/`);
