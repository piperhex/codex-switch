ALTER TABLE synced_providers
  ADD COLUMN IF NOT EXISTS "group" varchar(80) NOT NULL DEFAULT '';

ALTER TABLE remote_devices
  ADD COLUMN IF NOT EXISTS "activeProviderGroup" varchar(80);
