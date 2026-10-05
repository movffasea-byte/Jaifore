/* ================================
   JAIFORE — GENERATE PRODUCT THUMBNAILS
   backend/scripts/generate-thumbnails.js

   For every product with an image_url and no thumb_url yet:
     1. download image_url
     2. resize to ~320px wide WebP (quality 70)
     3. upload it to a PUBLIC Supabase Storage bucket
     4. save the public URL in products.thumb_url

   Re-runnable: rows that already have a thumb_url are skipped, and a
   failure on one row is logged and skipped without stopping the rest.

   Run once from backend/ after sql/001_add_thumb_url.sql:
     node scripts/generate-thumbnails.js

   Env vars (from .env or the shell — never commit them):
     DATABASE_URL                 same Postgres the API uses
     SUPABASE_URL                 e.g. https://<project>.supabase.co
     SUPABASE_SERVICE_ROLE_KEY    server-side key (NOT the anon key)
     SUPABASE_THUMB_BUCKET        optional, default "product-thumbs"
                                  (create it in Supabase as a PUBLIC bucket)
   ================================ */
require('dotenv').config();
const sharp = require('sharp');
const { pool } = require('../database');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET       = process.env.SUPABASE_THUMB_BUCKET || 'product-thumbs';

const THUMB_WIDTH   = 320;
const THUMB_QUALITY = 70;

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function upload(objectPath, buffer) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'image/webp',
      'x-upsert': 'true', // re-running overwrites instead of failing
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`upload failed (${res.status}): ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

async function main() {
  const missing = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const { rows } = await pool.query(
    `SELECT id, name, image_url FROM products
     WHERE thumb_url IS NULL AND image_url IS NOT NULL AND image_url <> '' AND image_url NOT LIKE 'data:%'
     ORDER BY id`
  );
  console.log(`${rows.length} product(s) need a thumbnail.`);

  let done = 0, failed = 0;
  for (const row of rows) {
    try {
      const original = await download(row.image_url);
      const thumb = await sharp(original)
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer();

      const publicUrl = await upload(`${row.id}.webp`, thumb);
      await pool.query('UPDATE products SET thumb_url = $1 WHERE id = $2', [publicUrl, row.id]);

      done++;
      console.log(`✓ #${row.id} ${row.name} — ${(original.length / 1024).toFixed(0)} KB → ${(thumb.length / 1024).toFixed(0)} KB`);
    } catch (err) {
      failed++;
      console.error(`✗ #${row.id} ${row.name}: ${err.message}`);
    }
  }

  console.log(`Done. ${done} created, ${failed} failed.`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
