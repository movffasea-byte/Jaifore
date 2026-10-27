/* ================================
   JAIFORE — BOSSY ADMIN ROUTE TESTS
   backend/test/bossyAdmin.test.js

   Database and Sentry are mocked. Run with: npx jest test/bossyAdmin.test.js
   ================================ */
process.env.JWT_SECRET = 'test-secret';

const mockQuery = jest.fn();
jest.mock('../database', () => ({ pool: { query: (...a) => mockQuery(...a) } }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = express();
app.use('/api/bossy-admin', require('../routes/bossyAdmin'));

const token = (role) => jwt.sign({ id: 1, role }, process.env.JWT_SECRET);
const admin = () => ({ Authorization: `Bearer ${token('admin')}` });
const ID = '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b';

beforeEach(() => mockQuery.mockReset());

describe('access control', () => {
  test.each(['/stats', '/conversations', `/conversations/${ID}`])('%s needs a token', async (path) => {
    const res = await request(app).get(`/api/bossy-admin${path}`);
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test.each(['/stats', '/conversations', `/conversations/${ID}`])('%s rejects a non-admin', async (path) => {
    const res = await request(app).get(`/api/bossy-admin${path}`).set('Authorization', `Bearer ${token('customer')}`);
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('GET /stats', () => {
  test('returns numbers, not strings, and the top tools', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ today: '2', week: '9', month: '30', signed_in: '12', guests: '18' }] })
      .mockResolvedValueOnce({ rows: [{ n: '71' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'search_products', n: '40' }, { name: 'get_price', n: '5' }] });
    const res = await request(app).get('/api/bossy-admin/stats').set(admin());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      conversations: { today: 2, week: 9, month: 30 },
      signedIn: 12,
      guests: 18,
      userMessages30d: 71,
      topTools: [{ name: 'search_products', count: 40 }, { name: 'get_price', count: 5 }],
    });
  });

  test('empty tables give zeros', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ today: '0', week: '0', month: '0', signed_in: '0', guests: '0' }] })
      .mockResolvedValueOnce({ rows: [{ n: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/bossy-admin/stats').set(admin());
    expect(res.body.conversations).toEqual({ today: 0, week: 0, month: 0 });
    expect(res.body.topTools).toEqual([]);
  });

  test('a database failure is a 500 without leaking the error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('password authentication failed for user "x"'));
    const res = await request(app).get('/api/bossy-admin/stats').set(admin());
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/password/);
  });
});

describe('GET /conversations', () => {
  const row = (over = {}) => ({
    id: ID, created_at: '2026-10-27T10:00:00Z', updated_at: '2026-10-27T10:05:00Z',
    user_id: null, user_name: null, message_count: '4', first_message: 'hello', ...over,
  });

  test('maps rows, labels guests, and never returns an IP hash', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ n: '2' }] })
      .mockResolvedValueOnce({ rows: [row(), row({ user_id: 5, user_name: 'Ada', ip_hash: 'secret' })] });
    const res = await request(app).get('/api/bossy-admin/conversations').set(admin());
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.conversations.map((c) => c.who)).toEqual(['Guest', 'Ada']);
    expect(res.body.conversations[0].messageCount).toBe(4);
    expect(JSON.stringify(res.body)).not.toMatch(/ip_hash|secret/);
  });

  test('truncates a long preview', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ n: '1' }] })
      .mockResolvedValueOnce({ rows: [row({ first_message: 'x'.repeat(500) })] });
    const res = await request(app).get('/api/bossy-admin/conversations').set(admin());
    expect(res.body.conversations[0].preview).toHaveLength(120);
  });

  test.each([['0', 1], ['-4', 1], ['abc', 1], ['3', 3]])('page=%s asks for page %i', async (q, page) => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '0' }] }).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/api/bossy-admin/conversations?page=${q}`).set(admin());
    expect(res.body.page).toBe(page);
    expect(mockQuery.mock.calls[1][1]).toEqual([20, (page - 1) * 20]);
  });
});

describe('GET /conversations/:id', () => {
  test('a malformed id is a 404 and never reaches the database', async () => {
    const res = await request(app).get("/api/bossy-admin/conversations/1'; DROP TABLE x;--").set(admin());
    expect(res.status).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('an unknown id is a 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/api/bossy-admin/conversations/${ID}`).set(admin());
    expect(res.status).toBe(404);
  });

  test('returns the transcript with tool rows marked', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ID, created_at: 't0', user_id: 5, user_name: 'Ada', user_email: 'ada@example.com' }] })
      .mockResolvedValueOnce({
        rows: [
          { role: 'user', content: 'wizard hat?', tool_name: null, created_at: 't1' },
          { role: 'tool', content: '3 products', tool_name: 'search_products', created_at: 't2' },
          { role: 'assistant', content: 'Found 3.', tool_name: null, created_at: 't3' },
        ],
      });
    const res = await request(app).get(`/api/bossy-admin/conversations/${ID}`).set(admin());
    expect(res.status).toBe(200);
    expect(res.body.who).toEqual({ name: 'Ada', email: 'ada@example.com' });
    expect(res.body.messages).toEqual([
      { role: 'user', text: 'wizard hat?', tool: null, at: 't1' },
      { role: 'tool', text: '3 products', tool: 'search_products', at: 't2' },
      { role: 'assistant', text: 'Found 3.', tool: null, at: 't3' },
    ]);
  });

  test('a guest conversation has no identity', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ID, created_at: 't0', user_id: null, user_name: null, user_email: null }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/api/bossy-admin/conversations/${ID}`).set(admin());
    expect(res.body.who).toBeNull();
  });
});
