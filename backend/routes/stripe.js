/* ================================
   JAIFORE STRIPE ROUTE
   backend/routes/stripe.js

   How a purchase works:
   1. The checkout page sends the cart to POST /api/stripe/quote to show
      the customer the REAL prices. Every price is recomputed here from the
      database — the browser's prices are never trusted.
   2. POST /api/stripe/create-checkout-session prices the cart again,
      saves it as a "pending checkout", and returns a Stripe Checkout URL.
      The customer pays on Stripe's page (which also collects the delivery
      address and, when enabled, calculates tax for their country).
   3. Stripe calls POST /api/stripe/webhook when payment succeeds. THAT is
      what creates the order, records the transaction, clears the server
      cart and reduces stock — so an order is never lost if the customer
      closes the tab right after paying.

   All amounts are USD. Money is handled in whole cents on the server.

   The webhook handler is exported separately (module.exports.webhookHandler)
   because it needs the RAW request body to verify Stripe's signature — it
   must be registered with express.raw() BEFORE the global express.json().
   ================================ */
const express = require('express');
const Sentry  = require('@sentry/node');
const { pool } = require('../database');
const { authenticate } = require('../middleware');
const { cacheInvalidate } = require('../redis');
const stripe = require('../stripeClient');
const { sendOrderConfirmation, sendAdminOrderAlert, sendLowStockAlert } = require('../mailer');

const router = express.Router();

// ── CONFIG ───────────────────────────────────────────
const APPAREL_CATEGORY = 'Apparels & Merchandise';
const DESIGN_CATEGORY  = 'Graphic Design';

// Shipping rule: physical orders of $60 or more ship free; below that, a
// flat $15. Web development is enquiry-only and can't be bought here.
const FREE_SHIPPING_THRESHOLD_CENTS = 60 * 100;
const SHIPPING_FEE_CENTS            = 15 * 100;

const MAX_LINES              = 50;
const MAX_LINE_QTY           = 99;
const MAX_DESIGNS_PER_LINE   = 20;
const LOW_STOCK_THRESHOLD    = 5;

const FRONTEND_URL  = (process.env.FRONTEND_URL || 'https://jai-fore.vercel.app').replace(/\/$/, '');

// Set STRIPE_AUTOMATIC_TAX=true in Railway ONLY after the account owner has
// switched on Stripe Tax and added the registrations. Until then checkout
// works without tax (turning it on early makes Stripe reject the session).
const AUTOMATIC_TAX = process.env.STRIPE_AUTOMATIC_TAX === 'true';

// Countries we deliver to. Override with STRIPE_SHIPPING_COUNTRIES
// (comma-separated ISO codes, e.g. "US,CA,GB,NG") — must be codes Stripe supports.
const DEFAULT_SHIPPING_COUNTRIES =
  'US,CA,GB,IE,DE,FR,ES,IT,NL,BE,AT,PT,SE,NO,DK,FI,CH,AU,NZ,NG,GH,KE,ZA,EG,TZ,UG,AE,SA,IN,SG,MY,JP,BR,MX';
const SHIPPING_COUNTRIES = (process.env.STRIPE_SHIPPING_COUNTRIES || DEFAULT_SHIPPING_COUNTRIES)
  .split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

