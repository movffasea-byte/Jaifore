/* ================================
   JAIFORE — UPLOAD IMAGE ORIGINALS TO SUPABASE STORAGE
   frontend/tools/upload-originals.js

   Uploads every original directly inside frontend/images/ to the public
   "product-images" bucket under its exact file name, then checks each one
   by byte size. web/ and thumb/ are not uploaded: they ship with the site.
   Re-runnable: x-upsert overwrites an existing object.

   Run from the repo root (the key is typed in your own shell, never committed):
     SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
       node frontend/tools/upload-originals.js
   ================================ */
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, '..', 'images');
const BUCKET = 'product-images';
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  process.exit(1);
}
const base = SUPABASE_URL.replace(/\/$/, '');

async function main() {
  const files = fs.readdirSync(IMAGES_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map(e => e.name)
    .sort();

  let uploaded = 0;
  const failed = [];
  for (const name of files) {
    const buffer = fs.readFileSync(path.join(IMAGES_DIR, name));
    const key = encodeURIComponent(name);
    try {
      const up = await fetch(`${base}/storage/v1/object/${BUCKET}/${key}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': TYPES[path.extname(name).toLowerCase()],
          'x-upsert': 'true',
        },
        body: buffer,
      });
      if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`);

      // Public read check: the stored size must match the local file.
      const head = await fetch(`${base}/storage/v1/object/public/${BUCKET}/${key}`, { method: 'HEAD' });
      const size = Number(head.headers.get('content-length'));
      if (!head.ok || size !== buffer.length) throw new Error(`verify ${head.status}, ${size} of ${buffer.length} bytes`);
      uploaded++;
    } catch (err) {
      failed.push(`${name}: ${err.message}`);
    }
  }

  console.log(`${uploaded} of ${files.length} originals uploaded and verified.`);
  if (failed.length) {
    console.error(`${failed.length} failed:\n  ${failed.join('\n  ')}`);
    process.exit(1);
  }
}

main();
