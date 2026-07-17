CREATE TABLE IF NOT EXISTS rbac_permissions (
  "code" varchar(100) PRIMARY KEY,
  "group" varchar(60) NOT NULL,
  "name" varchar(100) NOT NULL,
  "description" varchar(500) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS rbac_roles (
  "code" varchar(64) PRIMARY KEY,
  "name" varchar(100) NOT NULL,
  "description" varchar(500) NOT NULL DEFAULT '',
  "system" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rbac_role_permissions (
  "roleCode" varchar(64) NOT NULL,
  "permissionCode" varchar(100) NOT NULL,
  CONSTRAINT "PK_rbac_role_permissions" PRIMARY KEY ("roleCode", "permissionCode"),
  CONSTRAINT "FK_rbac_role_permissions_role"
    FOREIGN KEY ("roleCode") REFERENCES rbac_roles ("code") ON DELETE CASCADE,
  CONSTRAINT "FK_rbac_role_permissions_permission"
    FOREIGN KEY ("permissionCode") REFERENCES rbac_permissions ("code") ON DELETE CASCADE
);

INSERT INTO rbac_permissions ("code", "group", "name", "description") VALUES
  ('self.accounts.read', 'self-service', 'Read own accounts', 'View accounts assigned or synchronized to the current user.'),
  ('self.accounts.write', 'self-service', 'Manage own accounts', 'Update account metadata owned by the current user.'),
  ('self.providers.read', 'self-service', 'Read own providers', 'View providers synchronized by the current user.'),
  ('self.providers.write', 'self-service', 'Manage own providers', 'Create, update, and delete providers owned by the current user.'),
  ('self.password.update', 'self-service', 'Change own password', 'Change the current user password.'),
  ('admin.users.read', 'users', 'Read users', 'View users and their synchronized data.'),
  ('admin.users.manage', 'users', 'Manage users', 'Create, update, disable, and delete users.'),
  ('admin.roles.read', 'security', 'Read roles', 'View roles and the permission catalog.'),
  ('admin.roles.manage', 'security', 'Manage roles', 'Create, update, and delete custom roles.'),
  ('admin.official-accounts.read', 'official-accounts', 'Read official accounts', 'View the official account pool and its bindings.'),
  ('admin.official-accounts.manage', 'official-accounts', 'Manage official accounts', 'Create, update, delete, and bind official accounts.'),
  ('admin.audit-logs.read', 'audit', 'Read audit logs', 'View administrative audit events.'),
  ('admin.invitations.read', 'invitations', 'Read invitations', 'View registration invitations.'),
  ('admin.invitations.manage', 'invitations', 'Manage invitations', 'Create and revoke registration invitations.'),
  ('admin.approvals.read', 'approvals', 'Read approvals', 'View administrator approval requests.'),
  ('admin.approvals.manage', 'approvals', 'Manage approvals', 'Create and review administrator approval requests.'),
  ('admin.announcements.read', 'content', 'Read announcements', 'View the application announcement configuration.'),
  ('admin.announcements.manage', 'content', 'Manage announcements', 'Publish and update application announcements.'),
  ('admin.feedback.read', 'feedback', 'Read feedback', 'View feedback and its attachments.'),
  ('admin.feedback.manage', 'feedback', 'Manage feedback', 'Reply to user feedback.'),
  ('admin.telemetry.read', 'telemetry', 'Read telemetry', 'View installation and telemetry analytics.')
ON CONFLICT ("code") DO UPDATE SET
  "group" = EXCLUDED."group",
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO rbac_roles ("code", "name", "description", "system") VALUES
  ('user', 'User', 'Default self-service role.', true),
  ('admin', 'Administrator', 'Built-in role with every permission.', true)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "system" = true,
  "updatedAt" = now();

-- Preserve any legacy role values created outside the old TypeScript union.
INSERT INTO rbac_roles ("code", "name", "description", "system")
SELECT DISTINCT role, role, 'Imported legacy role.', false
FROM users
WHERE role NOT IN ('user', 'admin')
ON CONFLICT ("code") DO NOTHING;

DELETE FROM rbac_role_permissions WHERE "roleCode" IN ('user', 'admin');

INSERT INTO rbac_role_permissions ("roleCode", "permissionCode") VALUES
  ('user', 'self.accounts.read'),
  ('user', 'self.accounts.write'),
  ('user', 'self.providers.read'),
  ('user', 'self.providers.write'),
  ('user', 'self.password.update');

INSERT INTO rbac_role_permissions ("roleCode", "permissionCode")
SELECT 'admin', "code" FROM rbac_permissions;

ALTER TABLE users ALTER COLUMN role TYPE varchar(64);
ALTER TABLE admin_invitations ALTER COLUMN role TYPE varchar(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FK_users_rbac_role'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT "FK_users_rbac_role"
      FOREIGN KEY (role) REFERENCES rbac_roles ("code") ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;
