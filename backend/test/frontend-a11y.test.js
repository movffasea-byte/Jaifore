/* ================================
   JAIFORE — FRONTEND ACCESSIBILITY CHECKS (static)
   backend/test/frontend-a11y.test.js

   Reads the static HTML in ../frontend and checks things a screen reader or a
   phone browser depends on: every field has a name, labels point at real
   fields, each page has one h1, no duplicate ids, autocomplete hints on the
   account and checkout forms. No browser needed. Run with:
   npx jest test/frontend-a11y.test.js
   ================================ */
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const PAGES = fs.readdirSync(FRONTEND).filter(f => f.endsWith('.html')).map(f => f)
  .concat(['admin/admin.html']);

// Comments are removed first: an id mentioned in a comment is not an element.
const html = (page) => fs.readFileSync(path.join(FRONTEND, page), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const css = (file) => fs.readFileSync(path.join(FRONTEND, 'styles', file), 'utf8');
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));

function fields(source) {
  return [...source.matchAll(/<(input|textarea|select)\b[^>]*>/g)].map(m => ({ tag: m[0], index: m.index, a: attrs(m[0]) }))
    .filter(f => f.a.type !== 'hidden');
}

const insideLabel = (source, index) => source.lastIndexOf('<label', index) > source.lastIndexOf('</label>', index);

describe.each(PAGES)('%s', (page) => {
  const src = html(page);

  it('has a name for every form field (label, wrapping label or aria-label)', () => {
    const forIds = new Set([...src.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(m => m[1]));
    const unnamed = fields(src).filter(f =>
      !f.a['aria-label'] && !f.a['aria-labelledby'] && !(f.a.id && forIds.has(f.a.id)) && !insideLabel(src, f.index));
    expect(unnamed.map(f => f.tag)).toEqual([]);
  });

  it('every label for="..." points at a field that exists', () => {
    const ids = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const broken = [...src.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(m => m[1]).filter(id => !ids.has(id));
    expect(broken).toEqual([]);
  });

  it('has no duplicate ids', () => {
    const seen = {};
    for (const m of src.matchAll(/\bid="([^"]+)"/g)) seen[m[1]] = (seen[m[1]] || 0) + 1;
    expect(Object.entries(seen).filter(([, n]) => n > 1).map(([id]) => id)).toEqual([]);
  });
});

describe('page headings', () => {
  it.each(['index.html', 'services.html', 'checkout.html', 'configurator.html', 'dashboard.html', 'wishlist.html', 'faq.html'])(
    '%s has exactly one h1', (page) => {
      expect((html(page).match(/<h1\b/g) || []).length).toBe(1);
    });
});

describe('autocomplete hints', () => {
  const hint = (page, id) => attrs(fields(html(page)).find(f => f.a.id === id).tag).autocomplete;

  it('checkout contact fields', () => {
    expect([hint('checkout.html', 'sfFirstName'), hint('checkout.html', 'sfLastName'), hint('checkout.html', 'sfEmail'), hint('checkout.html', 'sfPhone')])
      .toEqual(['given-name', 'family-name', 'email', 'tel']);
  });

  it('new-password fields are marked so password managers offer to generate one', () => {
    expect(hint('loginsys.html', 'reg-password')).toBe('new-password');
    expect(hint('loginsys.html', 'reg-confirm')).toBe('new-password');
    expect(hint('reset-password.html', 'new-password')).toBe('new-password');
    expect(hint('dashboard.html', 'pfNewPw')).toBe('new-password');
    expect(hint('dashboard.html', 'pfCurrentPw')).toBe('current-password');
  });

  it('the six code boxes are named, and none asks the phone to autofill a whole code into one digit', () => {
    const boxes = fields(html('loginsys.html')).filter(f => (f.a.class || '').includes('otp-box'));
    expect(boxes).toHaveLength(6);
    expect(boxes.map(b => b.a['aria-label'])).toEqual([1, 2, 3, 4, 5, 6].map(n => `Digit ${n} of 6`));
    expect(boxes.some(b => b.a.autocomplete === 'one-time-code')).toBe(false);
  });
});

describe('shared form + touch rules (tokens.css)', () => {
  const tokens = css('tokens.css');

  it('keeps form text at 16px on phones so iOS does not zoom', () => {
    expect(tokens).toMatch(/@media \(max-width: 768px\)[^}]*html \.sf-group input[^}]*font-size: 1rem/s);
  });

  it('grows tap targets on touch screens without changing the layout', () => {
    expect(tokens).toMatch(/@media \(pointer: coarse\)/);
    expect(tokens).toMatch(/\.qty-btn::after[^}]*inset: -9px/s);
  });

  it('keeps a visible keyboard focus ring on fields', () => {
    expect(tokens).toMatch(/:focus-visible:focus-visible\s*\{[^}]*outline: 2px solid/s);
  });

  it('defines .sr-only, which the hidden page headings rely on', () => {
    expect(tokens).toMatch(/\.sr-only\s*\{/);
  });

  it('brace balance is intact (a stray brace would silently drop every rule after it)', () => {
    expect((tokens.match(/\{/g) || []).length).toBe((tokens.match(/\}/g) || []).length);
  });
});
