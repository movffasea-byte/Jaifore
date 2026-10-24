/* ================================
   JAIFORE — SHIPPING RULES
   backend/shippingRules.js

   One source of truth for checkout (routes/stripe.js) and Bossy Bot.
   Physical orders of $60 or more ship free; below that, a flat $15.
   Web development is enquiry-only and exempt.
   ================================ */

const FREE_SHIPPING_THRESHOLD_CENTS = 60 * 100;
const SHIPPING_FEE_CENTS            = 15 * 100;

module.exports = { FREE_SHIPPING_THRESHOLD_CENTS, SHIPPING_FEE_CENTS };
