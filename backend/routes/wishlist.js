/* ================================
   JAIFORE — WISHLIST ROUTES
   backend/routes/wishlist.js  (adjust path to match your existing routes/ layout)
   ================================ */

const express = require('express');
const router  = express.Router();

// Matches your real auth.js: it exports { authenticate, requireAdmin } as
// named exports (not a default export), and sets req.user = jwt.verify(...)
// directly — so req.user is exactly whatever was signed into the token at
// login. This router assumes that payload includes an `id` field (the same
// assumption /api/orders/my must already be making, since it scopes orders
// per-user somehow). If your login/verify-otp route signs the token with a
// different key name (userId, sub, etc.), every req.user.id below becomes
// req.user.<that key> instead — three occurrences, all in this file.
const { authenticate } = require('../middleware/auth'); // adjust path to match where auth.js actually lives

// db is whatever your existing routes use (pg Pool / client) — swap this
// require for however products.js / orders.js already import it.
const db = require('../db');

// ── CONFIG SIGNATURE ─────────────────────────────────
// Deliberately the SAME algorithm as cart.js's configSignature(), so a
// configured item wishlisted here and one added to cart there are
// recognized as "the same saved design" if a user does both. Kept as a
// standalone copy (not a shared import) since cart.js is a frontend file
// with no build step to share code with this backend router — see the
// note left in the roadmap about this duplication.
function configSignature({ customDesigns, gender, printSize }) {
  const designs = customDesigns || [];
  if (!designs.length) return null; // plain product — no signature

  const designKey = designs
    .map(d => d.name || d.src || '')
    .slice()
    .sort()
    .join('|');

  const printSizeKey = printSize?.id ?? printSize?.size_label ?? '';

  return `${designKey}::${gender || ''}::${printSizeKey}`;
}

// ── GET /api/wishlist — list the current user's saved items ─────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, product_id, config_signature, snapshot_data, created_at
       FROM wishlist_items
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[wishlist] GET failed:', err.message);
    res.status(500).json({ error: 'Failed to load wishlist.' });
  }
});

// ── POST /api/wishlist — save an item ────────────────────────────────
// Body shape mirrors what configurator.js already builds for cartProduct,
// plus the plain-product case from services.js/category.js.
//
// Plain product:   { productId, name, price, snapshot }
// Configured item: { productId, name, price, snapshot, gender, printSize,
//                     customDesigns, selectedSize, notes }
router.post('/', authenticate, async (req, res) => {
  const {
    productId, name, price, snapshot,
    gender, printSize, customDesigns, selectedSize, notes
  } = req.body;

  if (!productId || !name || price == null) {
    return res.status(400).json({ error: 'productId, name, and price are required.' });
  }

  const signature = configSignature({ customDesigns, gender, printSize });

  const snapshotData = {
    name, price, snapshot: snapshot || null,
    ...(signature ? { gender, printSize, customDesigns, selectedSize, notes } : {})
  };

  try {
    // ON CONFLICT matches the two unique constraints from the migration:
    // wishlist_unique_configured (signature present) and wishlist_unique_plain
    // (signature NULL, via the partial index). Postgres picks the right one
    // automatically based on whether config_signature is NULL here.
    const { rows } = await db.query(
      `INSERT INTO wishlist_items (user_id, product_id, config_signature, snapshot_data)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, product_id, config_signature)
       DO UPDATE SET snapshot_data = EXCLUDED.snapshot_data
       RETURNING id, product_id, config_signature, snapshot_data, created_at`,
      [req.user.id, productId, signature, JSON.stringify(snapshotData)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[wishlist] POST failed:', err.message);
    res.status(500).json({ error: 'Failed to save item.' });
  }
});

// ── DELETE /api/wishlist/:id ──────────────────────────────────────────
// Scoped to req.user.id in the WHERE clause (not just the row id) so one
// user can't delete another user's wishlist row by guessing an id.
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM wishlist_items WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Wishlist item not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[wishlist] DELETE failed:', err.message);
    res.status(500).json({ error: 'Failed to remove item.' });
  }
});

module.exports = router;