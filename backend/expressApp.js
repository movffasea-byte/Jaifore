/* ================================
   JAIFORE — EXPRESS APP (BUILDER)
   backend/expressApp.js

   Deliberately NOT named app.js/App.js. That naming caused a real
   production incident: Windows treats app.js and App.js as the same
   file, but Railway's Linux build does not — a require('./app') call
   silently resolved to whichever casing existed locally, while
   production quietly ran a stale, unrelated file with no error at
   all. Naming this file something that can't collide on any casing
   convention removes that entire class of bug going forward.

   This file BUILDS the app (all middleware + routes) and exports it,
   but does NOT call app.listen() — server.js does that. This split
   only exists so Jest/Supertest can import the app object directly
   and send it fake requests in-memory, without needing a real port
   or a real database connection cycle per test file.
   ================================ */

require('dotenv').config();

// ── SENTRY — must initialize before anything else ───────
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: 'https://749ed2ea232dfaeeed46e8b711acf4fc@o4511594226253824.ingest.us.sentry.io/4511594359226368',
  environment: process.env.NODE_ENV || 'production',
  tracesSampleRate: 1.0,
  sendDefaultPii: false,
});

const express      = require('express');
const cors         = require('cors');
const helmet = require('helmet');
const path         = require('path');
const rateLimit     = require('express-rate-limit');

const { router: authRouter } = require('./auth');
const stripeRoutes = require('./routes/stripe');

const app = express();

// ── MIDDLEWARE ─────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      process.env.FRONTEND_URL,
      'https://jai-fore.vercel.app',
      'https://jai-fore-website.vercel.app',
      'https://movffasea-byte.github.io',
      'http://127.0.0.1:5501',
      'http://localhost:5501',
      // Capacitor mobile app (mobile/): Android serves the bundled site from
      // https://localhost, iOS from capacitor://localhost; http://localhost covers
      // older Android configs. Not live until the backend is redeployed.
      'capacitor://localhost',
      'http://localhost',
      'https://localhost'
    ];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  // PATCH was missing here, so the browser blocked every PATCH request:
  // cart quantity sync, the admin stock +/- buttons and QR code edits.
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));


app.use(helmet({
  contentSecurityPolicy: false, // enable + configure directives once external script sources are audited
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── STRIPE WEBHOOK — must come BEFORE express.json() ───
// Stripe signs the exact bytes it sends, so this one route needs the raw
// body. If express.json() ran first, the signature check would always fail.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeRoutes.webhookHandler
);

// ── JSON BODY PARSING ──────────────────────────────────
// Cart, wishlist and checkout requests can carry customer-uploaded artwork
// (as base64 text), which is far bigger than the 100kb default. Those paths
// get a larger limit; everything else keeps the small default. The first
// parser to run marks the body as parsed, so the global one below skips them.
// (Uploading artwork to file storage instead is the proper long-term fix.)
app.use(['/api/stripe', '/api/cart', '/api/wishlist'], express.json({ limit: '25mb' }));
app.use(express.json());

// ── RATE LIMITERS ──────────────────────────────────────
app.set('trust proxy', 1);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' }
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment attempts. Please try again shortly.' }
});

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

app.use('/api/qr', require('./routes/qr'));

app.use('/api/auth', authLimiter, authRouter);

// Orders no longer take payments (Stripe's webhook creates them), so this is
// an ordinary route now. The strict payment limiter used to count every admin
// dashboard load against its 20-per-15-minutes allowance.
app.use('/api/orders', generalLimiter, require('./routes/orders'));

// Starting a payment is the one place that keeps the strict limit. The quote
// route (called on every quantity change) uses the general limit.
app.use('/api/stripe/create-checkout-session', paymentLimiter);
app.use('/api/stripe', generalLimiter, stripeRoutes);

app.use('/api/products',      generalLimiter, require('./routes/products'));
app.use('/api/transactions',  generalLimiter, require('./routes/transactions'));
app.use('/api/users',         generalLimiter, require('./routes/users'));
app.use('/api/print-pricing', generalLimiter, require('./routes/print-pricing'));
app.use('/api/backup',        generalLimiter, require('./routes/backup'));

app.use('/api/wishlist', generalLimiter, require('./routes/wishlist'));
app.use('/api/recently-viewed', generalLimiter, require('./routes/recently-viewed'));
app.use('/api/cart', generalLimiter, require('./routes/cart'));

app.use('/images', express.static(path.join(__dirname, 'images')));

app.use('/admin', express.static(path.join(__dirname, '../frontend/admin')));

Sentry.setupExpressErrorHandler(app);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: 'Something went wrong. Our team has been notified.' });
});

module.exports = app;