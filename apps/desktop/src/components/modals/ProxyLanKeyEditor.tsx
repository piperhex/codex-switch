import { useState } from "react";
import { Button, Checkbox, Input } from "antd";
import { Sparkles } from "lucide-react";
import { generateLocalProxyLanApiKey } from "../../api/localProxyLanKeysPreview";
import type { Translate, TranslationKey } from "../../i18n";
import type { LocalProxyLanApiKey, LocalProxyLanApiKeyInput } from "../../types";

interface ProxyLanKeyEditorProps {
  entry: LocalProxyLanApiKey | null;
  disabled: boolean;
  onSave: (key: LocalProxyLanApiKeyInput) => Promise<boolean>;
  onCancel: () => void;
  t: Translate;
}

const MAX_API_KEY_LENGTH = 512;
const MAX_QUOTA_USD = 1_000_000_000;

function validateInput(name: string, apiKey: string, quota: string): TranslationKey | null {
  if (!name.trim()) return "providers.proxy.lanKeyNameRequired";
  if (apiKey.trim() && !/^[\x21-\x7e]{16,512}$/.test(apiKey.trim())) return "providers.proxy.lanKeyInvalid";
  const quotaUsd = Number(quota);
  if (quota.trim() && (!Number.isFinite(quotaUsd) || quotaUsd < 0 || quotaUsd > MAX_QUOTA_USD)) {
    return "providers.proxy.lanKeyQuotaInvalid";
  }
  return null;
}

export function ProxyLanKeyEditor({ entry, disabled, onSave, onCancel, t }: ProxyLanKeyEditorProps) {
  const [name, setName] = useState(entry?.name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [quota, setQuota] = useState(entry?.quotaUsd?.toString() ?? "");
  const [error, setError] = useState<TranslationKey | null>(null);
  const [acknowledgeUsage, setAcknowledgeUsage] = useState(false);
  const save = async () => {
    const invalid = validateInput(name, apiKey, quota);
    setError(invalid);
    if (invalid || disabled) return;
    const saved = await onSave({ id: entry?.id, name: name.trim(), apiKey: apiKey.trim() || undefined,
      ...(acknowledgeUsage ? { acknowledgeUsage: true } : {}),
      quotaUsd: quota.trim() ? Number(quota) : null, enabled: entry?.enabled ?? true });
    if (saved) onCancel();
  };

  return (
    <form className="proxy-lan-key-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label htmlFor="proxy-lan-key-name">{t("providers.proxy.lanKeyName")}</label>
      <Input id="proxy-lan-key-name" value={name} maxLength={80} disabled={disabled}
        autoComplete="off" placeholder={t("providers.proxy.lanKeyNamePlaceholder")}
        onChange={(event) => setName(event.target.value)} />
      <label htmlFor="local-proxy-api-key">{t("providers.proxy.lanApiKey")}</label>
      <div className="proxy-lan-key-input">
        <Input.Password id="local-proxy-api-key" value={apiKey} disabled={disabled} autoComplete="new-password"
          maxLength={MAX_API_KEY_LENGTH}
          placeholder={t(entry ? "providers.proxy.keepLanApiKey" : "providers.proxy.lanKeyAutoGenerate")}
          onChange={(event) => setApiKey(event.target.value)} />
        <Button disabled={disabled} icon={<Sparkles size={14} />}
          onClick={() => setApiKey(generateLocalProxyLanApiKey())}>{t("providers.proxy.generateApiKey")}</Button>
      </div>
      <label htmlFor="proxy-lan-key-quota">{t("providers.proxy.lanKeyQuota")}</label>
      <Input id="proxy-lan-key-quota" value={quota} type="number" min={0} max={MAX_QUOTA_USD}
        step="any" disabled={disabled}
        placeholder={t("providers.proxy.lanKeyUnlimitedPlaceholder")}
        onChange={(event) => setQuota(event.target.value)} />
      <p>{t("providers.proxy.lanKeyQuotaHint")}</p>
      {entry && <p>{t("providers.proxy.lanKeyEditHint")}</p>}
      {entry?.usageIncomplete && <div className="proxy-lan-key-usage-review">
        <p>{t("providers.proxy.lanKeyUsageReviewHint")}</p>
        <Checkbox checked={acknowledgeUsage} disabled={disabled}
          onChange={(event) => setAcknowledgeUsage(event.target.checked)}>
          {t("providers.proxy.lanKeyAcknowledgeUsage")}
        </Checkbox>
      </div>}
      {error && <p className="proxy-lan-key-error" role="alert">{t(error)}</p>}
      <div className="proxy-settings-key-actions">
        <Button type="primary" htmlType="submit" disabled={disabled}>
          {t("providers.proxy.saveApiKey")}
        </Button>
        <Button onClick={onCancel} disabled={disabled}>{t("providers.proxy.cancel")}</Button>
      </div>
    </form>
  );
}
