/* ================================
   JAIFORE — CART SIGNATURE PARITY TEST
   backend/test/signature.test.js

   The cart-line "configuration signature" exists as separate copies in
   frontend/data/cart.js, routes/cart.js and routes/wishlist.js (no shared
   build step). This proves they all return the same string for the same
   cart line, and that a design's print size is part of the signature.
   ================================ */
const fs   = require('fs');
const path = require('path');

// The routes pull in auth/mailer, which need these set just to load.
// Dummy values are enough: nothing here sends an email or touches the database.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_dummy';
process.env.JWT_SECRET     = process.env.JWT_SECRET     || 'test-secret';

const cartRoute     = require('../routes/cart');
const wishlistRoute = require('../routes/wishlist');

// The frontend file is a browser script, so lift the function out of its source
const frontendSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'data', 'cart.js'), 'utf8');
const fnSource    = frontendSrc.match(/function configSignature\(item\) \{[\s\S]*?\r?\n\}/)[0];
const frontendSig = new Function(`${fnSource}; return configSignature;`)();

// One call per implementation, from the same logical cart line
const sigs = {
  frontend: line => frontendSig(line),
  cart:     line => cartRoute.configSignature(line),
  wishlist: line => wishlistRoute.configSignature({ ...line, customDesigns: line.designs }),
};

const SAMPLES = {
  'plain product':            { designs: [] },
  'no designs key':           {},
  'one design, own size':     { designs: [{ name: 'Lion', printSize: { id: 2 } }], gender: 'male' },
  'two designs, mixed sizes': { designs: [{ name: 'Lion', printSize: { id: 1 } }, { name: 'Eagle', printSize: { id: 3 } }], gender: 'female' },
  'reversed order':           { designs: [{ name: 'Eagle', printSize: { id: 3 } }, { name: 'Lion', printSize: { id: 1 } }], gender: 'female' },
  'size by label only':       { designs: [{ name: 'Lion', printSize: { size_label: 'Large' } }] },
  'legacy line-level size':   { designs: [{ name: 'Lion' }, { name: 'Eagle' }], printSize: { id: 2 }, gender: 'male' },
  'design without a name':    { designs: [{ src: 'https://x/y.png', printSize: { id: 1 } }] },
  'no gender':                { designs: [{ name: 'Lion', printSize: { id: 1 } }] },
  'position is ignored':      { designs: [{ name: 'Lion', printSize: { id: 1 }, x: 10, y: 20, w: 5, h: 5 }] },
};

describe('configSignature parity (frontend, cart route, wishlist route)', () => {
  Object.entries(SAMPLES).forEach(([label, line]) => {
    it(`all three agree: ${label}`, () => {
      const out = Object.values(sigs).map(fn => fn(line));
      expect(out[1]).toBe(out[0]);
      expect(out[2]).toBe(out[0]);
    });
  });
});

describe('configSignature behaviour', () => {
  const sig = sigs.cart;

  it('is null for a plain product', () => {
    expect(sig(SAMPLES['plain product'])).toBeNull();
    expect(sig(SAMPLES['no designs key'])).toBeNull();
  });

  it('treats the same design in two print sizes as different lines', () => {
    const small = sig({ designs: [{ name: 'Lion', printSize: { id: 1 } }], gender: 'male' });
    const large = sig({ designs: [{ name: 'Lion', printSize: { id: 3 } }], gender: 'male' });
    expect(small).not.toBe(large);
  });

  it('ignores design order', () => {
    expect(sig(SAMPLES['two designs, mixed sizes'])).toBe(sig(SAMPLES['reversed order']));
  });

  it('ignores position and size of the artwork on the garment', () => {
    expect(sig(SAMPLES['position is ignored'])).toBe(sig({ designs: [{ name: 'Lion', printSize: { id: 1 } }] }));
  });

  it('a legacy line-level size matches the same size set on each design', () => {
    const legacy = sig({ designs: [{ name: 'Lion' }], printSize: { id: 2 }, gender: 'male' });
    const modern = sig({ designs: [{ name: 'Lion', printSize: { id: 2 } }], gender: 'male' });
    expect(legacy).toBe(modern);
  });
});
