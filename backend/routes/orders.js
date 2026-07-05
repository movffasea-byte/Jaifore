/* ================================
   JAIFORE ORDERS ROUTE
   backend/routes/orders.js
   ================================ */
const express = require('express');
const router  = express.Router();
const { pool } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');
const axios = require('axios');
const Sentry = require('@sentry/node');
const { sendOrderConfirmation, sendAdminOrderAlert, sendOrderStatusUpdate } = require('../mailer');
const { cacheInvalidate } = require('../redis');

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
        txData.currency     || 'NGN',
      ]
    );

    const order = result.rows[0];

    // 7b. Decrement stock for each purchased item (item 12 — inventory management).
    // Only affects products with a real stock count set; NULL stock means
    // "not tracked" (e.g. print-on-demand or service items) and is left alone.
    try {
      for (const item of items) {
        const productId = item.id;
        const qty = Number(item.qty) || 1;
        if (!productId) {
          console.warn('[stock] Skipped — item has no product_id/id:', item);
          continue;
        }
        const stockResult = await pool.query(
          `UPDATE products
             SET stock = GREATEST(COALESCE(stock, 0) - $1, 0),
                 in_stock = (GREATEST(COALESCE(stock, 0) - $1, 0) > 0)
           WHERE id = $2 AND stock IS NOT NULL
           RETURNING id`,
          [qty, productId]
        );
        if (stockResult.rows.length) {
          await cacheInvalidate(`products:single:${productId}`);
        }
      }
      await cacheInvalidate('products:list:*');
    } catch (stockErr) {
      console.error('[stock] Decrement failed:', stockErr.message);
      Sentry.captureException(stockErr, { tags: { area: 'inventory' }, extra: { orderId: order.id } });
      // Non-blocking — an inventory bookkeeping issue must not fail the order
    }

    // 8. Send transactional emails (non-blocking — don't fail the order if email fails)
    const customerName  = req.user.name  || 'Customer';
    const customerEmail = req.user.email || '';

    Promise.allSettled([
      sendOrderConfirmation(customerEmail, customerName, order),
      sendAdminOrderAlert(order, customerName, customerEmail),
    ]).then(results => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const label = i === 0 ? 'Order confirmation' : 'Admin order alert';
          console.error(`[mailer] ${label} failed:`, r.reason?.message || r.reason);
          Sentry.captureException(r.reason, {
            tags: { area: 'transactional-email' },
            extra: { orderId: order.id, email: i === 0 ? customerEmail : process.env.ADMIN_EMAIL },
          });
        }
      });
    });

    res.status(201).json(order);

  } catch (err) {
    console.error('Flutterwave verify error:', err.response?.data || err.message);
    Sentry.withScope((scope) => {
      scope.setTag('area', 'payment-verification');
      scope.setContext('payment', {
        tx_ref,
        transaction_id,
        user_id: req.user?.id,
        attempted_total: total,
      });
      Sentry.captureException(err);
    });
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

// ── GET revenue summary (admin only) — daily/weekly/monthly series for charting ─
router.get('/revenue/summary', authenticate, requireAdmin, async (req, res) => {
  const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily';
  const bucket = period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month';
  const days   = period === 'daily' ? 30 : period === 'weekly' ? 90 : 365; // lookback window

  try {
    const result = await pool.query(
      `SELECT
         date_trunc($1, created_at) AS period,
         COUNT(*)::int AS order_count,
         SUM(total)::float AS revenue
       FROM orders
       WHERE payment_status = 'paid'
         AND created_at >= NOW() - $2::interval
       GROUP BY period
       ORDER BY period ASC`,
      [bucket, `${days} days`]
    );

    res.json({
      period,
      series: result.rows.map(r => ({
        date: r.period,
        revenue: parseFloat(r.revenue),
        orders: r.order_count,
      })),
    });
  } catch (err) {
    console.error('Revenue summary error:', err.message);
    Sentry.captureException(err, { tags: { area: 'admin-revenue' } });
    res.status(500).json({ error: err.message });
  }
});

// ── GET revenue quick totals: today / this week / this month / all-time ─
router.get('/revenue/quick-totals', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(SUM(total) FILTER (WHERE created_at >= date_trunc('day', NOW())), 0)::float   AS today,
        COALESCE(SUM(total) FILTER (WHERE created_at >= date_trunc('week', NOW())), 0)::float   AS this_week,
        COALESCE(SUM(total) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0)::float  AS this_month,
        COALESCE(SUM(total), 0)::float AS all_time
      FROM orders
      WHERE payment_status = 'paid'
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Revenue quick totals error:', err.message);
    Sentry.captureException(err, { tags: { area: 'admin-revenue' } });
    res.status(500).json({ error: err.message });
  }
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
    const order = result.rows[0];

    // Look up customer name/email for the notification (orders table doesn't store these)
    const customer = await pool.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [order.user_id]
    );

    if (customer.rows.length) {
      const { name: customerName, email: customerEmail } = customer.rows[0];
      sendOrderStatusUpdate(customerEmail, customerName, order, status)
        .catch(e => {
          console.error('Order status email error:', e.message);
          Sentry.captureException(e, {
            tags: { area: 'transactional-email' },
            extra: { orderId: order.id, status, email: customerEmail },
          });
        });
    } else {
      console.warn(`Order ${order.id} status updated but no matching user (id ${order.user_id}) found for notification.`);
    }

    res.json(order);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST initiate refund (admin only) ─────────────────
