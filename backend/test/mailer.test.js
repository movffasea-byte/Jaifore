/* ================================
   JAIFORE — MAILER TESTS
   backend/test/mailer.test.js

   Resend is mocked; each test reads the email that would have been sent.
   Run with: npx jest test/mailer.test.js
   ================================ */
process.env.MAIL_FROM_ADDRESS = 'orders@jaifore.test';

const mockSend = jest.fn().mockResolvedValue({ id: 'em_1' });
jest.mock('resend', () => ({ Resend: jest.fn(() => ({ emails: { send: mockSend } })) }));

const { sendOrderConfirmation, sendAdminOrderAlert, sendOTPEmail, generateOTP } = require('../mailer');
const { formatDateTime, formatDate } = require('../businessTime');

const order = (extra = {}) => ({
  id: 42,
  currency: 'USD',
  total: 35,
  shipping: { cost: 15 },
  items: [{ name: 'Cups', size: 'L', qty: 2, price: 10 }],
  ...extra,
});
const lastEmail = () => mockSend.mock.calls.at(-1)[0];

beforeEach(() => mockSend.mockClear());

describe('sender', () => {
  test('uses MAIL_FROM_ADDRESS, not the Resend test address', async () => {
    await sendOTPEmail('a@b.com', 'Ada', '1234');
    expect(lastEmail().from).toBe('Jaifore Studio <orders@jaifore.test>');
  });
});

describe('order emails', () => {
  test('item prices use the order currency', async () => {
    await sendOrderConfirmation('a@b.com', 'Ada', order());
    const { html } = lastEmail();
    expect(html).toContain('$20.00'); // 2 x $10 line
    expect(html).not.toContain('₦');
  });

  test('an order with no currency recorded is shown in USD', async () => {
    await sendOrderConfirmation('a@b.com', 'Ada', order({ currency: null }));
    expect(lastEmail().html).toContain('$35.00');
    expect(lastEmail().html).not.toContain('₦');
  });

  test('customer-supplied item text is escaped', async () => {
    await sendOrderConfirmation('a@b.com', 'Ada', order({
      items: [{ name: '<b>Cups</b>', size: '<img src=x onerror=alert(1)>', qty: 1, price: 10 }],
    }));
    const { html } = lastEmail();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;Cups&lt;/b&gt;');
  });

  test('admin alert is stamped in business (US Central) time, not WAT', async () => {
    await sendAdminOrderAlert(order(), 'Ada', 'a@b.com');
    const { html } = lastEmail();
    expect(html).toMatch(/\d{1,2}:\d{2} (AM|PM) C[SD]T/);
    expect(html).not.toContain('WAT');
  });
});

describe('generateOTP', () => {
  test('produces 4-digit codes from crypto, not Math.random', () => {
    const spy = jest.spyOn(Math, 'random');
    const codes = Array.from({ length: 200 }, generateOTP);
    expect(codes.every((c) => /^\d{4}$/.test(c))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('businessTime', () => {
  test('formats in US Central, following daylight saving', () => {
    expect(formatDateTime(new Date('2026-07-01T17:30:00Z'))).toBe('Jul 1, 2026, 12:30 PM CDT');
    expect(formatDateTime(new Date('2026-12-01T17:30:00Z'))).toBe('Dec 1, 2026, 11:30 AM CST');
  });

  test('the date is the Texas date, not the UTC date', () => {
    // 03:00 UTC on Nov 1 is still the evening of Oct 31 in Texas.
    expect(formatDate(new Date('2026-11-01T03:00:00Z'))).toBe('October 31, 2026');
  });
});
