/* ================================
   JAIFORE — REFUND ROUTE TESTS
   backend/test/refund.test.js

   Fully mocked (no real DB, Stripe or email). Run with:
   npx jest test/refund.test.js
   ================================ */

process.env.JWT_SECRET = 'test-secret';

const mockPool = { query: jest.fn() };
const mockStripe = { refunds: { create: jest.fn() } };

jest.mock('../database', () => ({ pool: mockPool }));
jest.mock('../stripeClient', () => mockStripe);
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  withScope: (fn) => fn({ setTag: jest.fn(), setContext: jest.fn() }),
}));
jest.mock('../mailer', () => ({
  sendOrderStatusUpdate: jest.fn().mockResolvedValue(),
  sendRefundNotification: jest.fn().mockResolvedValue(),
  sendAdminRefundAlert: jest.fn().mockResolvedValue(),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const ordersRouter = require('../routes/orders');
const { sendRefundNotification, sendAdminRefundAlert } = require('../mailer');

const app = express();
app.use(express.json());
app.use('/api/orders', ordersRouter);

const adminToken = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET);
const userToken = jwt.sign({ id: 2, role: 'user' }, process.env.JWT_SECRET);

const ORDER = { id: 10, user_id: 2, total: '50.00', payment_status: 'paid', stripe_payment_intent_id: 'pi_123' };
const refundReq = (body = {}, token = adminToken) =>
  request(app).post('/api/orders/10/refund').set('Authorization', `Bearer ${token}`).send(body);

beforeEach(() => {
  jest.clearAllMocks();
  mockPool.query.mockReset();
  mockStripe.refunds.create.mockResolvedValue({ id: 're_1', status: 'succeeded', amount: 5000 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// SELECT order → UPDATE order → SELECT customer
function mockHappyPath(order = ORDER) {
  mockPool.query
    .mockResolvedValueOnce({ rows: [order] })
    .mockImplementationOnce(async (sql, params) => ({ rows: [{ ...order, payment_status: params[0] }] }))
    .mockResolvedValueOnce({ rows: [{ name: 'Ada', email: 'ada@test.dev' }] });
}

describe('POST /api/orders/:id/refund — access control', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/orders/10/refund').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin and never touches Stripe', async () => {
    const res = await refundReq({}, userToken);
    expect(res.status).toBe(403);
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders/:id/refund — validation', () => {
  it('returns 404 when the order does not exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await refundReq();
    expect(res.status).toBe(404);
  });

  it('returns 400 for an order that has no Stripe payment (legacy gateway)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...ORDER, stripe_payment_intent_id: null }] });
    const res = await refundReq();
    expect(res.status).toBe(400);
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });

  it('returns 409 when the order was already refunded', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...ORDER, payment_status: 'refunded' }] });
    const res = await refundReq();
    expect(res.status).toBe(409);
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });

  it.each([['zero', 0], ['negative', -5], ['not a number', 'abc'], ['above the total', 50.01]])(
    'returns 400 for a refund amount that is %s',
    async (_label, amount) => {
      mockPool.query.mockResolvedValueOnce({ rows: [ORDER] });
      const res = await refundReq({ amount });
      expect(res.status).toBe(400);
      expect(mockStripe.refunds.create).not.toHaveBeenCalled();
    }
  );
});

describe('POST /api/orders/:id/refund — success paths', () => {
  it('issues a full refund without an amount and marks the order refunded', async () => {
    mockHappyPath();
    const res = await refundReq();

    expect(res.status).toBe(200);
    const args = mockStripe.refunds.create.mock.calls[0][0];
    expect(args.payment_intent).toBe('pi_123');
    expect(args).not.toHaveProperty('amount');
    expect(mockPool.query.mock.calls[1][1][0]).toBe('refunded');
    expect(res.body.order.payment_status).toBe('refunded');
  });

  it('issues a partial refund in cents and marks the order partially_refunded', async () => {
    mockHappyPath();
    mockStripe.refunds.create.mockResolvedValue({ id: 're_2', status: 'succeeded', amount: 1999 });
    const res = await refundReq({ amount: 19.99 });

    expect(res.status).toBe(200);
    expect(mockStripe.refunds.create.mock.calls[0][0].amount).toBe(1999);
    expect(mockPool.query.mock.calls[1][1][0]).toBe('partially_refunded');
  });

  it('treats an amount equal to the total as a full refund', async () => {
    mockHappyPath();
    const res = await refundReq({ amount: 50 });
    expect(res.status).toBe(200);
    expect(mockStripe.refunds.create.mock.calls[0][0]).not.toHaveProperty('amount');
    expect(mockPool.query.mock.calls[1][1][0]).toBe('refunded');
  });

  it('notifies the customer and the admin', async () => {
    mockHappyPath();
    await refundReq();
    expect(sendRefundNotification).toHaveBeenCalledTimes(1);
    expect(sendAdminRefundAlert).toHaveBeenCalledTimes(1);
  });

  it('still succeeds when the refund emails fail', async () => {
    mockHappyPath();
    sendRefundNotification.mockRejectedValueOnce(new Error('smtp down'));
    const res = await refundReq();
    expect(res.status).toBe(200);
  });
});

describe('POST /api/orders/:id/refund — failures', () => {
  it('returns 500 and leaves the order untouched when Stripe rejects the refund', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [ORDER] });
    mockStripe.refunds.create.mockRejectedValueOnce(Object.assign(new Error('x'), { raw: { message: 'Charge already refunded' } }));
    const res = await refundReq();

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Charge already refunded');
    expect(mockPool.query).toHaveBeenCalledTimes(1); // only the SELECT, no UPDATE
  });
});

describe('POST /api/orders/:id/refund — repeat and partial refunds', () => {
  const PARTLY = { ...ORDER, payment_status: 'partially_refunded', refunded_amount: '30.00' };

  it('rejects a second partial refund larger than what is left', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [PARTLY] });
    const res = await refundReq({ amount: 20.01 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/\$20\.00 left/);
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });

  it('refunds only the remainder when a full refund follows a partial one', async () => {
    mockHappyPath(PARTLY);
    const res = await refundReq();
    expect(res.status).toBe(200);
    expect(mockStripe.refunds.create.mock.calls[0][0].amount).toBe(2000);
    expect(mockPool.query.mock.calls[1][1]).toEqual(['refunded', '50.00', 10, '30.00']);
  });

  it('returns 409 when the refunded amount already covers the total', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...PARTLY, refunded_amount: '50.00' }] });
    const res = await refundReq();
    expect(res.status).toBe(409);
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });

  it('sends Stripe the same idempotency key when the same refund is requested twice', async () => {
    mockHappyPath();
    await refundReq({ amount: 10 });
    mockHappyPath();
    await refundReq({ amount: 10 });
    const [first, second] = mockStripe.refunds.create.mock.calls.map(c => c[1]?.idempotencyKey);
    expect(first).toBe('refund-10-0-1000');
    expect(second).toBe(first);
  });

  it('records nothing and sends no emails when another request already recorded the refund', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [ORDER] })
      .mockResolvedValueOnce({ rows: [] }); // compare-and-set lost
    const res = await refundReq();
    expect(res.status).toBe(409);
    expect(sendRefundNotification).not.toHaveBeenCalled();
    expect(sendAdminRefundAlert).not.toHaveBeenCalled();
  });
});
