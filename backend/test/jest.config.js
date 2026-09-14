module.exports = {
  testEnvironment: 'node',
  testTimeout: 15000, // real DB calls are slower than mocked ones
  // Run test files serially, not in parallel workers — several tests
  // share the same test user's cart rows, so parallel workers could
  // race on cleanup and cause flaky failures.
  maxWorkers: 1,
};