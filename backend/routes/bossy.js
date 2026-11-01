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

// Caps reset at midnight in the business's time zone (Texas, US Central), not
// the server's (Railway runs UTC). Set from the server, never from the browser,
// so a customer can't switch zones to get extra messages.
const CAP_TIMEZONE = process.env.BOSSY_TIMEZONE || 'America/Chicago';
const CAP_KEY_TTL = 2 * 24 * 60 * 60; // the day is in the key; TTL only cleans up

const capFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CAP_TIMEZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Today's date (YYYY-MM-DD) in CAP_TIMEZONE and the seconds left until its
// midnight. The date goes in the Redis key, so the counter rolls over exactly
// at local midnight; resetIn is only for the "try again in" message and can be
// an hour off on the two DST-change days.
function capClock(now = new Date()) {
  const p = Object.fromEntries(capFormat.formatToParts(now).map((x) => [x.type, x.value]));
  const elapsed = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  return { day: `${p.year}-${p.month}-${p.day}`, resetIn: Math.max(24 * 3600 - elapsed, 1) };
}

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

// Counts this message against today's allowance.
// Returns { allowed, resetIn } where resetIn is seconds until local midnight.
// Redis trouble fails open so chat is never taken down by the cache.
async function checkDailyCap(req) {
  const isUser = Boolean(req.user?.id);
  const who = isUser ? `user:${req.user.id}` : `ip:${req.ip}`;
  const cap = isUser ? userCap() : guestCap();
  const { day, resetIn } = capClock();
  const key = `bossy:cap:${day}:${who}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, CAP_KEY_TTL);
    return count <= cap ? { allowed: true } : { allowed: false, resetIn };
  } catch (err) {
    console.error('Bossy cap check failed:', err.message);
    return { allowed: true };
  }
}

// "about 3 hours" / "about an hour" / "a few minutes"
function waitText(seconds) {
  const hours = Math.ceil(seconds / 3600);
  if (seconds < 15 * 60) return 'a few minutes';
  return hours <= 1 ? 'about an hour' : `about ${hours} hours`;
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

  const cap = await checkDailyCap(req);
  if (!cap.allowed) {
    const wait = waitText(cap.resetIn);
    res.set('Retry-After', String(cap.resetIn));
    return res.status(429).json({
      error: req.user
        ? `You've hit your chat limit. Even a boss needs a break. Try again in ${wait}, or use the contact form if it's urgent.`
        : `That's your limit as a guest. Log in for more chats, or try again in ${wait}, boss.`,
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

router.capClock = capClock; // exposed for tests
module.exports = router;
