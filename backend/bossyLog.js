/* ================================
   JAIFORE — BOSSY BOT CONVERSATION LOG
   backend/bossyLog.js

   Reads and writes bossy_conversations / bossy_messages. History for the
   model always comes from here (never from the client).
   ================================ */

const crypto = require('crypto');
const { pool } = require('./database');

const HISTORY_ROWS = 20;     // 10 turns of user + assistant messages
const TOOL_SUMMARY_MAX = 500;

/** Keyed hash of the IP; the raw address is never stored. */
function hashIp(ip) {
  const key = process.env.BOSSY_IP_SALT || process.env.JWT_SECRET || '';
  return crypto.createHmac('sha256', key).update(String(ip || '')).digest('hex');
}

/**
 * Text history for a conversation the caller may continue, or null when the
 * id is unknown or belongs to a different user (the caller then starts fresh).
 */
async function loadHistory(conversationId, userId) {
  const conv = await pool.query('SELECT user_id FROM bossy_conversations WHERE id = $1', [conversationId]);
  if (!conv.rows.length) return null;
  const owner = conv.rows[0].user_id;
  if (owner !== null && Number(owner) !== Number(userId)) return null;

  const { rows } = await pool.query(
    `SELECT role, content FROM (
       SELECT id, role, content FROM bossy_messages
       WHERE conversation_id = $1 AND role IN ('user', 'assistant')
       ORDER BY id DESC LIMIT $2
     ) recent ORDER BY id ASC`,
    [conversationId, HISTORY_ROWS]
  );
  while (rows.length && rows[0].role !== 'user') rows.shift(); // model history must start with a user turn
  return rows.map((r) => ({ role: r.role, content: r.content }));
}

/** Saves one finished turn: user message, tool calls, assistant reply. */
async function saveTurn({ conversationId, isNew, userId, ip, userText, toolLog, reply }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isNew) {
      await client.query(
        'INSERT INTO bossy_conversations (id, user_id, ip_hash) VALUES ($1, $2, $3)',
        [conversationId, userId ?? null, hashIp(ip)]
      );
    }
    const insert = 'INSERT INTO bossy_messages (conversation_id, role, content, tool_name) VALUES ($1, $2, $3, $4)';
    await client.query(insert, [conversationId, 'user', userText, null]);
    for (const t of toolLog) {
      await client.query(insert, [conversationId, 'tool', String(t.summary).slice(0, TOOL_SUMMARY_MAX), t.name]);
    }
    await client.query(insert, [conversationId, 'assistant', reply, null]);
    await client.query('UPDATE bossy_conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { hashIp, loadHistory, saveTurn };
