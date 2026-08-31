import { useEffect, useRef, useState } from "react";
import { Button, Input, Select } from "antd";
import { RefreshCw, Save, Sparkles, X } from "lucide-react";
import { fetchGrokModels } from "../../api/backend";
import {
  GROK_BASE_URL,
  GROK_FALLBACK_MODELS,
  GROK_PROVIDER_NAME,
  grokContextWindows,
  grokImageInputModels,
  grokReasoningEfforts,
} from "../../utils/grokProvider";
import { modelOptions, normalizeModels } from "./providerUtils";
import { ProviderSpeedTierControl } from "./ProviderFormFields";
import type { ProviderModalProps } from "./ProviderModal";

const API_KEY_AUTOFETCH_DELAY_MS = 800;
const MIN_API_KEY_LENGTH_FOR_AUTOFETCH = 8;

export function GrokProviderModal({ provider, saving, onClose, onSave, t }: ProviderModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>(GROK_FALLBACK_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [fastModeEnabled, setFastModeEnabled] = useState(false);
  const modelRequestId = useRef(0);

  useEffect(() => {
    const nextModels = normalizeModels(
      provider?.model ?? "",
      provider?.models?.length ? provider.models : GROK_FALLBACK_MODELS,
    );
    setApiKey("");
    setModels(nextModels);
    setModel(provider?.model ?? nextModels[0] ?? "");
    setModelsError("");
    setModelsLoaded(false);
    setFastModeEnabled(provider?.fastModeEnabled ?? false);
  }, [provider]);

  const loadLatestModels = async () => {
    if (!apiKey.trim() && !provider?.hasApiKey) {
      setModelsError(t("providers.grok.modelsNeedKey"));
      return;
    }
    const requestId = ++modelRequestId.current;
    setModelsLoading(true);
    setModelsError("");
    try {
      const latest = await fetchGrokModels(GROK_BASE_URL, apiKey, provider?.id);
      if (requestId !== modelRequestId.current) return;
      setModels(latest);
      setModel((current) => latest.includes(current) ? current : latest[0] ?? "");
      setModelsLoaded(true);
    } catch (error) {
      if (requestId !== modelRequestId.current) return;
      setModelsError(t("providers.grok.modelsFetchFailed", {
        error: String(error).replace(/^Error:\s*/, ""),
      }));
    } finally {
      if (requestId === modelRequestId.current) setModelsLoading(false);
    }
  };

  useEffect(() => {
    const keyReady = apiKey.trim().length >= MIN_API_KEY_LENGTH_FOR_AUTOFETCH;
    if (!keyReady && !provider?.hasApiKey) return;
    const delay = provider?.hasApiKey ? 0 : API_KEY_AUTOFETCH_DELAY_MS;
    const timer = window.setTimeout(() => void loadLatestModels(), delay);
    return () => window.clearTimeout(timer);
    // Refresh when a saved credential is available or the user finishes entering a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, provider?.id, provider?.hasApiKey]);

  const normalizedModels = normalizeModels(model, models);
  const activeModel = model.trim() || normalizedModels[0] || "";
  const canSave = Boolean(
    activeModel
    && normalizedModels.length
    && (provider?.hasApiKey || apiKey.trim()),
  );
  const submit = async () => {
    if (!canSave) return;
    const saved = await onSave({
      id: provider?.id,
      kind: "custom",
      name: GROK_PROVIDER_NAME,
      baseUrl: GROK_BASE_URL,
      model: activeModel,
      models: normalizedModels,
      modelReasoningEfforts: grokReasoningEfforts(
        normalizedModels,
        provider?.modelReasoningEfforts ?? {},
      ),
      modelContextWindows: grokContextWindows(
        normalizedModels,
        provider?.modelContextWindows ?? {},
      ),
      imageInputModels: grokImageInputModels(
        normalizedModels,
        provider?.imageInputModels ?? [],
      ),
      contextWindow: null,
      modelSelectionControlledByCodex: true,
      fastModeEnabled,
      apiKey: apiKey.trim() || undefined,
      apiFormat: "openaiResponses",
      balancePlatform: null,
      balanceQueryUrl: null,
      balanceQueryUsesApiKey: true,
      walletQueryUrl: null,
    });
    if (saved) onClose();
  };

  let modelsStatus = <small>{t("providers.grok.modelsAutoHint")}</small>;
  if (modelsError) {
    modelsStatus = <small className="provider-form-error">{modelsError}</small>;
  } else if (modelsLoaded) {
    modelsStatus = <small>{t("providers.grok.modelsUpdated", { count: models.length })}</small>;
  }

  return (
    <div className="modal-backdrop provider-modal-backdrop">
      <div className="modal provider-modal grok-provider-modal">
        <button className="modal-close" disabled={saving} onClick={onClose}
          aria-label={t("providers.grok.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Sparkles size={22} /></div>
        <h2>{provider ? t("providers.grok.editTitle") : t("providers.grok.addTitle")}</h2>
        <p>{t("providers.grok.description")}</p>
        <div className="provider-form">
          <label htmlFor="grok-base-url">{t("providers.form.baseUrl")}</label>
          <Input id="grok-base-url" value={GROK_BASE_URL} disabled />
          <label htmlFor="grok-api-key">{t("providers.form.apiKey")}</label>
          <Input.Password id="grok-api-key" value={apiKey} disabled={saving}
            placeholder={provider?.hasApiKey
              ? t("providers.form.keepApiKey")
              : t("providers.form.newApiKey")}
            onChange={(event) => setApiKey(event.target.value)} />
          <ProviderSpeedTierControl fastModeEnabled={fastModeEnabled} saving={saving}
            onChange={setFastModeEnabled} t={t} />
          <div className="provider-form-label-row">
            <label htmlFor="grok-models">{t("providers.grok.models")}</label>
            <Button size="small" icon={<RefreshCw size={13} />} loading={modelsLoading}
              disabled={saving || (!apiKey.trim() && !provider?.hasApiKey)}
              onClick={() => void loadLatestModels()}>
              {provider ? t("providers.grok.refreshModels") : t("providers.grok.fetchModels")}
            </Button>
          </div>
          <Select id="grok-models" mode="tags" value={models} disabled={saving || modelsLoading}
            options={modelOptions(models)} tokenSeparators={[","]}
            onChange={(values) => {
              const next = normalizeModels("", values);
              setModels(next);
              if (!next.includes(model)) setModel(next[0] ?? "");
            }} />
          {modelsStatus}
          <label htmlFor="grok-active-model">{t("providers.form.activeModel")}</label>
          <Select id="grok-active-model" value={activeModel || undefined}
            disabled={saving || !normalizedModels.length} options={modelOptions(normalizedModels)}
            onChange={setModel} />
          <div className="provider-integration-note">
            <strong>{t("providers.grok.responsesApi")}</strong>
            <span>{t("providers.grok.billingHint")}</span>
          </div>
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
