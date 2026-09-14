/* ================================
   JAIFORE — CART ROUTES
   backend/routes/cart.js
   ================================ */

const express = require('express');
const router  = express.Router();

const { authenticate } = require('../auth');
const { pool: db }     = require('../database');

// ── CONFIG SIGNATURE ─────────────────────────────────
// Identical algorithm to wishlist.js's server-side copy and cart.js's
// frontend copy (item 18) — sorted design names + gender + print size.
// Kept as its own standalone copy for the same reason wishlist.js's is:
// no shared build step between this backend and the frontend cart.js.
function configSignature({ designs, gender, printSize }) {
  const list = designs || [];
  if (!list.length) return null; // plain product — no signature

  const designKey = list
    .map(d => d.name || d.src || '')
    .slice()
    .sort()
    .join('|');

  const printSizeKey = printSize?.id ?? printSize?.size_label ?? '';

  return `${designKey}::${gender || ''}::${printSizeKey}`;
}

// Shape a raw DB row into what the frontend cart.js expects — same field
// names as the frontend's own cart array items, so cart.js can treat a
// server response and a localStorage item identically.
function rowToCartItem(row) {
  const data = row.snapshot_data || {};
  return {
    cartItemId: row.id,           // server-side row id, needed for PATCH/DELETE
    id:         row.product_id,
    name:       data.name,
    price:      data.price,
    category:   data.category || null,
    size:       row.size,
    qty:        row.qty,
    snapshot:   data.snapshot || null,
    designs:    data.designs || [],
    gender:     data.gender || null,
    printSize:  data.printSize || null,
  };
}

// ── GET /api/cart — list the current user's server cart ─────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, product_id, config_signature, size, qty, snapshot_data
       FROM cart_items
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [req.user.id]
    );
    res.json(rows.map(rowToCartItem));
  } catch (err) {
    console.error('[cart] GET failed:', err.message);
    res.status(500).json({ error: 'Failed to load cart.' });
  }
});

// ── POST /api/cart — add or increment a line ─────────────────────────
// Body shape mirrors what the frontend cart.js's addToCart() already
// builds internally, plus `category` (frontend keeps it top-level, this
// route folds it into snapshot_data alongside the rest).
router.post('/', authenticate, async (req, res) => {
  const {
    productId, name, price, category, size,
    qty, snapshot, designs, gender, printSize
  } = req.body;

  if (!productId || !name || price == null) {
    return res.status(400).json({ error: 'productId, name, and price are required.' });
  }

  const signature = configSignature({ designs, gender, printSize });
  const addQty    = qty || 1;

  const snapshotData = { name, price, category, snapshot: snapshot || null, designs: designs || [], gender: gender || null, printSize: printSize || null };

  try {
    // Two separate query paths, branched on whether this is a plain
    // product (signature === null) or a configured one (signature set).
    // Each path's ON CONFLICT target matches ONE partial index exactly —
    // cart_unique_plain is (user_id, product_id, size) WHERE config_signature
    // IS NULL, cart_unique_configured is (user_id, product_id, config_signature, size)
    // WHERE config_signature IS NOT NULL. A single 4-column ON CONFLICT
    // clause can never match the plain index, which is what was causing
    // every plain-product POST to 500 — Postgres requires an exact column
    // match between ON CONFLICT and a real constraint/index, and there is
    // no single index covering both cases at once.
    let rows;
    if (signature === null) {
      ({ rows } = await db.query(
        `INSERT INTO cart_items (user_id, product_id, config_signature, size, qty, snapshot_data)
         VALUES ($1, $2, NULL, $3, $4, $5)
         ON CONFLICT (user_id, product_id, size) WHERE config_signature IS NULL
         DO UPDATE SET qty = cart_items.qty + EXCLUDED.qty, updated_at = NOW()
         RETURNING id, product_id, config_signature, size, qty, snapshot_data`,
        [req.user.id, productId, size || null, addQty, JSON.stringify(snapshotData)]
      ));
    } else {
      ({ rows } = await db.query(
        `INSERT INTO cart_items (user_id, product_id, config_signature, size, qty, snapshot_data)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, product_id, config_signature, size) WHERE config_signature IS NOT NULL
         DO UPDATE SET qty = cart_items.qty + EXCLUDED.qty, updated_at = NOW()
         RETURNING id, product_id, config_signature, size, qty, snapshot_data`,
        [req.user.id, productId, signature, size || null, addQty, JSON.stringify(snapshotData)]
      ));
    }
    res.status(201).json(rowToCartItem(rows[0]));
  } catch (err) {
    console.error('[cart] POST failed:', err.message);
    res.status(500).json({ error: 'Failed to add item to cart.' });
  }
});

