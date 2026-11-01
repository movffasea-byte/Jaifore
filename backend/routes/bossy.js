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
const { BUSINESS_TIMEZONE } = require('../businessTime');

const router = express.Router();

const MAX_MESSAGE_LENGTH = 1000;
const HISTORY_TURNS = 10;          // user+assistant pairs sent to the model
const MAX_TOOL_ROUNDS = 3;

const userCap = () => Number(process.env.BOSSY_USER_DAILY_CAP) || 50;
const guestCap = () => Number(process.env.BOSSY_GUEST_DAILY_CAP) || 15;
// Guests are counted per browser (guestId), so customers sharing one carrier IP
// don't share one allowance. guestId is client-made and easy to rotate, so every
// guest message also counts against this much higher per-IP ceiling: that is
// what keeps total spend bounded.
const guestIpCap = () => Number(process.env.BOSSY_GUEST_IP_DAILY_CAP) || 150;

// Caps reset at midnight in the business's time zone (businessTime.js), not
// the server's (Railway runs UTC). Set from the server, never from the browser,
// so a customer can't switch zones to get extra messages.
const CAP_KEY_TTL = 2 * 24 * 60 * 60; // the day is in the key; TTL only cleans up

const capFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Today's date (YYYY-MM-DD) in BUSINESS_TIMEZONE and the seconds left until its
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

// Per-process stand-in for the Redis counters, used only while Redis is
// unreachable. Less exact (each instance and each restart starts from zero),
// but the caps still hold, so a Redis outage can't become an unbounded API bill.
const memoryCounts = new Map();
let memoryDay = null;

function memoryIncr(day, key) {
  if (day !== memoryDay) { memoryCounts.clear(); memoryDay = day; }
  const count = (memoryCounts.get(key) || 0) + 1;
  memoryCounts.set(key, count);
  return count;
}

// An outage would otherwise log and report on every chat message.
const FALLBACK_REPORT_MS = 60 * 1000;
let lastFallbackReport = 0;

function reportFallback(err) {
  const now = Date.now();
  if (now - lastFallbackReport < FALLBACK_REPORT_MS) return;
  lastFallbackReport = now;
  console.error('Bossy caps using in-memory fallback, Redis unavailable:', err.message);
  Sentry.captureException(err, { tags: { area: 'bossy-cap' } });
}

// Adds one to today's counter for `who` and returns the new count.
// If Redis is down the count moves to memory: chat stays up and caps still apply.
async function bump(day, who) {
  const key = `bossy:cap:${day}:${who}`;
  try {
    const count = await redis.incr(key);
    // Cleanup only (the day is in the key), so a failure here doesn't matter.
    if (count === 1) redis.expire(key, CAP_KEY_TTL).catch(() => {});
    return count;
  } catch (err) {
    reportFallback(err);
    return memoryIncr(day, key);
  }
}

// Counts this message against today's allowance.
// Returns { allowed, resetIn, limit } where resetIn is seconds until local
// midnight and limit says which cap was hit ('own' or 'network').
//   signed in:          per user
//   guest with guestId: per browser, plus the shared per-IP ceiling
//   guest without one:  per IP (older clients, e.g. the mobile app)
async function checkDailyCap(req, guestId) {
  const { day, resetIn } = capClock();
  const deny = (limit) => ({ allowed: false, resetIn, limit });

  if (req.user?.id) {
    return (await bump(day, `user:${req.user.id}`)) <= userCap() ? { allowed: true } : deny('own');
  }
  if (!guestId) {
    return (await bump(day, `ip:${req.ip}`)) <= guestCap() ? { allowed: true } : deny('own');
  }
  if ((await bump(day, `guest:${guestId}`)) > guestCap()) return deny('own');
  if ((await bump(day, `guestip:${req.ip}`)) > guestIpCap()) return deny('network');
  return { allowed: true };
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
  const { conversationId: clientId, message, guestId: rawGuestId } = req.body || {};
  const guestId = typeof rawGuestId === 'string' && UUID_RE.test(rawGuestId) ? rawGuestId.toLowerCase() : null;

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res
      .status(400)
      .json({ error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` });
  }

  const cap = await checkDailyCap(req, guestId);
  if (!cap.allowed) {
    const wait = waitText(cap.resetIn);
    res.set('Retry-After', String(cap.resetIn));
    let error;
    if (req.user) {
      error = `You've hit your chat limit. Even a boss needs a break. Try again in ${wait}, or use the contact form if it's urgent.`;
    } else if (cap.limit === 'network') {
      error = `Lots of guests on your network are chatting today. Log in to keep going, or try again in ${wait}, boss.`;
    } else {
      error = `That's your limit as a guest. Log in for more chats, or try again in ${wait}, boss.`;
    }
    return res.status(429).json({ error });
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
router.resetCapFallback = () => { memoryCounts.clear(); memoryDay = null; lastFallbackReport = 0; }; // tests only
module.exports = router;
