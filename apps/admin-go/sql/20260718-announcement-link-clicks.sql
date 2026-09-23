CREATE TABLE IF NOT EXISTS announcement_link_clicks (
  "id" uuid PRIMARY KEY,
  "deviceId" uuid NOT NULL,
  "platform" varchar(20) NOT NULL,
  "email" varchar(160),
  "link" varchar(2048) NOT NULL,
  "announcementUpdatedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_announcement_link_clicks_deviceId_createdAt"
  ON announcement_link_clicks ("deviceId", "createdAt");
CREATE INDEX IF NOT EXISTS "IDX_announcement_link_clicks_platform_createdAt"
  ON announcement_link_clicks ("platform", "createdAt");
CREATE INDEX IF NOT EXISTS "IDX_announcement_link_clicks_createdAt"
  ON announcement_link_clicks ("createdAt");
