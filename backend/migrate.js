/* ================================
   JAIFORE MIGRATION RUNNER
   backend/migrate.js

   Applies every migrations/*.sql file that hasn't run yet, in filename
   order, each inside its own transaction. Applied files are recorded in
   schema_migrations, so a file runs exactly once. Never edit a migration
   that has been applied — add a new, higher-numbered file instead.
   ================================ */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LOCK_KEY = 727001; // arbitrary app-wide id for the advisory lock

async function runMigrations(pool, dir = MIGRATIONS_DIR) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  const applied = [];

  try {
    // Stops two instances booting at once (e.g. a Railway redeploy) from racing.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
      applied.push(file);
      console.log(`[migrate] applied ${file}`);
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch { /* connection already gone */ }
    client.release();
  }
  return applied;
}

module.exports = { runMigrations };
