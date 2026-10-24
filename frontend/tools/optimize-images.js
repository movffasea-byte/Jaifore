/* ================================
   JAIFORE — OPTIMISE WEBSITE IMAGES
   frontend/tools/optimize-images.js

   For every image directly inside frontend/images/ this writes two WebP copies:
     images/web/<name>.webp    max 1600px, quality 80  (modals, detail, canvas)
     images/thumb/<name>.webp  max  400px, quality 75  (grids, pickers)

   The originals are print masters: they are only ever READ here, never
   modified, moved or deleted. Transparency is kept (WebP has alpha).
   Re-runnable: a copy that is newer than its original is skipped.

   Run from frontend/:  npm install && npm run images
   ================================ */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.join(__dirname, '..', 'images');
const SIZES = [
  { dir: 'web',   max: 1600, quality: 80 },
  { dir: 'thumb', max: 400,  quality: 75 },
];
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const mb = bytes => (bytes / 1e6).toFixed(1);

async function main() {
  const files = fs.readdirSync(IMAGES_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map(e => e.name)
    .sort();

  const stems = new Set();
  for (const name of files) {
    const stem = path.parse(name).name;
    if (stems.has(stem)) throw new Error(`Two originals share the name "${stem}" — rename one first.`);
    stems.add(stem);
  }

  for (const { dir } of SIZES) fs.mkdirSync(path.join(IMAGES_DIR, dir), { recursive: true });

  const totals = { original: 0, web: 0, thumb: 0 };
  let made = 0, skipped = 0, failed = 0;

  for (const name of files) {
    const src = path.join(IMAGES_DIR, name);
    const srcStat = fs.statSync(src);
    const stem = path.parse(name).name;
    totals.original += srcStat.size;

    for (const { dir, max, quality } of SIZES) {
      const out = path.join(IMAGES_DIR, dir, `${stem}.webp`);
      if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= srcStat.mtimeMs) {
        totals[dir] += fs.statSync(out).size;
        skipped++;
        continue;
      }
      try {
        await sharp(src, { limitInputPixels: false })
          .rotate()
          .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
          .webp({ quality })
          .toFile(out);
        totals[dir] += fs.statSync(out).size;
        made++;
      } catch (err) {
        failed++;
        console.error(`FAILED ${dir}/${stem}.webp:`, err.message);
      }
    }
  }

  console.log(`${files.length} originals — made ${made}, skipped ${skipped}, failed ${failed}`);
  console.log(`originals ${mb(totals.original)} MB | web/ ${mb(totals.web)} MB | thumb/ ${mb(totals.thumb)} MB`);
  if (failed) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exit(1); });
