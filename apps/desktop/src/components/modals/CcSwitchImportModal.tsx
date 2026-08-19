import { useEffect, useState } from "react";
import { Input, Modal } from "antd";
import type { Translate } from "../../i18n";
import type { CcSwitchImportRequest, ProviderBalancePlatform } from "../../types";

interface CcSwitchImportModalProps {
  request: CcSwitchImportRequest | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (name: string) => void;
  t: Translate;
}

function balancePlatformLabel(platform: ProviderBalancePlatform | null | undefined, t: Translate) {
  if (platform === "newApi") return "New API";
  if (platform === "sub2Api") return "Sub2API";
  if (platform === "deepSeek") return "DeepSeek";
  return t("providers.import.balanceNone");
}

export function CcSwitchImportModal({
  request,
  saving,
  onCancel,
  onConfirm,
  t,
}: CcSwitchImportModalProps) {
  const [name, setName] = useState("");

  useEffect(() => setName(request?.name ?? ""), [request]);

  return <Modal
    open={Boolean(request)}
    width={400}
    title={t("providers.import.title")}
    okText={t("providers.import.confirm")}
    cancelText={t("providers.import.cancel")}
    confirmLoading={saving}
    closable={!saving}
    maskClosable={false}
    keyboard={!saving}
    okButtonProps={{ disabled: !name.trim() }}
    onCancel={onCancel}
    onOk={() => onConfirm(name)}
  >
    {request && <div className="ccswitch-import-content">
      <p>{t("providers.import.description")}</p>
      <div className="ccswitch-import-details">
        <div><span>{t("providers.import.app")}</span><strong>{request.app}</strong></div>
        <div><span>{t("providers.import.endpoint")}</span><strong>{request.endpoint}</strong></div>
        <div><span>{t("providers.import.model")}</span><strong>{request.model}</strong></div>
        <div>
          <span>{t("providers.import.balance")}</span>
          <strong>{balancePlatformLabel(request.balancePlatform, t)}</strong>
        </div>
        <div>
          <span>{t("providers.import.apiKey")}</span>
          <strong>{request.apiKeyProvided
            ? t("providers.import.apiKeyProtected")
            : t("providers.import.apiKeyMissing")}</strong>
        </div>
      </div>
      <label htmlFor="ccswitch-provider-name">{t("providers.import.name")}</label>
      <Input
        id="ccswitch-provider-name"
        value={name}
        maxLength={200}
        disabled={saving}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onPressEnter={() => {
          if (name.trim() && !saving) onConfirm(name);
        }}
      />
      <small>{t("providers.import.duplicateHint")}</small>
    </div>}
  </Modal>;
}
