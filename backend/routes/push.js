/* ================================
   JAIFORE PUSH ROUTES (admin only)
   backend/routes/push.js

   The admin page registers its browser/phone here so new orders can reach
   it with the page closed. Sending lives in push.js.
   ================================ */
const express = require('express');
const router  = express.Router();
const { pool } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');
const { pushEnabled } = require('../push');

router.use(authenticate, requireAdmin);

// ── GET the public key the browser needs to subscribe ─
router.get('/key', (req, res) => {
  if (!pushEnabled()) return res.status(503).json({ error: 'Push is not configured.' });
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ── POST save (or refresh) this device's subscription ─
router.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2000
      || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
    return res.status(400).json({ error: 'A valid push subscription is required.' });
  }
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );
    res.status(201).json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST remove this device's subscription ────────────
router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'Endpoint is required.' });
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
