const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100)  NOT NULL,
        email      VARCHAR(150)  UNIQUE NOT NULL,
        password   VARCHAR(255)  NOT NULL,
        role       VARCHAR(20)   DEFAULT 'user',
        created_at TIMESTAMP     DEFAULT NOW()
      );
    `);
    console.log('✅ Database ready — users table initialized');
  } catch (err) {
    console.error('❌ DB init error:', err.message);
    throw err;
  }
}

module.exports = { pool, initDB };