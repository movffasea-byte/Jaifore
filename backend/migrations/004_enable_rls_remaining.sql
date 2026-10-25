-- Lock the anon/authenticated Supabase roles out of tables created after the baseline.
-- The backend connects as a role that bypasses RLS, so it is unaffected.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bossy_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bossy_messages ENABLE ROW LEVEL SECURITY;
