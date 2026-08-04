/* ================================
   JAIFORE — RECENTLY VIEWED ROUTES
   backend/routes/recently-viewed.js
   ================================ */

const express = require('express');
const router  = express.Router();

// Same auth convention as wishlist-routes.js — named export from your
// real auth.js, populating req.user from the Bearer token.
const { authenticate } = require('../auth'); // auth.js lives directly in backend/, no middleware/ subfolder

// Swap this for however your other route files import the DB client.
const db = require('../database');

// ── GET /api/recently-viewed — list, most recent first ───────────────
// Joins against products so the frontend gets a ready-to-render object
// (name, price, image_url) in one call, rather than a bare list of ids it
// would need to re-fetch individually. Capped at 12 — this feature is a
// "recent activity" strip, not a full history; the cap also means a
// single query with no pagination is enough on both ends.
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT rv.product_id, rv.last_viewed_at,
              p.name, p.price, p.image_url, p.category, p.in_stock
       FROM recently_viewed rv
       JOIN products p ON p.id = rv.product_id
       WHERE rv.user_id = $1
       ORDER BY rv.last_viewed_at DESC
       LIMIT 12`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[recently-viewed] GET failed:', err.message);
    res.status(500).json({ error: 'Failed to load recently viewed items.' });
  }
});

// ── POST /api/recently-viewed — record a view ─────────────────────────
// Body: { productId }. Upserts on (user_id, product_id) so re-viewing the
// same product bumps its timestamp instead of creating a duplicate row —
// matches the unique constraint from the migration.
router.post('/', authenticate, async (req, res) => {
  const { productId } = req.body;
  if (!productId) {
    return res.status(400).json({ error: 'productId is required.' });
  }

  try {
    await db.query(
      `INSERT INTO recently_viewed (user_id, product_id, last_viewed_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET last_viewed_at = now()`,
      [req.user.id, productId]
    );
    // 204 — this is a fire-and-forget instrumentation call from the
    // frontend (see the recordView() helper in each page's JS); nothing
    // in the response body is ever read.
    res.status(204).end();
  } catch (err) {
    console.error('[recently-viewed] POST failed:', err.message);
    res.status(500).json({ error: 'Failed to record view.' });
  }
});

module.exports = router;