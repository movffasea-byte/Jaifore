-- Indexes for the queries the dashboard, admin and reports actually run, plus
-- ON DELETE rules so removing a product, user, QR code or order doesn't fail
-- with a foreign-key error (a 500 in the admin) while rows still point at it.
--
-- Nothing here changes data. Indexes are IF NOT EXISTS; each foreign key is
-- found by its columns (not by a guessed name) and re-created with the new rule.

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_user_id              ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at           ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at     ON transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_order_id       ON transactions (order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order  ON order_status_history (order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_qr_scans_qr_code_id         ON qr_scans (qr_code_id);
CREATE INDEX IF NOT EXISTS idx_pending_checkouts_created   ON pending_checkouts (created_at);
CREATE INDEX IF NOT EXISTS idx_cart_items_user_id          ON cart_items (user_id);

-- ── Foreign keys: delete the dependent rows along with their parent ──────
-- A deleted product disappears from carts, wishlists and recently viewed; a
-- deleted account takes its cart/wishlist/history; a deleted QR code takes its
-- scans; a deleted order takes its status history. Orders and transactions keep
-- their SET NULL rules (money records are never deleted with a user).
DO $$
DECLARE
  rule  RECORD;
  fk    RECORD;
BEGIN
  FOR rule IN
    SELECT * FROM (VALUES
      ('wishlist_items',       'user_id',    'users'),
      ('wishlist_items',       'product_id', 'products'),
      ('recently_viewed',      'user_id',    'users'),
      ('recently_viewed',      'product_id', 'products'),
      ('cart_items',           'user_id',    'users'),
      ('cart_items',           'product_id', 'products'),
      ('qr_scans',             'qr_code_id', 'qr_codes'),
      ('order_status_history', 'order_id',   'orders')
    ) AS t(child, col, parent)
  LOOP
    -- Drop whatever foreign key currently sits on this column, whatever it is named.
    FOR fk IN
      SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.contype = 'f'
         AND c.conrelid = rule.child::regclass
         AND a.attname = rule.col
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', rule.child, fk.conname);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE CASCADE',
      rule.child, rule.child || '_' || rule.col || '_fkey', rule.col, rule.parent
    );
  END LOOP;
END $$;

-- ── Print prices must be positive ────────────────────────────────────
-- NOT VALID: applies to every new or changed row without failing on old data.
ALTER TABLE print_pricing DROP CONSTRAINT IF EXISTS print_pricing_price_positive;
ALTER TABLE print_pricing
  ADD CONSTRAINT print_pricing_price_positive CHECK (price > 0) NOT VALID;
