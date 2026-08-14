ALTER TABLE "synced_providers"
  ADD COLUMN IF NOT EXISTS "modelReasoningEfforts" jsonb NOT NULL DEFAULT '{}'::jsonb;
