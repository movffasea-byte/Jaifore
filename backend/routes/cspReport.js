/* ================================
   JAIFORE — CSP VIOLATION REPORTS
   backend/routes/cspReport.js

   Browsers POST here when a page breaks the Content-Security-Policy set in
   frontend/vercel.json (report-only for now). Each distinct violation is
   logged once per hour, so one bad page can't flood the logs. Nothing is
   stored; the logs are what we read before switching the policy to enforce.
   ================================ */
const express = require('express');

const router = express.Router();

const REPEAT_WINDOW_MS = 60 * 60 * 1000;
const MAX_TRACKED = 500;
const seen = new Map(); // signature -> last logged at

// Old-style report-uri sends { "csp-report": {...} }; the Reporting API sends
// an array of { type: 'csp-violation', body: {...} }.
function extract(body) {
  if (Array.isArray(body)) return body.filter((r) => r?.type === 'csp-violation').map((r) => r.body || {});
  if (body && typeof body === 'object' && body['csp-report']) return [body['csp-report']];
  return [];
}

const clip = (value) => String(value ?? '').slice(0, 200);

router.post(
  '/',
  express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' }),
  (req, res) => {
    const now = Date.now();
    for (const r of extract(req.body)) {
      const directive = clip(r['effective-directive'] || r.effectiveDirective || r['violated-directive']);
      const blocked = clip(r['blocked-uri'] || r.blockedURL);
      const page = clip(r['document-uri'] || r.documentURL).replace(/[?#].*$/, '');
      const signature = `${directive}|${blocked}|${page}`;

      if (now - (seen.get(signature) || 0) < REPEAT_WINDOW_MS) continue;
      if (seen.size >= MAX_TRACKED) seen.delete(seen.keys().next().value);
      seen.set(signature, now);
      console.warn(`[csp] ${directive} blocked ${blocked || '(inline)'} on ${page}`);
    }
    res.status(204).end();
  }
);

router.resetSeen = () => seen.clear(); // tests only

module.exports = router;
