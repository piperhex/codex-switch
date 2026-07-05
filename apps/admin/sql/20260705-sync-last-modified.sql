ALTER TABLE synced_accounts
  ADD COLUMN IF NOT EXISTS "lastModifiedAt" timestamptz NOT NULL DEFAULT now();
