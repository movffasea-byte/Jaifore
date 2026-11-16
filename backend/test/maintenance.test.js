/* ================================
   JAIFORE — HOUSEKEEPING TESTS
   backend/test/maintenance.test.js

   Run with: npx jest test/maintenance.test.js
   ================================ */
const { purgeStaleCheckouts, startMaintenance, PENDING_CHECKOUT_DAYS } = require('../maintenance');

describe('purgeStaleCheckouts', () => {
  it('deletes only pending checkouts older than the retention window', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rowCount: 3 }) };
    expect(await purgeStaleCheckouts(pool)).toBe(3);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM pending_checkouts WHERE created_at < NOW\(\) - make_interval\(days => \$1\)/);
    expect(params).toEqual([PENDING_CHECKOUT_DAYS]);
  });

  it('keeps rows longer than Stripe retries an undelivered webhook (3 days)', () => {
    expect(PENDING_CHECKOUT_DAYS).toBeGreaterThan(3);
  });
});

describe('startMaintenance', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('purges once at start, then again on every interval', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
    const timer = startMaintenance({ pool, log: { log: jest.fn(), error: jest.fn() }, intervalMs: 1000 });
    await Promise.resolve();
    expect(pool.query).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(pool.query).toHaveBeenCalledTimes(3);
    clearInterval(timer);
  });

  it('logs a failed purge instead of throwing', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('db down')) };
    const log = { log: jest.fn(), error: jest.fn() };
    const timer = startMaintenance({ pool, log, intervalMs: 1000 });
    await Promise.resolve(); await Promise.resolve();
    expect(log.error).toHaveBeenCalledWith('[maintenance] Purge failed:', 'db down');
    clearInterval(timer);
  });

  it('does not keep the process alive on its own', () => {
    const timer = startMaintenance({ pool: { query: jest.fn().mockResolvedValue({}) }, log: { log: jest.fn(), error: jest.fn() } });
    expect(timer.hasRef()).toBe(false);
    clearInterval(timer);
  });
});
