import { useEffect, useState } from "react";
import { Button } from "antd";
import { Save, Server, X } from "lucide-react";
import type { Translate } from "../../i18n";
import type { Provider, ProviderInput } from "../../types";
import { ProviderFormFields } from "./ProviderFormFields";
import {
  DEFAULT_CONTEXT_WINDOW_K,
  defaultBalanceUrl,
  defaultWalletUrl,
  modelApiFormats,
  modelContextWindows,
  modelImageInputModels,
  modelTokenCosts,
  modelReasoningConfigs,
  modelReasoningEfforts,
  normalizeModels,
  parseContextWindowK,
  relayName,
  type ModelReasoningConfig,
} from "./providerUtils";
import { useProviderBalanceDetection } from "./useProviderBalanceDetection";

export interface ProviderModalProps {
  provider: Provider | null;
  saving: boolean;
  onClose: () => void;
  onSave: (provider: ProviderInput) => Promise<Provider | null>;
  t: Translate;
}

export function ProviderModal({ provider, saving, onClose, onSave, t }: ProviderModalProps) {
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [modelConfigs, setModelConfigs] = useState<ModelReasoningConfig[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [fastModeEnabled, setFastModeEnabled] = useState(false);
  const balance = useProviderBalanceDetection({ provider, baseUrl, apiKey });

  useEffect(() => {
    setName(provider?.name ?? "");
    setNameTouched(Boolean(provider));
    setBaseUrl(provider?.baseUrl ?? "");
    const nextModels = normalizeModels(provider?.model ?? "", provider?.models ?? []);
    setModelConfigs(nextModels.length
      ? modelReasoningConfigs(nextModels, {
        reasoningEfforts: provider?.modelReasoningEfforts,
        contextWindows: provider?.modelContextWindows,
        apiFormats: provider?.modelApiFormats,
        fallbackContextWindow: provider?.contextWindow,
        imageInputModels: provider?.imageInputModels,
        tokenCosts: provider?.modelTokenCosts,
        preserveImageInputForModels: provider?.imageInputModelsConfigured ? nextModels : [],
      })
      : [{
        model: "",
        reasoningEfforts: [],
        contextWindowK: DEFAULT_CONTEXT_WINDOW_K,
        apiFormat: "auto",
        supportsImageInput: false,
        unitCost: null,
    }]);
    setModel(provider?.model ?? nextModels[0] ?? "");
    setApiKey("");
    setFastModeEnabled(provider?.fastModeEnabled ?? false);
  }, [provider]);

  const rowModels = modelConfigs.map((config) => config.model.trim()).filter(Boolean);
  const normalizedModels = normalizeModels(model, rowModels);
  const modelsAreValid = rowModels.length === modelConfigs.length
    && new Set(rowModels).size === rowModels.length
    && modelConfigs.every((config) => (
      config.reasoningEfforts.length > 0 && Boolean(parseContextWindowK(config.contextWindowK))
    ));
  const activeModel = model.trim() || (normalizedModels[0] ?? "");
  const hasBalanceToken = balance.balanceQueryUsesApiKey
    || Boolean(balance.balanceQueryToken.trim() || provider?.hasBalanceQueryToken);
  const canSave = Boolean(
    name.trim()
    && baseUrl.trim()
    && activeModel
    && modelsAreValid
    && (provider?.hasApiKey || apiKey.trim())
    && (!balance.balancePlatform || (balance.balanceQueryUrl.trim() && hasBalanceToken)),
  );

  async function submit() {
    if (!canSave) return;
    const detectedPlatform = await balance.resolvePlatform();
    const detectedBalanceQueryUrl = detectedPlatform
      ? balance.balanceQueryUrl || defaultBalanceUrl(baseUrl, detectedPlatform)
      : "";
    const detectedWalletQueryUrl = detectedPlatform
      ? balance.walletQueryUrl || defaultWalletUrl(baseUrl, detectedPlatform)
      : "";
    const saved = await onSave({
      id: provider?.id,
      kind: "custom",
      name,
      baseUrl,
      model: activeModel,
      models: normalizedModels,
      modelReasoningEfforts: modelReasoningEfforts(modelConfigs),
      modelContextWindows: modelContextWindows(modelConfigs),
      modelApiFormats: modelApiFormats(modelConfigs),
      modelTokenCosts: modelTokenCosts(modelConfigs),
      imageInputModels: modelImageInputModels(modelConfigs),
      imageInputModelsConfigured: true,
      contextWindow: null,
      modelSelectionControlledByCodex: provider?.modelSelectionControlledByCodex ?? true,
      fastModeEnabled,
      apiKey: apiKey.trim() || undefined,
      apiFormat: provider?.apiFormat ?? "openaiResponses",
      balancePlatform: detectedPlatform,
      balanceQueryUrl: detectedPlatform ? detectedBalanceQueryUrl : null,
      balanceQueryToken: balance.balanceQueryToken.trim() || undefined,
      balanceQueryUsesApiKey: balance.balanceQueryUsesApiKey,
      walletQueryUrl: detectedPlatform ? detectedWalletQueryUrl || null : null,
      walletQueryToken: balance.walletQueryToken.trim() || undefined,
      walletUsername: balance.walletUsername.trim() || undefined,
      walletPassword: balance.walletPassword || undefined,
    });
    if (saved) onClose();
  }

  return (
    <div className="modal-backdrop provider-modal-backdrop">
      <div className="modal provider-modal">
        <button className="modal-close" disabled={saving} onClick={onClose} aria-label={t("providers.modal.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Server size={22} /></div>
        <h2>{provider ? t("providers.modal.editTitle") : t("providers.modal.addTitle")}</h2>
        <p>{t("providers.modal.description")}</p>
        <ProviderFormFields apiKey={apiKey} baseUrl={baseUrl} fastModeEnabled={fastModeEnabled}
          modelConfigs={modelConfigs} name={name}
          provider={provider} saving={saving} activeModel={activeModel}
          balanceSettings={{
            baseUrl,
            balancePlatform: balance.balancePlatform,
            balanceQueryUrl: balance.balanceQueryUrl,
            balanceQueryUsesApiKey: balance.balanceQueryUsesApiKey,
            balanceQueryToken: balance.balanceQueryToken,
            detectionState: balance.detectionState,
            provider,
            saving,
            walletQueryUrl: balance.walletQueryUrl,
            walletQueryToken: balance.walletQueryToken,
            walletUsername: balance.walletUsername,
            walletPassword: balance.walletPassword,
            onBalanceQueryUrlChange: balance.updateBalanceQueryUrl,
            onBalanceQueryUsesApiKeyChange: balance.setBalanceQueryUsesApiKey,
            onBalanceQueryTokenChange: balance.setBalanceQueryToken,
            onWalletQueryUrlChange: balance.updateWalletQueryUrl,
            onWalletQueryTokenChange: balance.setWalletQueryToken,
            onWalletUsernameChange: balance.setWalletUsername,
            onWalletPasswordChange: balance.setWalletPassword,
          }}
          onApiKeyChange={setApiKey}
          onFastModeEnabledChange={setFastModeEnabled}
          onBaseUrlChange={(value) => {
            setBaseUrl(value);
            if (!nameTouched) setName(relayName(value));
          }}
          onModelConfigsChange={setModelConfigs} onActiveModelChange={setModel}
          onNameChange={(value) => {
            setNameTouched(true);
            setName(value);
          }} t={t} />
        <div className="provider-modal-footer">
          <Button onClick={onClose} disabled={saving}>{t("providers.form.cancel")}</Button>
          <Button type="primary" icon={<Save size={14} />} loading={saving} disabled={!canSave}
            onClick={() => void submit()}>{t("providers.form.save")}</Button>
        </div>
      </div>
    </div>
  );
}
