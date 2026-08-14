ALTER TABLE synced_providers
  ADD COLUMN IF NOT EXISTS "imageInputModels" jsonb NOT NULL DEFAULT '[]'::jsonb;
