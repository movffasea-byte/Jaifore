-- backend/sql/002_wishlist_print_size.sql
-- Lets a wishlist row remember a graphic design's print size, and lets the
-- same design be saved in two sizes. Run in the Supabase SQL editor.
--
-- 1) FIRST check the real index names and send/inspect the result:
--      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'wishlist_items';
--    The statements below assume the plain-item unique index is called
--    wishlist_unique_plain (the name used in routes/wishlist.js). If yours
--    is different, or it is a CONSTRAINT rather than an index, change the
--    DROP line (ALTER TABLE wishlist_items DROP CONSTRAINT <name>;).
--
-- 2) Then run this (safe to run twice):

ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS print_size_id INTEGER;

DROP INDEX IF EXISTS wishlist_unique_plain;

-- One plain row per (user, product, print size). Rows without a size share size 0.
CREATE UNIQUE INDEX IF NOT EXISTS wishlist_unique_plain_v2
  ON wishlist_items (user_id, product_id, (COALESCE(print_size_id, 0)))
  WHERE config_signature IS NULL;
