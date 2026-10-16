-- Baseline schema, captured from the live Supabase database (jaifore-db).
-- Every statement is idempotent, so on the existing database this is a
-- no-op; on a fresh database it builds the full schema.

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(150) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  role       VARCHAR(20)  DEFAULT 'user',
  verified   BOOLEAN      DEFAULT false,
  created_at TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(150) NOT NULL,
  description    TEXT,
  price          NUMERIC(10,2),
  category       VARCHAR(100),
  image_url      TEXT,
  in_stock       BOOLEAN   DEFAULT true,
  created_at     TIMESTAMP DEFAULT NOW(),
  back_image     TEXT,
  front_male     TEXT,
  back_male      TEXT,
  front_female   TEXT,
  back_female    TEXT,
  stock          INTEGER,
  live_link      TEXT,
  print_size_ids INTEGER[],
  thumb_url      TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id                       SERIAL PRIMARY KEY,
  user_id                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  items                    JSONB         NOT NULL,
  total                    NUMERIC(10,2) NOT NULL,
  status                   VARCHAR(50)   DEFAULT 'processing',
  created_at               TIMESTAMP     DEFAULT NOW(),
  shipping                 JSONB         DEFAULT '{}'::jsonb,
  payment_ref              TEXT UNIQUE,
  payment_status           TEXT          DEFAULT 'pending',
  payment_method           TEXT,
  currency                 TEXT          DEFAULT 'USD',
  subtotal                 NUMERIC,
  shipping_fee             NUMERIC       DEFAULT 0,
  tax_amount               NUMERIC       DEFAULT 0,
  stripe_session_id        TEXT,
  stripe_payment_intent_id TEXT
);
-- One order per Stripe Checkout Session: makes webhook retries a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_session_unique
  ON orders (stripe_session_id) WHERE stripe_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS transactions (
  id             SERIAL PRIMARY KEY,
  order_id       INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  user_id        INTEGER REFERENCES users(id)  ON DELETE SET NULL,
  amount         NUMERIC(10,2) NOT NULL,
  reference      VARCHAR(200) UNIQUE,
  status         VARCHAR(50)  DEFAULT 'pending',
  payment_method VARCHAR(100) DEFAULT 'paystack',
  created_at     TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS print_pricing (
  id         SERIAL PRIMARY KEY,
  size_label VARCHAR NOT NULL,
  dimensions VARCHAR NOT NULL,
  price      NUMERIC NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER     NOT NULL REFERENCES orders(id),
  status     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER     NOT NULL REFERENCES users(id),
  product_id       INTEGER     NOT NULL REFERENCES products(id),
  config_signature TEXT,
  snapshot_data    JSONB       NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  print_size_id    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist_items (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS wishlist_unique_configured
  ON wishlist_items (user_id, product_id, config_signature);
CREATE UNIQUE INDEX IF NOT EXISTS wishlist_unique_plain_v2
  ON wishlist_items (user_id, product_id, COALESCE(print_size_id, 0)) WHERE config_signature IS NULL;

CREATE TABLE IF NOT EXISTS recently_viewed (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER     NOT NULL REFERENCES users(id),
  product_id     INTEGER     NOT NULL REFERENCES products(id),
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recently_viewed_user ON recently_viewed (user_id, last_viewed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS recently_viewed_unique ON recently_viewed (user_id, product_id);

CREATE TABLE IF NOT EXISTS cart_items (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  product_id       INTEGER NOT NULL REFERENCES products(id),
  config_signature TEXT,
  size             VARCHAR,
  qty              INTEGER NOT NULL DEFAULT 1,
  snapshot_data    JSONB   NOT NULL,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);
-- cart.js upserts with ON CONFLICT against these two partial indexes.
CREATE UNIQUE INDEX IF NOT EXISTS cart_unique_configured
  ON cart_items (user_id, product_id, config_signature, size) WHERE config_signature IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cart_unique_plain
  ON cart_items (user_id, product_id, size) WHERE config_signature IS NULL;

CREATE TABLE IF NOT EXISTS qr_codes (
  id              SERIAL PRIMARY KEY,
  slug            TEXT        NOT NULL UNIQUE,
  destination_url TEXT        NOT NULL,
  label           TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qr_codes_slug ON qr_codes (slug);

CREATE TABLE IF NOT EXISTS qr_scans (
  id         SERIAL PRIMARY KEY,
  qr_code_id INTEGER     NOT NULL REFERENCES qr_codes(id),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS pending_checkouts (
  session_id     TEXT PRIMARY KEY,
  user_id        INTEGER NOT NULL,
  items          JSONB   NOT NULL,
  contact        JSONB   NOT NULL DEFAULT '{}'::jsonb,
  subtotal_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL,
  created_at     TIMESTAMP DEFAULT NOW()
);
