-- Per-product Studio options.
-- second_view: what the Studio's second button shows. 'back' (default, every
-- existing product), 'side' (caps) or 'none' (cups, bags: front only).
-- one_size: hides the XS-XXL picker; the line is sold as "One Size".
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS second_view TEXT NOT NULL DEFAULT 'back',
  ADD COLUMN IF NOT EXISTS one_size BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_second_view_check;
ALTER TABLE products
  ADD CONSTRAINT products_second_view_check CHECK (second_view IN ('back', 'side', 'none'));
