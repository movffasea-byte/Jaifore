/* ================================
   JAIFORE — PRICING TESTS (no database)
   backend/test/pricing.test.js

   Covers the pure arithmetic in backend/pricing.js:
   unit = base + Σ(design fee + that design's own print price)
   ================================ */
const { priceApparelDesigns, PricingError, MAX_DESIGNS_PER_LINE } = require('../pricing');

// print_pricing: Small $2, Medium $5, Large $8
const prints = new Map([
  [1, { id: 1, size_label: 'Small',  dimensions: '3x3',   cents: 200 }],
  [2, { id: 2, size_label: 'Medium', dimensions: '6x6',   cents: 500 }],
  [3, { id: 3, size_label: 'Large',  dimensions: '10x10', cents: 800 }],
]);
const CATALOG_URL    = 'https://cdn.example.com/lion.png';
const catalogDesigns = new Map([[CATALOG_URL, 0]]);   // free artwork
const UPLOAD_FEE     = 100;                           // half the cheapest size

const price = (rawDesigns, extra = {}) => priceApparelDesigns({
  productName: 'Classic Tee', baseCents: 1500, rawDesigns, prints, catalogDesigns, uploadFeeCents: UPLOAD_FEE, ...extra,
});

describe('priceApparelDesigns', () => {
  it('no designs: just the garment', () => {
    expect(price([]).unitCents).toBe(1500);
    expect(price(undefined).designs).toEqual([]);
  });

  it('1 catalog design: base + print price (no fee)', () => {
    const r = price([{ name: 'Lion', src: CATALOG_URL, printSize: { id: 2 } }]);
    expect(r.unitCents).toBe(1500 + 0 + 500);
    expect(r.designs[0].printSize).toMatchObject({ id: 2, size_label: 'Medium', price: 5 });
  });

  it('2 designs with mixed sizes: each pays its own print price', () => {
    const r = price([
      { name: 'Lion',  src: CATALOG_URL, printSize: { id: 1 } },
      { name: 'Eagle', src: CATALOG_URL, printSize: { id: 3 } },
    ]);
    expect(r.unitCents).toBe(1500 + 200 + 800);
    expect(r.designs.map(d => d.printSize.id)).toEqual([1, 3]);
  });

  it(`rejects more than ${MAX_DESIGNS_PER_LINE} designs`, () => {
    const d = { name: 'Lion', src: CATALOG_URL, printSize: { id: 1 } };
    expect(() => price([d, d, d])).toThrow(PricingError);
  });

  it('legacy line-level size still prices every design without its own', () => {
    const r = price(
      [{ name: 'Lion', src: CATALOG_URL }, { name: 'Eagle', src: CATALOG_URL }],
      { lineLevelPrint: { id: 2 } }
    );
    expect(r.unitCents).toBe(1500 + 500 + 500);
    expect(r.designs.every(d => d.printSize.id === 2)).toBe(true);
  });

  it("a design's own size wins over a legacy line-level size", () => {
    const r = price([{ name: 'Lion', src: CATALOG_URL, printSize: { id: 3 } }], { lineLevelPrint: { id: 1 } });
    expect(r.unitCents).toBe(1500 + 800);
  });

  it('uploaded artwork pays the upload fee on top of its print price', () => {
    const r = price([{ name: 'mine.png', src: 'data:image/png;base64,AAAA', printSize: { id: 2 } }]);
    expect(r.unitCents).toBe(1500 + UPLOAD_FEE + 500);
    expect(r.designs[0].price).toBe(1);
  });

  it('an unknown https image is treated as an upload', () => {
    const r = price([{ name: 'x', src: 'https://evil.example/x.png', printSize: { id: 1 } }]);
    expect(r.unitCents).toBe(1500 + UPLOAD_FEE + 200);
  });

  it('catalog design + upload on one garment, different sizes', () => {
    const r = price([
      { name: 'Lion',     src: CATALOG_URL,                   printSize: { id: 3 } },
      { name: 'mine.png', src: 'data:image/png;base64,AAAA', printSize: { id: 1 } },
    ]);
    expect(r.unitCents).toBe(1500 + 800 + (UPLOAD_FEE + 200));
  });

  it('quantity scales the unit price (line total = unit x qty)', () => {
    const r = price([
      { name: 'Lion', src: CATALOG_URL, printSize: { id: 2 } },
      { name: 'Eagle', src: CATALOG_URL, printSize: { id: 1 } },
    ]);
    expect(r.unitCents * 3).toBe((1500 + 500 + 200) * 3);
  });

  it('rejects an unknown size id', () => {
    expect(() => price([{ name: 'Lion', src: CATALOG_URL, printSize: { id: 99 } }])).toThrow(/print size/i);
  });

  it('rejects a design with no size and no legacy size', () => {
    expect(() => price([{ name: 'Lion', src: CATALOG_URL }])).toThrow(PricingError);
  });

  it('rejects when only one of two designs has a size', () => {
    expect(() => price([
      { name: 'Lion',  src: CATALOG_URL, printSize: { id: 1 } },
      { name: 'Eagle', src: CATALOG_URL },
    ])).toThrow(/every design/i);
  });

  it('cleans design fields and keeps the position data', () => {
    const r = price([{ name: '  Lion  ', src: CATALOG_URL, viewKey: 'male_front', x: '10', y: 5, w: 50, h: 40, printSize: { id: 1 } }]);
    expect(r.designs[0]).toMatchObject({ name: 'Lion', viewKey: 'male_front', x: 10, y: 5, w: 50, h: 40 });
  });
});
