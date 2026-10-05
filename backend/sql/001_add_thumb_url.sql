-- backend/sql/001_add_thumb_url.sql
-- Adds a nullable thumbnail URL to products. Safe to run more than once.
-- Run BEFORE using GET /api/products?fields=lite (it selects thumb_url) and
-- before scripts/generate-thumbnails.js (it writes thumb_url).
ALTER TABLE products ADD COLUMN IF NOT EXISTS thumb_url TEXT;
