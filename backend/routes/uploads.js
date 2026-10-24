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

router.post('/', authenticate, async (req, res) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET, SUPABASE_PRIVATE_BUCKET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_BUCKET) {
    return res.status(503).json({ error: 'Uploads are not configured yet.' });
  }

  const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(req.body?.dataUrl || ''));
  if (!match) return res.status(400).json({ error: 'Send the image as a base64 data URL.' });

  const mime = match[1].toLowerCase();
  const ext = TYPES[mime];
  if (!ext) return res.status(400).json({ error: 'Only PNG, JPG, WEBP or GIF images are allowed.' });

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_BYTES) return res.status(413).json({ error: 'File too large. Max 5MB.' });
  if (!SIGNATURES[mime](buffer)) return res.status(400).json({ error: 'File content does not match its image type.' });

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
