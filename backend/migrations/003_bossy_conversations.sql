-- Bossy Bot chat logs. The IP is stored only as a keyed hash.
CREATE TABLE IF NOT EXISTS bossy_conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ip_hash    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bossy_conversations_updated_idx ON bossy_conversations (updated_at DESC);
CREATE INDEX IF NOT EXISTS bossy_conversations_user_idx ON bossy_conversations (user_id);

CREATE TABLE IF NOT EXISTS bossy_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES bossy_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         TEXT NOT NULL,
  tool_name       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bossy_messages_conv_idx ON bossy_messages (conversation_id, id);
