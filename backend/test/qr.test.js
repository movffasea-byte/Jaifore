/* ================================
   JAIFORE — QR SCAN ROUTE TESTS
   backend/test/qr.test.js

   Fully mocked. Run with: npx jest test/qr.test.js
   ================================ */
process.env.JWT_SECRET = 'test-secret';

const mockQuery = jest.fn();
jest.mock('../database', () => ({ pool: { query: (...a) => mockQuery(...a) } }));
jest.mock('../redis', () => ({ cacheGet: jest.fn(), cacheSet: jest.fn(), cacheInvalidate: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn(), init: jest.fn() }));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const qrRouter = require('../routes/qr');

const app = express();
app.use('/api/qr', qrRouter);

beforeEach(() => mockQuery.mockReset());

describe('GET /api/qr/:slug', () => {
  it('stores at most 255 characters of the user agent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, destination_url: 'https://jaifore.org/x', is_active: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/qr/abc').set('User-Agent', 'A'.repeat(5000));
    expect(res.status).toBe(302);
    expect(mockQuery.mock.calls[1][1][1]).toHaveLength(255);
  });

  it('still redirects when no user agent is sent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, destination_url: 'https://jaifore.org/x', is_active: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/qr/abc').set('User-Agent', '');
    expect(res.status).toBe(302);
    expect(mockQuery.mock.calls[1][1][1]).toBeNull();
  });
});

describe('expressApp', () => {
  it('mounts /api/qr behind a rate limiter', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'expressApp.js'), 'utf8');
    expect(src).toMatch(/app\.use\('\/api\/qr', generalLimiter,/);
  });
});
