// backend/server.js
require('dotenv').config();

const app = require('./expressApp');
const { initDB, pool } = require('./database');
const { redis } = require('./redis');
const { createShutdown } = require('./shutdown');
const { startMaintenance } = require('./maintenance');

const PORT = process.env.PORT || 3000;

// ── START ──────────────────────────────────────────────
// expressApp.js already builds and configures the app (Sentry init,
// CORS, middleware, rate limiters, routes, error handlers). This file
// only wires up the DB and starts listening — nothing else should be
// duplicated here.
async function start() {
  try {
    await initDB();
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
    const shutdown = createShutdown({ server, pool, redis });
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    startMaintenance({ pool });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
}

start();