/* ================================
   JAIFORE — MIGRATION RUNNER TESTS
   backend/test/migrate.test.js

   Mocked pool + temp migration folder. Run with: npx jest test/migrate.test.js
   ================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runMigrations } = require('../migrate');

let dir;
let client;
let pool;
const sql = () => client.query.mock.calls.map(c => String(c[0]).trim());

function makePool({ applied = [], failOn = null } = {}) {
  client = {
    release: jest.fn(),
    query: jest.fn(async (text) => {
      if (/SELECT name FROM schema_migrations/.test(text)) return { rows: applied.map(name => ({ name })) };
      if (failOn && text.includes(failOn)) throw new Error('syntax error');
      return { rows: [] };
    }),
  };
  pool = { connect: jest.fn().mockResolvedValue(client) };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
  fs.writeFileSync(path.join(dir, '002_second.sql'), 'SELECT 2;');
  fs.writeFileSync(path.join(dir, '001_first.sql'), 'SELECT 1;');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore me');
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

it('applies pending .sql files in filename order and records them', async () => {
  makePool();
  const applied = await runMigrations(pool, dir);
  expect(applied).toEqual(['001_first.sql', '002_second.sql']);
  expect(sql().indexOf('SELECT 1;')).toBeLessThan(sql().indexOf('SELECT 2;'));
  expect(client.query).toHaveBeenCalledWith('INSERT INTO schema_migrations (name) VALUES ($1)', ['001_first.sql']);
});

it('skips migrations already recorded', async () => {
  makePool({ applied: ['001_first.sql'] });
  const applied = await runMigrations(pool, dir);
  expect(applied).toEqual(['002_second.sql']);
  expect(sql()).not.toContain('SELECT 1;');
});

it('does nothing when everything is already applied', async () => {
  makePool({ applied: ['001_first.sql', '002_second.sql'] });
  expect(await runMigrations(pool, dir)).toEqual([]);
  expect(sql()).not.toContain('BEGIN');
});

it('rolls back, stops, names the failing file, and still unlocks and releases', async () => {
  makePool({ failOn: 'SELECT 2;' });
  await expect(runMigrations(pool, dir)).rejects.toThrow('Migration 002_second.sql failed');
  expect(sql()).toContain('ROLLBACK');
  expect(client.query).not.toHaveBeenCalledWith('INSERT INTO schema_migrations (name) VALUES ($1)', ['002_second.sql']);
  expect(sql().some(s => s.includes('pg_advisory_unlock'))).toBe(true);
  expect(client.release).toHaveBeenCalled();
});

it('holds the advisory lock before touching schema_migrations', async () => {
  makePool();
  await runMigrations(pool, dir);
  const lock = sql().findIndex(s => s.includes('pg_advisory_lock'));
  const create = sql().findIndex(s => s.includes('CREATE TABLE IF NOT EXISTS schema_migrations'));
  expect(lock).toBeGreaterThanOrEqual(0);
  expect(lock).toBeLessThan(create);
});

it('the baseline migration file exists and is idempotent DDL only', () => {
  const baseline = fs.readFileSync(path.join(__dirname, '../migrations/001_baseline.sql'), 'utf8');
  const creates = baseline.match(/CREATE TABLE/g) || [];
  const safe = baseline.match(/CREATE TABLE IF NOT EXISTS/g) || [];
  expect(creates.length).toBe(safe.length);
  expect(baseline).not.toMatch(/DROP |TRUNCATE|DELETE FROM/i);
});
