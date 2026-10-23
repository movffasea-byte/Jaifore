/* ================================
   JAIFORE PRICING (pure functions)
   backend/pricing.js

   The arithmetic behind a configured garment, with no database or Express
   in it so it can be unit-tested directly (test/pricing.test.js).
   routes/stripe.js loads the print sizes, catalog designs and product row,
   then hands them to priceApparelDesigns().
   ================================ */

// A garment carries at most 2 designs in total (front/back in any mix),
// each with its own print size. Keep in sync with MAX_DESIGNS in
// frontend/scripts/configurator.js.
const MAX_DESIGNS_PER_LINE = 2;

class PricingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Unit price (in cents) of one garment and the cleaned design list.
//
//   unit = base + Σ over designs ( design fee + that design's print price )
//
// - design fee: a catalog design pays its catalog price (normally 0 — the
//   artwork is free); any other artwork is a customer upload and pays the
//   upload fee.
// - print size: each design's own `printSize.id`, looked up in `prints`.
//   Backward compatible — a design without its own size falls back to the
//   old line-level `lineLevelPrint`. A missing or unknown size is rejected.
//
// prints:          Map<id, { id, size_label, dimensions, cents }>
// catalogDesigns:  Map<image_url, priceCents>
function priceApparelDesigns({
  productName = 'this item',
  baseCents,
  rawDesigns,
  lineLevelPrint = null,
  prints,
  catalogDesigns,
  uploadFeeCents,
}) {
  const list = Array.isArray(rawDesigns) ? rawDesigns : [];

  if (list.length > MAX_DESIGNS_PER_LINE) {
    throw new PricingError(`"${productName}" can have at most ${MAX_DESIGNS_PER_LINE} designs.`);
  }
  if (!list.length) return { unitCents: baseCents, designs: [] };

  let unitCents = baseCents;

  const designs = list.map(d => {
    const sizeId = Number(d?.printSize?.id ?? lineLevelPrint?.id);
    const print  = prints.get(sizeId);
    if (!print) {
      throw new PricingError(`Please choose a print size for every design on "${productName}".`);
    }

    const src = typeof d.src === 'string' ? d.src : '';
    const feeCents = (src && !src.startsWith('data:') && catalogDesigns.has(src))
      ? catalogDesigns.get(src)
      : uploadFeeCents;

    unitCents += feeCents + print.cents;

    return {
      name:    cleanText(d.name, 200),
      src,
      price:   feeCents / 100,
      viewKey: cleanText(d.viewKey, 30),
      x: Number(d.x) || 0, y: Number(d.y) || 0,
      w: Number(d.w) || 0, h: Number(d.h) || 0,
      printSize: { id: print.id, size_label: print.size_label, dimensions: print.dimensions, price: print.cents / 100 },
    };
  });

  return { unitCents, designs };
}

module.exports = { MAX_DESIGNS_PER_LINE, PricingError, toCents, cleanText, priceApparelDesigns };
