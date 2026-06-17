require('dotenv').config();
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
// Trust Render's proxy so req.ip reflects the real client IP, not the proxy IP
app.set('trust proxy', 1);

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

app.use('/images', express.static(path.join(__dirname, 'images')));

// ── 404 HANDLER ────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
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
    process.exit(1);
  }
}

start();