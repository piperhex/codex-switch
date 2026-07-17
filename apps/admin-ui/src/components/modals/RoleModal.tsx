import { useEffect, useMemo, useState } from "react";
import { App as AntApp, Checkbox, Form, Input, Modal, Typography } from "antd";
import { useI18n } from "../../i18n-context";
import type { ApiClient, Permission, PermissionDefinition, RbacRole } from "../../types";

interface RoleModalProps {
  open: boolean;
  role: RbacRole | null;
  permissions: PermissionDefinition[];
  grantablePermissions: Permission[];
  api: ApiClient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface RoleFormValues {
  code: string;
  name: string;
  description?: string;
  permissions: Permission[];
}

export function RoleModal({
  api,
  grantablePermissions,
  onClose,
  onSaved,
  open,
  permissions,
  role,
}: RoleModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm<RoleFormValues>();
  const [saving, setSaving] = useState(false);
  const grantable = useMemo(() => new Set(grantablePermissions), [grantablePermissions]);
  const selected = useMemo(() => new Set(role?.permissions ?? []), [role?.permissions]);
  const groups = useMemo(() => {
    const grouped = new Map<string, PermissionDefinition[]>();
    for (const permission of permissions) {
      const group = grouped.get(permission.group) ?? [];
      group.push(permission);
      grouped.set(permission.group, group);
    }
    return [...grouped.entries()];
  }, [permissions]);

  useEffect(() => {
    if (!open) {
      form.resetFields();
      return;
    }
    form.setFieldsValue(role
      ? {
        code: role.code,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
      }
      : { code: "", name: "", description: "", permissions: [] });
  }, [form, open, role]);

  return (
    <Modal
      title={t(role ? "roles.editTitle" : "roles.createTitle")}
      open={open}
      width={780}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnClose
    >
      <Form<RoleFormValues>
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          setSaving(true);
          try {
            const path = role ? `/admin/api/roles/${encodeURIComponent(role.code)}` : "/admin/api/roles";
            await api(path, {
              method: role ? "PATCH" : "POST",
              body: JSON.stringify(values),
            });
            message.success(t(role ? "common.updated" : "common.created"));
            onClose();
            await onSaved();
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form.Item
          name="code"
          label={t("roles.code")}
          extra={t("roles.codeHint")}
          rules={[
            { required: true },
            { pattern: /^[a-z][a-z0-9_-]{1,63}$/ },
          ]}
        >
          <Input disabled={Boolean(role)} maxLength={64} />
        </Form.Item>
        <Form.Item name="name" label={t("roles.name")} rules={[{ required: true, whitespace: true }]}>
          <Input maxLength={100} showCount />
        </Form.Item>
        <Form.Item name="description" label={t("roles.descriptionField")}>
          <Input.TextArea maxLength={500} showCount rows={3} />
        </Form.Item>
        <Form.Item name="permissions" label={t("roles.permissions")} initialValue={[]}>
          <Checkbox.Group style={{ width: "100%" }}>
            <div className="permission-groups">
              {groups.map(([group, entries]) => (
                <div className="permission-group" key={group}>
                  <Typography.Text strong>{group}</Typography.Text>
                  <div className="permission-options">
                    {entries.map((permission) => (
                      <Checkbox
                        key={permission.code}
                        value={permission.code}
                        disabled={!grantable.has(permission.code) && !selected.has(permission.code)}
                      >
                        <span className="permission-option-copy">
                          <span>{permission.name}</span>
                          <Typography.Text type="secondary">{permission.code}</Typography.Text>
                        </span>
                      </Checkbox>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Checkbox.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
}
