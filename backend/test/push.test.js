/* ================================
   JAIFORE — WEB PUSH TESTS
   backend/test/push.test.js

   Mocked web-push and pool. Run with: npx jest test/push.test.js
   ================================ */
const mockPool = { query: jest.fn() };
const mockWebpush = { setVapidDetails: jest.fn(), sendNotification: jest.fn() };

jest.mock('../database', () => ({ pool: mockPool }));
jest.mock('web-push', () => mockWebpush);

const { sendAdminPush } = require('../push');

const subs = [
  { id: 1, endpoint: 'https://push.example/a', p256dh: 'k1', auth: 'a1' },
  { id: 2, endpoint: 'https://push.example/b', p256dh: 'k2', auth: 'a2' },
];

beforeEach(() => {
  jest.clearAllMocks();
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('does nothing when the VAPID keys are missing', async () => {
  delete process.env.VAPID_PUBLIC_KEY;
  const r = await sendAdminPush({ title: 'x' });
  expect(r).toEqual({ sent: 0, removed: 0 });
  expect(mockPool.query).not.toHaveBeenCalled();
});

it('sends to every admin subscription', async () => {
  mockPool.query.mockResolvedValueOnce({ rows: subs });
  mockWebpush.sendNotification.mockResolvedValue({});
  const r = await sendAdminPush({ title: 'New order' });
  expect(r).toEqual({ sent: 2, removed: 0 });
  expect(mockWebpush.sendNotification).toHaveBeenCalledTimes(2);
  expect(mockWebpush.sendNotification.mock.calls[0][1]).toBe(JSON.stringify({ title: 'New order' }));
});

it('deletes subscriptions the push service says are gone (410) and survives other errors', async () => {
  mockPool.query.mockResolvedValueOnce({ rows: subs }).mockResolvedValueOnce({ rows: [] });
  mockWebpush.sendNotification
    .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
    .mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
  const r = await sendAdminPush({ title: 'x' });
  expect(r).toEqual({ sent: 0, removed: 1 });
  expect(mockPool.query).toHaveBeenLastCalledWith(expect.stringContaining('DELETE FROM push_subscriptions'), [[1]]);
});

it('never throws when the database fails', async () => {
  mockPool.query.mockRejectedValueOnce(new Error('db down'));
  await expect(sendAdminPush({ title: 'x' })).resolves.toEqual({ sent: 0, removed: 0 });
});
