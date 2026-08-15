import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space } from "antd";
import { ScanQrCode } from "lucide-react";
import type { Translate } from "../../i18n";
import {
  normalizeTotpSecret,
  parseOtpAuthUri,
  type TotpDraft,
  type TotpEntry,
} from "../../utils/totp";
import { decodeQrImage, QrImageError } from "./qr";

interface TotpFormModalProps {
  entry: TotpEntry | null;
  open: boolean;
  onCancel: () => void;
  onSave: (draft: TotpDraft) => void;
  t: Translate;
}

const DEFAULT_DRAFT: TotpDraft = {
  issuer: "",
  accountName: "",
  secret: "",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
};

function qrImportError(cause: unknown, t: Translate) {
  if (!(cause instanceof QrImageError)) return t("totp.qrInvalid");
  if (cause.code === "unsupported-image") return t("totp.qrUnsupported");
  if (cause.code === "qr-not-found") return t("totp.qrNotFound");
  return t("totp.qrReadFailed");
}

export function TotpFormModal({ entry, onCancel, onSave, open, t }: TotpFormModalProps) {
  const [form] = Form.useForm<TotpDraft>();
  const [error, setError] = useState("");
  const [imported, setImported] = useState(false);
  const [readingQr, setReadingQr] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(entry ? {
      issuer: entry.issuer,
      accountName: entry.accountName,
      secret: entry.secret,
      algorithm: entry.algorithm,
      digits: entry.digits,
      period: entry.period,
    } : DEFAULT_DRAFT);
    setError("");
    setImported(false);
  }, [entry, form, open]);

  const importQrCode = async (file: File) => {
    setReadingQr(true);
    try {
      const draft = parseOtpAuthUri(await decodeQrImage(file));
      form.setFieldsValue(draft);
      setError("");
      setImported(true);
    } catch (cause) {
      setImported(false);
      setError(qrImportError(cause, t));
    } finally {
      setReadingQr(false);
    }
  };

  const save = async () => {
    try {
      const current = form.getFieldsValue(true);
      const parsed = current.secret?.trim().toLowerCase().startsWith("otpauth://")
        ? parseOtpAuthUri(current.secret)
        : await form.validateFields().then((values) => ({
          ...values,
          secret: normalizeTotpSecret(values.secret),
        }));
      onSave(parsed);
      onCancel();
    } catch (cause) {
      if (cause instanceof Error) setError(t("totp.invalidSecret"));
    }
  };

  return (
    <Modal className="totp-form-modal" open={open} centered width={520}
      title={t(entry ? "totp.editTitle" : "totp.addTitle")}
      okText={t("totp.save")} cancelText={t("table.cancel")}
      onOk={() => void save()} onCancel={onCancel}>
      {!entry && <div className="totp-qr-import">
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importQrCode(file);
        }} />
        <Button icon={<ScanQrCode size={15} />} loading={readingQr}
          onClick={() => fileInputRef.current?.click()}>{t("totp.scanQr")}</Button>
        <span>{t("totp.scanQrHint")}</span>
      </div>}
      {imported ? <Alert type="success" showIcon message={t("totp.qrImported")} /> : null}
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <Form form={form} layout="vertical" requiredMark={false} autoComplete="off">
        <div className="totp-form-row">
          <Form.Item name="issuer" label={t("totp.issuer")}
            rules={[{ required: true, whitespace: true, message: t("totp.issuerRequired") }]}>
            <Input maxLength={160} placeholder={t("totp.issuerPlaceholder")} />
          </Form.Item>
          <Form.Item name="accountName" label={t("totp.accountName")}
            rules={[{ required: true, whitespace: true, message: t("totp.accountRequired") }]}>
            <Input maxLength={320} placeholder={t("totp.accountPlaceholder")} />
          </Form.Item>
        </div>
        <Form.Item name="secret" label={t("totp.secret")}
          extra={t("totp.secretHint")}
          rules={[{ required: true, whitespace: true, message: t("totp.secretRequired") }]}>
          <Input.Password placeholder={t("totp.secretPlaceholder")} />
        </Form.Item>
        <div className="totp-form-options">
          <Form.Item name="algorithm" label={t("totp.algorithm")}>
            <Select options={["SHA1", "SHA256", "SHA512"].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="digits" label={t("totp.digits")}>
            <Select options={[6, 8].map((value) => ({ value, label: String(value) }))} />
          </Form.Item>
          <Form.Item label={t("totp.period")}>
            <Space.Compact block>
              <Form.Item name="period" noStyle>
                <InputNumber min={15} max={120} precision={0} />
              </Form.Item>
              <Button disabled>{t("totp.seconds")}</Button>
            </Space.Compact>
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
