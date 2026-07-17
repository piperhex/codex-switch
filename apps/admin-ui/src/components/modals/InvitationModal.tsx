import { useState } from "react";
import { App as AntApp, Button, Form, Input, InputNumber, Modal, Select, Switch } from "antd";
import { ClipboardCopy } from "lucide-react";
import { labelForRole } from "../../i18n";
import { useI18n } from "../../i18n-context";
import type { ApiClient, Invitation, RbacRole, Role } from "../../types";

interface InvitationModalProps {
  open: boolean;
  api: ApiClient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  roles: RbacRole[];
}

interface InvitationFormValues {
  email?: string;
  role: Role;
  maxUses: number;
  neverExpires: boolean;
  expiresInHours: number;
}

export function InvitationModal({ api, onClose, onSaved, open, roles }: InvitationModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm();
  const [createdInvite, setCreatedInvite] = useState<string | null>(null);
  const neverExpires = Form.useWatch("neverExpires", form) ?? false;

  const close = () => {
    onClose();
    setCreatedInvite(null);
    form.resetFields();
  };

  return (
    <Modal
      title={t("invitationModal.title")}
      open={open}
      onCancel={close}
      onOk={() => form.submit()}
      destroyOnClose
    >
      {createdInvite && (
        <div className="token-box">
          <code>{`${window.location.origin}/admin?inviteToken=${createdInvite}`}</code>
          <Button
            icon={<ClipboardCopy size={15} />}
            onClick={async () => {
              await navigator.clipboard.writeText(`${window.location.origin}/admin?inviteToken=${createdInvite}`);
              message.success(t("common.copied"));
            }}
          />
        </div>
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ role: "user", maxUses: 1, neverExpires: false, expiresInHours: 72 }}
        onFinish={async (values: InvitationFormValues) => {
          const invitation = await api<Invitation>("/admin/api/invitations", {
            method: "POST",
            body: JSON.stringify(values),
          });
          setCreatedInvite(invitation.token ?? null);
          message.success(t("common.created"));
          await onSaved();
        }}
      >
        <Form.Item
          name="email"
          label={t("common.email")}
          extra={t("invitations.emailHint")}
          rules={[{ type: "email" }]}
        >
          <Input placeholder={t("invitations.anyEmail")} />
        </Form.Item>
        <Form.Item name="role" label={t("common.role")} rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={roles.map((role) => ({
              label: role.system ? labelForRole(role.code, t) : role.name,
              value: role.code,
            }))}
          />
        </Form.Item>
        <Form.Item name="maxUses" label={t("invitations.maxUses")} rules={[{ required: true }]}>
          <InputNumber min={1} max={10000} precision={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="neverExpires" label={t("invitations.neverExpires")} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="expiresInHours"
          label={t("invitations.validHours")}
          rules={neverExpires ? [] : [{ required: true }]}
        >
          <InputNumber min={1} max={720} precision={0} disabled={neverExpires} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
