/* ================================
   JAIFORE — PRINT PRICING ROUTE TESTS
   backend/test/print-pricing.test.js

   Fully mocked. Run with: npx jest test/print-pricing.test.js
   ================================ */
process.env.JWT_SECRET = 'test-secret';

const mockQuery = jest.fn();
jest.mock('../database', () => ({ pool: { query: (...a) => mockQuery(...a) } }));
jest.mock('../redis', () => ({ cacheGet: jest.fn(), cacheSet: jest.fn(), cacheInvalidate: jest.fn() }));
jest.mock('../middleware', () => ({
  authenticate: (req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');

const app = express();
app.use(express.json());
app.use('/api/print-pricing', require('../routes/print-pricing'));

beforeEach(() => { mockQuery.mockReset().mockResolvedValue({ rows: [{ id: 1, price: 12.5 }] }); });

describe('PUT /api/print-pricing/:id', () => {
  it.each([
    ['negative', -5],
    ['negative as text', '-0.01'],
    ['not a number', 'abc'],
    ['infinite', 'Infinity'],
    ['absurdly large', 1e9],
  ])('rejects a price that is %s and never touches the database', async (_label, price) => {
    const res = await request(app).put('/api/print-pricing/1').send({ price });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/greater than 0/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('still rejects a missing or zero price', async () => {
    expect((await request(app).put('/api/print-pricing/1').send({})).status).toBe(400);
    expect((await request(app).put('/api/print-pricing/1').send({ price: 0 })).status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('accepts a normal price, as a number or as text', async () => {
    expect((await request(app).put('/api/print-pricing/1').send({ price: 12.5 })).status).toBe(200);
    expect((await request(app).put('/api/print-pricing/1').send({ price: '20.00' })).status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
