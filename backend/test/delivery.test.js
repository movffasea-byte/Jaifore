/* ================================
   JAIFORE — DELIVERY OPTIONS + BACKORDER TESTS
   backend/test/delivery.test.js

   Fully mocked (no real DB, Stripe, Redis or email). Run with:
   npx jest test/delivery.test.js
   ================================ */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
delete process.env.BACKORDER_EXTRA_BUSINESS_DAYS;

const mockClient = { query: jest.fn(), release: jest.fn() };
const mockPool = { query: jest.fn(), connect: jest.fn() };
const mockStripe = {
  webhooks: { constructEvent: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
};

jest.mock('../database', () => ({ pool: mockPool }));
const mockRedis = { set: jest.fn(), del: jest.fn() };
jest.mock('../redis', () => ({ cacheInvalidate: jest.fn(), redis: mockRedis }));
jest.mock('../stripeClient', () => mockStripe);
jest.mock('../middleware', () => ({ authenticate: (req, res, next) => { req.user = { id: 7, role: 'user' }; next(); } }));
jest.mock('../push', () => ({ sendAdminPush: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));
jest.mock('../mailer', () => ({
  sendOrderConfirmation: jest.fn().mockResolvedValue(),
  sendAdminOrderAlert: jest.fn().mockResolvedValue(),
  sendLowStockAlert: jest.fn().mockResolvedValue(),
}));

const express = require('express');
const request = require('supertest');
const stripeRouter = require('../routes/stripe');
const { webhookHandler } = stripeRouter;
const rules = require('../shippingRules');
const { addBusinessDays, formatDateOnly } = require('../businessTime');

const app = express();
app.use(express.json());
app.use('/api/stripe', stripeRouter);

const APPAREL = 'Apparels & Merchandise';
const tee = (over = {}) => ({
  id: 1, name: 'Tee', price: 25, category: APPAREL, in_stock: true, stock: 100,
  image_url: null, front_male: null, print_size_ids: null, second_view: 'back',
  one_size: false, ready_made: false, allow_backorder: false, ...over,
});
const cart = (qty = 1) => [{ id: 1, qty, size: 'M' }];

function dbWith(product) {
  mockPool.query.mockImplementation(async (sql) => {
    if (/FROM products WHERE id = ANY/.test(sql)) return { rows: product ? [product] : [] };
    if (/FROM print_pricing/.test(sql)) return { rows: [] };
    if (/FROM products WHERE category/.test(sql)) return { rows: [] };
    return { rows: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPool.connect.mockResolvedValue(mockClient);
  mockRedis.set.mockReset().mockResolvedValue('OK');
  mockRedis.del.mockReset().mockResolvedValue(1);
  mockStripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: 'https://stripe.test/pay' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.BACKORDER_EXTRA_BUSINESS_DAYS; });

describe('business days (Texas calendar)', () => {
  it('skips weekends: Friday + 3 business days is Wednesday', () => {
    expect(addBusinessDays(new Date('2026-11-20T18:00:00Z'), 3)).toBe('2026-11-25');
  });

  it('counts from the Texas date, not UTC: 03:00 UTC Saturday is still Friday evening in Texas', () => {
    expect(addBusinessDays(new Date('2026-11-21T03:00:00Z'), 1)).toBe('2026-11-23');
  });

  it('starts from the next Monday when ordered on a weekend', () => {
    expect(addBusinessDays(new Date('2026-11-21T18:00:00Z'), 1)).toBe('2026-11-23');
  });

  it('formats a calendar date without shifting the day', () => {
    expect(formatDateOnly('2026-11-25')).toBe('Wed, Nov 25');
    expect(formatDateOnly(new Date('2026-11-25T00:00:00Z'))).toBe('Wed, Nov 25');
  });
});

describe('shipping rules', () => {
  const at = (opts) => rules.buildOptions({ from: new Date('2026-11-20T18:00:00Z'), ...opts });
  const byId = (list) => Object.fromEntries(list.map(o => [o.id, o]));

  it('offers Express, Standard and No-Rush with the agreed prices and windows', () => {
    const o = byId(at({ subtotalCents: 5000 }));
    expect(Object.keys(o)).toEqual(['express', 'standard', 'no_rush']);
    expect([o.express.price_cents, o.standard.price_cents, o.no_rush.price_cents]).toEqual([1999, 1500, 0]);
    expect([o.express.min_days, o.express.max_days]).toEqual([3, 5]);
    expect([o.standard.min_days, o.standard.max_days]).toEqual([5, 8]);
    expect([o.no_rush.min_days, o.no_rush.max_days]).toEqual([8, 10]);
    expect(o.standard.earliest).toBe('2026-11-27');
  });

  it('makes Standard free from $60 but never Express', () => {
    const o = byId(at({ subtotalCents: 6000 }));
    expect(o.standard.price_cents).toBe(0);
    expect(o.express.price_cents).toBe(1999);
    expect(byId(at({ subtotalCents: 5999 })).standard.price_cents).toBe(1500);
  });

  it('drops Express and shifts the rest when an item is backordered', () => {
    const o = byId(at({ subtotalCents: 5000, backordered: true }));
    expect(Object.keys(o)).toEqual(['standard', 'no_rush']);
    expect([o.standard.min_days, o.standard.max_days]).toEqual([10, 13]);
  });

  it('reads the backorder delay from BACKORDER_EXTRA_BUSINESS_DAYS', () => {
    process.env.BACKORDER_EXTRA_BUSINESS_DAYS = '2';
    expect(byId(at({ subtotalCents: 5000, backordered: true })).standard.min_days).toBe(7);
  });

  it('refuses unknown ids and Express for backordered carts', () => {
    expect(rules.findOption('overnight', false)).toBeNull();
    expect(rules.findOption('express', true)).toBeNull();
    expect(rules.findOption('express', false).id).toBe('express');
  });
});

describe('POST /api/stripe/quote', () => {
  const quote = (body) => request(app).post('/api/stripe/quote').send({ items: cart(), ...body });

  it('returns the three options and prices Standard by default', async () => {
    dbWith(tee());
    const res = await quote({});
    expect(res.status).toBe(200);
    expect(res.body.shipping_method).toBe('standard');
    expect(res.body.shipping_fee).toBe(15);
    expect(res.body.total_before_tax).toBe(40);
    expect(res.body.shipping_options.map(o => o.id)).toEqual(['express', 'standard', 'no_rush']);
    expect(res.body.backordered).toBe(false);
  });

  it('prices the chosen option', async () => {
    dbWith(tee());
    const express = await quote({ shipping_method: 'express' });
    expect(express.body.shipping_fee).toBe(19.99);
    const noRush = await quote({ shipping_method: 'no_rush' });
    expect(noRush.body.shipping_fee).toBe(0);
    expect(noRush.body.total_before_tax).toBe(25);
  });

  it('rejects an unknown delivery option', async () => {
    dbWith(tee());
    expect((await quote({ shipping_method: 'teleport' })).status).toBe(400);
  });

  it('still refuses a short-stock order when the product does not accept backorders', async () => {
    dbWith(tee({ stock: 2 }));
    const res = await quote({ items: cart(5) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only 2/);
  });

  it('accepts a short-stock order as a backorder when the product allows it, without Express', async () => {
    dbWith(tee({ stock: 2, allow_backorder: true }));
    const res = await quote({ items: cart(5) });
    expect(res.status).toBe(200);
    expect(res.body.backordered).toBe(true);
    expect(res.body.backordered_items).toEqual(['Tee']);
    expect(res.body.shipping_options.map(o => o.id)).toEqual(['standard', 'no_rush']);
    expect(res.body.shipping_options[0].min_days).toBe(10);
  });

  it('does not offer Express to a backordered cart even if the browser asks for it', async () => {
    dbWith(tee({ stock: 0, allow_backorder: true }));
    const res = await quote({ shipping_method: 'express' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/restocked/);
  });

  it('treats an in-stock product that allows backorders as normal', async () => {
    dbWith(tee({ allow_backorder: true }));
    const res = await quote({});
    expect(res.body.backordered).toBe(false);
    expect(res.body.shipping_options).toHaveLength(3);
  });
});

describe('POST /api/stripe/create-checkout-session', () => {
  const contact = { name: 'Ada', email: 'ada@test.dev', phone: '5551234' };
  const create = (body) => request(app).post('/api/stripe/create-checkout-session').send({ items: cart(), contact, ...body });
  const sentRate = () => mockStripe.checkout.sessions.create.mock.calls[0][0].shipping_options[0].shipping_rate_data;
  const savedPending = () => mockPool.query.mock.calls.find(c => /INSERT INTO pending_checkouts/.test(c[0]))[1];

  it('charges Express and gives Stripe its delivery estimate', async () => {
    dbWith(tee());
    const res = await create({ shipping_method: 'express' });
    expect(res.status).toBe(200);
    const rate = sentRate();
    expect(rate.fixed_amount.amount).toBe(1999);
    expect(rate.display_name).toMatch(/Express/);
    expect(rate.delivery_estimate).toEqual({
      minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 5 },
    });
    const saved = savedPending();
    expect(saved[5]).toBe(1999); // shipping_cents
    expect(saved[6]).toBe('express');
    expect(saved[7]).toBe(false);
  });

  it('defaults to Standard when no option is sent (older apps)', async () => {
    dbWith(tee());
    await create({});
    expect(sentRate().fixed_amount.amount).toBe(1500);
    expect(savedPending()[6]).toBe('standard');
  });

  it('sends only the option the server allows, never a price from the browser', async () => {
    dbWith(tee());
    await create({ shipping_method: 'no_rush', shipping_cents: 1 });
    expect(sentRate().fixed_amount.amount).toBe(0);
  });

  it('rejects Express for a backordered cart and creates no Stripe session', async () => {
    dbWith(tee({ stock: 0, allow_backorder: true }));
    const res = await create({ shipping_method: 'express' });
    expect(res.status).toBe(400);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('records a backorder and its later delivery estimate', async () => {
    dbWith(tee({ stock: 0, allow_backorder: true }));
    await create({ shipping_method: 'standard' });
    expect(sentRate().delivery_estimate.minimum.value).toBe(10);
    expect(savedPending()[7]).toBe(true);
  });

  it('rejects an unknown option and creates no Stripe session', async () => {
    dbWith(tee());
    expect((await create({ shipping_method: 'teleport' })).status).toBe(400);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('one checkout at a time per customer', () => {
  const contact = { name: 'Ada', email: 'ada@test.dev', phone: '5551234' };
  const create = () => request(app).post('/api/stripe/create-checkout-session').send({ items: cart(), contact });

  it('takes a per-customer lock, creates the session, then releases the lock', async () => {
    dbWith(tee());
    const res = await create();
    expect(res.status).toBe(200);
    expect(mockRedis.set).toHaveBeenCalledWith('checkout-lock:7', '1', 'EX', 20, 'NX');
    expect(mockRedis.del).toHaveBeenCalledWith('checkout-lock:7');
  });

  it('answers a second click while one is in progress with 409 and creates no second session', async () => {
    dbWith(tee());
    mockRedis.set.mockResolvedValue(null); // lock already held
    const res = await create();
    expect(res.status).toBe(409);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled(); // never release a lock we don't own
  });

  it('releases the lock even when the checkout fails', async () => {
    dbWith(tee({ stock: 0 })); // out of stock -> cart error
    const res = await create();
    expect(res.status).toBe(400);
    expect(mockRedis.del).toHaveBeenCalledWith('checkout-lock:7');
  });

  it('still lets the customer pay when Redis is down', async () => {
    dbWith(tee());
    mockRedis.set.mockRejectedValue(new Error('Connection is closed.'));
    const res = await create();
    expect(res.status).toBe(200);
    expect(mockRedis.del).not.toHaveBeenCalled();
  });
});

describe('webhook stores the delivery choice on the order', () => {
  const sessionEvent = () => ({
    id: 'evt_1', type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_1', payment_status: 'paid', amount_subtotal: 5000, amount_total: 5000,
      total_details: { amount_shipping: 0, amount_tax: 0 }, payment_intent: 'pi_1', payment_method_types: ['card'],
    } },
  });
  const res = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); r.send = jest.fn().mockReturnValue(r); return r; };
  const run = async (pending) => {
    mockStripe.webhooks.constructEvent.mockReturnValue(sessionEvent());
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ session_id: 'cs_1', user_id: 7, items: [], subtotal_cents: 5000, shipping_cents: 0, contact: {}, ...pending }] })
      .mockResolvedValueOnce({ rows: [{ id: 99, user_id: 7, total: 50, status: 'processing' }] })
      .mockResolvedValue({ rows: [] });
    mockPool.query.mockResolvedValue({ rows: [{ name: 'Ada', email: 'ada@test.dev' }] });
    await webhookHandler({ body: Buffer.from('{}'), headers: { 'stripe-signature': 's' } }, res());
    return mockClient.query.mock.calls.find(c => /INSERT INTO orders/.test(c[0]))[1];
  };

  it('saves the method, backorder flag and a delivery window counted from payment', async () => {
    const params = await run({ shipping_method: 'no_rush', backordered: false });
    const [method, backordered, min, max] = params.slice(-4);
    expect(method).toBe('no_rush');
    expect(backordered).toBe(false);
    expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(max >= min).toBe(true);
    expect(min).toBe(addBusinessDays(new Date(), 8));
    expect(max).toBe(addBusinessDays(new Date(), 10));
  });

  it('adds the restock delay to a backordered order', async () => {
    const params = await run({ shipping_method: 'standard', backordered: true });
    expect(params.slice(-4)[1]).toBe(true);
    expect(params.slice(-4)[2]).toBe(addBusinessDays(new Date(), 10));
  });

  it('falls back to Standard for a checkout saved before delivery options existed', async () => {
    const params = await run({ shipping_method: undefined, backordered: undefined });
    expect(params.slice(-4)[0]).toBe('standard');
  });
});
