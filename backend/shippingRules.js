/* ================================
   JAIFORE — SHIPPING RULES
   backend/shippingRules.js

   One source of truth for checkout (routes/stripe.js), the checkout page's
   quote, order emails and Bossy Bot.

   Three delivery options. Estimates are business days counted from the order,
   assuming the items are in stock. If an ordered item has to be restocked first
   (a backorder), Express is not offered and the others move later by
   BACKORDER_EXTRA_BUSINESS_DAYS.

   Keep in sync with: frontend FAQ / terms wording about delivery times.
   Web development is enquiry-only and exempt.
   ================================ */

const { addBusinessDays } = require('./businessTime');

const FREE_SHIPPING_THRESHOLD_CENTS = 60 * 100; // Standard is free from here
const SHIPPING_FEE_CENTS            = 15 * 100; // Standard below the threshold
const EXPRESS_FEE_CENTS             = 1999;     // Express is never free

const DEFAULT_OPTION_ID = 'standard';

const OPTIONS = [
  { id: 'express',  label: 'Express',  minDays: 3, maxDays: 5 },
  { id: 'standard', label: 'Standard', minDays: 5, maxDays: 8 },
  { id: 'no_rush',  label: 'No-Rush',  minDays: 8, maxDays: 10 },
];

// Extra business days when an item must be restocked first. Env-tunable.
function backorderExtraDays() {
  const n = Number(process.env.BACKORDER_EXTRA_BUSINESS_DAYS);
  return Number.isInteger(n) && n >= 0 ? n : 5;
}

function priceCents(optionId, subtotalCents) {
  if (!subtotalCents) return 0;
  if (optionId === 'express') return EXPRESS_FEE_CENTS;
  if (optionId === 'no_rush') return 0;
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_FEE_CENTS;
}

// Business-day range for an option, e.g. { minDays: 5, maxDays: 8 }.
function deliveryDays(option, backordered) {
  const extra = backordered ? backorderExtraDays() : 0;
  return { minDays: option.minDays + extra, maxDays: option.maxDays + extra };
}

// The option for an id, or null when it doesn't exist or isn't available for this cart.
function findOption(optionId, backordered) {
  const option = OPTIONS.find((o) => o.id === optionId);
  if (!option) return null;
  if (backordered && option.id === 'express') return null;
  return option;
}

// What the customer can choose, with prices and dates, for this cart.
function buildOptions({ subtotalCents, backordered = false, from = new Date() }) {
  return OPTIONS.filter((o) => findOption(o.id, backordered)).map((o) => {
    const { minDays, maxDays } = deliveryDays(o, backordered);
    return {
      id: o.id,
      label: o.label,
      price_cents: priceCents(o.id, subtotalCents),
      min_days: minDays,
      max_days: maxDays,
      earliest: addBusinessDays(from, minDays),
      latest: addBusinessDays(from, maxDays),
    };
  });
}

module.exports = {
  FREE_SHIPPING_THRESHOLD_CENTS, SHIPPING_FEE_CENTS, EXPRESS_FEE_CENTS, DEFAULT_OPTION_ID,
  OPTIONS, backorderExtraDays, priceCents, deliveryDays, findOption, buildOptions,
};
