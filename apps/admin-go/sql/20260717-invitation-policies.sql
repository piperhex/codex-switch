ALTER TABLE admin_invitations
  ADD COLUMN IF NOT EXISTS "maxUses" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "usedCount" integer NOT NULL DEFAULT 0;

UPDATE admin_invitations
SET "usedCount" = 1
WHERE "acceptedAt" IS NOT NULL AND "usedCount" = 0;

ALTER TABLE admin_invitations
  ALTER COLUMN "email" DROP NOT NULL,
  ALTER COLUMN "expiresAt" DROP NOT NULL;
