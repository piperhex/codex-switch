CREATE TABLE IF NOT EXISTS remote_devices (
  "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "deviceId" uuid NOT NULL,
  name varchar(120) NOT NULL,
  platform varchar(20) NOT NULL,
  "appVersion" varchar(50),
  "activeAccountId" varchar(64),
  "lastSeenAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("ownerId", "deviceId")
);

CREATE INDEX IF NOT EXISTS "IDX_remote_devices_owner_name"
  ON remote_devices ("ownerId", name);
