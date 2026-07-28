ALTER TABLE synced_providers
  ADD COLUMN IF NOT EXISTS "balancePlatform" varchar(24),
  ADD COLUMN IF NOT EXISTS "balanceQueryUrl" varchar(1000),
  ADD COLUMN IF NOT EXISTS "balanceQueryToken" text,
  ADD COLUMN IF NOT EXISTS "walletQueryUrl" varchar(1000),
  ADD COLUMN IF NOT EXISTS "walletQueryToken" text,
  ADD COLUMN IF NOT EXISTS "walletUsername" varchar(320),
  ADD COLUMN IF NOT EXISTS "walletPassword" text;
