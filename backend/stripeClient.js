/* ================================
   JAIFORE — STRIPE CLIENT
   backend/stripeClient.js

   One shared Stripe instance for the whole backend. The secret key lives
   ONLY in the STRIPE_SECRET_KEY environment variable (Railway) — never in
   any file in the repo and never in frontend code.

   Exports null when the key isn't set, so the server still boots (and the
   rest of the site keeps working) before Stripe has been configured; the
   payment routes answer "payments are not configured yet" in that case.
   ================================ */
const Stripe = require('stripe');

const key = process.env.STRIPE_SECRET_KEY;
const stripe = key ? new Stripe(key) : null;

if (!key) {
  console.warn('[stripe] STRIPE_SECRET_KEY is not set — online payments are disabled.');
}

module.exports = stripe;