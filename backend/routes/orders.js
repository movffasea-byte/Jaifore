/* ================================
   JAIFORE ORDERS ROUTE
   backend/routes/orders.js

   Orders are created by the Stripe webhook (routes/stripe.js), never by the
   browser. This file lists/updates orders and handles refunds through Stripe.
   Flutterwave is gone: its verify-payment route (which trusted the price the
   browser sent) now just answers "payments have moved".
   ================================ */
const express = require('express');
const router  = express.Router();
const { pool } = require('../database');
const { serverError } = require('../errors');
const { sqlLocal, sqlNowLocal } = require('../businessTime');

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;
const { authenticate, requireAdmin } = require('../middleware');
const Sentry = require('@sentry/node');
const stripe = require('../stripeClient');
const { sendOrderStatusUpdate, sendRefundNotification, sendAdminRefundAlert } = require('../mailer');

// ── OLD FLUTTERWAVE ENDPOINT — RETIRED ────────────────
// Kept only so a stale cached checkout page gets a clear message instead of
// a confusing 404.
router.post('/verify-payment', authenticate, (req, res) => {
  res.status(410).json({ error: 'Payments have moved to Stripe. Please refresh the checkout page and try again.' });
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
  } catch (err) { serverError(res, err, 'orders'); }
});

// ── GET orders by date (admin only) ──────────────────
router.get('/by-date/:date', authenticate, requireAdmin, async (req, res) => {
  if (!DATE_PARAM.test(req.params.date)) return res.status(400).json({ error: 'Date must look like 2026-11-15.' });
  try {
    const result = await pool.query(`
      SELECT o.*, u.name AS customer_name, u.email AS customer_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE DATE(${sqlLocal('o.created_at')}) = $1
      ORDER BY o.created_at DESC
    `, [req.params.date]);
    res.json(result.rows);
  } catch (err) { serverError(res, err, 'orders'); }
});

// ── GET logged in user's orders ───────────────────────
router.get('/my', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) { serverError(res, err, 'orders'); }
});

// ── REVENUE (admin only) ──────────────────────────────
// Revenue counts only Stripe orders (stripe_session_id set), all in USD.
// Orders from the old Flutterwave test period used a different currency and
// would distort the totals, so they are left out of these figures (they still
// appear in the Orders list).
const REVENUE_FILTER = `payment_status IN ('paid', 'partially_refunded') AND stripe_session_id IS NOT NULL`;

router.get('/revenue/summary', authenticate, requireAdmin, async (req, res) => {
  const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily';
  const bucket = period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month';
  const days   = period === 'daily' ? 30 : period === 'weekly' ? 90 : 365; // lookback window

  try {
    const result = await pool.query(
      `SELECT
         date_trunc($1, ${sqlLocal('created_at')}) AS period,
         COUNT(*)::int AS order_count,
         SUM(total)::float AS revenue
       FROM orders
       WHERE ${REVENUE_FILTER}
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
    serverError(res, err, 'admin-revenue');
  }
});

router.get('/revenue/quick-totals', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(SUM(total) FILTER (WHERE ${sqlLocal('created_at')} >= date_trunc('day', ${sqlNowLocal()})), 0)::float   AS today,
        COALESCE(SUM(total) FILTER (WHERE ${sqlLocal('created_at')} >= date_trunc('week', ${sqlNowLocal()})), 0)::float   AS this_week,
        COALESCE(SUM(total) FILTER (WHERE ${sqlLocal('created_at')} >= date_trunc('month', ${sqlNowLocal()})), 0)::float  AS this_month,
        COALESCE(SUM(total), 0)::float AS all_time
      FROM orders
      WHERE ${REVENUE_FILTER}
    `);
    res.json(result.rows[0]);
  } catch (err) {
    serverError(res, err, 'admin-revenue');
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
  } catch (err) { serverError(res, err, 'orders'); }
});

