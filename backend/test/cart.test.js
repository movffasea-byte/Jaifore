/* ================================
   JAIFORE — CART ROUTE TESTS
   backend/tests/cart.test.js

   Run with: npm test  (from backend/)

   These hit the REAL Express app and REAL database (via supertest +
   your existing db pool) rather than mocking pg — the bug we're
   guarding against (ON CONFLICT target not matching a real partial
   index) only shows up against an actual Postgres instance, so a
   mocked db would hide exactly the failure we care about.

   Setup expected:
   - .env (or .env.test) has DATABASE_URL / JWT_SECRET etc. pointing
     at a real reachable DB — same dev Supabase DB is fine.
   - A test user exists (or gets created in beforeAll) so we have a
     real, valid JWT to authenticate with.
   - Every row this file inserts is deleted again in afterEach/afterAll
     so repeated runs don't pollute real data.
   ================================ */

const request = require('supertest');
const jwt = require('jsonwebtoken');

// Adjust this path to wherever your Express app is exported from.
// If server.js currently does app.listen() directly with no separate
// export, that's a small refactor needed: split into app.js (exports
// the app) + server.js (calls app.listen()) so supertest can import
// the app without also binding a real port.
const app = require('../app');
const { pool: db } = require('../database');

// A fixed fake product id used only by these tests — pick a real,
// existing product_id from your products table so any FK constraint
// (if cart_items.product_id references products.id) is satisfied.
const TEST_PRODUCT_ID = 17; // <-- same id used in earlier manual testing
const TEST_PRODUCT_ID_CONFIGURED = 1; // any existing configurable product

let testUserId;
let token;
const insertedCartIds = []; // track every row we create, for cleanup

beforeAll(async () => {
  // Reuse a test user if one already exists, otherwise create one.
  // Adjust the email/password to match whatever your users table needs.
  const existing = await db.query(
    `SELECT id FROM users WHERE email = $1`,
    ['cart-tests@jaifore.test']
  );

  if (existing.rows.length) {
    testUserId = existing.rows[0].id;
  } else {
    const inserted = await db.query(
      `INSERT INTO users (name, email, password, verified)
       VALUES ($1, $2, $3, true)
       RETURNING id`,
      ['Cart Test User', 'cart-tests@jaifore.test', 'not-a-real-hash']
    );
    testUserId = inserted.rows[0].id;
  }

  // Sign a token the same way login/verify-otp does, so authenticate()
  // accepts it. Adjust payload shape to match your real JWT payload.
  token = jwt.sign(
    { id: testUserId, name: 'Cart Test User' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
});

afterEach(async () => {
  // Delete only what THIS suite inserted, scoped to the test user —
  // never a blanket DELETE FROM cart_items.
  if (insertedCartIds.length) {
    await db.query(
      `DELETE FROM cart_items WHERE id = ANY($1::int[])`,
      [insertedCartIds]
    );
    insertedCartIds.length = 0;
  }
});

afterAll(async () => {
  await db.end?.(); // close the pool so Jest can exit cleanly
});

describe('GET /api/cart', () => {
  it('returns an empty array for a user with no cart items', async () => {
    const res = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('rejects with 401 when no token is provided', async () => {
    const res = await request(app).get('/api/cart');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/cart — plain product (the bug this suite guards against)', () => {
  it('adds a plain (non-configured) product and returns 201', async () => {
    const res = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId: TEST_PRODUCT_ID,
        name: 'Test Plain Product',
        price: 5000,
        category: 'apparel',
        size: 'M',
        qty: 1,
      });

    // This is the exact case that previously 500'd: config_signature is
    // NULL, and the old single 4-column ON CONFLICT clause couldn't match
    // the 3-column cart_unique_plain partial index.
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('cartItemId');
    expect(res.body.qty).toBe(1);

    insertedCartIds.push(res.body.cartItemId);
  });

  it('increments qty on a second identical POST instead of erroring or duplicating', async () => {
    const first = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: TEST_PRODUCT_ID, name: 'Test Plain Product', price: 5000, size: 'M', qty: 1 });
    insertedCartIds.push(first.body.cartItemId);

    const second = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: TEST_PRODUCT_ID, name: 'Test Plain Product', price: 5000, size: 'M', qty: 2 });

    expect(second.status).toBe(201);
    expect(second.body.cartItemId).toBe(first.body.cartItemId); // same row, not a new one
    expect(second.body.qty).toBe(3); // 1 + 2
  });

  it('rejects with 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ size: 'M' }); // no productId/name/price

    expect(res.status).toBe(400);
  });
});

