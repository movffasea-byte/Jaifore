/* ================================
   JAIFORE UPLOADS ROUTE
   backend/routes/uploads.js

   Customer artwork goes to Supabase Storage instead of travelling through
   the cart/wishlist/checkout requests as base64. The browser sends the image
   once as a data URL; we validate it, store it, and hand back a short public
   URL to use as the design's `src`.

   Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_BUCKET (a
   PUBLIC bucket). The service-role key stays on the server only.

   Optional SUPABASE_PRIVATE_BUCKET (a PRIVATE bucket): every upload is also
   stored there under the same object path, and admins fetch the print
   original through GET /original, which hands back a short-lived signed URL.
   ================================ */
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const Sentry = require('@sentry/node');
const { authenticate, requireAdmin } = require('../middleware');

const router = express.Router();

const SIGNED_URL_SECONDS = 5 * 60;
// <userId>/<uuid>.<ext>, exactly what POST / generates.
const OBJECT_PATH = /^\d+\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;

const MAX_BYTES = 5 * 1024 * 1024;
// SVG is deliberately absent: it can carry scripts and is served from our bucket.
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

// Check the real file signature, not just the type the browser claimed.
const SIGNATURES = {
  'image/png':  b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  'image/gif':  b => b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)),
};

// Checks a base64 data URL and returns { mime, ext, buffer } or { status, error }.
function readImage(dataUrl, maxBytes = MAX_BYTES) {
  const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!match) return { status: 400, error: 'Send the image as a base64 data URL.' };

  const mime = match[1].toLowerCase();
  const ext = TYPES[mime];
  if (!ext) return { status: 400, error: 'Only PNG, JPG, WEBP or GIF images are allowed.' };

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > maxBytes) return { status: 413, error: `File too large. Max ${maxBytes / 1024 / 1024}MB.` };
  if (!SIGNATURES[mime](buffer)) return { status: 400, error: 'File content does not match its image type.' };
  return { mime, ext, buffer };
}

router.post('/', authenticate, async (req, res) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET, SUPABASE_PRIVATE_BUCKET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_BUCKET) {
    return res.status(503).json({ error: 'Uploads are not configured yet.' });
  }

  const image = readImage(req.body?.dataUrl);
  if (image.error) return res.status(image.status).json({ error: image.error });
  const { mime, ext, buffer } = image;

  const objectPath = `${req.user.id}/${crypto.randomUUID()}.${ext}`;
  const base = SUPABASE_URL.replace(/\/$/, '');

  try {
    await axios.post(`${base}/storage/v1/object/${SUPABASE_BUCKET}/${objectPath}`, buffer, {
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': mime,
        'Cache-Control': 'max-age=31536000',
      },
      maxBodyLength: Infinity,
    });

    // Best effort: the customer's upload already succeeded, so a failure here
    // is reported but never surfaced to them.
    if (SUPABASE_PRIVATE_BUCKET) {
      try {
        await axios.post(`${base}/storage/v1/object/${SUPABASE_PRIVATE_BUCKET}/${objectPath}`, buffer, {
          headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': mime },
          maxBodyLength: Infinity,
        });
      } catch (err) {
        console.error('[uploads] Private copy failed:', err.response?.data?.message || err.message);
        Sentry.captureException(err, { tags: { area: 'uploads-private' }, extra: { userId: req.user.id, objectPath } });
      }
    }

    return res.status(201).json({ url: `${base}/storage/v1/object/public/${SUPABASE_BUCKET}/${objectPath}` });
  } catch (err) {
    console.error('[uploads] Storage upload failed:', err.response?.data?.message || err.message);
    Sentry.captureException(err, { tags: { area: 'uploads' }, extra: { userId: req.user.id } });
    return res.status(502).json({ error: 'Could not store the image. Please try again.' });
  }
});