// ── HELPERS ──────────────────────────────────────────
class CartError extends Error {
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

function isHttpsUrl(value) {
  return typeof value === 'string' && /^https:\/\//i.test(value) && value.length <= 2000;
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// ── SERVER-SIDE PRICING ──────────────────────────────
// Turns whatever cart the browser sent into trusted priced lines. Product
// names, base prices, print-size prices, stock and print-size eligibility
// all come from the database.
async function priceCart(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw new CartError('Your cart is empty.');
  }
  if (rawItems.length > MAX_LINES) {
    throw new CartError('Your cart has too many different items. Please split it into smaller orders.');
  }

  const productIds = [...new Set(rawItems.map(i => Number(i.id)).filter(Number.isInteger))];
  if (!productIds.length) throw new CartError('Your cart contains an invalid item.');

  const [productRes, printRes, catalogRes] = await Promise.all([
    pool.query(
      `SELECT id, name, price, category, in_stock, stock, image_url, front_male, print_size_ids
       FROM products WHERE id = ANY($1::int[])`,
      [productIds]
    ),
    pool.query('SELECT id, size_label, dimensions, price FROM print_pricing'),
    pool.query('SELECT image_url, price FROM products WHERE category = $1', [DESIGN_CATEGORY]),
  ]);

  const products = new Map(productRes.rows.map(p => [p.id, p]));
  const prints   = new Map(printRes.rows.map(p => [p.id, { ...p, cents: toCents(p.price) }]));

  // Catalog designs (the free artwork) can be looked up by their image; any
  // other artwork on a shirt is treated as a customer upload and pays the
  // upload fee, which is half the cheapest print size (same as the studio).
  const catalogDesigns = new Map(catalogRes.rows.filter(r => r.image_url).map(r => [r.image_url, toCents(r.price)]));
  const printCents     = [...prints.values()].map(p => p.cents);
  const uploadFeeCents = printCents.length ? Math.round(Math.min(...printCents) / 2) : 0;

  const lines = [];
  const stockNeeded = new Map(); // productId -> total quantity across lines

  for (const raw of rawItems) {
    const product = products.get(Number(raw.id));
    if (!product) throw new CartError('An item in your cart is no longer available. Please remove it and try again.');

    const qty = parseInt(raw.qty, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_LINE_QTY) {
      throw new CartError(`Please choose a quantity between 1 and ${MAX_LINE_QTY} for "${product.name}".`);
    }

    let unitCents;
    let categoryKey;
    let size = null;
    let gender = null;
    let printSize = null;
    let designs = [];
    const detailParts = [];

    if (product.category === APPAREL_CATEGORY) {
      categoryKey = 'apparel';

      size = cleanText(raw.size, 12);
      if (!size) throw new CartError(`Please choose a size for "${product.name}".`);
      detailParts.push(`Size ${size}`);

      const baseCents = toCents(product.price);
      if (!baseCents) throw new CartError(`"${product.name}" can't be purchased right now.`);

      const rawDesigns = Array.isArray(raw.designs) ? raw.designs : [];
      if (rawDesigns.length > MAX_DESIGNS_PER_LINE) {
        throw new CartError(`"${product.name}" has too many designs on it.`);
      }

      if (!rawDesigns.length) {
        unitCents = baseCents;
      } else {
        const print = prints.get(Number(raw.printSize?.id));
        if (!print) throw new CartError(`Please choose a print size for "${product.name}".`);
        printSize = { id: print.id, size_label: print.size_label, dimensions: print.dimensions, price: print.cents / 100 };

        let designsCents = 0;
        designs = rawDesigns.map(d => {
          const src = typeof d.src === 'string' ? d.src : '';
          const feeCents = (src && !src.startsWith('data:') && catalogDesigns.has(src))
            ? catalogDesigns.get(src)
            : uploadFeeCents;
          designsCents += feeCents;
          return {
            name:    cleanText(d.name, 200),
            src,
            price:   feeCents / 100,
            viewKey: cleanText(d.viewKey, 30),
            x: Number(d.x) || 0, y: Number(d.y) || 0,
            w: Number(d.w) || 0, h: Number(d.h) || 0,
          };
        });

        unitCents = baseCents + designsCents + print.cents * designs.length;

        const g = String(raw.gender || '').toLowerCase();
        gender = (g === 'male' || g === 'female') ? g : null;
        if (gender) detailParts.push(gender === 'male' ? 'Male' : 'Female');
        detailParts.push(`Print ${print.size_label}`, `${designs.length} design${designs.length > 1 ? 's' : ''}`);
      }

      // Stock only exists for apparel. NULL stock = not tracked.
      if (product.stock !== null && product.stock !== undefined) {
        stockNeeded.set(product.id, (stockNeeded.get(product.id) || 0) + qty);
      } else if (product.in_stock === false) {
        throw new CartError(`"${product.name}" is out of stock.`);
      }

    } else if (product.category === DESIGN_CATEGORY) {
      categoryKey = 'design';

      const print = prints.get(Number(raw.printSize?.id));
      const offered = Array.isArray(product.print_size_ids) ? product.print_size_ids : [];
      if (!print || !offered.includes(print.id)) {
        throw new CartError(`Please choose a print size for "${product.name}".`);
      }
      printSize = { id: print.id, size_label: print.size_label, dimensions: print.dimensions, price: print.cents / 100 };

      const baseCents = toCents(product.price); // free artwork → normally 0
      unitCents = baseCents + print.cents;
      designs = [{ name: product.name, src: product.image_url || '', price: baseCents / 100, viewKey: '', x: 0, y: 0, w: 0, h: 0 }];
      detailParts.push(`Print ${print.size_label} (${print.dimensions})`);

    } else {
      throw new CartError(`"${product.name}" can't be bought online — please use the Enquire button.`);
    }

    if (!unitCents) throw new CartError(`"${product.name}" can't be purchased right now.`);

    lines.push({
      productId:   product.id,
      name:        product.name,
      category:    categoryKey,
      size,
      qty,
      unitCents,
      gender,
      printSize,
      designs,
      notes:       cleanText(raw.notes, 500),
      snapshot:    isHttpsUrl(raw.snapshot) ? raw.snapshot : null,
      imageUrl:    isHttpsUrl(product.front_male) ? product.front_male : (isHttpsUrl(product.image_url) ? product.image_url : null),
      description: detailParts.join(' · '),
    });
  }

  // Not enough stock for what's in the cart?
  for (const [productId, needed] of stockNeeded) {
    const product = products.get(productId);
    if (needed > product.stock) {
      throw new CartError(
        product.stock > 0
          ? `Only ${product.stock} of "${product.name}" left in stock.`
          : `"${product.name}" is out of stock.`
      );
    }
  }

  const subtotalCents = lines.reduce((sum, l) => sum + l.unitCents * l.qty, 0);
  // Every purchasable line is a physical product, so all of it counts toward shipping.
  const shippingCents = subtotalCents === 0 ? 0
    : (subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_FEE_CENTS);

  return { lines, subtotalCents, shippingCents };
}

function sendCartError(res, err, context) {
  if (err instanceof CartError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(`[stripe] ${context} failed:`, err.message);
  Sentry.captureException(err, { tags: { area: 'stripe-checkout' }, extra: { context } });
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

// ── POST /api/stripe/quote — real prices for the checkout page ─────────
router.post('/quote', authenticate, async (req, res) => {
  try {
    const priced = await priceCart(req.body.items);
    res.json({
      currency: 'USD',
      lines: priced.lines.map(l => ({
        id:         l.productId,
        size:       l.size,
        qty:        l.qty,
        unit_price: l.unitCents / 100,
        line_total: (l.unitCents * l.qty) / 100,
      })),
      subtotal:               priced.subtotalCents / 100,
      shipping_fee:           priced.shippingCents / 100,
      free_shipping_threshold: FREE_SHIPPING_THRESHOLD_CENTS / 100,
      flat_shipping_fee:      SHIPPING_FEE_CENTS / 100,
      total_before_tax:       (priced.subtotalCents + priced.shippingCents) / 100,
      tax_enabled:            AUTOMATIC_TAX,
    });
  } catch (err) { sendCartError(res, err, 'quote'); }
});

// ── POST /api/stripe/create-checkout-session ───────────────────────────
router.post('/create-checkout-session', authenticate, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Online payments are not available yet. Please try again later.' });

  try {
    const contact = {
      name:  cleanText(req.body.contact?.name, 120),
      email: cleanText(req.body.contact?.email, 200),
      phone: cleanText(req.body.contact?.phone, 40),
      notes: cleanText(req.body.contact?.notes, 500),
    };
    if (!contact.name || !contact.phone || !/^\S+@\S+\.\S+$/.test(contact.email)) {
      throw new CartError('Please fill in your name, a valid email and your phone number.');
    }

    const priced = await priceCart(req.body.items);

    const lineItems = priced.lines.map(l => ({
      quantity: l.qty,
      price_data: {
        currency:    'usd',
        unit_amount: l.unitCents,
        ...(AUTOMATIC_TAX ? { tax_behavior: 'exclusive' } : {}),
        product_data: {
          name: l.size ? `${l.name} (${l.size})` : l.name,
          ...(l.description ? { description: l.description.slice(0, 500) } : {}),
          ...(l.imageUrl ? { images: [l.imageUrl] } : {}),
        },
      },
    }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: priced.shippingCents, currency: 'usd' },
          display_name: priced.shippingCents === 0 ? 'Free shipping' : 'Standard shipping',
          ...(AUTOMATIC_TAX ? { tax_behavior: 'exclusive' } : {}),
        },
      }],
      ...(AUTOMATIC_TAX ? { automatic_tax: { enabled: true } } : {}),
      customer_email:      contact.email,
      client_reference_id: String(req.user.id),
      metadata:            { user_id: String(req.user.id) },
      expires_at:          Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
      success_url: `${FRONTEND_URL}/checkout.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${FRONTEND_URL}/checkout.html?payment=cancelled`,
    });

