CREATE TABLE IF NOT EXISTS app_announcements (
  "id" varchar(32) PRIMARY KEY,
  "content" text NOT NULL DEFAULT '',
  "enabled" boolean NOT NULL DEFAULT false,
  "textColor" varchar(7) NOT NULL DEFAULT '#C4D7C8',
  "backgroundColor" varchar(7) NOT NULL DEFAULT '#203128',
  "updatedById" uuid NULL,
  "updatedByEmail" varchar(160) NOT NULL DEFAULT '',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_announcements
  ADD COLUMN IF NOT EXISTS "textColor" varchar(7) NOT NULL DEFAULT '#C4D7C8',
  ADD COLUMN IF NOT EXISTS "backgroundColor" varchar(7) NOT NULL DEFAULT '#203128';
