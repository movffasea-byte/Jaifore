/* ================================
   JAIFORE — BUILD THE BOSSY BOT MASCOT IMAGES
   frontend/tools/make-bossy.js

   Reads images/bossy/peace-bossy-bot.png (transparent full-body master, not deployed) and
   writes four files to images/bossy/:
     bossy-head.webp / .png   160x160 head badge on black for the corner launcher
                              (the CSS rounds it)
     bossy-full.webp / .png   full body, 400px tall, transparent, for the chat
                              panel header and greeting. Its width must match the
                              width given to picture('bossy-full', ...) in
                              scripts/bossy-bot.js (printed below).

   Run from frontend/:  node tools/make-bossy.js
   ================================ */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'images', 'bossy');
const SRC = path.join(OUT, 'peace-bossy-bot.png');
// Square around the head and crown in the 1122x1402 master (source px).
const HEAD_CROP = { left: 120, top: 10, width: 880, height: 880 };

async function main() {
  const badge = await sharp(SRC).extract(HEAD_CROP).resize(160, 160).toBuffer();
  const head = sharp({ create: { width: 160, height: 160, channels: 4, background: '#000' } })
    .composite([{ input: badge }]);
  await head.clone().webp({ quality: 82 }).toFile(path.join(OUT, 'bossy-head.webp'));
  await head.clone().png({ compressionLevel: 9, palette: true }).toFile(path.join(OUT, 'bossy-head.png'));

  const trimmed = await sharp(SRC).trim().toBuffer();
  const full = sharp(trimmed).resize({ height: 400 });
  console.log('bossy-full width:', (await full.clone().toBuffer({ resolveWithObject: true })).info.width);
  await full.clone().webp({ quality: 80 }).toFile(path.join(OUT, 'bossy-full.webp'));
  await full.clone().png({ palette: true }).toFile(path.join(OUT, 'bossy-full.png'));

  for (const f of fs.readdirSync(OUT).filter(f => f.startsWith('bossy-')).sort()) {
    console.log(f.padEnd(18), (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1) + ' KB');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
