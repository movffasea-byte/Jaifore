/* ================================
   JAIFORE — ADMIN STATIC FILES TEST (no database)
   backend/test/static.test.js

   The admin page is served by Express at /admin but loads a few files that
   live elsewhere in frontend/. If a file it needs is not served, admin.html
   breaks on Railway while looking fine locally. This reads admin.html and
   checks every local file it references is actually served.
   ================================ */
const fs   = require('fs');
const path = require('path');
const request = require('supertest');

// Loading the app needs these set; nothing here touches the database, Redis or email.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_dummy';
process.env.JWT_SECRET     = process.env.JWT_SECRET     || 'test-secret';
process.env.DATABASE_URL   = 'postgres://x:x@127.0.0.1:1/x';
process.env.REDIS_URL      = 'redis://127.0.0.1:1';

const app = require('../expressApp');

const adminHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'admin', 'admin.html'), 'utf8');

// Local files admin.html references, resolved to the URL path the browser requests
function referencedUrls() {
  const refs = [...adminHtml.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1])
    .filter(u => !/^(https?:|data:|#|mailto:)/.test(u));
  return refs.map(u => path.posix.normalize(u.startsWith('/') ? u : '/admin/' + u));
}

describe('admin.html local assets are served by Express', () => {
  const urls = referencedUrls();

  it('references at least the stylesheet and script', () => {
    expect(urls).toEqual(expect.arrayContaining(['/admin/admin.css', '/admin/admin.js']));
  });

  urls.forEach(url => {
    it(`serves ${url}`, async () => {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
    });
  });
});