// ── PATCH /api/cart/:id — set qty directly ───────────────────────────
// For checkout's +/- editor, which sets an absolute quantity rather than
// incrementing — different from POST's "add one more" semantics.
router.patch('/:id', authenticate, async (req, res) => {
  const { qty } = req.body;
  if (qty == null || qty < 1) {
    return res.status(400).json({ error: 'qty must be a positive number.' });
  }

  try {
    const { rows } = await db.query(
      `UPDATE cart_items SET qty = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, product_id, config_signature, size, qty, snapshot_data`,
      [qty, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cart item not found.' });
    res.json(rowToCartItem(rows[0]));
  } catch (err) {
    console.error('[cart] PATCH failed:', err.message);
    res.status(500).json({ error: 'Failed to update quantity.' });
  }
});

// ── DELETE /api/cart/:id ───────────────────────────────────────────────
// Scoped to req.user.id in the WHERE clause, same pattern as wishlist.js's
// DELETE — a user can't remove another user's cart row by guessing an id.
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM cart_items WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Cart item not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[cart] DELETE failed:', err.message);
    res.status(500).json({ error: 'Failed to remove item.' });
  }
});

// ── POST /api/cart/merge — resolve a login-time conflict in one call ──
// Body: { localCart: [...], keepLocal: boolean }
// localCart is the frontend's raw cart array (same shape addToCart()
// builds — id/name/price/category/size/qty/snapshot/designs/gender/printSize).
//
// Behavior:
//  - Lines that exist ONLY locally or ONLY on the server are always kept —
//    the keepLocal choice only decides what happens where BOTH sides have
//    a line for the same product+signature+size (a genuine conflict).
//  - keepLocal=true  -> for conflicting lines, the local qty overwrites
//    the server's qty (server row updated, not summed).
//  - keepLocal=false -> for conflicting lines, the server's existing qty
//    is left untouched; the local line is simply dropped.
//  - Returns the final merged cart (same shape as GET /api/cart) so the
//    frontend can replace its local `cart` variable with the authoritative
//    result in one step, rather than re-fetching separately.
router.post('/merge', authenticate, async (req, res) => {
  const { localCart, keepLocal } = req.body;
  if (!Array.isArray(localCart)) {
    return res.status(400).json({ error: 'localCart must be an array.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: serverRows } = await client.query(
      `SELECT id, product_id, config_signature, size, qty, snapshot_data
       FROM cart_items WHERE user_id = $1`,
      [req.user.id]
    );

    // Key server rows by product_id+signature+size so local lines can be
    // matched against them in-memory rather than one query per line.
    const serverByKey = new Map();
    serverRows.forEach(row => {
      const key = `${row.product_id}::${row.config_signature || ''}::${row.size || ''}`;
      serverByKey.set(key, row);
    });

    for (const item of localCart) {
      const signature = configSignature({ designs: item.designs, gender: item.gender, printSize: item.printSize });
      const key = `${item.id}::${signature || ''}::${item.size || ''}`;
      const existing = serverByKey.get(key);

      const snapshotData = {
        name: item.name, price: item.price, category: item.category || null,
        snapshot: item.snapshot || null, designs: item.designs || [],
        gender: item.gender || null, printSize: item.printSize || null
      };

      if (!existing) {
        // Local-only line — always kept, inserted as a new server row.
        await client.query(
          `INSERT INTO cart_items (user_id, product_id, config_signature, size, qty, snapshot_data)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.user.id, item.id, signature, item.size || null, item.qty, JSON.stringify(snapshotData)]
        );
      } else if (keepLocal) {
        // Genuine conflict, user chose "keep local" — overwrite the
        // server row's qty (and refresh its snapshot to the local copy).
        await client.query(
          `UPDATE cart_items SET qty = $1, snapshot_data = $2, updated_at = NOW() WHERE id = $3`,
          [item.qty, JSON.stringify(snapshotData), existing.id]
        );
      }
      // else: genuine conflict, user chose "keep server" — do nothing,
      // the existing server row is left exactly as it was.
    }

    await client.query('COMMIT');

    const { rows: finalRows } = await client.query(
      `SELECT id, product_id, config_signature, size, qty, snapshot_data
       FROM cart_items WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.user.id]
    );
    res.json(finalRows.map(rowToCartItem));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cart] MERGE failed:', err.message);
    res.status(500).json({ error: 'Failed to merge cart.' });
  } finally {
    client.release();
  }
});

module.exports = router;