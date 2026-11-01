/* ================================
   JAIFORE — CSP REPORT ROUTE TESTS
   backend/test/cspReport.test.js

   Run with: npx jest test/cspReport.test.js
   ================================ */
const express = require('express');
const request = require('supertest');
const cspReport = require('../routes/cspReport');

const app = express();
app.use(express.json()); // mirrors expressApp: the global parser runs first
app.use('/api/csp-report', cspReport);

const legacy = (over = {}) => ({
  'csp-report': {
    'document-uri': 'https://jaifore.org/checkout.html?session=abc',
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://evil.example/x.js',
    ...over,
  },
});

let warn;
beforeEach(() => {
  cspReport.resetSeen();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('accepts a legacy application/csp-report body and logs it without the query string', async () => {
  const res = await request(app).post('/api/csp-report')
    .set('Content-Type', 'application/csp-report').send(JSON.stringify(legacy()));
  expect(res.status).toBe(204);
  expect(warn).toHaveBeenCalledWith('[csp] script-src-elem blocked https://evil.example/x.js on https://jaifore.org/checkout.html');
});

test('accepts the Reporting API format', async () => {
  const body = [{ type: 'csp-violation', body: { documentURL: 'https://jaifore.org/', effectiveDirective: 'connect-src', blockedURL: 'https://api.other.example' } }];
  const res = await request(app).post('/api/csp-report')
    .set('Content-Type', 'application/reports+json').send(JSON.stringify(body));
  expect(res.status).toBe(204);
  expect(warn).toHaveBeenCalledWith('[csp] connect-src blocked https://api.other.example on https://jaifore.org/');
});

test('logs the same violation only once per hour', async () => {
  for (let i = 0; i < 3; i++) {
    await request(app).post('/api/csp-report').set('Content-Type', 'application/csp-report').send(JSON.stringify(legacy()));
  }
  expect(warn).toHaveBeenCalledTimes(1);
});

test('ignores junk without failing', async () => {
  const res = await request(app).post('/api/csp-report').set('Content-Type', 'application/json').send('{"hello":"world"}');
  expect(res.status).toBe(204);
  expect(warn).not.toHaveBeenCalled();
});
