/* ================================
   JAIFORE PRINT PRICING ROUTE
   backend/routes/print-pricing.js
   ================================ */
const express = require('express');
const router  = express.Router();
const { pool } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

// GET all print pricing (public)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM print_pricing ORDER BY price ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update print price (admin only)
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { price } = req.body;
  if (!price) return res.status(400).json({ error: 'Price is required.' });
  try {
    const result = await pool.query(
      'UPDATE print_pricing SET price=$1 WHERE id=$2 RETURNING *',
      [price, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Price not found.' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;