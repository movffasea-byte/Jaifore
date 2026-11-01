/* ================================
   JAIFORE — EXCHANGE RATE ROUTE TESTS
   backend/test/fx.test.js

   Upstream fetch and Redis are mocked. Run with: npx jest test/fx.test.js
   ================================ */
process.env.EXCHANGE_RATE_API_KEY = 'test-fx-key';

const mockStore = new Map();
jest.mock('../redis', () => ({
  cacheGet: jest.fn(async (k) => mockStore.get(k) ?? null),
  cacheSet: jest.fn(async (k, v) => { mockStore.set(k, v); }),
}));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const express = require('express');
const request = require('supertest');
const fx = require('../routes/fx');

const app = express();
app.use('/api/fx', fx);

const upstreamOk = () => ({ json: async () => ({ result: 'success', conversion_rates: { USD: 1, EUR: 0.92, NGN: 1500 } }), status: 200 });

beforeEach(() => {
  fx.resetState();
  mockStore.clear();
  global.fetch = jest.fn(async () => upstreamOk());
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('returns USD-based rates without exposing the key', async () => {
  const res = await request(app).get('/api/fx');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ base: 'USD', rates: { EUR: 0.92, NGN: 1500 } });
  expect(JSON.stringify(res.body)).not.toContain('test-fx-key');
  expect(global.fetch.mock.calls[0][0]).toContain('/test-fx-key/latest/USD');
});

test('many visitors cause one upstream call, then cache hits', async () => {
  await Promise.all(Array.from({ length: 5 }, () => request(app).get('/api/fx')));
  await request(app).get('/api/fx');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('rates already in Redis are used without calling upstream', async () => {
  mockStore.set('fx:usd', { rates: { EUR: 0.9 }, updatedAt: 'earlier' });
  const res = await request(app).get('/api/fx');
  expect(res.body.rates.EUR).toBe(0.9);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('an upstream failure returns 503 and is not retried on every request', async () => {
  global.fetch = jest.fn(async () => ({ json: async () => ({ result: 'error', 'error-type': 'invalid-key' }), status: 200 }));
  expect((await request(app).get('/api/fx')).status).toBe(503);
  expect((await request(app).get('/api/fx')).status).toBe(503);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledWith('FX rates fetch failed:', 'exchange-rate API: invalid-key');
});

test('a missing key returns 503 without calling upstream', async () => {
  delete process.env.EXCHANGE_RATE_API_KEY;
  const res = await request(app).get('/api/fx');
  process.env.EXCHANGE_RATE_API_KEY = 'test-fx-key';
  expect(res.status).toBe(503);
  expect(global.fetch).not.toHaveBeenCalled();
});
