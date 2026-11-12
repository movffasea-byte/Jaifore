/* ================================
   JAIFORE — BUILD THE LOGO FILES
   frontend/tools/make-logo.js

   Reads logo/rooted3.png (transparent background, not deployed) and writes:
     logo/jaifore-96.webp      40px nav / footer logo
     logo/jaifore-480.webp     hero / offline / login logo
     icons/*.png, logo/favicon-32.png   app and tab icons
     logo/admin-192.webp, logo/admin-512.webp   admin logo on a dark square

   Run from frontend/:  npm run logo
   ================================ */
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'logo', 'rooted3.png');

async function main() {
  const trimmed = await sharp(SRC).trim().toBuffer();   // crop to the artwork

  const square = (size, pad, bgColour) => sharp(trimmed)
    .resize({ width: Math.round(size * (1 - pad * 2)), height: Math.round(size * (1 - pad * 2)), fit: 'inside' })
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => sharp({ create: { width: size, height: size, channels: 4, background: bgColour } })
      .composite([{ input: data, left: Math.round((size - info.width) / 2), top: Math.round((size - info.height) / 2) }]));

  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  const dark = { r: 11, g: 7, b: 16, alpha: 1 };           // --bg in dark mode
  for (const width of [96, 480]) {
    await (await square(width, 0.02, clear)).webp({ quality: 88, alphaQuality: 90 })
      .toFile(path.join(ROOT, 'logo', `jaifore-${width}.webp`));
  }
  await (await square(32, 0.04, clear)).png().toFile(path.join(ROOT, 'logo', 'favicon-32.png'));
  await (await square(192, 0.08, dark)).png().toFile(path.join(ROOT, 'icons', 'icon-192.png'));
  await (await square(512, 0.08, dark)).png().toFile(path.join(ROOT, 'icons', 'icon-512.png'));
  await (await square(180, 0.08, dark)).png().toFile(path.join(ROOT, 'icons', 'apple-touch-icon.png'));
  await (await square(512, 0.20, dark)).png().toFile(path.join(ROOT, 'icons', 'icon-maskable-512.png'));  // safe zone
  for (const size of [192, 512]) {
    await (await square(size, 0.06, dark)).webp({ quality: 86 })
      .toFile(path.join(ROOT, 'logo', `admin-${size}.webp`));
  }
  console.log('logo files written');
}

main().catch(err => { console.error(err); process.exit(1); });
