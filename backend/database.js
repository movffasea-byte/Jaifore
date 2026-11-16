/* ================================
   JAIFORE DATABASE
   backend/database.js
   ================================ */
const { Pool } = require('pg');
const { runMigrations } = require('./migrate');

const Sentry = require('@sentry/node');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,                        // Railway's Postgres has a small connection budget
  idleTimeoutMillis: 30000,       // drop idle connections instead of holding them forever
  connectionTimeoutMillis: 10000, // fail fast when the database can't be reached
  statement_timeout: 30000,       // a runaway query can't hold a connection (and a request) forever
});

// An idle client can error (database restart, network drop). Without a listener
// Node treats that as an uncaught 'error' event and the whole server crashes.
// pg discards the broken client by itself; we only need to not die and to report it.
pool.on('error', (err) => {
  console.error('[db] Idle client error:', err.message);
  Sentry.captureException(err, { tags: { area: 'database-pool' } });
});

// Schema lives in migrations/*.sql — see migrate.js.
async function initDB() {
  try {
    await runMigrations(pool);
    console.log('✅ Database ready — migrations up to date');
  } catch (err) { console.error('❌ DB init error:', err.message); throw err; }
}

module.exports = { pool, initDB };
