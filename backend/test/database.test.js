/* ================================
   JAIFORE — DATABASE POOL SETTINGS
   backend/test/database.test.js

   The pool must not crash the server on an idle-client error, and must have
   timeouts. Run with: npx jest test/database.test.js
   ================================ */
const mockHandlers = {};
const mockOptions = {};
jest.mock('pg', () => ({
  Pool: jest.fn(function (opts) {
    Object.assign(mockOptions, opts);
    this.on = (event, fn) => { mockHandlers[event] = fn; };
  }),
}));
jest.mock('../migrate', () => ({ runMigrations: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

describe('database pool', () => {
  beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); require('../database'); });

  it('listens for idle client errors, so a dropped connection cannot crash the process', () => {
    expect(typeof mockHandlers.error).toBe('function');
    expect(() => mockHandlers.error(new Error('Connection terminated unexpectedly'))).not.toThrow();
    expect(require('@sentry/node').captureException).toHaveBeenCalled();
  });

  it('has a connection limit and timeouts', () => {
    expect(mockOptions.max).toBeGreaterThan(0);
    expect(mockOptions.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(mockOptions.idleTimeoutMillis).toBeGreaterThan(0);
    expect(mockOptions.statement_timeout).toBeGreaterThan(0);
  });
});
