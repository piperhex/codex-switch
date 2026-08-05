import { Button, Input, Modal, Tooltip } from "antd";
import { Check, Copy, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { Translate } from "../../i18n";

function generateApiKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `cs_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

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
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | null>(null);

  useEffect(() => {
    if (open) {
      setApiKey("");
      setCopyStatus(null);
    }
  }, [open]);

  const normalizedApiKey = apiKey.trim();
  const canConfirm = Boolean(normalizedApiKey || hasConfiguredKey);
  const submit = async () => {
    if (!canConfirm) return;
    const succeeded = await onConfirm(normalizedApiKey || undefined);
    if (succeeded) onClose();
  };
  const copyApiKey = async (value: string) => {
    setCopyStatus(await copyToClipboard(value) ? "copied" : "failed");
  };
  const generateAndCopy = async () => {
    const generated = generateApiKey();
    setApiKey(generated);
    await copyApiKey(generated);
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
        <div className="lan-api-key-row">
          <Input.Password
            id="local-proxy-lan-api-key"
            autoFocus
            value={apiKey}
            disabled={loading}
            placeholder={hasConfiguredKey
              ? t("providers.proxy.keepLanApiKey")
              : t("providers.proxy.lanApiKeyPlaceholder")}
            onChange={(event) => {
              setApiKey(event.target.value);
              setCopyStatus(null);
            }}
            onPressEnter={() => void submit()}
          />
          <Tooltip title={t("providers.proxy.generateAndCopyLanApiKey")}>
            <Button disabled={loading} icon={<Sparkles size={14} />}
              onClick={() => void generateAndCopy()}>
              {t("providers.proxy.generateAndCopy")}
            </Button>
          </Tooltip>
          <Tooltip title={t("providers.proxy.copyLanApiKey")}>
            <Button disabled={loading || !normalizedApiKey}
              aria-label={t("providers.proxy.copyLanApiKey")}
              icon={copyStatus === "copied" ? <Check size={14} /> : <Copy size={14} />}
              onClick={() => void copyApiKey(normalizedApiKey)} />
          </Tooltip>
        </div>
        {copyStatus && <span className={`lan-api-key-copy-status ${copyStatus}`} role="status">
          {t(copyStatus === "copied"
            ? "providers.proxy.lanApiKeyCopied"
            : "providers.proxy.lanApiKeyCopyFailed")}
        </span>}
        <small>{t("providers.proxy.lanApiKeyHint")}</small>
      </div>
    </Modal>
  );
}