// Body: { amount, comments } — both optional. Omitting amount refunds the full total.
// Two Flutterwave calls are needed because orders only ever stored payment_ref
// (our own tx_ref), never Flutterwave's numeric transaction id that the refund
// endpoint actually requires — so we resolve it fresh each time via tx_ref.
router.post('/:id/refund', authenticate, requireAdmin, async (req, res) => {
  const { amount, comments } = req.body;

  try {
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!orderResult.rows.length) return res.status(404).json({ error: 'Order not found.' });
    const order = orderResult.rows[0];

    if (!order.payment_ref) {
      return res.status(400).json({ error: 'This order has no payment reference on file — cannot process a refund.' });
    }
    if (order.payment_status === 'refunded') {
      return res.status(409).json({ error: 'This order has already been refunded.' });
    }

    // 1. Resolve our tx_ref to Flutterwave's numeric transaction id
    const lookupRes = await axios.get(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(order.payment_ref)}`,
      { headers: { Authorization: `Bearer ${FLW_SECRET}` } }
    );

    if (lookupRes.data.status !== 'success' || !lookupRes.data.data?.id) {
      return res.status(502).json({ error: 'Could not locate this transaction with Flutterwave.' });
    }
    const flwTransactionId = lookupRes.data.data.id;

    // 2. Initiate the refund against that transaction id
    const refundBody = {};
    if (amount) refundBody.amount = amount; // omit entirely for a full refund
    if (comments) refundBody.comments = comments;

    const refundRes = await axios.post(
      `https://api.flutterwave.com/v3/transactions/${flwTransactionId}/refund`,
      refundBody,
      { headers: { Authorization: `Bearer ${FLW_SECRET}`, 'Content-Type': 'application/json' } }
    );

    if (refundRes.data.status !== 'success') {
      return res.status(502).json({ error: refundRes.data.message || 'Refund could not be initiated.' });
    }

    // 3. Mark the order refunded on our side
    const updated = await pool.query(
      `UPDATE orders SET payment_status = 'refunded' WHERE id = $1 RETURNING *`,
      [order.id]
    );

    res.json({
      message: 'Refund initiated.',
      refund: refundRes.data.data,
      order: updated.rows[0],
    });

  } catch (err) {
    console.error('Refund error:', err.response?.data || err.message);
    Sentry.withScope((scope) => {
      scope.setTag('area', 'refund');
      scope.setContext('refund', { orderId: req.params.id });
      Sentry.captureException(err);
    });
    res.status(500).json({ error: err.response?.data?.message || 'Refund failed. Please contact support or try again.' });
  }
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