/* ================================
   JAIFORE — BUILD THE LOGO FILES
   frontend/tools/make-logo.js

   Reads logo/jaifore-source.jpg (white background) and writes:
     logo/jaifore.png          transparent master (white keyed out)
     logo/jaifore-96.webp      40px nav / footer logo
     logo/jaifore-480.webp     hero / offline / login logo
     icons/*.png, logo/favicon-32.png   app and tab icons

   It also crops logo/jaifore-admin-source.jpg (black background, used by the
   admin only) to logo/admin-192.webp and logo/admin-512.webp.

   White is removed everywhere except inside the lettering box, where only
   white connected to the outside or the rope-loop holes goes, so the white
   cores of the neon letters stay.

   Run from frontend/:  npm run logo
   ================================ */
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'logo', 'jaifore-source.jpg');
const WHITE = 236;                       // min(r,g,b) at or above this counts as background
const HOLE_SEEDS = [[304, 521], [924, 543], [428, 601]];  // inside the two rope loops (source px)
const TEXT_BOX = { x0: 330, x1: 950, y0: 380, y1: 650 };  // neon lettering (source px)

async function keyOutWhite() {
  const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const rgba = Buffer.alloc(w * h * 4);
  const bg = new Uint8Array(w * h);
  const isWhite = i => Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) >= WHITE;

  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (!bg[i] && isWhite(i)) { bg[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  HOLE_SEEDS.forEach(([x, y]) => push(x, y));
  for (let i = 0; i < w * h; i++) {         // enclosed gaps (between roots, rope, anchor)
    const x = i % w, y = (i - x) / w;
    const inText = x >= TEXT_BOX.x0 && x <= TEXT_BOX.x1 && y >= TEXT_BOX.y0 && y <= TEXT_BOX.y1;
    if (!inText && isWhite(i)) { bg[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  for (let i = 0; i < w * h; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    let a = bg[i] ? 0 : 255;
    let nr = r, ng = g, nb = b;
    if (!bg[i]) {
      const x = i % w, y = (i - x) / w;
      let edge = false;
      for (let dy = -2; dy <= 2 && !edge; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && bg[ny * w + nx]) { edge = true; break; }
        }
      if (edge) {                         // soften the fringe and un-premultiply from white
        const m = Math.min(r, g, b);
        a = Math.max(0, Math.min(255, Math.round(((250 - m) / (250 - 150)) * 255)));
        if (a > 0) {
          const k = 255 / a;
          nr = Math.max(0, Math.min(255, Math.round(255 - (255 - r) * k)));
          ng = Math.max(0, Math.min(255, Math.round(255 - (255 - g) * k)));
          nb = Math.max(0, Math.min(255, Math.round(255 - (255 - b) * k)));
        }
      }
    }
    rgba[i * 4] = nr; rgba[i * 4 + 1] = ng; rgba[i * 4 + 2] = nb; rgba[i * 4 + 3] = a;
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } });
}

async function main() {
  const master = path.join(ROOT, 'logo', 'jaifore.png');
  await (await keyOutWhite()).png({ compressionLevel: 9 }).toFile(master);
  const trimmed = await sharp(master).trim().toBuffer();   // crop to the artwork

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
  const adminSrc = path.join(ROOT, 'logo', 'jaifore-admin-source.jpg');
  for (const size of [192, 512]) {
    await sharp(adminSrc).extract({ left: 110, top: 315, width: 860, height: 860 })
      .resize(size, size).webp({ quality: 86 }).toFile(path.join(ROOT, 'logo', `admin-${size}.webp`));
  }
  console.log('logo files written');
}

main().catch(err => { console.error(err); process.exit(1); });
