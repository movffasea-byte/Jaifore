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
const { authenticate } = require('../auth'); // adjust path to match where auth.js actually lives

// db is whatever your existing routes use (pg Pool / client) — swap this
// require for however products.js / orders.js already import it.
const { pool: db } = require('../database');

// ── CONFIG SIGNATURE ─────────────────────────────────
// Deliberately the SAME algorithm as cart.js's configSignature(), so a
// configured item wishlisted here and one added to cart there are
// recognized as "the same saved design" if a user does both. Kept as a
// standalone copy (not a shared import) since cart.js is a frontend file
// with no build step to share code with this backend router — see the
// note left in the roadmap about this duplication.
function configSignature({ customDesigns, gender, printSize }) {
  const list = customDesigns || [];
  if (!list.length) return null; // plain product — no signature

  // A design's print size is part of its identity: the same design in two
  // sizes is two different cart lines. Legacy lines carried one line-level
  // printSize instead, so a design without its own falls back to that.
  const lineSize = printSize?.id ?? printSize?.size_label ?? '';

  const designKey = list
    .map(d => `${d.name || d.src || ''}@${d.printSize?.id ?? d.printSize?.size_label ?? lineSize}`)
    .slice()
    .sort()
    .join('|');

  return `${designKey}::${gender || ''}`;
}

// ── GET /api/wishlist — list the current user's saved items ─────────
router.get('/', authenticate, async (req, res) => {
  try {
    let rows;
    try {
      // print_size_id comes from sql/002_wishlist_print_size.sql
      ({ rows } = await db.query(
        `SELECT id, product_id, config_signature, print_size_id, snapshot_data, created_at
         FROM wishlist_items
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [req.user.id]
      ));
    } catch (err) {
      if (err.code !== '42703') throw err; // column not added yet — fall back to the old shape
      ({ rows } = await db.query(
        `SELECT id, product_id, config_signature, snapshot_data, created_at
         FROM wishlist_items
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [req.user.id]
      ));
    }
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
// Graphic design:  { productId, name, price, snapshot, category: 'design', printSize }
//                  — the print size is stored in its own column, so the same
//                  design saved in two sizes is two wishlist rows.
// Configured item: { productId, name, price, snapshot, gender, printSize,
//                     customDesigns, selectedSize, notes }
router.post('/', authenticate, async (req, res) => {
  const {
    productId, name, price, snapshot, category,
    gender, printSize, customDesigns, selectedSize, notes
  } = req.body;

  if (!productId || !name || price == null) {
    return res.status(400).json({ error: 'productId, name, and price are required.' });
  }

  const signature = configSignature({ customDesigns, gender, printSize });

  // A plain item (no custom designs) may carry a print size — graphics need one
  const plainSizeId = Number(printSize?.id);
  const printSizeId = !signature && Number.isInteger(plainSizeId) ? plainSizeId : null;

  const snapshotData = {
    name, price, snapshot: snapshot || null,
    ...(category ? { category } : {}),
    ...(printSizeId ? { printSize } : {}),
    ...(signature ? { gender, printSize, customDesigns, selectedSize, notes } : {})
  };

  // The original insert (no print_size_id) — used for configured items and
  // as the fallback until sql/002_wishlist_print_size.sql has been run.
  // ON CONFLICT matches wishlist_unique_configured / wishlist_unique_plain.
  const insertOriginal = () => db.query(
    `INSERT INTO wishlist_items (user_id, product_id, config_signature, snapshot_data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, product_id, config_signature)
     DO UPDATE SET snapshot_data = EXCLUDED.snapshot_data
     RETURNING id, product_id, config_signature, snapshot_data, created_at`,
    [req.user.id, productId, signature, JSON.stringify(snapshotData)]
  );

  try {
    let rows;
    if (signature) {
      ({ rows } = await insertOriginal());
    } else {
      try {
        ({ rows } = await db.query(
          `INSERT INTO wishlist_items (user_id, product_id, config_signature, print_size_id, snapshot_data)
           VALUES ($1, $2, NULL, $3, $4)
           ON CONFLICT (user_id, product_id, (COALESCE(print_size_id, 0))) WHERE config_signature IS NULL
           DO UPDATE SET snapshot_data = EXCLUDED.snapshot_data
           RETURNING id, product_id, config_signature, print_size_id, snapshot_data, created_at`,
          [req.user.id, productId, printSizeId, JSON.stringify(snapshotData)]
        ));
      } catch (err) {
        // 42703 = column missing, 42P10 = no matching unique index: migration not applied yet
        if (err.code !== '42703' && err.code !== '42P10') throw err;
        ({ rows } = await insertOriginal());
      }
    }
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
module.exports.configSignature = configSignature; // exported for test/signature.test.js 