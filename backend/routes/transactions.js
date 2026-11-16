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
const { serverError } = require('../errors');
const { sqlLocal } = require('../businessTime');

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;
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
  } catch (err) { serverError(res, err, 'transactions'); }
});

// GET transactions by date (admin only)
router.get('/by-date/:date', authenticate, requireAdmin, async (req, res) => {
  if (!DATE_PARAM.test(req.params.date)) return res.status(400).json({ error: 'Date must look like 2026-11-15.' });
  try {
    const result = await pool.query(`
      SELECT t.*, u.name AS customer_name, u.email AS customer_email
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE DATE(${sqlLocal('t.created_at')}) = $1
      ORDER BY t.created_at DESC
    `, [req.params.date]);
    res.json(result.rows);
  } catch (err) { serverError(res, err, 'transactions'); }
});

// GET transactions summary per month (for calendar dots)
router.get('/summary/:year/:month', authenticate, requireAdmin, async (req, res) => {
  const year = Number(req.params.year), month = Number(req.params.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Year and month must be valid numbers.' });
  }
  try {
    const result = await pool.query(`
      SELECT to_char(DATE(${sqlLocal('created_at')}), 'YYYY-MM-DD') AS date, COUNT(*) AS count, SUM(amount) AS total
      FROM transactions
      WHERE EXTRACT(YEAR FROM ${sqlLocal('created_at')})  = $1
        AND EXTRACT(MONTH FROM ${sqlLocal('created_at')}) = $2
      GROUP BY DATE(${sqlLocal('created_at')})
    `, [year, month]);
    res.json(result.rows);
  } catch (err) { serverError(res, err, 'transactions'); }
});

module.exports = router;