ALTER TABLE "synced_accounts"
  ADD COLUMN IF NOT EXISTS "privateDetails" jsonb NOT NULL DEFAULT '{}'::jsonb;
