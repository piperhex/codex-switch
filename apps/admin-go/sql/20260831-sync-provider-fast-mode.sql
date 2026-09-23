ALTER TABLE "synced_providers"
ADD COLUMN IF NOT EXISTS "fastModeEnabled" boolean NOT NULL DEFAULT false;
