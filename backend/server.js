// backend/server.js
require('dotenv').config();

const app = require('./expressApp');
const { initDB } = require('./database');

const PORT = process.env.PORT || 3000;

// ── START ──────────────────────────────────────────────
// expressApp.js already builds and configures the app (Sentry init,
// CORS, middleware, rate limiters, routes, error handlers). This file
// only wires up the DB and starts listening — nothing else should be
// duplicated here.
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