    // Keep the exact priced cart so the webhook can build the order from it
    // (it can be large — uploaded artwork — so it can't go in Stripe metadata).
    const orderItems = priced.lines.map(l => ({
      id: l.productId, name: l.name, category: l.category, size: l.size, qty: l.qty,
      price: l.unitCents / 100, gender: l.gender, printSize: l.printSize,
      designs: l.designs, notes: l.notes, snapshot: l.snapshot,
    }));

    await pool.query(
      `INSERT INTO pending_checkouts (session_id, user_id, items, contact, subtotal_cents, shipping_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.id, req.user.id, JSON.stringify(orderItems), JSON.stringify(contact), priced.subtotalCents, priced.shippingCents]
    );

    res.json({ url: session.url });
  } catch (err) { sendCartError(res, err, 'create-checkout-session'); }
});

// ── GET /api/stripe/session-status — has the order been created yet? ───
router.get('/session-status', authenticate, async (req, res) => {
  const sessionId = req.query.session_id;
  if (typeof sessionId !== 'string' || !sessionId) {
    return res.status(400).json({ error: 'session_id is required.' });
  }
  try {
    const result = await pool.query(
      'SELECT id FROM orders WHERE stripe_session_id = $1 AND user_id = $2',
      [sessionId, req.user.id]
    );
    res.json(result.rows.length ? { status: 'paid', orderId: result.rows[0].id } : { status: 'pending' });
  } catch (err) {
    console.error('[stripe] session-status failed:', err.message);
    res.status(500).json({ error: 'Could not check the payment status.' });
  }
});

// ── FULFILMENT ───────────────────────────────────────
function mapShipping(session, contact) {
  const collected = session.collected_information?.shipping_details || session.shipping_details || null;
  const addr = collected?.address || session.customer_details?.address || {};
  return {
    name:    collected?.name || contact.name || session.customer_details?.name || '',
    email:   contact.email   || session.customer_details?.email || '',
    phone:   contact.phone   || session.customer_details?.phone || '',
    address: [addr.line1, addr.line2].filter(Boolean).join(', '),
    city:    addr.city        || '',
    state:   addr.state       || '',
    country: addr.country     || '',
    postal:  addr.postal_code || '',
    notes:   contact.notes    || '',
  };
}

// Reduces stock for apparel (the only category with a stock count) and sends
// the low-stock alert when a product drops to the threshold.
async function decrementStock(items, orderId) {
  try {
    for (const item of items) {
      const productId = item.id;
      const qty = Number(item.qty) || 1;
      if (!productId) continue;

      const before = await pool.query('SELECT stock FROM products WHERE id = $1', [productId]);
      const oldStock = before.rows.length ? before.rows[0].stock : null;

      const updated = await pool.query(
        `UPDATE products
           SET stock = GREATEST(COALESCE(stock, 0) - $1, 0),
               in_stock = (GREATEST(COALESCE(stock, 0) - $1, 0) > 0)
         WHERE id = $2 AND stock IS NOT NULL AND category = $3
         RETURNING *`,
        [qty, productId, APPAREL_CATEGORY]
      );

      if (updated.rows.length) {
        await cacheInvalidate(`products:single:${productId}`);
        const product = updated.rows[0];
        const crossed = oldStock !== null && oldStock !== undefined &&
          oldStock > LOW_STOCK_THRESHOLD && product.stock <= LOW_STOCK_THRESHOLD;
        if (crossed) {
          sendLowStockAlert(product).catch(e => {
            console.error('[mailer] Low stock alert failed:', e.message);
            Sentry.captureException(e, { tags: { area: 'transactional-email' }, extra: { productId: product.id } });
          });
        }
      }
    }
    await cacheInvalidate('products:list:*');
  } catch (err) {
    console.error('[stock] Decrement failed:', err.message);
    Sentry.captureException(err, { tags: { area: 'inventory' }, extra: { orderId } });
  }
}

// Creates the order for a paid Checkout Session. Safe to run more than once
// for the same session (Stripe retries webhooks): the unique index on
// orders.stripe_session_id makes the second attempt a no-op.
async function fulfillSession(session) {
  const client = await pool.connect();
  let order;
  let pending;

  try {
    await client.query('BEGIN');

    const pendingRes = await client.query('SELECT * FROM pending_checkouts WHERE session_id = $1', [session.id]);
    if (!pendingRes.rows.length) {
      const existing = await client.query('SELECT id FROM orders WHERE stripe_session_id = $1', [session.id]);
      await client.query('ROLLBACK');
      if (existing.rows.length) return; // already fulfilled earlier
      throw new Error(`Paid checkout session ${session.id} has no saved cart — create the order by hand.`);
    }
    pending = pendingRes.rows[0];

    // Integrity check: what Stripe charged for the items must match what we priced.
    if (Number.isFinite(session.amount_subtotal) && session.amount_subtotal !== pending.subtotal_cents) {
      Sentry.captureMessage('Stripe subtotal differs from the server-priced cart', {
        level: 'error',
        tags: { area: 'stripe-checkout' },
        extra: { sessionId: session.id, stripe: session.amount_subtotal, priced: pending.subtotal_cents },
      });
    }

    const subtotal    = (session.amount_subtotal ?? pending.subtotal_cents) / 100;
    const shippingFee = (session.total_details?.amount_shipping ?? pending.shipping_cents) / 100;
    const tax         = (session.total_details?.amount_tax ?? 0) / 100;
    const total       = (session.amount_total ?? (pending.subtotal_cents + pending.shipping_cents)) / 100;
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null;

    const insert = await client.query(
      `INSERT INTO orders
         (user_id, items, total, shipping, payment_ref, payment_status, payment_method, currency,
          subtotal, shipping_fee, tax_amount, stripe_session_id, stripe_payment_intent_id)
       VALUES ($1, $2, $3, $4, $5, 'paid', $6, 'USD', $7, $8, $9, $10, $11)
       ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        pending.user_id,
        JSON.stringify(pending.items),
        total,
        JSON.stringify(mapShipping(session, pending.contact || {})),
        session.id,
        session.payment_method_types?.[0] || 'card',
        subtotal, shippingFee, tax,
        session.id, paymentIntentId,
      ]
    );

    if (!insert.rows.length) { // another webhook delivery got here first
      await client.query('ROLLBACK');
      return;
    }
    order = insert.rows[0];

    await client.query('DELETE FROM cart_items WHERE user_id = $1', [pending.user_id]);
    await client.query('DELETE FROM pending_checkouts WHERE session_id = $1', [session.id]);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  } finally {
    client.release();
  }

  // ── The order exists. Everything below is best-effort: a hiccup here must
  // never make Stripe retry the webhook or look like a failed payment.
  try {
    await pool.query('INSERT INTO order_status_history (order_id, status) VALUES ($1, $2)', [order.id, order.status]);
  } catch (err) {
    console.error('[timeline] Failed to seed history:', err.message);
    Sentry.captureException(err, { tags: { area: 'order-timeline' }, extra: { orderId: order.id } });
  }

  try {
    await pool.query(
      `INSERT INTO transactions (order_id, user_id, amount, reference, status, payment_method)
       VALUES ($1, $2, $3, $4, 'success', 'stripe')`,
      [order.id, order.user_id, order.total, order.stripe_payment_intent_id || session.id]
    );
  } catch (err) {
    console.error('[transactions] Failed to record transaction:', err.message);
    Sentry.captureException(err, { tags: { area: 'transactions' }, extra: { orderId: order.id } });
  }

  await decrementStock(pending.items, order.id);

  try {
    const customer = await pool.query('SELECT name, email FROM users WHERE id = $1', [order.user_id]);
    const customerName  = customer.rows[0]?.name  || pending.contact?.name  || 'Customer';
    const customerEmail = customer.rows[0]?.email || pending.contact?.email || '';

    Promise.allSettled([
      sendOrderConfirmation(customerEmail, customerName, order),
      sendAdminOrderAlert(order, customerName, customerEmail),
    ]).then(results => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`[mailer] ${i === 0 ? 'Order confirmation' : 'Admin order alert'} failed:`, r.reason?.message || r.reason);
          Sentry.captureException(r.reason, {
            tags: { area: 'transactional-email' },
            extra: { orderId: order.id, email: i === 0 ? customerEmail : process.env.ADMIN_EMAIL },
          });
        }
      });
    });
  } catch (err) {
    console.error('[mailer] Could not prepare order emails:', err.message);
  }
}

// ── WEBHOOK ──────────────────────────────────────────
// Registered separately in expressApp.js with express.raw() — see the note at the top.
async function webhookHandler(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send('Stripe webhook is not configured.');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] Webhook signature check failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        await fulfillSession(session);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe] Webhook handling failed:', err.message);
    Sentry.captureException(err, { tags: { area: 'stripe-webhook' }, extra: { eventId: event.id, type: event.type } });
    res.status(500).json({ error: 'Webhook handler failed.' }); // Stripe will retry
  }
}

module.exports = router;
module.exports.webhookHandler = webhookHandler;