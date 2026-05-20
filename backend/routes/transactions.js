/* ================================
   JAIFORE TRANSACTIONS ROUTE
   backend/routes/transactions.js
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

// POST create transaction (authenticated user)
router.post('/', authenticate, async (req, res) => {
  const { order_id, amount, reference, status, payment_method } = req.body;
  if (!amount || !reference) return res.status(400).json({ error: 'Amount and reference are required.' });
  try {
    const result = await pool.query(
      `INSERT INTO transactions (order_id, user_id, amount, reference, status, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [order_id, req.user.id, amount, reference, status || 'success', payment_method || 'paystack']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;