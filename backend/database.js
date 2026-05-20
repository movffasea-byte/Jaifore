/* ================================
   JAIFORE DATABASE
   backend/database.js
   ================================ */
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  try {
    // Users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100)  NOT NULL,
        email      VARCHAR(150)  UNIQUE NOT NULL,
        password   VARCHAR(255)  NOT NULL,
        role       VARCHAR(20)   DEFAULT 'user',
        verified   BOOLEAN       DEFAULT false,
        created_at TIMESTAMP     DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false;`);

    // Products
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(150)  NOT NULL,
        description TEXT,
        price       NUMERIC(10,2) NOT NULL,
        category    VARCHAR(100),
        image_url   TEXT,
        in_stock    BOOLEAN       DEFAULT true,
        created_at  TIMESTAMP     DEFAULT NOW()
      );
    `);

    // Orders
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        items        JSONB         NOT NULL,
        total        NUMERIC(10,2) NOT NULL,
        status       VARCHAR(50)   DEFAULT 'pending',
        created_at   TIMESTAMP     DEFAULT NOW()
      );
    `);

    // Transactions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id             SERIAL PRIMARY KEY,
        order_id       INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        amount         NUMERIC(10,2) NOT NULL,
        reference      VARCHAR(200)  UNIQUE,
        status         VARCHAR(50)   DEFAULT 'pending',
        payment_method VARCHAR(100)  DEFAULT 'paystack',
        created_at     TIMESTAMP     DEFAULT NOW()
      );
    `);

    console.log('✅ Database ready — all tables initialized');
  } catch (err) { console.error('❌ DB init error:', err.message); throw err; }
}

module.exports = { pool, initDB };