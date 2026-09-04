import { useEffect, useRef, useState } from "react";
import { Button, Input, Select } from "antd";
import { Code2, RefreshCw, Save, X } from "lucide-react";
import { fetchClaudeCodeModels } from "../../api/backend";
import {
  CLAUDE_CODE_BASE_URL,
  CLAUDE_CODE_FALLBACK_MODELS,
  CLAUDE_CODE_PROVIDER_NAME,
  claudeCodeContextWindows,
  claudeCodeImageInputModels,
  claudeCodeReasoningEfforts,
} from "../../utils/claudeCodeProvider";
import { modelOptions, normalizeModels } from "./providerUtils";
import { ProviderFastModeSupportControl } from "./ProviderFormFields";
import type { ProviderModalProps } from "./ProviderModal";

const API_KEY_AUTOFETCH_DELAY_MS = 800;
const MIN_API_KEY_LENGTH_FOR_AUTOFETCH = 8;

export function ClaudeCodeProviderModal({ provider, saving, onClose, onSave, t }: ProviderModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>(CLAUDE_CODE_FALLBACK_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [supportsFastMode, setSupportsFastMode] = useState(true);
  const modelRequestId = useRef(0);

  useEffect(() => {
    const nextModels = normalizeModels(
      provider?.model ?? "",
      provider?.models?.length ? provider.models : CLAUDE_CODE_FALLBACK_MODELS,
    );
    setApiKey("");
    setModels(nextModels);
    setModel(provider?.model ?? nextModels[0] ?? "");
    setModelsError("");
    setModelsLoaded(false);
    setSupportsFastMode(provider?.fastModeEnabled ?? true);
  }, [provider]);

  const loadLatestModels = async () => {
    if (!apiKey.trim() && !provider?.hasApiKey) {
      setModelsError(t("providers.claudeCode.modelsNeedKey"));
      return;
    }
    const requestId = ++modelRequestId.current;
    setModelsLoading(true);
    setModelsError("");
    try {
      const latest = await fetchClaudeCodeModels(CLAUDE_CODE_BASE_URL, apiKey, provider?.id);
      if (requestId !== modelRequestId.current) return;
      setModels(latest);
      setModel((current) => latest.includes(current) ? current : latest[0] ?? "");
      setModelsLoaded(true);
    } catch (error) {
      if (requestId !== modelRequestId.current) return;
      setModelsError(t("providers.claudeCode.modelsFetchFailed", {
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
      name: CLAUDE_CODE_PROVIDER_NAME,
      baseUrl: CLAUDE_CODE_BASE_URL,
      model: activeModel,
      models: normalizedModels,
      modelReasoningEfforts: claudeCodeReasoningEfforts(normalizedModels),
      modelContextWindows: claudeCodeContextWindows(
        normalizedModels,
        provider?.modelContextWindows ?? {},
      ),
      imageInputModels: claudeCodeImageInputModels(normalizedModels),
      contextWindow: null,
      modelSelectionControlledByCodex: true,
      fastModeEnabled: supportsFastMode,
      apiKey: apiKey.trim() || undefined,
      apiFormat: "openaiChat",
      balancePlatform: null,
      balanceQueryUrl: null,
      balanceQueryUsesApiKey: true,
      walletQueryUrl: null,
    });
    if (saved) onClose();
  };

  let modelsStatus = <small>{t("providers.claudeCode.modelsAutoHint")}</small>;
  if (modelsError) {
    modelsStatus = <small className="provider-form-error">{modelsError}</small>;
  } else if (modelsLoaded) {
    modelsStatus = (
      <small>{t("providers.claudeCode.modelsUpdated", { count: models.length })}</small>
    );
  }

  return (
    <div className="modal-backdrop provider-modal-backdrop">
      <div className="modal provider-modal claude-code-provider-modal">
        <button className="modal-close" disabled={saving} onClick={onClose}
          aria-label={t("providers.claudeCode.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Code2 size={22} /></div>
        <h2>{provider
          ? t("providers.claudeCode.editTitle")
          : t("providers.claudeCode.addTitle")}</h2>
        <p>{t("providers.claudeCode.description")}</p>
        <div className="provider-form">
          <label htmlFor="claude-code-base-url">{t("providers.form.baseUrl")}</label>
          <Input id="claude-code-base-url" value={CLAUDE_CODE_BASE_URL} disabled />
          <label htmlFor="claude-code-api-key">{t("providers.form.apiKey")}</label>
          <Input.Password id="claude-code-api-key" value={apiKey} disabled={saving}
            placeholder={provider?.hasApiKey
              ? t("providers.form.keepApiKey")
              : t("providers.form.newApiKey")}
            onChange={(event) => setApiKey(event.target.value)} />
          <ProviderFastModeSupportControl supportsFastMode={supportsFastMode} saving={saving}
            onChange={setSupportsFastMode} t={t} />
          <div className="provider-form-label-row">
            <label htmlFor="claude-code-models">{t("providers.claudeCode.models")}</label>
            <Button size="small" icon={<RefreshCw size={13} />} loading={modelsLoading}
              disabled={saving || (!apiKey.trim() && !provider?.hasApiKey)}
              onClick={() => void loadLatestModels()}>
              {provider
                ? t("providers.claudeCode.refreshModels")
                : t("providers.claudeCode.fetchModels")}
            </Button>
          </div>
          <Select id="claude-code-models" mode="tags" value={models}
            disabled={saving || modelsLoading} options={modelOptions(models)} tokenSeparators={[","]}
            onChange={(values) => {
              const next = normalizeModels("", values);
              setModels(next);
              if (!next.includes(model)) setModel(next[0] ?? "");
            }} />
          {modelsStatus}
          <label htmlFor="claude-code-active-model">{t("providers.form.activeModel")}</label>
          <Select id="claude-code-active-model" value={activeModel || undefined}
            disabled={saving || !normalizedModels.length} options={modelOptions(normalizedModels)}
            onChange={setModel} />
          <div className="provider-integration-note">
            <strong>{t("providers.claudeCode.apiKeyRequired")}</strong>
            <span>{t("providers.claudeCode.reasoningHint")}</span>
            <span>{t("providers.claudeCode.billingHint")}</span>
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
