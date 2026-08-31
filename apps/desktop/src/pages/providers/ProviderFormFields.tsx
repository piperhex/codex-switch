import { Input, Segmented } from "antd";
import type { Translate } from "../../i18n";
import type { Provider } from "../../types";
import { ProviderBalanceSettings, type ProviderBalanceSettingsProps } from "./ProviderBalanceSettings";
import { RelayModelPicker } from "./RelayModelPicker";
import type { ModelReasoningConfig } from "./providerUtils";
import { relayApiUrl } from "./providerUtils";

interface ProviderFormFieldsProps {
  apiKey: string;
  baseUrl: string;
  fastModeEnabled: boolean;
  modelConfigs: ModelReasoningConfig[];
  name: string;
  provider: Provider | null;
  saving: boolean;
  activeModel: string;
  balanceSettings: Omit<ProviderBalanceSettingsProps, "t">;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onFastModeEnabledChange: (value: boolean) => void;
  onModelConfigsChange: (configs: ModelReasoningConfig[]) => void;
  onActiveModelChange: (model: string) => void;
  onNameChange: (value: string) => void;
  t: Translate;
}

interface ProviderSpeedTierControlProps {
  fastModeEnabled: boolean;
  saving: boolean;
  onChange: (value: boolean) => void;
  t: Translate;
}

export function ProviderSpeedTierControl({
  fastModeEnabled,
  saving,
  onChange,
  t,
}: ProviderSpeedTierControlProps) {
  return <>
    <label htmlFor="provider-speed-tier">{t("providers.form.speedTier")}</label>
    <Segmented id="provider-speed-tier" disabled={saving}
      value={fastModeEnabled ? "fast" : "standard"}
      options={[
        { label: t("providers.form.speedStandard"), value: "standard" },
        { label: t("providers.form.speedFast"), value: "fast" },
      ]}
      onChange={(value) => onChange(value === "fast")} />
    <small>{t("providers.form.speedTierHint")}</small>
  </>;
}

export function ProviderFormFields({
  apiKey,
  baseUrl,
  fastModeEnabled,
  modelConfigs,
  name,
  provider,
  saving,
  activeModel,
  balanceSettings,
  onApiKeyChange,
  onBaseUrlChange,
  onFastModeEnabledChange,
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
    <ProviderSpeedTierControl fastModeEnabled={fastModeEnabled} saving={saving}
      onChange={onFastModeEnabledChange} t={t} />
    <RelayModelPicker baseUrl={relayApiUrl(baseUrl)} apiKey={apiKey}
      enabled={Boolean(baseUrl.trim() && apiKey.trim())} disabled={saving}
      modelConfigs={modelConfigs} activeModel={activeModel}
      onModelConfigsChange={onModelConfigsChange} onActiveModelChange={onActiveModelChange} t={t} />
    <ProviderBalanceSettings {...balanceSettings} t={t} />
  </div>;
}
