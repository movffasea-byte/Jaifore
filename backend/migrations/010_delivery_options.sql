-- Delivery options (Express / Standard / No-Rush) and backorders.
--
-- products.allow_backorder: when true, customers can order more than is in
-- stock; the order is flagged backordered and gets a later delivery estimate.
-- Off by default, so nothing changes until a product is switched on.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS allow_backorder BOOLEAN NOT NULL DEFAULT false;

-- What the customer chose, carried from checkout to the order by the Stripe webhook.
ALTER TABLE pending_checkouts
  ADD COLUMN IF NOT EXISTS shipping_method TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS backordered     BOOLEAN NOT NULL DEFAULT false;

-- The order keeps the choice and the delivery window it was promised.
-- Orders placed before this migration keep NULL dates (no estimate was made).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_method   TEXT,
  ADD COLUMN IF NOT EXISTS backordered       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS est_delivery_min  DATE,
  ADD COLUMN IF NOT EXISTS est_delivery_max  DATE;
