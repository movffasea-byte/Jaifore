require('dotenv').config();
const express = require('express');
const cors    = require('cors');

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

// ── ROUTES ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: "Jai'fore backend is live 🚀" });
});

app.use('/api/auth',         authRouter);
app.use('/api/products',     require('./routes/products'));
app.use('/api/orders',       require('./routes/orders'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/users',        require('./routes/users'));
app.use('/api/print-pricing', require('./routes/print-pricing'));



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