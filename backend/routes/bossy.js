/* ================================
   JAIFORE — BOSSY BOT ROUTES
   backend/routes/bossy.js

   POST /api/bossy/chat  { conversationId?, message }
   -> { conversationId, reply, actions }

   Guests are allowed; a valid JWT just attaches req.user.
   Daily caps live in Redis; conversations and history live in Postgres
   (bossyLog.js).
   ================================ */

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Sentry = require('@sentry/node');
const { redis } = require('../redis');
const { createReply, extractText } = require('../bossyClient');
const { SYSTEM_PROMPT } = require('../bossyPrompt');
const { toolsFor, runTool } = require('../bossyTools');
const { loadHistory, saveTurn } = require('../bossyLog');

const router = express.Router();

const MAX_MESSAGE_LENGTH = 1000;
const HISTORY_TURNS = 10;          // user+assistant pairs sent to the model
const MAX_TOOL_ROUNDS = 3;

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

// Runs the model, executing tool calls for up to MAX_TOOL_ROUNDS rounds.
// Tool blocks stay inside this request; only the final text goes back into history.
async function runWithTools(history, user) {
  const messages = [...history];
  const actions = [];
  const toolLog = [];
  const available = toolsFor(user);

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // After the last allowed round, call without tools to force a final answer.
    const tools = round < MAX_TOOL_ROUNDS ? available : [];
    const response = await createReply({ system: SYSTEM_PROMPT, messages, tools });
    const toolUses = (response.content || []).filter((b) => b.type === 'tool_use');

    if (!toolUses.length || !tools.length) {
      return { response, actions, toolLog };
    }

    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const tu of toolUses) {
      try {
        const out = await runTool(tu.name, tu.input, { user });
        actions.push(...out.actions);
        toolLog.push({ name: tu.name, summary: out.summary || tu.name });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out.result) });
      } catch (err) {
        console.error(`Bossy tool ${tu.name} failed:`, err.message);
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          is_error: true,
          content: 'That lookup failed. Tell the customer you could not check it right now.',
        });
      }
    }
    messages.push({ role: 'user', content: results });
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

  const userText = message.trim();

  let conversationId = null;
  let history = [];
  if (typeof clientId === 'string' && UUID_RE.test(clientId)) {
    try {
      const saved = await loadHistory(clientId, req.user?.id);
      if (saved) {
        conversationId = clientId;
        history = saved;
      }
    } catch (err) {
      // Carry on with an empty history rather than failing the chat.
      console.error('Bossy history load failed:', err.message);
      Sentry.captureException(err);
    }
  }
  const isNew = !conversationId;
  if (isNew) conversationId = crypto.randomUUID();

  // Only the last N turns (each turn = user + assistant message) go to the model.
  const recent = [...history, { role: 'user', content: userText }].slice(-(HISTORY_TURNS * 2 - 1));

  try {
    const { response, actions, toolLog } = await runWithTools(recent, req.user);
    const reply = extractText(response) || "I'm lost for words. Try asking me again.";

    try {
      await saveTurn({ conversationId, isNew, userId: req.user?.id, ip: req.ip, userText, toolLog, reply });
    } catch (err) {
      // The customer still gets their answer; the log write is reported.
      console.error('Bossy log save failed:', err.message);
      Sentry.captureException(err);
    }

    return res.json({ conversationId, reply, actions });
  } catch (err) {
    console.error('Bossy chat failed:', err.message);
    Sentry.captureException(err);
    return res.status(502).json({
      error: "Bossy Bot is taking a breather. Try again in a moment.",
    });
  }
});

module.exports = router;
