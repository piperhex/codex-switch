ALTER TABLE synced_providers
  ADD COLUMN IF NOT EXISTS "balancePlatform" varchar(24),
  ADD COLUMN IF NOT EXISTS "balanceQueryUrl" varchar(1000),
  ADD COLUMN IF NOT EXISTS "balanceQueryToken" text;
