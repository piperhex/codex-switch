import { useEffect, useRef, useState } from "react";
import { Button, Input, Select } from "antd";
import { Orbit, RefreshCw, Save, X } from "lucide-react";
import { fetchAntigravityModels } from "../../api/backend";
import type { ModelContextWindows, ModelReasoningEfforts, ReasoningEffort } from "../../types";
import {
  ANTIGRAVITY_BASE_URL,
  ANTIGRAVITY_FALLBACK_MODELS,
  ANTIGRAVITY_PROVIDER_NAME,
} from "../../utils/antigravityProvider";
import { modelOptions, normalizeModels } from "./providerUtils";
import { ProviderSpeedTierControl } from "./ProviderFormFields";
import type { ProviderModalProps } from "./ProviderModal";

const ANTIGRAVITY_REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const CLAUDE_CONTEXT_WINDOW = 200_000;
const GEMINI_CONTEXT_WINDOW = 1_000_000;
const FALLBACK_CONTEXT_WINDOW = 256_000;

function contextWindowForModel(model: string) {
  const normalized = model.toLowerCase();
  if (normalized.startsWith("claude-")) return CLAUDE_CONTEXT_WINDOW;
  if (normalized.startsWith("gemini-")) return GEMINI_CONTEXT_WINDOW;
  return FALLBACK_CONTEXT_WINDOW;
}

function reasoningEffortsForModels(
  models: string[],
  existing: ModelReasoningEfforts,
): ModelReasoningEfforts {
  return Object.fromEntries(models.map((model) => [
    model,
    existing[model]?.length ? existing[model] : ANTIGRAVITY_REASONING_EFFORTS,
  ]));
}

function contextWindowsForModels(
  models: string[],
  existing: ModelContextWindows,
): ModelContextWindows {
  return Object.fromEntries(models.map((model) => [
    model,
    existing[model] ?? contextWindowForModel(model),
  ]));
}

export function AntigravityProviderModal({ provider, saving, onClose, onSave, t }: ProviderModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>(ANTIGRAVITY_FALLBACK_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [fastModeEnabled, setFastModeEnabled] = useState(false);
  const modelRequestId = useRef(0);

  useEffect(() => {
    const nextModels = normalizeModels(
      provider?.model ?? "",
      provider?.models?.length ? provider.models : ANTIGRAVITY_FALLBACK_MODELS,
    );
    setApiKey("");
    setModels(nextModels);
    setModel(provider?.model ?? nextModels[0] ?? "");
    setModelsError("");
    setModelsLoaded(false);
    setFastModeEnabled(provider?.fastModeEnabled ?? false);
  }, [provider]);

  const loadLatestModels = async () => {
    const requestId = ++modelRequestId.current;
    setModelsLoading(true);
    setModelsError("");
    try {
      const latest = await fetchAntigravityModels(ANTIGRAVITY_BASE_URL, apiKey, provider?.id);
      if (requestId !== modelRequestId.current) return;
      setModels(latest);
      setModel((current) => latest.includes(current) ? current : latest[0] ?? "");
      setModelsLoaded(true);
    } catch (error) {
      if (requestId !== modelRequestId.current) return;
      setModelsError(t("providers.antigravity.modelsFetchFailed", {
        error: String(error).replace(/^Error:\s*/, ""),
      }));
    } finally {
      if (requestId === modelRequestId.current) setModelsLoading(false);
    }
  };

  const normalizedModels = normalizeModels(model, models);
  const activeModel = model.trim() || normalizedModels[0] || "";
  const canSave = Boolean(activeModel && normalizedModels.length);
  const submit = async () => {
    if (!canSave) return;
    const saved = await onSave({
      id: provider?.id,
      kind: "custom",
      name: ANTIGRAVITY_PROVIDER_NAME,
      baseUrl: ANTIGRAVITY_BASE_URL,
      model: activeModel,
      models: normalizedModels,
      modelReasoningEfforts: reasoningEffortsForModels(
        normalizedModels,
        provider?.modelReasoningEfforts ?? {},
      ),
      modelContextWindows: contextWindowsForModels(
        normalizedModels,
        provider?.modelContextWindows ?? {},
      ),
      imageInputModels: provider?.imageInputModels?.filter((value) => normalizedModels.includes(value)) ?? [],
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

  let modelsStatus = <small>{t("providers.antigravity.modelsHint")}</small>;
  if (modelsError) {
    modelsStatus = <small className="provider-form-error">{modelsError}</small>;
  } else if (modelsLoaded) {
    modelsStatus = <small>{t("providers.antigravity.modelsUpdated", { count: models.length })}</small>;
  }

  return (
    <div className="modal-backdrop provider-modal-backdrop">
      <div className="modal provider-modal antigravity-provider-modal">
        <button className="modal-close" disabled={saving} onClick={onClose}
          aria-label={t("providers.antigravity.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Orbit size={22} /></div>
        <h2>{provider
          ? t("providers.antigravity.editTitle")
          : t("providers.antigravity.addTitle")}</h2>
        <p>{t("providers.antigravity.description")}</p>
        <div className="provider-form">
          <label htmlFor="antigravity-base-url">{t("providers.form.baseUrl")}</label>
          <Input id="antigravity-base-url" value={ANTIGRAVITY_BASE_URL} disabled />
          <label htmlFor="antigravity-api-key">{t("providers.antigravity.apiKeyOptional")}</label>
          <Input.Password id="antigravity-api-key" value={apiKey} disabled={saving}
            placeholder={provider?.hasApiKey
              ? t("providers.form.keepApiKey")
              : t("providers.antigravity.apiKeyPlaceholder")}
            onChange={(event) => setApiKey(event.target.value)} />
          <ProviderSpeedTierControl fastModeEnabled={fastModeEnabled} saving={saving}
            onChange={setFastModeEnabled} t={t} />
          <div className="provider-form-label-row">
            <label htmlFor="antigravity-models">{t("providers.antigravity.models")}</label>
            <Button size="small" icon={<RefreshCw size={13} />} loading={modelsLoading}
              disabled={saving} onClick={() => void loadLatestModels()}>
              {provider
                ? t("providers.antigravity.refreshModels")
                : t("providers.antigravity.fetchModels")}
            </Button>
          </div>
          <Select id="antigravity-models" mode="tags" value={models}
            disabled={saving || modelsLoading} options={modelOptions(models)} tokenSeparators={[","]}
            onChange={(values) => {
              const next = normalizeModels("", values);
              setModels(next);
              if (!next.includes(model)) setModel(next[0] ?? "");
            }} />
          {modelsStatus}
          <label htmlFor="antigravity-active-model">{t("providers.form.activeModel")}</label>
          <Select id="antigravity-active-model" value={activeModel || undefined}
            disabled={saving || !normalizedModels.length} options={modelOptions(normalizedModels)}
            onChange={setModel} />
          <div className="provider-integration-note">
            <strong>{t("providers.antigravity.gatewayRequired")}</strong>
            <span>{t("providers.antigravity.gatewayHint")}</span>
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
