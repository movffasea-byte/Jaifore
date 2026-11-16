/* ================================
   JAIFORE — SERVER RESILIENCE TESTS
   backend/test/resilience.test.js

   Health check, CORS rejection, graceful shutdown and database pool settings.
   Fully mocked. Run with: npx jest test/resilience.test.js
   ================================ */
process.env.JWT_SECRET = 'test-secret';

const mockPool = { query: jest.fn(), on: jest.fn(), end: jest.fn() };
const mockRedis = { status: 'ready', quit: jest.fn() };
jest.mock('../database', () => ({ pool: mockPool }));
jest.mock('../redis', () => ({ redis: mockRedis, cacheGet: jest.fn(), cacheSet: jest.fn(), cacheInvalidate: jest.fn() }));
jest.mock('../stripeClient', () => ({}));
jest.mock('../push', () => ({ sendAdminPush: jest.fn() }));
jest.mock('../mailer', () => ({}));
jest.mock('@sentry/node', () => ({
  init: jest.fn(), captureException: jest.fn(), captureMessage: jest.fn(), setupExpressErrorHandler: jest.fn(),
}));

const request = require('supertest');
const app = require('../expressApp');
const { createShutdown } = require('../shutdown');

beforeEach(() => {
  mockPool.query.mockReset().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  mockRedis.status = 'ready';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('GET /health', () => {
  it('is ok when the database answers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up', redis: 'up' });
  });

  it('is 503 when the database is unreachable', async () => {
    mockPool.query.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });

  it('stays ok when only Redis is down, and says so', async () => {
    mockRedis.status = 'reconnecting';
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.redis).toBe('down');
  });
});

describe('CORS', () => {
  it('answers a blocked origin with 403, not 500', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This origin is not allowed.');
  });

  it('still allows the real site', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://jaifore.org');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://jaifore.org');
  });
});

describe('graceful shutdown', () => {
  const make = (over = {}) => {
    const server = { close: jest.fn((cb) => cb()) };
    const pool = { end: jest.fn().mockResolvedValue() };
    const redis = { quit: jest.fn().mockResolvedValue() };
    const exit = jest.fn();
    const log = { log: jest.fn(), error: jest.fn() };
    const shutdown = createShutdown({ server, pool, redis, exit, log, timeoutMs: 50, ...over });
    return { server, pool, redis, exit, log, shutdown };
  };

  it('stops the server, closes the database and Redis, then exits 0', async () => {
    const { server, pool, redis, exit, shutdown } = make();
    await shutdown('SIGTERM');
    expect(server.close).toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalled();
    expect(redis.quit).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('closes the server before the database, so in-flight requests can still query', async () => {
    const order = [];
    const { shutdown } = make({
      server: { close: jest.fn((cb) => { order.push('server'); cb(); }) },
      pool: { end: jest.fn(async () => { order.push('pool'); }) },
    });
    await shutdown('SIGTERM');
    expect(order).toEqual(['server', 'pool']);
  });

  it('ignores a second signal while shutting down', async () => {
    const { server, shutdown } = make();
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('exits 1 but still closes everything when a step fails', async () => {
    const { pool, redis, exit, shutdown } = make({ redis: { quit: jest.fn().mockRejectedValue(new Error('boom')) } });
    await shutdown('SIGTERM');
    expect(pool.end).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces an exit when a request never finishes', async () => {
    jest.useFakeTimers();
    const exit = jest.fn();
    const { shutdown } = make({ server: { close: jest.fn() /* never calls back */ }, exit, timeoutMs: 1000 });
    shutdown('SIGTERM');
    await jest.advanceTimersByTimeAsync(1001);
    expect(exit).toHaveBeenCalledWith(1);
    jest.useRealTimers();
  });
});