// Admin only: a product photo goes into the public product-images bucket as
// the next free number (151.jpg, 152.jpg, ...) and comes back as the
// https://jaifore.org/images/<name> link the shop already serves through the
// Vercel /images rewrite. GIF is refused: product photos are JPG/PNG/WEBP.
const PRODUCT_BUCKET = () => process.env.SUPABASE_PRODUCT_BUCKET || 'product-images';
const PRODUCT_MAX_BYTES = 6 * 1024 * 1024; // fits the 8mb JSON limit once base64'd
const NUMBERED = /^(\d+)\.(jpe?g|png|webp)$/i;

router.post('/product-image', authenticate, requireAdmin, async (req, res) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'Uploads are not configured yet.' });
  }

  const image = readImage(req.body?.dataUrl, PRODUCT_MAX_BYTES);
  if (image.error) return res.status(image.status).json({ error: image.error });
  if (image.ext === 'gif') return res.status(400).json({ error: 'Product photos must be JPG, PNG or WEBP.' });

  const base = SUPABASE_URL.replace(/\/$/, '');
  const bucket = PRODUCT_BUCKET();
  const auth = { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

  try {
    const { data: objects } = await axios.post(
      `${base}/storage/v1/object/list/${bucket}`,
      { prefix: '', limit: 1000, offset: 0 },
      { headers: auth }
    );
    const highest = (objects || []).reduce((max, o) => {
      const m = NUMBERED.exec(o?.name || '');
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);

    // Skip numbers the site already ships a web copy for (photos added to
    // the repo but not uploaded yet), or the shop would show that copy.
    const site = (process.env.FRONTEND_URL || 'https://jaifore.org').replace(/\/$/, '');
    let start = highest + 1;
    for (let tries = 0; tries < 50; tries++, start++) {
      const shipped = await axios.head(`${site}/images/web/${start}.webp`, { validateStatus: () => true })
        .then(r => r.status === 200, () => false);
      if (!shipped) break;
    }

    // Never overwrite: if the number was taken meanwhile, try the next one.
    for (let n = start; n <= start + 2; n++) {
      const name = `${n}.${image.ext}`;
      try {
        await axios.post(`${base}/storage/v1/object/${bucket}/${name}`, image.buffer, {
          headers: { ...auth, 'Content-Type': image.mime, 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' },
          maxBodyLength: Infinity,
        });
        return res.status(201).json({ name, url: `${site}/images/${name}` });
      } catch (err) {
        const taken = err.response?.status === 409 || /exist/i.test(err.response?.data?.message || err.response?.data?.error || '');
        if (!taken) throw err;
      }
    }
    return res.status(409).json({ error: 'Could not find a free image number. Please try again.' });
  } catch (err) {
    console.error('[uploads] Product image failed:', err.response?.data?.message || err.message);
    Sentry.captureException(err, { tags: { area: 'uploads-product' } });
    return res.status(502).json({ error: 'Could not store the image. Please try again.' });
  }
});

// Admin only: signed link to the untouched print original of an upload.
router.get('/original', authenticate, requireAdmin, async (req, res) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PRIVATE_BUCKET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_PRIVATE_BUCKET) {
    return res.status(503).json({ error: 'Private originals are not configured yet.' });
  }

  const objectPath = String(req.query.path || '');
  if (!OBJECT_PATH.test(objectPath)) return res.status(400).json({ error: 'Invalid path.' });

  const base = SUPABASE_URL.replace(/\/$/, '');
  try {
    const { data } = await axios.post(
      `${base}/storage/v1/object/sign/${SUPABASE_PRIVATE_BUCKET}/${objectPath}`,
      { expiresIn: SIGNED_URL_SECONDS },
      { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    return res.json({ url: `${base}/storage/v1${data.signedURL}`, expiresIn: SIGNED_URL_SECONDS });
  } catch (err) {
    // Uploads from before the private bucket existed have no original here.
    if ([400, 404].includes(err.response?.status)) return res.status(404).json({ error: 'No private original for this file.' });
    console.error('[uploads] Signing failed:', err.response?.data?.message || err.message);
    Sentry.captureException(err, { tags: { area: 'uploads-sign' }, extra: { objectPath } });
    return res.status(502).json({ error: 'Could not create the download link.' });
  }
});

module.exports = router;
