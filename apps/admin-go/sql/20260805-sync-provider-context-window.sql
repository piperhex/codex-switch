ALTER TABLE synced_providers
  ADD COLUMN IF NOT EXISTS "contextWindow" integer;
