/* ================================
   JAIFORE — AUTH + MIDDLEWARE TESTS
   backend/test/auth.test.js

   Fully mocked (no real DB, Redis or email). Run with:
   npx jest test/auth.test.js
   ================================ */

process.env.JWT_SECRET = 'test-secret';

const mockPool = { query: jest.fn() };

jest.mock('../database', () => ({ pool: mockPool }));
jest.mock('../redis', () => ({ cacheGet: jest.fn(), cacheSet: jest.fn(), cacheInvalidate: jest.fn() }));
jest.mock('../mailer', () => ({
  generateOTP: jest.fn(() => '123456'),
  sendOTPEmail: jest.fn().mockResolvedValue(),
  sendAdminNotification: jest.fn().mockResolvedValue(),
  sendWelcomeEmail: jest.fn().mockResolvedValue(),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(),
}));

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticate, requireAdmin } = require('../middleware');
const { router: authRouter } = require('../auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.get('/protected', authenticate, (req, res) => res.json({ user: req.user }));
app.get('/admin-only', authenticate, requireAdmin, (req, res) => res.json({ ok: true }));

const sign = (payload, opts = { expiresIn: '1h' }) => jwt.sign(payload, process.env.JWT_SECRET, opts);

beforeEach(() => {
  mockPool.query.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('authenticate middleware', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects a header that is not a Bearer token', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const bad = jwt.sign({ id: 1 }, 'some-other-secret');
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = sign({ id: 1 }, { expiresIn: -10 });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('accepts a valid token and exposes the user', async () => {
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${sign({ id: 5, role: 'user' })}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(5);
  });
});

describe('requireAdmin middleware', () => {
  it('returns 403 for a normal user', async () => {
    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${sign({ id: 5, role: 'user' })}`);
    expect(res.status).toBe(403);
  });

  it('lets an admin through', async () => {
    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${sign({ id: 1, role: 'admin' })}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/login', () => {
  let hash;
  beforeAll(async () => { hash = await bcrypt.hash('correct-horse', 4); });

  const user = (over = {}) => ({ id: 3, name: 'Ada', email: 'ada@test.dev', password: hash, role: 'user', verified: true, ...over });

  it('returns 400 when email or password is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ada@test.dev' });
    expect(res.status).toBe(400);
  });

  it('returns 401 for an unknown email', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.dev', password: 'x' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for a wrong password, with the same message as an unknown email', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [user()] });
    const res = await request(app).post('/api/auth/login').send({ email: 'ada@test.dev', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password.');
  });

  it('returns 403 and needsVerification for an unverified account', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [user({ verified: false })] });
    const res = await request(app).post('/api/auth/login').send({ email: 'ada@test.dev', password: 'correct-horse' });
    expect(res.status).toBe(403);
    expect(res.body.needsVerification).toBe(true);
  });

  it('returns a token carrying id and role on success, never the password hash', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [user({ role: 'admin' })] });
    const res = await request(app).post('/api/auth/login').send({ email: ' ADA@test.dev ', password: 'correct-horse' });
    expect(res.status).toBe(200);
    expect(mockPool.query.mock.calls[0][1]).toEqual(['ada@test.dev']); // normalised
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded).toMatchObject({ id: 3, role: 'admin' });
    expect(JSON.stringify(res.body)).not.toContain(hash);
  });
});

describe('registration and OTP', () => {
  // Fake Redis: the pending registration must live there, not in process memory.
  const redisMock = require('../redis');
  let store;
  beforeEach(() => {
    store = new Map();
    redisMock.cacheGet.mockImplementation(async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null));
    redisMock.cacheSet.mockImplementation(async (k, v) => { store.set(k, JSON.stringify(v)); });
    redisMock.cacheInvalidate.mockImplementation(async (k) => { store.delete(k); });
  });
  afterEach(() => {
    redisMock.cacheGet.mockReset(); redisMock.cacheSet.mockReset(); redisMock.cacheInvalidate.mockReset();
  });

  it('rejects a password shorter than 8 characters', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'A', email: 'a@test.dev', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when a verified account already exists', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1, verified: true }] });
    const res = await request(app).post('/api/auth/register').send({ name: 'A', email: 'a@test.dev', password: 'longenough1' });
    expect(res.status).toBe(409);
  });

  it('rejects a wrong OTP, then accepts the right one and issues a token', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // no existing user
    const email = 'otp@test.dev';
    const reg = await request(app).post('/api/auth/register').send({ name: 'Otp', email, password: 'longenough1' });
    expect(reg.status).toBe(200);

    const wrong = await request(app).post('/api/auth/verify-otp').send({ email, otp: '000000' });
    expect(wrong.status).toBe(400);

    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 9, name: 'Otp', email, role: 'user', created_at: new Date() }] });
    const ok = await request(app).post('/api/auth/verify-otp').send({ email, otp: '123456' });
    expect(ok.status).toBe(201);
    expect(jwt.verify(ok.body.token, process.env.JWT_SECRET).id).toBe(9);
  });

  it('keeps the pending registration in Redis with a 10 minute TTL and clears it once verified', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const email = 'store@test.dev';
    await request(app).post('/api/auth/register').send({ name: 'S', email, password: 'longenough1' });
    expect(redisMock.cacheSet).toHaveBeenCalledWith('otp:store@test.dev', expect.objectContaining({ otp: '123456' }), 600);
    expect(store.has('otp:store@test.dev')).toBe(true);

    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 3, name: 'S', email, role: 'user', created_at: new Date() }] });
    await request(app).post('/api/auth/verify-otp').send({ email, otp: '123456' });
    expect(store.has('otp:store@test.dev')).toBe(false);
  });

  it('resend-otp refreshes the stored code', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const email = 'resend@test.dev';
    await request(app).post('/api/auth/register').send({ name: 'R', email, password: 'longenough1' });
    const res = await request(app).post('/api/auth/resend-otp').send({ email });
    expect(res.status).toBe(200);
    expect(redisMock.cacheSet).toHaveBeenCalledTimes(2);
  });

  it('returns 400 for resend-otp with no pending registration', async () => {
    const res = await request(app).post('/api/auth/resend-otp').send({ email: 'ghost@test.dev' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for verify-otp with no pending registration', async () => {
    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'ghost@test.dev', otp: '123456' });
    expect(res.status).toBe(400);
  });
});
