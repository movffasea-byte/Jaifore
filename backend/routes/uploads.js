/* ================================
   JAIFORE UPLOADS ROUTE
   backend/routes/uploads.js

   Customer artwork goes to Supabase Storage instead of travelling through
   the cart/wishlist/checkout requests as base64. The browser sends the image
   once as a data URL; we validate it, store it, and hand back a short public
   URL to use as the design's `src`.

   Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_BUCKET (a
   PUBLIC bucket). The service-role key stays on the server only.
   ================================ */
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const Sentry = require('@sentry/node');
const { authenticate } = require('../middleware');

const router = express.Router();

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
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET } = process.env;
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
    return res.status(201).json({ url: `${base}/storage/v1/object/public/${SUPABASE_BUCKET}/${objectPath}` });
  } catch (err) {
    console.error('[uploads] Storage upload failed:', err.response?.data?.message || err.message);
    Sentry.captureException(err, { tags: { area: 'uploads' }, extra: { userId: req.user.id } });
    return res.status(502).json({ error: 'Could not store the image. Please try again.' });
  }
});

module.exports = router;
