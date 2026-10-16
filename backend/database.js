/* ================================
   JAIFORE DATABASE
   backend/database.js
   ================================ */
const { Pool } = require('pg');
const { runMigrations } = require('./migrate');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Schema lives in migrations/*.sql — see migrate.js.
async function initDB() {
  try {
    await runMigrations(pool);
    console.log('✅ Database ready — migrations up to date');
  } catch (err) { console.error('❌ DB init error:', err.message); throw err; }
}

module.exports = { pool, initDB };
