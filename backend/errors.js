/* ================================
   JAIFORE — SHARED ERROR RESPONSE
   backend/errors.js

   An unexpected failure must never show its raw message to the caller
   (database errors can reveal table names, hosts and queries), and it must
   reach Sentry so someone sees it. Routes call this in their catch blocks.
   ================================ */
const Sentry = require('@sentry/node');

function serverError(res, err, area) {
  console.error(`[${area}]`, err.message);
  Sentry.captureException(err, { tags: { area } });
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

module.exports = { serverError };
