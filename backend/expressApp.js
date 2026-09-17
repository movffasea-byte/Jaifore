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
const path         = require('path');
const rateLimit     = require('express-rate-limit');

const { router: authRouter } = require('./auth');

const app = express();

// ── MIDDLEWARE ─────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      process.env.FRONTEND_URL,
      'https://jai-fore-website.vercel.app',
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

app.use('/api/orders', paymentLimiter, require('./routes/orders'));

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