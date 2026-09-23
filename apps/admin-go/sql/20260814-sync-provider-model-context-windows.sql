ALTER TABLE "synced_providers"
  ADD COLUMN IF NOT EXISTS "modelContextWindows" jsonb NOT NULL DEFAULT '{}'::jsonb;
