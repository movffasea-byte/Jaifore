/* ================================
   JAIFORE — BOSSY BOT ROUTE TESTS
   backend/test/bossy.test.js

   Anthropic SDK and Redis are mocked. Run with: npx jest test/bossy.test.js
   ================================ */
process.env.JWT_SECRET = 'test-secret';
process.env.BOSSY_USER_DAILY_CAP = '3';
process.env.BOSSY_GUEST_DAILY_CAP = '2';

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } }))
);
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const mockStore = new Map();
const mockCounts = new Map();
jest.mock('../redis', () => ({
  redis: {
    incr: jest.fn(async (k) => {
      const n = (mockCounts.get(k) || 0) + 1;
      mockCounts.set(k, n);
      return n;
    }),
    expireat: jest.fn(async () => 1),
    get: jest.fn(async (k) => mockStore.get(k) ?? null),
    set: jest.fn(async (k, v) => { mockStore.set(k, v); return 'OK'; }),
    quit: jest.fn(),
  },
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { redis } = require('../redis');
const bossyRouter = require('../routes/bossy');

const app = express();
app.use(express.json());
app.use('/api/bossy', bossyRouter);

const token = jwt.sign({ id: 7, role: 'user' }, process.env.JWT_SECRET);
const chat = (body, tok) => {
  const r = request(app).post('/api/bossy/chat');
  return (tok ? r.set('Authorization', `Bearer ${tok}`) : r).send(body);
};

beforeEach(() => {
  mockStore.clear();
  mockCounts.clear();
  mockCreate.mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'Pick the Large.' }] });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => redis.quit());

describe('validation', () => {
  test('rejects missing, empty and non-string messages', async () => {
    expect((await chat({})).status).toBe(400);
    expect((await chat({ message: '   ' })).status).toBe(400);
    expect((await chat({ message: 42 })).status).toBe(400);
  });

  test('rejects messages over 1,000 characters', async () => {
    const res = await chat({ message: 'a'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('chat', () => {
  test('guest gets a reply, a conversationId and empty actions', async () => {
    const res = await chat({ message: 'Which print size?' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('Pick the Large.');
    expect(res.body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.actions).toEqual([]);
  });

  test('sends no sampling params, effort low and cached system prompt', async () => {
    await chat({ message: 'hi' });
    const params = mockCreate.mock.calls[0][0];
    expect(params.temperature).toBeUndefined();
    expect(params.top_p).toBeUndefined();
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(params.messages[params.messages.length - 1].role).toBe('user');
  });

  test('keeps history by conversationId and sends only the last 10 turns', async () => {
    process.env.BOSSY_USER_DAILY_CAP = '100';
    let id;
    for (let i = 0; i < 12; i++) {
      const res = await chat({ conversationId: id, message: `msg ${i}` }, token);
      id = res.body.conversationId;
    }
    const sent = mockCreate.mock.calls[11][0].messages;
    expect(sent.length).toBeLessThanOrEqual(19);
    expect(sent[0].role).toBe('user');
    expect(sent[sent.length - 1].content).toBe('msg 11');
    process.env.BOSSY_USER_DAILY_CAP = '3';
  });

  test('unknown conversationId starts a fresh conversation', async () => {
    const bogus = '00000000-0000-4000-8000-000000000000';
    const res = await chat({ conversationId: bogus, message: 'hi' });
    expect(res.body.conversationId).not.toBe(bogus);
  });

  test('returns 502 when the model call fails', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const res = await chat({ message: 'hi' });
    expect(res.status).toBe(502);
  });
});

describe('daily caps', () => {
  test('guest is capped at BOSSY_GUEST_DAILY_CAP', async () => {
    expect((await chat({ message: '1' })).status).toBe(200);
    expect((await chat({ message: '2' })).status).toBe(200);
    const res = await chat({ message: '3' });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/guest/i);
  });

  test('logged-in user is capped separately at BOSSY_USER_DAILY_CAP', async () => {
    for (let i = 0; i < 3; i++) expect((await chat({ message: 'x' }, token)).status).toBe(200);
    expect((await chat({ message: 'x' }, token)).status).toBe(429);
    expect(redis.incr).toHaveBeenCalledWith('bossy:cap:user:7');
  });

  test('invalid token falls back to guest limits', async () => {
    await chat({ message: 'x' }, 'not-a-jwt');
    expect(redis.incr).toHaveBeenCalledWith(expect.stringMatching(/^bossy:cap:ip:/));
  });
});