// ── GET order status timeline (owning customer, or admin) — item 15 ──
router.get('/:id/timeline', authenticate, async (req, res) => {
  try {
    const order = await pool.query('SELECT id, user_id FROM orders WHERE id = $1', [req.params.id]);
    if (!order.rows.length) return res.status(404).json({ error: 'Order not found.' });

    // A customer can only ever see their own order's timeline
    if (order.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to view this order.' });
    }

    const history = await pool.query(
      `SELECT status, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json(history.rows);
  } catch (err) { serverError(res, err, 'orders'); }
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

    // item 15 — record this transition (non-blocking — the status update
    // itself already succeeded; a logging failure must never be reported
    // back to the admin as the whole status change having failed)
    try {
      await pool.query(
        `INSERT INTO order_status_history (order_id, status) VALUES ($1, $2)`,
        [order.id, status]
      );
    } catch (historyErr) {
      console.error('[timeline] Failed to log transition:', historyErr.message);
      Sentry.captureException(historyErr, { tags: { area: 'order-timeline' }, extra: { orderId: order.id, status } });
    }

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
            extra: { orderId: order.id, status, recipient: 'customer' },
          });
        });
    } else {
      console.warn(`Order ${order.id} status updated but no matching user (id ${order.user_id}) found for notification.`);
    }

    res.json(order);
  } catch (err) { serverError(res, err, 'orders'); }
});

// ── POST initiate refund (admin only) — through Stripe ─
// Body: { amount, comments } — both optional. Omitting amount refunds the
// full order total. Only orders paid through Stripe can be refunded here.
router.post('/:id/refund', authenticate, requireAdmin, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured on the server.' });

  const { amount } = req.body;

  try {
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!orderResult.rows.length) return res.status(404).json({ error: 'Order not found.' });
    const order = orderResult.rows[0];

    if (!order.stripe_payment_intent_id) {
      return res.status(400).json({
        error: 'This order was paid through the old Flutterwave gateway and can’t be refunded here. Refund it from the Flutterwave dashboard.'
      });
    }
    if (order.payment_status === 'refunded') {
      return res.status(409).json({ error: 'This order has already been refunded.' });
    }

    // Earlier partial refunds count against the total.
    const totalCents     = Math.round(Number(order.total) * 100);
    const refundedCents  = Math.round(Number(order.refunded_amount || 0) * 100);
    const remainingCents = totalCents - refundedCents;
    if (remainingCents <= 0) {
      return res.status(409).json({ error: 'This order has already been refunded.' });
    }

    // Optional partial refund (in dollars); leave it out to refund everything left
    let requestedCents = remainingCents;
    if (amount !== undefined && amount !== null && amount !== '') {
      const value = Number(amount);
      const cents = Math.round(value * 100);
      if (!Number.isFinite(value) || cents <= 0 || cents > remainingCents) {
        return res.status(400).json({
          error: `Refund amount must be more than 0 and no more than the $${(remainingCents / 100).toFixed(2)} left on this order.`,
        });
      }
      requestedCents = cents;
    }
    const isFullRefund = requestedCents >= remainingCents;

    // Same order + same refunded-so-far + same amount = same key, so a double
    // click or a retried request gets Stripe's first refund back, not a second one.
    const refund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_intent_id,
      ...(refundedCents === 0 && isFullRefund ? {} : { amount: requestedCents }),
      reason: 'requested_by_customer',
      metadata: { order_id: String(order.id) },
    }, { idempotencyKey: `refund-${order.id}-${refundedCents}-${requestedCents}` });

    // Compare-and-set: only the request that saw this refunded_amount records it.
    const updated = await pool.query(
      `UPDATE orders SET payment_status = $1, refunded_amount = $2
        WHERE id = $3 AND refunded_amount = $4 RETURNING *`,
      [isFullRefund ? 'refunded' : 'partially_refunded',
        ((refundedCents + requestedCents) / 100).toFixed(2), order.id, (refundedCents / 100).toFixed(2)]
    );
    if (!updated.rows.length) {
      return res.status(409).json({ error: 'This refund was already recorded. Reload the orders list.' });
    }
    const refundedOrder = updated.rows[0];

    // Refund emails (non-blocking — a failed email must never undo or block
    // the refund Stripe already processed).
    const refundAmount = requestedCents / 100;
    const customer = await pool.query(`SELECT name, email FROM users WHERE id = $1`, [order.user_id]);

    if (customer.rows.length) {
      const { name: customerName, email: customerEmail } = customer.rows[0];

      Promise.allSettled([
        sendRefundNotification(customerEmail, customerName, refundedOrder, refundAmount),
        sendAdminRefundAlert(refundedOrder, customerName, customerEmail, refundAmount),
      ]).then(results => {
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            const label = i === 0 ? 'Refund notification' : 'Admin refund alert';
            console.error(`[mailer] ${label} failed:`, r.reason?.message || r.reason);
            Sentry.captureException(r.reason, {
              tags: { area: 'transactional-email' },
              extra: { orderId: order.id, recipient: i === 0 ? 'customer' : 'admin' },
            });
          }
        });
      });
    } else {
      console.warn(`Order ${order.id} refunded but no matching user (id ${order.user_id}) found — customer notification skipped.`);
      sendAdminRefundAlert(refundedOrder, 'Unknown customer', '—', refundAmount)
        .catch(e => {
          console.error('[mailer] Admin refund alert failed:', e.message);
          Sentry.captureException(e, {
            tags: { area: 'transactional-email' },
            extra: { orderId: order.id, recipient: 'admin' },
          });
        });
    }

    res.json({
      message: 'Refund initiated.',
      refund: { id: refund.id, status: refund.status, amount: refund.amount / 100 },
      order: refundedOrder,
    });

  } catch (err) {
    console.error('Refund error:', err.raw?.message || err.message);
    Sentry.withScope((scope) => {
      scope.setTag('area', 'refund');
      scope.setContext('refund', { orderId: req.params.id });
      Sentry.captureException(err);
    });
    res.status(500).json({ error: err.raw?.message || 'Refund failed. Please try again or refund it from the Stripe dashboard.' });
  }
});

// ── POST create order directly (admin only, for manual orders) ─
// This used to be open to any logged-in customer, who could create an order
// with any total they chose. Real orders come from the Stripe webhook now.
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { items, total, shipping, user_id } = req.body;
  if (!items || !total) return res.status(400).json({ error: 'Items and total are required.' });
  try {
    const result = await pool.query(
      `INSERT INTO orders (user_id, items, total, shipping) VALUES ($1, $2, $3, $4) RETURNING *`,
      [user_id || req.user.id, JSON.stringify(items), total, JSON.stringify(shipping || {})]
    );
    const order = result.rows[0];

    // item 15 — seed the timeline with this order's starting status (non-blocking)
    try {
      await pool.query(
        `INSERT INTO order_status_history (order_id, status) VALUES ($1, $2)`,
        [order.id, order.status]
      );
    } catch (historyErr) {
      console.error('[timeline] Failed to seed history:', historyErr.message);
      Sentry.captureException(historyErr, { tags: { area: 'order-timeline' }, extra: { orderId: order.id } });
    }

    res.status(201).json(order);
  } catch (err) { serverError(res, err, 'orders'); }
});

module.exports = router;