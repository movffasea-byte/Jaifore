/* ================================
   JAIFORE — BUILD THE BOSSY BOT MASCOT IMAGES
   frontend/tools/make-bossy.js

   Writes four files to images/bossy/:
     bossy-head.webp / .png   160x160 round badge for the corner launcher (transparent corners)
     bossy-full.webp / .png   full body, 400px tall, for the chat panel header and greeting

   The full-body source has its black background baked in, so show it on a dark
   surface. If a transparent version is supplied later, pass it as FULL and the
   copies will keep their alpha.

   Run from frontend/ (paths are arguments, nothing is read from the repo):
     node tools/make-bossy.js <badge.webp> <full-body.webp>
   ================================ */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'images', 'bossy');
const [BADGE, FULL] = process.argv.slice(2);
// Full-body crop of the 1536px source: trims the empty black margins (source px).
const FULL_CROP = { left: 280, top: 0, width: 800, height: 1440 };

async function main() {
  if (!BADGE || !FULL || !fs.existsSync(BADGE) || !fs.existsSync(FULL)) {
    console.error('Usage: node tools/make-bossy.js <badge.webp> <full-body.webp>');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const head = sharp(BADGE).resize(160, 160);
  await head.clone().webp({ quality: 82 }).toFile(path.join(OUT, 'bossy-head.webp'));
  await head.clone().png({ compressionLevel: 9, palette: true }).toFile(path.join(OUT, 'bossy-head.png'));

  const full = sharp(FULL).extract(FULL_CROP).resize({ height: 400 });
  await full.clone().webp({ quality: 80 }).toFile(path.join(OUT, 'bossy-full.webp'));
  await full.clone().png({ palette: true }).toFile(path.join(OUT, 'bossy-full.png'));

  for (const f of fs.readdirSync(OUT).sort()) {
    console.log(f.padEnd(18), (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1) + ' KB');
  }
}

main();
