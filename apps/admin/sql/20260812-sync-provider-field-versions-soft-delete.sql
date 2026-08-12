ALTER TABLE "synced_providers"
  ADD COLUMN IF NOT EXISTS "fieldModifiedAt" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "synced_providers"
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz NULL;
