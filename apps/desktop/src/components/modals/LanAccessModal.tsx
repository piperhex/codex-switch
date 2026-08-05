import { Input, Modal } from "antd";
import { useEffect, useState } from "react";
import type { Translate } from "../../i18n";

export function LanAccessModal({
  open,
  hasConfiguredKey,
  loading,
  onClose,
  onConfirm,
  t,
}: {
  open: boolean;
  hasConfiguredKey: boolean;
  loading: boolean;
  onClose: () => void;
  onConfirm: (apiKey?: string) => Promise<boolean>;
  t: Translate;
}) {
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (open) setApiKey("");
  }, [open]);

  const normalizedApiKey = apiKey.trim();
  const canConfirm = Boolean(normalizedApiKey || hasConfiguredKey);
  const submit = async () => {
    if (!canConfirm) return;
    const succeeded = await onConfirm(normalizedApiKey || undefined);
    if (succeeded) onClose();
  };

  return (
    <Modal
      open={open}
      width={400}
      title={t("providers.proxy.lanAccessTitle")}
      okText={t("providers.proxy.enableLan")}
      cancelText={t("providers.proxy.cancel")}
      confirmLoading={loading}
      okButtonProps={{ disabled: !canConfirm }}
      closable={!loading}
      maskClosable={!loading}
      onCancel={onClose}
      onOk={() => void submit()}
    >
      <div className="lan-access-form">
        <p>{t("providers.proxy.lanAccessDescription")}</p>
        <label htmlFor="local-proxy-lan-api-key">{t("providers.proxy.lanApiKey")}</label>
        <Input.Password
          id="local-proxy-lan-api-key"
          autoFocus
          value={apiKey}
          disabled={loading}
          placeholder={hasConfiguredKey
            ? t("providers.proxy.keepLanApiKey")
            : t("providers.proxy.lanApiKeyPlaceholder")}
          onChange={(event) => setApiKey(event.target.value)}
          onPressEnter={() => void submit()}
        />
        <small>{t("providers.proxy.lanApiKeyHint")}</small>
      </div>
    </Modal>
  );
}
