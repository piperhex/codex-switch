ALTER TABLE synced_totp_vaults
  ADD COLUMN IF NOT EXISTS "tombstones" jsonb NOT NULL DEFAULT '[]'::jsonb;
