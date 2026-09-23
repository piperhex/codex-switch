ALTER TABLE remote_devices
  ADD COLUMN IF NOT EXISTS "activeProviderId" varchar(64),
  ADD COLUMN IF NOT EXISTS "localProxyRunning" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '[]'::jsonb;
