/* ================================
   JAIFORE TRANSACTIONS ROUTE
   backend/routes/transactions.js

   Read-only for admins. Transactions are recorded by the Stripe webhook
   (routes/stripe.js) when a payment actually succeeds. The old
   POST /api/transactions route is gone: it let any logged-in customer
   insert a "success" transaction with any amount, and those rows feed
   the admin revenue figures.
   ================================ */
const express = require('express');
const router  = express.Router();
const { pool } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');

// GET all transactions (admin only)
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, u.name AS customer_name, u.email AS customer_email
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET transactions by date (admin only)
router.get('/by-date/:date', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, u.name AS customer_name, u.email AS customer_email
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE DATE(t.created_at) = $1
      ORDER BY t.created_at DESC
    `, [req.params.date]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET transactions summary per month (for calendar dots)
router.get('/summary/:year/:month', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DATE(created_at) AS date, COUNT(*) AS count, SUM(amount) AS total
      FROM transactions
      WHERE EXTRACT(YEAR FROM created_at)  = $1
        AND EXTRACT(MONTH FROM created_at) = $2
      GROUP BY DATE(created_at)
    `, [req.params.year, req.params.month]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;