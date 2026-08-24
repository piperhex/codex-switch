ALTER TABLE "synced_accounts"
  ADD COLUMN IF NOT EXISTS "autoSwitchThreshold" double precision NOT NULL DEFAULT 0;
