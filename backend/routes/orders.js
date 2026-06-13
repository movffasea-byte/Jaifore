/* ================================
   JAIFORE ORDERS ROUTE
   backend/routes/orders.js
   ================================ */
const express = require('express');
const router  = express.Router();
const { pool } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');
const axios = require('axios');

const FLW_SECRET = process.env.FLUTTERWAVE_SECRET_KEY;

// ── VERIFY PAYMENT + CREATE ORDER (authenticated user) ─
router.post('/verify-payment', authenticate, async (req, res) => {
  const { transaction_id, tx_ref, items, total, shipping } = req.body;

  if (!transaction_id || !tx_ref || !items || !total) {
    return res.status(400).json({ error: 'Missing required payment fields.' });
  }

  try {
    // 1. Verify transaction with Flutterwave
    const flwRes = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      { headers: { Authorization: `Bearer ${FLW_SECRET}` } }
    );

    const flwData = flwRes.data;

    // 2. Validate response
    if (flwData.status !== 'success') {
      return res.status(400).json({ error: 'Payment verification failed.' });
    }

    const txData = flwData.data;

    // 3. Check payment status
    if (txData.status !== 'successful') {
      return res.status(400).json({ error: `Payment status: ${txData.status}. Order not created.` });
    }

    // 4. Check tx_ref matches (prevents replay attacks)
    if (txData.tx_ref !== tx_ref) {
      return res.status(400).json({ error: 'Transaction reference mismatch.' });
    }

    // 5. Check amount matches (allow small float margin)
    const paidAmount  = parseFloat(txData.amount);
    const orderAmount = parseFloat(total);
    if (Math.abs(paidAmount - orderAmount) > 1) {
      return res.status(400).json({
        error: `Amount mismatch. Expected ${orderAmount}, got ${paidAmount}.`
      });
    }

    // 6. Check for duplicate — prevent double order on same transaction
    const existing = await pool.query(
      `SELECT id FROM orders WHERE payment_ref = $1`,
      [tx_ref]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Order already created for this payment.' });
    }

    // 7. Create the order with payment details
    const result = await pool.query(
      `INSERT INTO orders
         (user_id, items, total, shipping, payment_ref, payment_status, payment_method, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.user.id,
        JSON.stringify(items),
        total,
        JSON.stringify(shipping || {}),
        tx_ref,
        'paid',
        txData.payment_type || 'card',
        txData.currency     || 'USD',
      ]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error('Flutterwave verify error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Payment verification error. Please contact support.' });
  }
});

// ── GET all orders (admin only) ───────────────────────
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, u.name AS customer_name, u.email AS customer_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET orders by date (admin only) ──────────────────
router.get('/by-date/:date', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, u.name AS customer_name, u.email AS customer_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE DATE(o.created_at) = $1
      ORDER BY o.created_at DESC
    `, [req.params.date]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET logged in user's orders ───────────────────────
router.get('/my', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET single order (admin only) ────────────────────
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, u.name AS customer_name, u.email AS customer_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Order not found.' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT update order status (admin only) ─────────────
router.put('/:id/status', authenticate, requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'Status is required.' });
  try {
    const result = await pool.query(
      `UPDATE orders SET status=$1 WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Order not found.' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST create order directly (kept for manual/admin use) ─
router.post('/', authenticate, async (req, res) => {
  const { items, total, shipping } = req.body;
  if (!items || !total) return res.status(400).json({ error: 'Items and total are required.' });
  try {
    const result = await pool.query(
      `INSERT INTO orders (user_id, items, total, shipping) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, JSON.stringify(items), total, JSON.stringify(shipping || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;