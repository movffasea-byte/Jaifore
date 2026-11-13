/* ================================
   JAIFORE — PRODUCT STUDIO OPTIONS TESTS
   backend/test/products.test.js

   Database, Redis, Sentry and the mailer are mocked.
   Run with: npx jest test/products.test.js
   ================================ */
process.env.JWT_SECRET = 'test-secret';

const mockQuery = jest.fn();
jest.mock('../database', () => ({ pool: { query: (...a) => mockQuery(...a) } }));
jest.mock('../redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(),
  cacheInvalidate: jest.fn().mockResolvedValue(),
}));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));
jest.mock('../mailer', () => ({ sendLowStockAlert: jest.fn().mockResolvedValue() }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use('/api/products', require('../routes/products'));

const admin = { Authorization: `Bearer ${jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET)}` };
const APPAREL = 'Apparels & Merchandise';
const stored = {
  stock: null, category: APPAREL, second_view: 'back', one_size: false,
  front_male: 'https://jaifore.org/images/a.jpg', back_male: 'https://jaifore.org/images/b.jpg',
  front_female: null, back_female: null, ready_made: false,
};

// The first query is the "before" row (PUT) or the INSERT (POST); the
// UPDATE/INSERT returns a row so the route can finish.
beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (sql) => {
    if (/^\s*SELECT stock, category/.test(sql)) return { rows: [stored] };
    return { rows: [{ id: 7, print_size_ids: null }] };
  });
});
const writeParams = () => mockQuery.mock.calls.find(([sql]) => /UPDATE products SET name|INSERT INTO products/.test(sql))[1];

describe('Studio options on products', () => {
  it('create defaults to a back view and XS-XXL sizes', async () => {
    const res = await request(app).post('/api/products').set(admin)
      .send({ name: 'Mug', category: APPAREL, price: 12 });
    expect(res.status).toBe(201);
    expect(writeParams().slice(10)).toEqual(['back', false, null, null, null, null, false]);
  });

  it('create saves a side view, one size and mockup links', async () => {
    const res = await request(app).post('/api/products').set(admin).send({
      name: 'Cap', category: APPAREL, price: 20, second_view: 'side', one_size: true,
      front_male: ' https://jaifore.org/images/cap-front-m.jpg ', back_male: 'https://jaifore.org/images/cap-side-m.jpg',
    });
    expect(res.status).toBe(201);
    expect(writeParams().slice(10)).toEqual([
      'side', true, 'https://jaifore.org/images/cap-front-m.jpg', 'https://jaifore.org/images/cap-side-m.jpg', null, null, false,
    ]);
  });

  it('update keeps stored Studio fields the request leaves out', async () => {
    const res = await request(app).put('/api/products/7').set(admin)
      .send({ name: 'Tee', category: APPAREL, price: 15 });
    expect(res.status).toBe(200);
    expect(writeParams().slice(10, 17)).toEqual([
      'back', false, stored.front_male, stored.back_male, null, null, false,
    ]);
  });

  it('update can switch to front only and clear a mockup', async () => {
    const res = await request(app).put('/api/products/7').set(admin)
      .send({ name: 'Mug', category: APPAREL, price: 12, second_view: 'none', one_size: true, back_male: '' });
    expect(res.status).toBe(200);
    expect(writeParams().slice(10, 16)).toEqual(['none', true, stored.front_male, null, null, null]);
  });

  it('create and update can mark a product ready-made', async () => {
    await request(app).post('/api/products').set(admin)
      .send({ name: 'Anchor Tee', category: APPAREL, price: 30.88, ready_made: true });
    expect(writeParams()[16]).toBe(true);
    mockQuery.mockClear();
    await request(app).put('/api/products/7').set(admin)
      .send({ name: 'Anchor Tee', category: APPAREL, price: 30.88, ready_made: true });
    expect(writeParams()[16]).toBe(true);
  });

  test.each([
    [{ second_view: 'top' }, /Second view/],
    [{ one_size: 'yes' }, /One size/],
    [{ ready_made: 'true' }, /Ready-made/],
    [{ front_male: 'http://jaifore.org/a.jpg' }, /https/],
    [{ back_female: 'javascript:alert(1)' }, /https/],
  ])('rejects bad input %j', async (extra, msg) => {
    const res = await request(app).put('/api/products/7').set(admin)
      .send({ name: 'Tee', category: APPAREL, price: 15, ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(msg);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('ready_made filter on the product list', () => {
  const listSql = () => mockQuery.mock.calls.find(([sql]) => /FROM products/.test(sql));

  it.each([['true', true], ['false', false]])('ready_made=%s filters to %s', async (q, val) => {
    const res = await request(app).get(`/api/products?category=${encodeURIComponent(APPAREL)}&ready_made=${q}&limit=4`);
    expect(res.status).toBe(200);
    const [sql, params] = listSql();
    expect(sql).toMatch(/ready_made = \$2/);
    expect(params).toEqual([APPAREL, val, 4]);
  });

  it('any other value leaves the list unfiltered', async () => {
    await request(app).get('/api/products?ready_made=yes');
    expect(listSql()[0]).not.toMatch(/ready_made/);
  });
});
