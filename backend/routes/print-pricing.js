/* ================================
   JAIFORE PRINT PRICING ROUTE
   backend/routes/print-pricing.js
   ================================ */
const express = require('express');
const router  = express.Router();
const { pool } = require('../database');
const { serverError } = require('../errors');
const { authenticate, requireAdmin } = require('../middleware');
const { cacheGet, cacheSet, cacheInvalidate } = require('../redis');

const CACHE_TTL = 1800; // 30 minutes — pricing tiers change very rarely
const CACHE_KEY = 'print-pricing:list';

// GET all print pricing (public)
router.get('/', async (req, res) => {
  try {
    const cached = await cacheGet(CACHE_KEY);
    if (cached) {
      return res.json(cached);
    }

    const result = await pool.query('SELECT * FROM print_pricing ORDER BY price ASC');
    await cacheSet(CACHE_KEY, result.rows, CACHE_TTL);
    res.json(result.rows);
  } catch (err) { serverError(res, err, 'print-pricing'); }
});

// PUT update print price (admin only)
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { price } = req.body;
  if (!price) return res.status(400).json({ error: 'Price is required.' });
  // A zero, negative or non-numeric price would sell prints for free (or crash the query).
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return res.status(400).json({ error: 'Price must be a number greater than 0.' });
  }
  try {
    const result = await pool.query(
      'UPDATE print_pricing SET price=$1 WHERE id=$2 RETURNING *',
      [price, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Price not found.' });

    // Pricing changed — clear the cached list so the new price shows immediately
    await cacheInvalidate(CACHE_KEY);

    res.json(result.rows[0]);
  } catch (err) { serverError(res, err, 'print-pricing'); }
});

module.exports = router;
