/* ================================
   JAIFORE — ERROR RESPONSE + BACKUP TESTS
   backend/test/errors.test.js

   Unexpected failures must not leak their message to callers, must reach
   Sentry, and the GitHub backup must never contain password hashes.
   Fully mocked. Run with: npx jest test/errors.test.js
   ================================ */
process.env.JWT_SECRET = 'test-secret';
process.env.GITHUB_BACKUP_TOKEN = 'gh-token';
process.env.GITHUB_BACKUP_REPO = 'owner/backups';
process.env.BACKUP_SECRET = 'cron-secret';

const mockQuery = jest.fn();
jest.mock('../database', () => ({ pool: { query: (...a) => mockQuery(...a) } }));
jest.mock('../redis', () => ({ cacheGet: jest.fn(), cacheSet: jest.fn(), cacheInvalidate: jest.fn() }));
jest.mock('../middleware', () => ({
  authenticate: (req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => next(),
}));
jest.mock('../authUser', () => ({ verifyUserToken: jest.fn() }));
jest.mock('../stripeClient', () => ({}));
jest.mock('../push', () => ({ sendAdminPush: jest.fn() }));
jest.mock('../mailer', () => ({}));
jest.mock('@sentry/node', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const express = require('express');
const request = require('supertest');
const Sentry = require('@sentry/node');
const { serverError } = require('../errors');

const SECRET = 'connect ECONNREFUSED 10.0.0.5:5432 password=hunter2';

beforeEach(() => {
  mockQuery.mockReset();
  Sentry.captureException.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('serverError', () => {
  it('answers with a generic 500, logs the real message and reports to Sentry', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const err = new Error(SECRET);
    serverError(res, err, 'orders');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|hunter2/);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, { tags: { area: 'orders' } });
    expect(console.error).toHaveBeenCalledWith('[orders]', SECRET);
  });
});

describe('routes no longer leak raw error messages', () => {
  const mount = (path, router) => { const a = express(); a.use(express.json()); a.use(path, router); return a; };

  const cases = [
    ['GET /api/orders', () => request(mount('/api/orders', require('../routes/orders'))).get('/api/orders')],
    ['GET /api/orders/my', () => request(mount('/api/orders', require('../routes/orders'))).get('/api/orders/my')],
    ['GET /api/transactions', () => request(mount('/api/transactions', require('../routes/transactions'))).get('/api/transactions')],
    ['GET /api/users', () => request(mount('/api/users', require('../routes/users'))).get('/api/users')],
    ['GET /api/print-pricing', () => request(mount('/api/print-pricing', require('../routes/print-pricing'))).get('/api/print-pricing')],
    ['GET /api/products', () => request(mount('/api/products', require('../routes/products'))).get('/api/products')],
  ];

  it.each(cases)('%s answers a database failure with a generic message and reports it', async (_name, call) => {
    mockQuery.mockRejectedValue(new Error(SECRET));
    const res = await call();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|hunter2/);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});

describe('POST /api/backup', () => {
  const pushed = [];
  const app = () => { const a = express(); a.use(express.json()); a.use('/api/backup', require('../routes/backup')); return a; };
  const run = () => request(app()).post('/api/backup').set('x-backup-secret', 'cron-secret');

  beforeEach(() => {
    pushed.length = 0;
    global.fetch = jest.fn(async (url, opts = {}) => {
      if (opts.method === 'PUT') { pushed.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({}) }; }
      return { ok: false, json: async () => ({}) }; // file does not exist yet
    });
  });
  afterEach(() => { delete global.fetch; });

  const decoded = () => pushed.map(p => Buffer.from(p.body.content, 'base64').toString('utf8'));

  it('asks the database for rows without the password column and never pushes a hash', async () => {
    mockQuery.mockImplementation(async (sql) => {
      // What Postgres returns for: to_jsonb(t) - 'password'  (the hash is already gone)
      expect(sql).toMatch(/to_jsonb\(t\) - 'password'/);
      return { rows: [{ row: { id: 1, email: 'a@t.dev', role: 'user' } }] };
    });
    const res = await run();
    expect(res.status).toBe(200);
    const all = decoded().join('\n');
    expect(all).toContain('a@t.dev');
    expect(all).not.toMatch(/password|\$2[aby]\$/);
  });

  it('does not query with SELECT * any more', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await run();
    expect(mockQuery.mock.calls.every(c => !/SELECT \*/.test(c[0]))).toBe(true);
  });

  it('reports a failed table without leaking the database error, in the response or the manifest', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM orders/.test(sql)) throw new Error(SECRET);
      return { rows: [{ row: { id: 1 } }] };
    });
    const res = await run();
    expect(res.status).toBe(207);
    expect(res.body.results.orders).toEqual({ status: 'failed' });
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|hunter2/);
    expect(decoded().join('\n')).not.toMatch(/ECONNREFUSED|hunter2/);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { area: 'backup' }, extra: { table: 'orders' } });
  });
});
