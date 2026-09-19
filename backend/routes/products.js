/* ================================
   JAIFORE PRODUCTS ROUTE
   backend/routes/products.js
   ================================ */
const express = require('express');
const router  = express.Router();
const { pool } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');
const { cacheGet, cacheSet, cacheInvalidate } = require('../redis');
const Sentry = require('@sentry/node');
const { sendLowStockAlert } = require('../mailer');

const CACHE_TTL = 300; // 5 minutes — product catalog changes rarely, read often
const LOW_STOCK_THRESHOLD = 5; // item 14 — anything at or below this triggers an alert

// Fires the low-stock email exactly once per transition — only when stock
// crosses from "above threshold" to "at or below threshold". This prevents
// a flood of emails while a product sits at a low number and sells one at a time
// (e.g. 4 -> 3 -> 2 -> 1 would otherwise fire three more alerts after the first).
function checkLowStockTransition(oldStock, newStock) {
  if (oldStock === null || oldStock === undefined) return false; // untracked product, never alert
  if (newStock === null || newStock === undefined) return false;
  return oldStock > LOW_STOCK_THRESHOLD && newStock <= LOW_STOCK_THRESHOLD;
}

function fireLowStockAlert(product) {
  sendLowStockAlert(product).catch(e => {
    console.error('[mailer] Low stock alert failed:', e.message);
    Sentry.captureException(e, {
      tags: { area: 'transactional-email' },
      extra: { productId: product.id, email: process.env.ADMIN_EMAIL },
    });
  });
}

// Web Development products have no price and no stock — they're enquiry-only.
// Graphic Design products also have no plain price — monetization moved to
// print pricing (each design references existing print_pricing rows via
// print_size_ids, so a design's "price" is always whatever those rows say,
// never duplicated onto the product itself). Apparel keeps the original
// required-price behavior unchanged.
function categoryRequiresPrice(category) {
  return category === 'Apparels & Merchandise';
}

// Expands a product's print_size_ids into full {id, size_label, dimensions,
// price} objects by joining against the print_pricing table, so the
// frontend/admin never has to make a second request to resolve prices.
// Kept as a plain helper (not cached per-product) since print_pricing is
// small and rarely changes; the join cost here is negligible.
async function attachPrintSizes(products) {
  const list = Array.isArray(products) ? products : [products];
  const idsNeeded = new Set();
  list.forEach(p => (p.print_size_ids || []).forEach(id => idsNeeded.add(id)));

  if (!idsNeeded.size) {
    list.forEach(p => { p.print_sizes = []; });
    return products;
  }

  const result = await pool.query(
    'SELECT id, size_label, dimensions, price FROM print_pricing WHERE id = ANY($1::int[])',
    [Array.from(idsNeeded)]
  );
  const byId = new Map(result.rows.map(r => [r.id, r]));

  list.forEach(p => {
    p.print_sizes = (p.print_size_ids || [])
      .map(id => byId.get(id))
      .filter(Boolean); // drop any id that no longer exists in print_pricing
  });

  return products;
}

