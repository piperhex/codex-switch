import { useEffect, useState } from "react";
import { Button, Input, Segmented, Select, Switch } from "antd";
import { Save, Server, X } from "lucide-react";
import type { Translate } from "../../i18n";
import type { Provider, ProviderApiFormat, ProviderBalancePlatform, ProviderInput } from "../../types";
import { ModelReasoningEditor } from "./ModelReasoningEditor";
import {
  balancePlatformOptions,
  DEFAULT_CONTEXT_WINDOW_K,
  defaultBalanceUrl,
  defaultWalletUrl,
  modelContextWindows,
  modelReasoningConfigs,
  modelReasoningEfforts,
  modelOptions,
  normalizeModels,
  parseContextWindowK,
  type ModelReasoningConfig,
} from "./providerUtils";

export interface ProviderModalProps {
  provider: Provider | null;
  saving: boolean;
  onClose: () => void;
  onSave: (provider: ProviderInput) => Promise<Provider | null>;
  t: Translate;
}
export function ProviderModal({ provider, saving, onClose, onSave, t }: ProviderModalProps) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [modelConfigs, setModelConfigs] = useState<ModelReasoningConfig[]>([]);
  const [imageInputModels, setImageInputModels] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [apiFormat, setApiFormat] = useState<ProviderApiFormat>("openaiResponses");
  const [balancePlatform, setBalancePlatform] = useState<ProviderBalancePlatform | "none">("none");
  const [balanceQueryUrl, setBalanceQueryUrl] = useState("");
  const [balanceQueryUsesApiKey, setBalanceQueryUsesApiKey] = useState(true);
  const [balanceQueryToken, setBalanceQueryToken] = useState("");
  const [walletQueryUrl, setWalletQueryUrl] = useState("");
  const [walletQueryToken, setWalletQueryToken] = useState("");
  const [walletUsername, setWalletUsername] = useState("");
  const [walletPassword, setWalletPassword] = useState("");
  const apiFormatOptions: { label: string; value: ProviderApiFormat }[] = [
    { label: t("providers.api.responses"), value: "openaiResponses" },
    { label: t("providers.api.chatCompletions"), value: "openaiChat" },
  ];

  useEffect(() => {
    setName(provider?.name ?? "");
    setBaseUrl(provider?.baseUrl ?? "");
    const nextModels = normalizeModels(provider?.model ?? "", provider?.models ?? []);
    setModelConfigs(nextModels.length
      ? modelReasoningConfigs(nextModels, {
        reasoningEfforts: provider?.modelReasoningEfforts,
        contextWindows: provider?.modelContextWindows,
        fallbackContextWindow: provider?.contextWindow,
      })
      : [{ model: "", reasoningEfforts: [], contextWindowK: DEFAULT_CONTEXT_WINDOW_K }]);
    setImageInputModels(provider?.imageInputModels?.filter((value) => nextModels.includes(value)) ?? []);
    setModel(provider?.model ?? nextModels[0] ?? "");
    setApiKey("");
    setApiFormat(provider?.apiFormat ?? "openaiResponses");
    setBalancePlatform(provider?.balancePlatform ?? "none");
    setBalanceQueryUrl(provider?.balanceQueryUrl ?? "");
    setBalanceQueryUsesApiKey(provider?.balanceQueryUsesApiKey ?? true);
    setBalanceQueryToken("");
    setWalletQueryUrl(provider?.walletQueryUrl
      ?? (provider?.balancePlatform ? defaultWalletUrl(provider.baseUrl, provider.balancePlatform) : ""));
    setWalletQueryToken("");
    setWalletUsername(provider?.walletUsername ?? "");
    setWalletPassword("");
  }, [provider]);

  const rowModels = modelConfigs.map((config) => config.model.trim()).filter(Boolean);
  const normalizedModels = normalizeModels(model, rowModels);
  const modelsAreValid = rowModels.length === modelConfigs.length
    && new Set(rowModels).size === rowModels.length
    && modelConfigs.every((config) => (
      config.reasoningEfforts.length > 0 && Boolean(parseContextWindowK(config.contextWindowK))
    ));
  const activeModel = model.trim() || (normalizedModels[0] ?? "");
  const hasBalanceToken = balanceQueryUsesApiKey
    || Boolean(balanceQueryToken.trim() || provider?.hasBalanceQueryToken);
  const canSave = Boolean(
    name.trim()
    && baseUrl.trim()
    && activeModel
    && modelsAreValid
    && (provider?.hasApiKey || apiKey.trim())
    && (balancePlatform === "none" || (balanceQueryUrl.trim() && hasBalanceToken)),
  );
  const updateModels = (configs: ModelReasoningConfig[]) => {
    const nextModels = configs.map((config) => config.model.trim()).filter(Boolean);
    setModelConfigs(configs);
    setImageInputModels((current) => current.filter((value) => nextModels.includes(value)));
    if (!nextModels.includes(model.trim())) setModel(nextModels[0] ?? "");
  };
  const submit = async () => {
    if (!canSave) return;
    const saved = await onSave({
      id: provider?.id,
      kind: "custom",
      name,
      baseUrl,
      model: activeModel,
      models: normalizedModels,
      modelReasoningEfforts: modelReasoningEfforts(modelConfigs),
      modelContextWindows: modelContextWindows(modelConfigs),
      imageInputModels: imageInputModels.filter((value) => normalizedModels.includes(value)),
      contextWindow: null,
      modelSelectionControlledByCodex: provider?.modelSelectionControlledByCodex ?? false,
      apiKey: apiKey.trim() || undefined,
      apiFormat,
      balancePlatform: balancePlatform === "none" ? null : balancePlatform,
      balanceQueryUrl: balancePlatform === "none" ? null : balanceQueryUrl,
      balanceQueryToken: balanceQueryToken.trim() || undefined,
      balanceQueryUsesApiKey,
      walletQueryUrl: balancePlatform === "none" ? null : walletQueryUrl || null,
      walletQueryToken: walletQueryToken.trim() || undefined,
      walletUsername: walletUsername.trim() || undefined,
      walletPassword: walletPassword || undefined,
    });
    if (saved) onClose();
  };
  const newApiWalletFields = <>
    <label htmlFor="provider-wallet-token">{t("providers.form.walletToken")}</label>
    <Input.Password id="provider-wallet-token" value={walletQueryToken} disabled={saving}
      placeholder={provider?.hasWalletQueryToken
        ? t("providers.form.keepWalletToken")
        : t("providers.form.walletTokenPlaceholder")}
      onChange={(event) => setWalletQueryToken(event.target.value)} />
    <small>{t("providers.form.walletNewApiTokenAutoIdHint")}</small>
    <div className="provider-auth-divider">{t("providers.form.walletLoginAlternative")}</div>
    <label htmlFor="provider-wallet-username">{t("providers.form.walletUsername")}</label>
    <Input id="provider-wallet-username" value={walletUsername} disabled={saving}
      placeholder={t("providers.form.walletUsernamePlaceholder")}
      onChange={(event) => setWalletUsername(event.target.value)} />
    <label htmlFor="provider-wallet-password">{t("providers.form.walletPassword")}</label>
    <Input.Password id="provider-wallet-password" value={walletPassword} disabled={saving}
      placeholder={provider?.hasWalletLoginCredentials
        ? t("providers.form.keepWalletPassword")
        : t("providers.form.walletPasswordPlaceholder")}
      onChange={(event) => setWalletPassword(event.target.value)} />
    <small>{t("providers.form.walletLoginHint")}</small>
  </>;
  const tokenWalletFields = <>
    <label htmlFor="provider-wallet-token">{t("providers.form.walletToken")}</label>
    <Input.Password id="provider-wallet-token" value={walletQueryToken} disabled={saving}
      placeholder={provider?.hasWalletQueryToken
        ? t("providers.form.keepWalletToken")
        : t("providers.form.walletTokenPlaceholder")}
      onChange={(event) => setWalletQueryToken(event.target.value)} />
    <small>{t("providers.form.walletTokenHint")}</small>
  </>;

  return (
    <div className="modal-backdrop provider-modal-backdrop">
      <div className="modal provider-modal">
        <button className="modal-close" disabled={saving} onClick={onClose} aria-label={t("providers.modal.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Server size={22} /></div>
        <h2>{provider ? t("providers.modal.editTitle") : t("providers.modal.addTitle")}</h2>
        <p>{t("providers.modal.description")}</p>
        <div className="provider-form">
          <label htmlFor="provider-name">{t("providers.form.name")}</label>
          <Input id="provider-name" value={name} disabled={saving} placeholder="OpenRouter"
            onChange={(event) => setName(event.target.value)} />
          <label htmlFor="provider-base-url">{t("providers.form.baseUrl")}</label>
          <Input id="provider-base-url" value={baseUrl} disabled={saving} placeholder="https://openrouter.ai/api/v1"
            onChange={(event) => setBaseUrl(event.target.value)} />
          <label>{t("providers.form.models")}</label>
          <ModelReasoningEditor value={modelConfigs} disabled={saving}
            onChange={updateModels} t={t} />
          <small>{t("providers.form.modelRowsHint")}</small>
          <label htmlFor="provider-active-model">{t("providers.form.activeModel")}</label>
          <Select id="provider-active-model" value={activeModel || undefined}
            disabled={saving || !normalizedModels.length}
            placeholder="openai/gpt-4.1" options={modelOptions(normalizedModels)}
            onChange={(value) => setModel(value)} />
          <label htmlFor="provider-image-input-models">{t("providers.form.imageInputModels")}</label>
          <Select id="provider-image-input-models" mode="multiple" value={imageInputModels}
            disabled={saving || !normalizedModels.length}
            placeholder={t("providers.form.imageInputModelsPlaceholder")}
            options={modelOptions(normalizedModels)} onChange={setImageInputModels} />
          <small>{t("providers.form.imageInputModelsHint")}</small>
          <label htmlFor="provider-api-key">{t("providers.form.apiKey")}</label>
          <Input.Password id="provider-api-key" value={apiKey} disabled={saving}
            placeholder={provider?.hasApiKey ? t("providers.form.keepApiKey") : t("providers.form.newApiKey")}
            onChange={(event) => setApiKey(event.target.value)} />
          <label>{t("providers.form.upstreamApi")}</label>
          <Segmented value={apiFormat} options={apiFormatOptions}
            onChange={(value) => setApiFormat(value as ProviderApiFormat)} />
          <label htmlFor="provider-balance-platform">{t("providers.form.balancePlatform")}</label>
          <Select id="provider-balance-platform" value={balancePlatform} disabled={saving}
            options={balancePlatformOptions(t)}
            onChange={(value) => {
              setBalancePlatform(value);
              if (value !== "none" && !balanceQueryUrl.trim()) {
                setBalanceQueryUrl(defaultBalanceUrl(baseUrl, value));
              }
              if (value !== "none" && !walletQueryUrl.trim()) {
                setWalletQueryUrl(defaultWalletUrl(baseUrl, value));
              }
            }} />
          {balancePlatform !== "none" && <>
            <label htmlFor="provider-balance-url">{t("providers.form.balanceQueryUrl")}</label>
            <Input id="provider-balance-url" value={balanceQueryUrl} disabled={saving}
              placeholder={defaultBalanceUrl(baseUrl, balancePlatform)}
              onChange={(event) => setBalanceQueryUrl(event.target.value)} />
            <div className="provider-form-switch">
              <div>
                <label htmlFor="provider-balance-reuse-key">{t("providers.form.balanceReuseApiKey")}</label>
                <small>{t("providers.form.balanceReuseApiKeyHint")}</small>
              </div>
              <Switch id="provider-balance-reuse-key" checked={balanceQueryUsesApiKey} disabled={saving}
                onChange={setBalanceQueryUsesApiKey} />
            </div>
            {!balanceQueryUsesApiKey && <>
              <label htmlFor="provider-balance-token">{t("providers.form.balanceToken")}</label>
              <Input.Password id="provider-balance-token" value={balanceQueryToken} disabled={saving}
                placeholder={provider?.hasBalanceQueryToken
                  ? t("providers.form.keepBalanceToken")
                  : t("providers.form.newApiKey")}
                onChange={(event) => setBalanceQueryToken(event.target.value)} />
            </>}
            <label htmlFor="provider-wallet-url">{t("providers.form.walletQueryUrl")}</label>
            <Input id="provider-wallet-url" value={walletQueryUrl} disabled={saving}
              placeholder={defaultWalletUrl(baseUrl, balancePlatform)}
              onChange={(event) => setWalletQueryUrl(event.target.value)} />
            {balancePlatform === "newApi" ? newApiWalletFields : tokenWalletFields}
          </>}
        </div>
        <div className="provider-modal-footer">
          <Button onClick={onClose} disabled={saving}>{t("providers.form.cancel")}</Button>
          <Button type="primary" icon={<Save size={14} />} loading={saving} disabled={!canSave}
            onClick={() => void submit()}>{t("providers.form.save")}</Button>
        </div>
      </div>
    </div>
  );
}
