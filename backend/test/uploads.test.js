/* ================================
   JAIFORE — UPLOADS ROUTE TESTS
   backend/test/uploads.test.js

   Mocked Supabase Storage (axios). Run with: npx jest test/uploads.test.js
   ================================ */
process.env.JWT_SECRET = 'test-secret';
process.env.SUPABASE_URL = 'https://proj.supabase.co/';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_BUCKET = 'artwork';

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const uploadsRouter = require('../routes/uploads');

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use('/api/uploads', uploadsRouter);

const token = jwt.sign({ id: 42, role: 'user' }, process.env.JWT_SECRET);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;
const upload = (body, tok = token) => {
  const r = request(app).post('/api/uploads');
  return (tok ? r.set('Authorization', `Bearer ${tok}`) : r).send(body);
};

beforeEach(() => {
  axios.post.mockReset().mockResolvedValue({ status: 200 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('private originals', () => {
  const adminToken = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET);
  const PATH = '42/123e4567-e89b-12d3-a456-426614174000.png';
  const original = (path, tok) => {
    const r = request(app).get('/api/uploads/original').query({ path });
    return tok ? r.set('Authorization', `Bearer ${tok}`) : r;
  };
  beforeEach(() => { process.env.SUPABASE_PRIVATE_BUCKET = 'print-originals'; });
  afterEach(() => { delete process.env.SUPABASE_PRIVATE_BUCKET; });

  it('also stores a copy in the private bucket, same path', async () => {
    const res = await upload({ dataUrl: dataUrl('image/png', PNG) });
    expect(res.status).toBe(201);
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[1][0]).toMatch(/\/storage\/v1\/object\/print-originals\/42\/.+\.png$/);
  });

  it('still succeeds when the private copy fails, and reports it', async () => {
    const Sentry = require('@sentry/node');
    axios.post.mockResolvedValueOnce({ status: 200 }).mockRejectedValueOnce(new Error('boom'));
    const res = await upload({ dataUrl: dataUrl('image/png', PNG) });
    expect(res.status).toBe(201);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('does not touch a private bucket when none is configured', async () => {
    delete process.env.SUPABASE_PRIVATE_BUCKET;
    await upload({ dataUrl: dataUrl('image/png', PNG) });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('refuses guests and non-admins', async () => {
    expect((await original(PATH)).status).toBe(401);
    expect((await original(PATH, token)).status).toBe(403);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it.each([['../etc/passwd'], ['42/x.png'], [''], ['42/123e4567-e89b-12d3-a456-426614174000.svg']])('rejects a bad path (%s)', async (p) => {
    expect((await original(p, adminToken)).status).toBe(400);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns a signed URL valid for 5 minutes', async () => {
    axios.post.mockResolvedValueOnce({ data: { signedURL: '/object/sign/print-originals/' + PATH + '?token=abc' } });
    const res = await original(PATH, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://proj.supabase.co/storage/v1/object/sign/print-originals/' + PATH + '?token=abc');
    expect(axios.post.mock.calls[0][1]).toEqual({ expiresIn: 300 });
  });

  it('returns 404 for an upload that predates the private bucket', async () => {
    axios.post.mockRejectedValueOnce(Object.assign(new Error('nf'), { response: { status: 400 } }));
    expect((await original(PATH, adminToken)).status).toBe(404);
  });

  it('returns 503 when the private bucket is not configured', async () => {
    delete process.env.SUPABASE_PRIVATE_BUCKET;
    expect((await original(PATH, adminToken)).status).toBe(503);
  });
});

it('requires login (guests cannot upload)', async () => {
  const res = await upload({ dataUrl: dataUrl('image/png', PNG) }, null);
  expect(res.status).toBe(401);
  expect(axios.post).not.toHaveBeenCalled();
});

it('stores a valid PNG under the user folder and returns its public URL', async () => {
  const res = await upload({ dataUrl: dataUrl('image/png', PNG) });
  expect(res.status).toBe(201);
  expect(res.body.url).toMatch(/^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/artwork\/42\/[0-9a-f-]+\.png$/);

  const [url, body, opts] = axios.post.mock.calls[0];
  expect(url).toMatch(/\/storage\/v1\/object\/artwork\/42\/.+\.png$/);
  expect(Buffer.isBuffer(body)).toBe(true);
  expect(opts.headers.Authorization).toBe('Bearer service-key');
  expect(opts.headers['Content-Type']).toBe('image/png');
});

it('rejects SVG', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const res = await upload({ dataUrl: dataUrl('image/svg+xml', svg) });
  expect(res.status).toBe(400);
  expect(axios.post).not.toHaveBeenCalled();
});

it('rejects a file whose bytes do not match its claimed type', async () => {
  const res = await upload({ dataUrl: dataUrl('image/png', Buffer.from('<html>not a png</html>')) });
  expect(res.status).toBe(400);
  expect(axios.post).not.toHaveBeenCalled();
});

it('rejects files over 5MB with 413', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
  const res = await upload({ dataUrl: dataUrl('image/png', big) });
  expect(res.status).toBe(413);
  expect(axios.post).not.toHaveBeenCalled();
});

it.each([[undefined], ['hello'], ['data:image/png;base64,']])('rejects a missing or malformed dataUrl (%s)', async (value) => {
  const res = await upload({ dataUrl: value });
  expect(res.status).toBe(400);
});

it('returns 503 when storage is not configured', async () => {
  const saved = process.env.SUPABASE_BUCKET;
  delete process.env.SUPABASE_BUCKET;
  const res = await upload({ dataUrl: dataUrl('image/png', PNG) });
  process.env.SUPABASE_BUCKET = saved;
  expect(res.status).toBe(503);
});

it('returns 502 and reports to Sentry when Supabase rejects the upload', async () => {
  const Sentry = require('@sentry/node');
  axios.post.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { data: { message: 'Bucket not found' } } }));
  const res = await upload({ dataUrl: dataUrl('image/png', PNG) });
  expect(res.status).toBe(502);
  expect(Sentry.captureException).toHaveBeenCalled();
  expect(JSON.stringify(res.body)).not.toContain('Bucket not found');
});
