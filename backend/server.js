require('dotenv').config();

// ── SENTRY — must initialize before anything else ───────
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: 'https://749ed2ea232dfaeeed46e8b711acf4fc@o4511594226253824.ingest.us.sentry.io/4511594359226368',
  environment: process.env.NODE_ENV || 'production',
  tracesSampleRate: 1.0, // capture 100% of transactions for now; lower this later if volume grows
  sendDefaultPii: false,  // don't auto-attach IP/cookies — we control what we send
});

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const rateLimit     = require('express-rate-limit');

const { initDB }          = require('./database');
const { router: authRouter } = require('./auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ─────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      process.env.FRONTEND_URL,
      'https://movffasea-byte.github.io',
      'http://127.0.0.1:5501',
      'http://localhost:5501'
    ];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// ── RATE LIMITERS ──────────────────────────────────────
// The chain in front of this app is: Cloudflare -> Render edge -> Render
// internal routing -> this app. That's 3 hops contributing to
// X-Forwarded-For before the real client IP. Trusting exactly 3 hops
// extracts the genuine client IP while still rejecting spoofed values
// beyond that depth.
app.set('trust proxy', 3);

// Strict — login, OTP, password-related routes (most common brute-force target)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 8,                    // 8 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' }
});

// Moderate — payment verification (legitimate retries happen, but cap abuse)
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment attempts. Please try again shortly.' }
});

// Relaxed — general API browsing (products, print-pricing, etc.)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
});

// ── ROUTES ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: "Jai'fore backend is live 🚀" });
});

// Auth routes get the strict limiter (login, OTP send/verify, register, etc.)
app.use('/api/auth', authLimiter, authRouter);

// Orders route handles both regular order creation AND /verify-payment —
// apply payment limiter to the whole router since payment-adjacent traffic
// is the sensitive part; general order reads are still capped, just more loosely
app.use('/api/orders', paymentLimiter, require('./routes/orders'));

// Everything else gets the general/relaxed limiter
app.use('/api/products',      generalLimiter, require('./routes/products'));
app.use('/api/transactions',  generalLimiter, require('./routes/transactions'));
app.use('/api/users',         generalLimiter, require('./routes/users'));
app.use('/api/print-pricing', generalLimiter, require('./routes/print-pricing'));
app.use('/api/backup',        generalLimiter, require('./routes/backup'));

app.use('/images', express.static(path.join(__dirname, 'images')));

// ── SENTRY ERROR HANDLER ───────────────────────────────
// Must come AFTER all routes, BEFORE any custom error handler / 404.
// This catches unhandled errors thrown in route handlers and reports them.
Sentry.setupExpressErrorHandler(app);

// ── 404 HANDLER ────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ── FINAL ERROR HANDLER ────────────────────────────────
// Catches anything Sentry passed through, sends a clean response to the client.
// Sentry has already captured the error by this point.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: 'Something went wrong. Our team has been notified.' });
});

// ── START ──────────────────────────────────────────────
async function start() {
  try {
    await initDB();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    Sentry.captureException(err);
    process.exit(1);
  }
}

start();