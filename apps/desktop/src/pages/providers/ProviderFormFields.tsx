import { Input } from "antd";
import type { Translate } from "../../i18n";
import type { Provider } from "../../types";
import { ProviderBalanceSettings, type ProviderBalanceSettingsProps } from "./ProviderBalanceSettings";
import { RelayModelPicker } from "./RelayModelPicker";
import type { ModelReasoningConfig } from "./providerUtils";
import { relayApiUrl } from "./providerUtils";

interface ProviderFormFieldsProps {
  apiKey: string;
  baseUrl: string;
  modelConfigs: ModelReasoningConfig[];
  name: string;
  provider: Provider | null;
  saving: boolean;
  activeModel: string;
  balanceSettings: Omit<ProviderBalanceSettingsProps, "t">;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onModelConfigsChange: (configs: ModelReasoningConfig[]) => void;
  onActiveModelChange: (model: string) => void;
  onNameChange: (value: string) => void;
  t: Translate;
}

export function ProviderFormFields({
  apiKey,
  baseUrl,
  modelConfigs,
  name,
  provider,
  saving,
  activeModel,
  balanceSettings,
  onApiKeyChange,
  onBaseUrlChange,
  onModelConfigsChange,
  onActiveModelChange,
  onNameChange,
  t,
}: ProviderFormFieldsProps) {
  return <div className="provider-form">
    <label htmlFor="provider-name">{t("providers.form.name")}</label>
    <Input id="provider-name" value={name} disabled={saving} placeholder="OpenRouter"
      onChange={(event) => onNameChange(event.target.value)} />
    <label htmlFor="provider-base-url">{t("providers.form.baseUrl")}</label>
    <Input id="provider-base-url" value={baseUrl} disabled={saving}
      placeholder="https://openrouter.ai/api/v1"
      onChange={(event) => onBaseUrlChange(event.target.value)} />
    <label htmlFor="provider-api-key">{t("providers.form.apiKey")}</label>
    <Input.Password id="provider-api-key" value={apiKey} disabled={saving}
      placeholder={provider?.hasApiKey ? t("providers.form.keepApiKey") : t("providers.form.newApiKey")}
      onChange={(event) => onApiKeyChange(event.target.value)} />
    <RelayModelPicker baseUrl={relayApiUrl(baseUrl)} apiKey={apiKey}
      enabled={Boolean(baseUrl.trim() && apiKey.trim())} disabled={saving}
      modelConfigs={modelConfigs} activeModel={activeModel}
      onModelConfigsChange={onModelConfigsChange} onActiveModelChange={onActiveModelChange} t={t} />
    <ProviderBalanceSettings {...balanceSettings} t={t} />
  </div>;
}
