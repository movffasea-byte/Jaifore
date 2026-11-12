-- Ready-made products (Jai'fore's own shirts) are sold as shown: no Studio,
-- no customer designs. Every existing product stays Studio-editable.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ready_made BOOLEAN NOT NULL DEFAULT false;
