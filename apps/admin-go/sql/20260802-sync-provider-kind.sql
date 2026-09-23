ALTER TABLE synced_providers
  ADD COLUMN IF NOT EXISTS kind varchar(24) NOT NULL DEFAULT 'custom';
