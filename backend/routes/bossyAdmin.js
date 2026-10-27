/* ================================
   JAIFORE BOSSY ADMIN ROUTE
   backend/routes/bossyAdmin.js

   Read-only view of the Bossy Bot chat log for the admin Bossy tab:
   usage stats, a paged conversation list, and one full transcript (tool
   calls included). Admin only. The IP hash is never returned.
   ================================ */
const express = require('express');
const router  = express.Router();
const { pool } = require('../database');
const { authenticate, requireAdmin } = require('../middleware');
const Sentry = require('@sentry/node');

const PAGE_SIZE = 20;
const PREVIEW_MAX = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res, err, what) {
  Sentry.captureException(err);
  console.error(`bossy-admin ${what}:`, err.message);
  res.status(500).json({ error: 'Could not load Bossy data.' });
}

// ── Usage stats ───────────────────────────────────────
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const counts = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))      AS today,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')     AS week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')    AS month,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days' AND user_id IS NOT NULL) AS signed_in,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days' AND user_id IS NULL)     AS guests
      FROM bossy_conversations`);
    const messages = await pool.query(
      `SELECT COUNT(*) AS n FROM bossy_messages
       WHERE role = 'user' AND created_at >= NOW() - INTERVAL '30 days'`);
    const tools = await pool.query(
      `SELECT tool_name AS name, COUNT(*) AS n FROM bossy_messages
       WHERE role = 'tool' AND tool_name IS NOT NULL AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY tool_name ORDER BY n DESC, tool_name LIMIT 6`);

    const c = counts.rows[0];
    res.json({
      conversations: { today: Number(c.today), week: Number(c.week), month: Number(c.month) },
      signedIn: Number(c.signed_in),
      guests: Number(c.guests),
      userMessages30d: Number(messages.rows[0].n),
      topTools: tools.rows.map((t) => ({ name: t.name, count: Number(t.n) })),
    });
  } catch (err) { fail(res, err, 'stats'); }
});

// ── Conversation list, newest activity first ──────────
router.get('/conversations', authenticate, requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  try {
    const total = await pool.query('SELECT COUNT(*) AS n FROM bossy_conversations');
    const { rows } = await pool.query(
      `SELECT c.id, c.created_at, c.updated_at, c.user_id, u.name AS user_name,
              (SELECT COUNT(*) FROM bossy_messages m WHERE m.conversation_id = c.id AND m.role <> 'tool') AS message_count,
              (SELECT m.content FROM bossy_messages m WHERE m.conversation_id = c.id AND m.role = 'user'
               ORDER BY m.id LIMIT 1) AS first_message
       FROM bossy_conversations c
       LEFT JOIN users u ON u.id = c.user_id
       ORDER BY c.updated_at DESC
       LIMIT $1 OFFSET $2`,
      [PAGE_SIZE, (page - 1) * PAGE_SIZE]
    );
    res.json({
      page,
      pageSize: PAGE_SIZE,
      total: Number(total.rows[0].n),
      conversations: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        who: r.user_id ? (r.user_name || 'Customer') : 'Guest',
        messageCount: Number(r.message_count),
        preview: r.first_message ? String(r.first_message).slice(0, PREVIEW_MAX) : '',
      })),
    });
  } catch (err) { fail(res, err, 'list'); }
});

// ── One full transcript ───────────────────────────────
router.get('/conversations/:id', authenticate, requireAdmin, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Conversation not found.' });
  try {
    const conv = await pool.query(
      `SELECT c.id, c.created_at, c.user_id, u.name AS user_name, u.email AS user_email
       FROM bossy_conversations c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversation not found.' });
    const msgs = await pool.query(
      `SELECT role, content, tool_name, created_at FROM bossy_messages
       WHERE conversation_id = $1 ORDER BY id`,
      [req.params.id]
    );
    const c = conv.rows[0];
    res.json({
      id: c.id,
      createdAt: c.created_at,
      who: c.user_id ? { name: c.user_name || 'Customer', email: c.user_email || null } : null,
      messages: msgs.rows.map((m) => ({
        role: m.role,
        text: m.content,
        tool: m.tool_name || null,
        at: m.created_at,
      })),
    });
  } catch (err) { fail(res, err, 'transcript'); }
});

module.exports = router;
