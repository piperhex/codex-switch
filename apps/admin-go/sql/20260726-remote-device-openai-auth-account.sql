ALTER TABLE remote_devices
  ADD COLUMN IF NOT EXISTS "openaiAuthAccountId" varchar(64);