// GET all products (public) — supports ?category=&search=&limit=
// item 17: `search` matches against name OR description, case-insensitive,
// and composes with the existing category filter (both can be present at once).
router.get('/', async (req, res) => {
  try {
    const { category, search, limit } = req.query;

    // Cache key folds in every query dimension so different combinations
    // (e.g. same category, different search term) never collide with each other
    // or serve stale results from a different filter combo.
    const cacheKey = `products:list:${category || 'all'}:${search || 'nosearch'}:${limit || 'nolimit'}`;

    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let query  = 'SELECT * FROM products';
    const conditions = [];
    const params = [];

    if (category) {
      params.push(category);
      conditions.push(`LOWER(category) = LOWER($${params.length})`);
    }

    if (search) {
      // One placeholder reused for both name and description via a single
      // pushed param — keeps $N numbering simple regardless of param order.
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }

    if (conditions.length) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    if (limit) {
      params.push(parseInt(limit));
      query += ` LIMIT $${params.length}`;
    }

    const result = await pool.query(query, params);
    const products = await attachPrintSizes(result.rows);
    await cacheSet(cacheKey, products, CACHE_TTL);
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET low-stock products only (admin only) — item 14, backs the Overview
// banner and Products tab badge without requiring the full list every time.
// Deliberately excludes untracked (NULL stock) products, same convention as
// the rest of the inventory system (item 12).
router.get('/alerts/low-stock', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, stock FROM products
       WHERE stock IS NOT NULL AND stock <= $1
       ORDER BY stock ASC`,
      [LOW_STOCK_THRESHOLD]
    );
    res.json({ threshold: LOW_STOCK_THRESHOLD, products: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single product (public)
router.get('/:id', async (req, res) => {
  try {
    const cacheKey = `products:single:${req.params.id}`;
    const cached   = await cacheGet(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });

    const [product] = await attachPrintSizes([result.rows[0]]);
    await cacheSet(cacheKey, product, CACHE_TTL);
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create product (admin only)
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { name, description, price, category, image_url, back_image, in_stock, stock, live_link, print_size_ids } = req.body;

  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (categoryRequiresPrice(category) && !price) {
    return res.status(400).json({ error: 'Price is required for Apparel & Merchandise.' });
  }

  try {
    const stockValue = (stock === undefined || stock === null || stock === '') ? 0 : parseInt(stock, 10);
    const priceValue = (price === undefined || price === null || price === '') ? null : price;
    const printSizeIdsValue = Array.isArray(print_size_ids) && print_size_ids.length ? print_size_ids : null;

    const result = await pool.query(
      `INSERT INTO products (name, description, price, category, image_url, back_image, in_stock, stock, live_link, print_size_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [name, description, priceValue, category, image_url, back_image, in_stock ?? true, stockValue, live_link || null, printSizeIdsValue]
    );

    // New product means every cached "list" view is now stale — clear them all.
    // Single-product cache keys are unaffected since this ID didn't exist yet.
    await cacheInvalidate('products:list:*');

    // A brand-new product created already at/below the threshold counts as a
    // transition too (it went from "didn't exist" to "low") — worth flagging
    // immediately rather than waiting for the first sale to notice.
    if (checkLowStockTransition(LOW_STOCK_THRESHOLD + 1, stockValue)) {
      fireLowStockAlert(result.rows[0]);
    }

    const [product] = await attachPrintSizes([result.rows[0]]);
    res.status(201).json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update product (admin only)
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { name, description, price, category, image_url, back_image, in_stock, stock, live_link, print_size_ids } = req.body;

  if (categoryRequiresPrice(category) && !price) {
    return res.status(400).json({ error: 'Price is required for Apparel & Merchandise.' });
  }

  try {
    // Fetch the pre-update stock so we can detect a low-stock transition below
    const before = await pool.query('SELECT stock FROM products WHERE id = $1', [req.params.id]);
    const oldStock = before.rows.length ? before.rows[0].stock : null;

    const stockValue = (stock === undefined || stock === null || stock === '') ? null : parseInt(stock, 10);
    const priceValue = (price === undefined || price === null || price === '') ? null : price;
    const printSizeIdsValue = Array.isArray(print_size_ids) && print_size_ids.length ? print_size_ids : null;

    // If a real stock count is provided, it governs in_stock automatically.
    // Leaving stock blank keeps this product "untracked" and respects whatever
    // in_stock was set to manually (e.g. print-on-demand or service items).
    const resolvedInStock = (stockValue !== null) ? stockValue > 0 : in_stock;

    const result = await pool.query(
      `UPDATE products SET name=$1, description=$2, price=$3, category=$4,
       image_url=$5, back_image=$6, in_stock=$7, stock=$8, live_link=$9, print_size_ids=$10
       WHERE id=$11 RETURNING *`,
      [name, description, priceValue, category, image_url, back_image, resolvedInStock, stockValue, live_link || null, printSizeIdsValue, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });

    // Clear both the specific product's cache AND all list views,
    // since this update could change which category/filter it shows under.
    await cacheInvalidate(`products:single:${req.params.id}`);
    await cacheInvalidate('products:list:*');

    if (checkLowStockTransition(oldStock, stockValue)) {
      fireLowStockAlert(result.rows[0]);
    }

    const [product] = await attachPrintSizes([result.rows[0]]);
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH quick stock adjustment (admin only) — for the +/- buttons in the
// admin table, so routine restocking doesn't require opening the full edit form.
// Body: { delta: 5 } to adjust relatively, or { set: 20 } to set an exact value.
router.patch('/:id/stock', authenticate, requireAdmin, async (req, res) => {
  const { delta, set } = req.body;
  if (delta === undefined && set === undefined) {
    return res.status(400).json({ error: 'Provide either "delta" (relative change) or "set" (exact value).' });
  }
  try {
    const current = await pool.query('SELECT stock FROM products WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Product not found.' });

    const currentStock = current.rows[0].stock ?? 0;
    const newStock = Math.max(0, set !== undefined ? Number(set) : currentStock + Number(delta));

    const result = await pool.query(
      `UPDATE products SET stock=$1, in_stock=$2 WHERE id=$3 RETURNING *`,
      [newStock, newStock > 0, req.params.id]
    );

    await cacheInvalidate(`products:single:${req.params.id}`);
    await cacheInvalidate('products:list:*');

    if (checkLowStockTransition(currentStock, newStock)) {
      fireLowStockAlert(result.rows[0]);
    }

    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE product (admin only)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);

    await cacheInvalidate(`products:single:${req.params.id}`);
    await cacheInvalidate('products:list:*');

    res.json({ message: 'Product deleted.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;