-- Bumped whenever a user's password changes (reset, profile change, re-register).
-- Tokens carry the version they were issued with, so old tokens stop working
-- the moment it changes.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
