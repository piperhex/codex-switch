import { useEffect, useState } from "react";
import { App as AntApp, DatePicker, Form, Input, Modal } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useI18n } from "../../i18n-context";
import type { ApiClient, SyncAccount } from "../../types";

interface OwnAccountEditModalProps {
  account: SyncAccount | null;
  api: ApiClient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface FormValues {
  note?: string;
  expiresAt?: Dayjs | null;
}

export function OwnAccountEditModal({ account, api, onClose, onSaved }: OwnAccountEditModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!account) return;
    const expiresAt = account.expiresAt ? dayjs(account.expiresAt) : null;
    form.setFieldsValue({
      note: account.note ?? "",
      expiresAt: expiresAt?.isValid() ? expiresAt : null,
    });
  }, [account, form]);

  async function save(values: FormValues) {
    if (!account) return;
    setSaving(true);
    try {
      await api(`/admin/api/profile/accounts/${encodeURIComponent(account.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          note: values.note ?? "",
          expiresAt: values.expiresAt?.format("YYYY-MM-DD") ?? "",
        }),
      });
      message.success(t("common.updated"));
      onClose();
      await onSaved();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("accounts.editMetadataTitle")}
      open={Boolean(account)}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnClose
      width={620}
    >
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="note" label={t("common.note")}>
          <Input.TextArea rows={6} maxLength={1000} showCount />
        </Form.Item>
        <Form.Item name="expiresAt" label={t("common.expiresAt")}>
          <DatePicker format="YYYY-MM-DD" style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
