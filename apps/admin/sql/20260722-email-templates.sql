CREATE TABLE IF NOT EXISTS mail_services (
  "id" uuid PRIMARY KEY,
  "name" varchar(100) NOT NULL UNIQUE,
  "host" varchar(255) NOT NULL,
  "port" integer NOT NULL,
  "secure" boolean NOT NULL DEFAULT true,
  "username" varchar(255) NOT NULL,
  "encryptedPassword" text NOT NULL,
  "fromAddress" varchar(320) NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "createdById" uuid NULL,
  "createdByEmail" varchar(160) NOT NULL DEFAULT '',
  "updatedById" uuid NULL,
  "updatedByEmail" varchar(160) NOT NULL DEFAULT '',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_templates (
  "code" varchar(100) PRIMARY KEY,
  "subject" varchar(300) NOT NULL,
  "body" text NOT NULL,
  "mailServiceId" uuid NULL,
  "updatedById" uuid NULL,
  "updatedByEmail" varchar(160) NOT NULL DEFAULT '',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS "mailServiceId" uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FK_email_templates_mail_service'
  ) THEN
    ALTER TABLE email_templates
      ADD CONSTRAINT "FK_email_templates_mail_service"
      FOREIGN KEY ("mailServiceId") REFERENCES mail_services ("id") ON DELETE SET NULL;
  END IF;
END $$;

INSERT INTO rbac_permissions ("code", "group", "name", "description", "system") VALUES
  (
    'admin.email-templates.read',
    'content',
    'Read email templates',
    'View notification email template content and variables.',
    true
  ),
  (
    'admin.email-templates.manage',
    'content',
    'Manage email templates',
    'Customize notification email subjects and content.',
    true
  ),
  (
    'admin.mail-services.read',
    'content',
    'Read mail services',
    'View default and custom SMTP sending services.',
    true
  ),
  (
    'admin.mail-services.manage',
    'content',
    'Manage mail services',
    'Create, update, and delete custom SMTP sending services.',
    true
  )
ON CONFLICT ("code") DO UPDATE SET
  "group" = EXCLUDED."group",
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "system" = true;

-- Preserve effective access for existing custom roles when the new mail-service dependencies
-- are introduced by this release.
INSERT INTO rbac_role_permissions ("roleCode", "permissionCode")
SELECT DISTINCT existing."roleCode", 'admin.mail-services.read'
FROM rbac_role_permissions existing
WHERE existing."permissionCode" IN (
  'admin.email-templates.read',
  'admin.email-templates.manage',
  'admin.feedback.manage'
)
ON CONFLICT ("roleCode", "permissionCode") DO NOTHING;

INSERT INTO rbac_role_permissions ("roleCode", "permissionCode")
SELECT DISTINCT existing."roleCode", 'admin.mail-services.manage'
FROM rbac_role_permissions existing
WHERE existing."permissionCode" = 'admin.email-templates.manage'
ON CONFLICT ("roleCode", "permissionCode") DO NOTHING;

INSERT INTO rbac_role_permissions ("roleCode", "permissionCode")
SELECT 'admin', "code"
FROM rbac_permissions
WHERE "code" IN (
  'admin.email-templates.read',
  'admin.email-templates.manage',
  'admin.mail-services.read',
  'admin.mail-services.manage'
)
ON CONFLICT ("roleCode", "permissionCode") DO NOTHING;
