ALTER TABLE "synced_providers"
  ADD COLUMN IF NOT EXISTS "modelApiFormats" jsonb NOT NULL DEFAULT '{}'::jsonb;