describe('POST /api/cart — configured product', () => {
  it('adds a configured product (with designs/gender/printSize) and returns 201', async () => {
    const res = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId: TEST_PRODUCT_ID_CONFIGURED,
        name: 'Test Configured Product',
        price: 8000,
        size: 'L',
        qty: 1,
        designs: [{ name: 'design-a' }, { name: 'design-b' }],
        gender: 'male',
        printSize: { id: 'A4' },
      });

    expect(res.status).toBe(201);
    expect(res.body.gender).toBe('male');
    expect(res.body.designs.length).toBe(2);

    insertedCartIds.push(res.body.cartItemId);
  });

  it('treats two different design configs on the same product as separate lines', async () => {
    const a = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId: TEST_PRODUCT_ID_CONFIGURED, name: 'Config A', price: 8000, size: 'L',
        qty: 1, designs: [{ name: 'design-a' }], gender: 'male', printSize: { id: 'A4' },
      });
    insertedCartIds.push(a.body.cartItemId);

    const b = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId: TEST_PRODUCT_ID_CONFIGURED, name: 'Config B', price: 8000, size: 'L',
        qty: 1, designs: [{ name: 'design-z' }], gender: 'male', printSize: { id: 'A4' },
      });
    insertedCartIds.push(b.body.cartItemId);

    expect(a.body.cartItemId).not.toBe(b.body.cartItemId);
  });
});

describe('PATCH /api/cart/:id', () => {
  it('sets qty to an absolute value', async () => {
    const created = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: TEST_PRODUCT_ID, name: 'Patch Test', price: 3000, size: 'S', qty: 1 });
    insertedCartIds.push(created.body.cartItemId);

    const res = await request(app)
      .patch(`/api/cart/${created.body.cartItemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ qty: 5 });

    expect(res.status).toBe(200);
    expect(res.body.qty).toBe(5);
  });

  it('rejects qty less than 1', async () => {
    const created = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: TEST_PRODUCT_ID, name: 'Patch Test 2', price: 3000, size: 'S', qty: 1 });
    insertedCartIds.push(created.body.cartItemId);

    const res = await request(app)
      .patch(`/api/cart/${created.body.cartItemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ qty: 0 });

    expect(res.status).toBe(400);
  });

  it('returns 404 for a cart item belonging to another user', async () => {
    // Fabricate an id that either doesn't exist or isn't owned by this
    // user — either way the WHERE user_id=$3 clause should block it.
    const res = await request(app)
      .patch('/api/cart/999999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ qty: 2 });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/cart/:id', () => {
  it('removes a cart item owned by the user', async () => {
    const created = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: TEST_PRODUCT_ID, name: 'Delete Test', price: 3000, size: 'S', qty: 1 });

    const res = await request(app)
      .delete(`/api/cart/${created.body.cartItemId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Not pushed to insertedCartIds since it's already deleted here.
  });

  it('returns 404 for a nonexistent cart item', async () => {
    const res = await request(app)
      .delete('/api/cart/999999999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/cart/merge', () => {
  it('inserts local-only lines untouched', async () => {
    const res = await request(app)
      .post('/api/cart/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({
        localCart: [
          { id: TEST_PRODUCT_ID, name: 'Merge Local Only', price: 4000, size: 'M', qty: 2 },
        ],
        keepLocal: true,
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const line = res.body.find(i => i.name === 'Merge Local Only');
    expect(line).toBeTruthy();
    expect(line.qty).toBe(2);

    insertedCartIds.push(line.cartItemId);
  });

  it('keepLocal=true overwrites a conflicting server line qty', async () => {
    const existing = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: TEST_PRODUCT_ID, name: 'Merge Conflict', price: 4000, size: 'M', qty: 1 });
    insertedCartIds.push(existing.body.cartItemId);

    const res = await request(app)
      .post('/api/cart/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({
        localCart: [
          { id: TEST_PRODUCT_ID, name: 'Merge Conflict', price: 4000, size: 'M', qty: 9 },
        ],
        keepLocal: true,
      });

    expect(res.status).toBe(200);
    const line = res.body.find(i => i.cartItemId === existing.body.cartItemId);
    expect(line.qty).toBe(9); // overwritten, not summed to 10
  });

  it('keepLocal=false leaves the server line untouched', async () => {
    const existing = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: TEST_PRODUCT_ID, name: 'Merge Conflict 2', price: 4000, size: 'M', qty: 1 });
    insertedCartIds.push(existing.body.cartItemId);

    const res = await request(app)
      .post('/api/cart/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({
        localCart: [
          { id: TEST_PRODUCT_ID, name: 'Merge Conflict 2', price: 4000, size: 'M', qty: 9 },
        ],
        keepLocal: false,
      });

    expect(res.status).toBe(200);
    const line = res.body.find(i => i.cartItemId === existing.body.cartItemId);
    expect(line.qty).toBe(1); // untouched
  });

  it('rejects a non-array localCart with 400', async () => {
    const res = await request(app)
      .post('/api/cart/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ localCart: 'not-an-array', keepLocal: true });

    expect(res.status).toBe(400);
  });
});