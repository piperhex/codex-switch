ALTER TABLE "synced_accounts"
  ADD COLUMN IF NOT EXISTS "autoSwitchPriority" integer NOT NULL DEFAULT 0;
