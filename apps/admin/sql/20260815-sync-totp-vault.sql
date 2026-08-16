CREATE TABLE IF NOT EXISTS synced_totp_vaults (
  "id" uuid PRIMARY KEY,
  "ownerId" uuid NOT NULL REFERENCES users("id") ON DELETE CASCADE,
  "entries" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "tombstones" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "modifiedAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_synced_totp_vaults_ownerId"
  ON synced_totp_vaults ("ownerId");
