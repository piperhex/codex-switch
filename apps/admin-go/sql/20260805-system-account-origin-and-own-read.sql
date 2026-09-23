ALTER TABLE system_accounts
  ADD COLUMN IF NOT EXISTS "source" varchar(20) NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS "addedByUserId" uuid NULL,
  ADD COLUMN IF NOT EXISTS "addedByEmail" varchar(240) NULL,
  ADD COLUMN IF NOT EXISTS "sourceAccountId" varchar(64) NULL;

CREATE INDEX IF NOT EXISTS "IDX_system_accounts_addedByUserId"
  ON system_accounts ("addedByUserId");

-- Recover the operator for existing pool accounts from the audit trail when possible.
WITH origins AS (
  SELECT DISTINCT ON (log."targetId")
    log."targetId",
    log."actorId",
    log."actorEmail",
    log.metadata
  FROM admin_audit_logs AS log
  WHERE log."targetType" = 'official-account'
    AND log.action IN (
      'official-account.create',
      'official-account.create-from-user',
      'official-account.create-from-own-account'
    )
  ORDER BY log."targetId", log."createdAt" ASC
)
UPDATE system_accounts AS account
SET
  "addedByUserId" = origin."actorId",
  "addedByEmail" = NULLIF(origin."actorEmail", ''),
  "sourceAccountId" = NULLIF(origin.metadata->>'sourceAccountId', '')
FROM origins AS origin
WHERE account."addedByUserId" IS NULL
  AND origin."targetId" = account.id::text;

INSERT INTO rbac_permissions ("code", "group", "name", "description", "system") VALUES
  (
    'admin.official-accounts.read-own',
    'official-accounts',
    'Read own official accounts',
    'View only official pool accounts added by the current user.',
    true
  )
ON CONFLICT ("code") DO UPDATE SET
  "group" = EXCLUDED."group",
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "system" = true;

INSERT INTO rbac_role_permissions ("roleCode", "permissionCode")
VALUES ('admin', 'admin.official-accounts.read-own')
ON CONFLICT DO NOTHING;
