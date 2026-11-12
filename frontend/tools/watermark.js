/* ================================
   JAIFORE — WATERMARK READY-MADE PHOTOS
   tools/watermark.js

   Usage: node tools/watermark.js <input.jpg> <output.jpg> [opacity]

   Lays the Jai'fore logo (logo/rooted3.png) faintly over the photo with a
   multiply blend: it shows on the light background and vanishes on the
   black shirt, so the print itself stays clean. Then run `npm run images`
   for the web/ and thumb/ copies.
   ================================ */
const path  = require('path');
const sharp = require('sharp');

const LOGO = path.join(__dirname, '..', 'logo', 'rooted3.png');

async function watermark(input, output, opacity = 0.12) {
  const { width, height } = await sharp(input).metadata();
  const size = Math.round(Math.min(width, height) * 0.8);

  // Logo flattened onto white, then pulled towards white so only a faint
  // tint is left: px' = 255 - opacity * (255 - px). White stays neutral
  // under multiply, and the near-black shirt barely changes.
  const faded = await sharp(LOGO)
    .resize(size, size, { fit: 'inside' })
    .flatten({ background: '#ffffff' })
    .linear(opacity, 255 * (1 - opacity))
    .png()
    .toBuffer();
  const layer = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([{ input: faded, gravity: 'center' }])
    .raw()
    .toBuffer();

  // Multiply only on the background: light pixels joined to the photo's
  // edge (flood fill), so light parts of the print itself stay untouched.
  const LIGHT = 200;
  const { data } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const light = p => data[p * 3] > LIGHT && data[p * 3 + 1] > LIGHT && data[p * 3 + 2] > LIGHT;
  const bg = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const p = stack.pop();
    if (bg[p] || !light(p)) continue;
    bg[p] = 1;
    const x = p % width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (p >= width) stack.push(p - width);
    if (p < width * (height - 1)) stack.push(p + width);
  }
  for (let p = 0; p < bg.length; p++) {
    if (!bg[p]) continue;
    for (let c = 0; c < 3; c++) data[p * 3 + c] = Math.round(data[p * 3 + c] * layer[p * 3 + c] / 255);
  }

  await sharp(data, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(output);
}

if (require.main === module) {
  const [input, output, opacity] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: node tools/watermark.js <input.jpg> <output.jpg> [opacity]');
    process.exit(1);
  }
  watermark(input, output, opacity ? Number(opacity) : undefined)
    .then(() => console.log(`watermarked ${output}`))
    .catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { watermark };
