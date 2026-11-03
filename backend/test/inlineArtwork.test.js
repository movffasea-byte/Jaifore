/* ================================
   JAIFORE — INLINE ARTWORK TESTS
   backend/test/inlineArtwork.test.js
   Cart, wishlist and checkout refuse artwork sent as a data: URL (it belongs
   in /api/uploads), and their JSON limit is small now that it no longer
   travels inline. Fully mocked (no real DB, Redis, Stripe or email). Run with:
   npx jest test/inlineArtwork.test.js
   ================================ */
process.env.JWT_SECRET     = 'test-secret';
process.env.RESEND_API_KEY = 're_test_dummy';

const mockPool = { query: jest.fn(), connect: jest.fn() };
jest.mock('../database', () => ({ pool: mockPool }));
jest.mock('../redis', () => ({
  redis: { incr: jest.fn(), expire: jest.fn() },
  cacheGet: jest.fn(), cacheSet: jest.fn(), cacheInvalidate: jest.fn(),
}));
jest.mock('../stripeClient', () => ({}));
jest.mock('../mailer', () => ({}));
jest.mock('../push', () => ({ sendAdminPush: jest.fn() }));
jest.mock('@sentry/node', () => ({
  init: jest.fn(), captureException: jest.fn(),
  setupExpressErrorHandler: jest.fn(),
  withScope: (fn) => fn({ setTag: jest.fn(), setContext: jest.fn() }),
}));
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({})));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { hasInlineArtwork, REUPLOAD_MESSAGE } = require('../inlineArtwork');

const token = jwt.sign({ id: 2, role: 'user' }, process.env.JWT_SECRET);
const auth  = { Authorization: `Bearer ${token}` };
const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

function mount(path, router) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(path, router);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('hasInlineArtwork', () => {
  test('finds a data: URL nested in designs', () => {
    expect(hasInlineArtwork({ designs: [{ src: 'https://x/a.png' }, { src: DATA_URL }] })).toBe(true);
  });

  test('ignores uploaded URLs and ordinary text', () => {
    expect(hasInlineArtwork({ designs: [{ src: 'https://x/a.png' }], notes: 'data: print it big' })).toBe(false);
  });
});

describe('routes refuse inline artwork', () => {
  const line = { productId: 1, name: 'Tee', price: 20, category: 'apparel' };

  test('POST /api/cart', async () => {
    const app = mount('/api/cart', require('../routes/cart'));
    const res = await request(app).post('/api/cart').set(auth)
      .send({ ...line, designs: [{ src: DATA_URL, name: 'logo.png' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(REUPLOAD_MESSAGE);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  test('POST /api/cart/merge', async () => {
    const app = mount('/api/cart', require('../routes/cart'));
    const res = await request(app).post('/api/cart/merge').set(auth)
      .send({ localCart: [{ ...line, designs: [{ src: DATA_URL }] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(REUPLOAD_MESSAGE);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  test('POST /api/wishlist', async () => {
    const app = mount('/api/wishlist', require('../routes/wishlist'));
    const res = await request(app).post('/api/wishlist').set(auth)
      .send({ ...line, customDesigns: [{ src: DATA_URL }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(REUPLOAD_MESSAGE);
  });

  test('POST /api/stripe/quote', async () => {
    const app = mount('/api/stripe', require('../routes/stripe'));
    const res = await request(app).post('/api/stripe/quote').set(auth)
      .send({ items: [{ id: 1, qty: 1, designs: [{ src: DATA_URL }] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(REUPLOAD_MESSAGE);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});

describe('JSON limit', () => {
  test('a 2mb cart request is rejected before auth', async () => {
    const app = require('../expressApp');
    const res = await request(app).post('/api/cart')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });
});
