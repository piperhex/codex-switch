INSERT INTO rbac_permissions ("code", "group", "name", "description", "system") VALUES
  (
    'admin.official-accounts.manage-own',
    'official-accounts',
    'Manage own official accounts',
    'Create pool accounts and manage only accounts added by the current user.',
    true
  )
ON CONFLICT ("code") DO UPDATE SET
  "group" = EXCLUDED."group",
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "system" = true;

INSERT INTO rbac_role_permissions ("roleCode", "permissionCode")
VALUES ('admin', 'admin.official-accounts.manage-own')
ON CONFLICT DO NOTHING;
