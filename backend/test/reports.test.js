/* ================================
   JAIFORE — STOCK EDIT + TEXAS-TIME REPORT TESTS
   backend/test/reports.test.js

   Fully mocked. The SQL itself is checked against a real Postgres by hand
   (see the commit message); here we pin the shape that matters.
   Run with: npx jest test/reports.test.js
   ================================ */
process.env.JWT_SECRET = 'test-secret';

const mockQuery = jest.fn();
jest.mock('../database', () => ({ pool: { query: (...a) => mockQuery(...a) } }));
jest.mock('../redis', () => ({ cacheGet: jest.fn(), cacheSet: jest.fn(), cacheInvalidate: jest.fn() }));
jest.mock('../middleware', () => ({
  authenticate: (req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => next(),
}));
jest.mock('../mailer', () => ({ sendLowStockAlert: jest.fn().mockResolvedValue(), sendOrderStatusUpdate: jest.fn(), sendAdminRefundAlert: jest.fn(), sendRefundNotification: jest.fn() }));
jest.mock('../stripeClient', () => ({}));
jest.mock('../push', () => ({ sendAdminPush: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const express = require('express');
const request = require('supertest');

const mount = (path, router) => { const a = express(); a.use(express.json()); a.use(path, router); return a; };
const products = () => request(mount('/api/products', require('../routes/products')));
const orders = () => request(mount('/api/orders', require('../routes/orders')));
const transactions = () => request(mount('/api/transactions', require('../routes/transactions')));

beforeEach(() => { mockQuery.mockReset(); jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('PATCH /api/products/:id/stock', () => {
  const APPAREL = 'Apparels & Merchandise';
  const found = () => mockQuery.mockResolvedValueOnce({ rows: [{ stock: 10, category: APPAREL }] });
  const updated = (over = {}) => mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, stock: 15, old_stock: 10, ...over }] });

  it.each([
    ['text', { delta: 'abc' }],
    ['a fraction', { delta: 1.5 }],
    ['blank', { delta: '' }],
    ['huge', { delta: 1e9 }],
    ['a negative exact value', { set: -3 }],
    ['not a number for set', { set: 'x' }],
  ])('rejects %s without touching the database', async (_label, body) => {
    const res = await products().patch('/api/products/5/stock').send(body);
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('changes stock in ONE statement computed from the live row, not from a value read earlier', async () => {
    found(); updated();
    const res = await products().patch('/api/products/5/stock').send({ delta: 5 });
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/COALESCE\(products\.stock, 0\) \+ \$1::int/);
    expect(params).toEqual([5, '5']);
  });

  it('sets an exact value the same way', async () => {
    found(); updated({ stock: 20 });
    await products().patch('/api/products/5/stock').send({ set: 20 });
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/stock\s+= GREATEST\(\$1::int, 0\)/);
    expect(params[0]).toBe(20);
  });

  it('does not leak the helper old_stock column to the admin page', async () => {
    found(); updated();
    const res = await products().patch('/api/products/5/stock').send({ delta: 5 });
    expect(res.body).toEqual({ id: 5, stock: 15 });
  });

  it('sends the low-stock alert when this edit crosses the threshold (using the real previous stock)', async () => {
    found(); updated({ stock: 4, old_stock: 9 });
    await products().patch('/api/products/5/stock').send({ delta: -5 });
    await new Promise(r => setImmediate(r));
    expect(require('../mailer').sendLowStockAlert).toHaveBeenCalled();
  });

  it('answers 404 when the product disappears between the check and the update', async () => {
    found(); mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await products().patch('/api/products/5/stock').send({ delta: 1 })).status).toBe(404);
  });
});

describe('reports follow the business calendar (Texas), not UTC', () => {
  const TEXAS = /AT TIME ZONE 'UTC'\) AT TIME ZONE 'America\/Chicago'/;

  it('orders by date reads the day in Texas time', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await orders().get('/api/orders/by-date/2026-11-15');
    expect(mockQuery.mock.calls[0][0]).toMatch(TEXAS);
    expect(mockQuery.mock.calls[0][1]).toEqual(['2026-11-15']);
  });

  it('revenue buckets and "today / this week / this month" use Texas time', async () => {
    mockQuery.mockResolvedValue({ rows: [{}] });
    await orders().get('/api/orders/revenue/summary?period=daily');
    await orders().get('/api/orders/revenue/quick-totals');
    expect(mockQuery.mock.calls[0][0]).toMatch(TEXAS);
    expect(mockQuery.mock.calls[1][0]).toMatch(TEXAS);
    expect(mockQuery.mock.calls[1][0]).toMatch(/NOW\(\) AT TIME ZONE 'America\/Chicago'/);
  });

  it('transactions by date and the calendar summary use Texas time', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await transactions().get('/api/transactions/by-date/2026-11-15');
    await transactions().get('/api/transactions/summary/2026/11');
    expect(mockQuery.mock.calls[0][0]).toMatch(TEXAS);
    expect(mockQuery.mock.calls[1][0]).toMatch(TEXAS);
    expect(mockQuery.mock.calls[1][1]).toEqual([2026, 11]);
  });

  it.each(['yesterday', '2026-13-45x', '15-11-2026', "2026-11-15'; DROP TABLE orders;--"])(
    'rejects a bad date %s with 400 before querying', async (bad) => {
      expect((await orders().get(`/api/orders/by-date/${encodeURIComponent(bad)}`)).status).toBe(400);
      expect((await transactions().get(`/api/transactions/by-date/${encodeURIComponent(bad)}`)).status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

  it('rejects an invalid year or month', async () => {
    expect((await transactions().get('/api/transactions/summary/abcd/11')).status).toBe(400);
    expect((await transactions().get('/api/transactions/summary/2026/13')).status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('business zone in SQL', () => {
  it('refuses a zone name that could break out of the SQL and falls back to Texas', () => {
    process.env.BUSINESS_TIMEZONE = "x'; DROP TABLE orders;--";
    jest.isolateModules(() => {
      const { sqlLocal } = require('../businessTime');
      expect(sqlLocal('created_at')).toContain("'America/Chicago'");
      expect(sqlLocal('created_at')).not.toMatch(/DROP/);
    });
    delete process.env.BUSINESS_TIMEZONE;
  });
});
