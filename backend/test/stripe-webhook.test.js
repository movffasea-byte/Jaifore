/* ================================
   JAIFORE — STRIPE WEBHOOK TESTS
   backend/test/stripe-webhook.test.js

   Fully mocked (no real DB, Stripe, Redis or email), so it runs anywhere
   with `npx jest test/stripe-webhook.test.js`.
   ================================ */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const mockClient = { query: jest.fn(), release: jest.fn() };
const mockPool = { query: jest.fn(), connect: jest.fn() };
const mockStripe = { webhooks: { constructEvent: jest.fn() } };

jest.mock('../database', () => ({ pool: mockPool }));
jest.mock('../redis', () => ({ cacheInvalidate: jest.fn() }));
jest.mock('../stripeClient', () => mockStripe);
jest.mock('../middleware', () => ({ authenticate: (req, res, next) => next() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));
jest.mock('../mailer', () => ({
  sendOrderConfirmation: jest.fn().mockResolvedValue(),
  sendAdminOrderAlert: jest.fn().mockResolvedValue(),
  sendLowStockAlert: jest.fn().mockResolvedValue(),
}));

const { webhookHandler } = require('../routes/stripe');

const PENDING = {
  session_id: 'cs_1',
  user_id: 7,
  items: [],
  subtotal_cents: 5000,
  shipping_cents: 500,
  contact: {},
};
const ORDER = { id: 99, user_id: 7, total: 55, status: 'processing', stripe_payment_intent_id: 'pi_1' };

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

function paidEvent(type = 'checkout.session.completed', overrides = {}) {
  return {
    id: 'evt_1',
    type,
    data: {
      object: {
        id: 'cs_1',
        payment_status: 'paid',
        amount_subtotal: 5000,
        amount_total: 5500,
        total_details: { amount_shipping: 500, amount_tax: 0 },
        payment_intent: 'pi_1',
        payment_method_types: ['card'],
        ...overrides,
      },
    },
  };
}

const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig' } };
const sqlCalls = () => mockClient.query.mock.calls.map(c => String(c[0]));

beforeEach(() => {
  jest.clearAllMocks();
  mockPool.connect.mockResolvedValue(mockClient);
  mockPool.query.mockResolvedValue({ rows: [] });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('webhookHandler — signature and config', () => {
  it('returns 503 when the webhook secret is not configured', async () => {
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = mockRes();
    await webhookHandler(req, res);
    process.env.STRIPE_WEBHOOK_SECRET = saved;
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 400 and creates nothing when the signature is invalid', async () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => { throw new Error('bad signature'); });
    const res = mockRes();
    await webhookHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});

describe('webhookHandler — event handling', () => {
  it('ignores event types it does not care about', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({ id: 'evt_2', type: 'customer.created', data: { object: {} } });
    const res = mockRes();
    await webhookHandler(req, res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('does not fulfil a session that is not paid yet', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(paidEvent('checkout.session.completed', { payment_status: 'unpaid' }));
    const res = mockRes();
    await webhookHandler(req, res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('creates the order and commits for a paid session', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(paidEvent());
    mockClient.query
      .mockResolvedValueOnce({})                          // BEGIN
      .mockResolvedValueOnce({ rows: [PENDING] })         // SELECT pending_checkouts
      .mockResolvedValueOnce({ rows: [ORDER] })           // INSERT orders
      .mockResolvedValue({ rows: [] });                   // DELETEs + COMMIT
    mockPool.query.mockResolvedValue({ rows: [{ name: 'Ada', email: 'ada@test.dev' }] });

    const res = mockRes();
    await webhookHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({ received: true });
    const sql = sqlCalls();
    expect(sql.some(s => s.includes('INSERT INTO orders'))).toBe(true);
    expect(sql.some(s => s.includes('DELETE FROM cart_items'))).toBe(true);
    expect(sql).toContain('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('also fulfils async_payment_succeeded events', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(paidEvent('checkout.session.async_payment_succeeded'));
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [PENDING] })
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValue({ rows: [] });
    const res = mockRes();
    await webhookHandler(req, res);
    expect(sqlCalls().some(s => s.includes('INSERT INTO orders'))).toBe(true);
  });
});

describe('webhookHandler — retries and failures', () => {
  it('is a no-op when a retry arrives for an already-created order', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(paidEvent());
    mockClient.query
      .mockResolvedValueOnce({})                          // BEGIN
      .mockResolvedValueOnce({ rows: [PENDING] })
      .mockResolvedValueOnce({ rows: [] })                // INSERT hit ON CONFLICT DO NOTHING
      .mockResolvedValue({});                             // ROLLBACK
    const res = mockRes();
    await webhookHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(sqlCalls()).toContain('ROLLBACK');
    expect(sqlCalls()).not.toContain('COMMIT');
    expect(sqlCalls().some(s => s.includes('DELETE FROM cart_items'))).toBe(false);
  });

  it('acknowledges a retry when the cart is gone but the order already exists', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(paidEvent());
    mockClient.query
      .mockResolvedValueOnce({})                          // BEGIN
      .mockResolvedValueOnce({ rows: [] })                // no pending_checkouts row
      .mockResolvedValueOnce({ rows: [{ id: 99 }] })      // order already there
      .mockResolvedValue({});
    const res = mockRes();
    await webhookHandler(req, res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('returns 500 (so Stripe retries) and reports to Sentry when a paid session has no cart and no order', async () => {
    const Sentry = require('@sentry/node');
    mockStripe.webhooks.constructEvent.mockReturnValue(paidEvent());
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({});
    const res = mockRes();
    await webhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(Sentry.captureException).toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('rolls back, releases the connection and returns 500 when the insert throws', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(paidEvent());
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [PENDING] })
      .mockRejectedValueOnce(new Error('db down'))        // INSERT orders fails
      .mockResolvedValue({});
    const res = mockRes();
    await webhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(sqlCalls()).toContain('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('flags a Stripe subtotal that differs from the server-priced cart', async () => {
    const Sentry = require('@sentry/node');
    mockStripe.webhooks.constructEvent.mockReturnValue(paidEvent('checkout.session.completed', { amount_subtotal: 100 }));
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [PENDING] })
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValue({ rows: [] });
    const res = mockRes();
    await webhookHandler(req, res);
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });
});
