/* ================================
   JAIFORE — BOSSY BOT ROUTES
   backend/routes/bossy.js

   POST /api/bossy/chat  { conversationId?, message }
   -> { conversationId, reply, actions: [] }

   Guests are allowed; a valid JWT just attaches req.user.
   Daily caps and short-term history live in Redis (Phase 4 moves
   history to the database).
   ================================ */

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Sentry = require('@sentry/node');
const { redis } = require('../redis');
const { createReply, extractText } = require('../bossyClient');
const { SYSTEM_PROMPT } = require('../bossyPrompt');

const router = express.Router();

const MAX_MESSAGE_LENGTH = 1000;
const HISTORY_TURNS = 10;          // user+assistant pairs sent to the model
const HISTORY_TTL_SECONDS = 24 * 60 * 60;

const userCap = () => Number(process.env.BOSSY_USER_DAILY_CAP) || 50;
const guestCap = () => Number(process.env.BOSSY_GUEST_DAILY_CAP) || 15;

// Attach req.user when a valid token is present; never reject.
function optionalAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    } catch {
      // Bad or expired token: treat as a guest.
    }
  }
  next();
}

// Counts this message against today's allowance. Returns true if allowed.
// Redis trouble fails open so chat is never taken down by the cache.
async function withinDailyCap(req) {
  const isUser = Boolean(req.user?.id);
  const who = isUser ? `user:${req.user.id}` : `ip:${req.ip}`;
  const cap = isUser ? userCap() : guestCap();
  const key = `bossy:cap:${who}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      await redis.expireat(key, Math.floor(midnight.getTime() / 1000));
    }
    return count <= cap;
  } catch (err) {
    console.error('Bossy cap check failed:', err.message);
    return true;
  }
}

async function loadHistory(conversationId) {
  try {
    const raw = await redis.get(`bossy:conv:${conversationId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Bossy history load failed:', err.message);
    return null;
  }
}

async function saveHistory(conversationId, history) {
  try {
    await redis.set(
      `bossy:conv:${conversationId}`,
      JSON.stringify(history),
      'EX',
      HISTORY_TTL_SECONDS
    );
  } catch (err) {
    console.error('Bossy history save failed:', err.message);
  }
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

router.post('/chat', optionalAuth, async (req, res) => {
  const { conversationId: clientId, message } = req.body || {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res
      .status(400)
      .json({ error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` });
  }

  if (!(await withinDailyCap(req))) {
    return res.status(429).json({
      error: req.user
        ? "You've hit today's chat limit. Even a boss needs a break. Come back tomorrow, or use the contact form if it's urgent."
        : "That's your daily limit as a guest. Log in for more chats, or come back tomorrow, boss.",
    });
  }

  let conversationId = null;
  let history = null;
  if (typeof clientId === 'string' && UUID_RE.test(clientId)) {
    history = await loadHistory(clientId);
    if (history) conversationId = clientId;
  }
  if (!conversationId) {
    conversationId = crypto.randomUUID();
    history = [];
  }

  history.push({ role: 'user', content: message.trim() });
  // Only the last N turns (each turn = user + assistant message) go to the model.
  const recent = history.slice(-(HISTORY_TURNS * 2 - 1));

  try {
    const response = await createReply({ system: SYSTEM_PROMPT, messages: recent });
    const reply = extractText(response) || "I'm lost for words. Try asking me again.";

    history.push({ role: 'assistant', content: reply });
    await saveHistory(conversationId, history.slice(-HISTORY_TURNS * 2));

    return res.json({ conversationId, reply, actions: [] });
  } catch (err) {
    console.error('Bossy chat failed:', err.message);
    Sentry.captureException(err);
    return res.status(502).json({
      error: "Bossy Bot is taking a breather. Try again in a moment.",
    });
  }
});

module.exports = router;
