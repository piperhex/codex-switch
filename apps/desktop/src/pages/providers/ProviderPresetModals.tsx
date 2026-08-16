import { useEffect, useRef, useState } from "react";
import { AutoComplete, Button, Input, Select } from "antd";
import { Bot, RefreshCw, Save, X } from "lucide-react";
import { fetchDeepSeekModels } from "../../api/backend";
import type { Provider, ProviderInput } from "../../types";
import { CONTEXT_WINDOW_OPTIONS, modelOptions, normalizeModels, parseContextWindowK } from "./providerUtils";
import type { ProviderModalProps } from "./ProviderModal";
export function OpenAiProviderModal({ provider, saving, onClose, onSave, t }: ProviderModalProps) {
  const [name, setName] = useState("Codex Switch");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    setName(provider?.name ?? "Codex Switch");
    setBaseUrl(provider?.baseUrl ?? "");
    setApiKey("");
  }, [provider]);

  const canSave = Boolean(
    name.trim()
    && baseUrl.trim(),
  );
  const submit = async () => {
    if (!canSave) return;
    const saved = await onSave({
      id: provider?.id,
      kind: "openai",
      name,
      baseUrl,
      model: provider?.model ?? "",
      models: provider?.models ?? [],
      modelReasoningEfforts: provider?.modelReasoningEfforts ?? {},
      modelContextWindows: provider?.modelContextWindows ?? {},
      imageInputModels: provider?.imageInputModels ?? [],
      modelSelectionControlledByCodex: true,
      apiKey: apiKey.trim() || undefined,
      apiFormat: "openaiResponses",
      balancePlatform: null,
      balanceQueryUrl: null,
      balanceQueryUsesApiKey: true,
      walletQueryUrl: null,
    });
    if (saved) onClose();
  };

  return (
    <div className="modal-backdrop provider-modal-backdrop">
      <div className="modal provider-modal">
        <button className="modal-close" disabled={saving} onClick={onClose}
          aria-label={t("providers.openai.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Bot size={22} /></div>
        <h2>{provider ? t("providers.openai.editTitle") : t("providers.openai.addTitle")}</h2>
        <p>{t("providers.openai.description")}</p>
        <div className="provider-form">
          <label htmlFor="openai-provider-name">{t("providers.form.name")}</label>
          <Input id="openai-provider-name" value={name} disabled={saving} placeholder="Codex Switch"
            onChange={(event) => setName(event.target.value)} />
          <label htmlFor="openai-provider-base-url">{t("providers.openai.baseUrl")}</label>
          <Input id="openai-provider-base-url" value={baseUrl} disabled={saving}
            placeholder="https://upstream-codex-switch.example.com/v1"
            onChange={(event) => setBaseUrl(event.target.value)} />
          <small>{t("providers.openai.baseUrlHint")}</small>
          <label htmlFor="openai-provider-api-key">{t("providers.openai.apiKeyOptional")}</label>
          <Input.Password id="openai-provider-api-key" value={apiKey} disabled={saving}
            placeholder={provider?.hasApiKey
              ? t("providers.form.keepApiKey")
              : t("providers.openai.apiKeyPlaceholder")}
            onChange={(event) => setApiKey(event.target.value)} />
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
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_FALLBACK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

export function DeepSeekProviderModal({ provider, saving, onClose, onSave, t }: ProviderModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>(DEEPSEEK_FALLBACK_MODELS);
  const [contextWindowK, setContextWindowK] = useState("1000");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const modelRequestId = useRef(0);

  useEffect(() => {
    const nextModels = normalizeModels(
      provider?.model ?? "",
      provider?.models?.length ? provider.models : DEEPSEEK_FALLBACK_MODELS,
    );
    setApiKey("");
    setModels(nextModels);
    setModel(provider?.model ?? nextModels[0] ?? "");
    setContextWindowK(provider?.contextWindow
      ? String(provider.contextWindow / 1000)
      : "1000");
    setModelsError("");
    setModelsLoaded(false);
  }, [provider]);

  const loadLatestModels = async () => {
    if (!apiKey.trim() && !provider?.hasApiKey) {
      setModelsError(t("providers.deepSeek.modelsNeedKey"));
      return;
    }
    const requestId = ++modelRequestId.current;
    setModelsLoading(true);
    setModelsError("");
    try {
      const latest = await fetchDeepSeekModels(DEEPSEEK_BASE_URL, apiKey, provider?.id);
      if (requestId !== modelRequestId.current) return;
      setModels(latest);
      setModel((current) => latest.includes(current) ? current : latest[0] ?? "");
      setModelsLoaded(true);
    } catch (error) {
      if (requestId !== modelRequestId.current) return;
      setModelsError(t("providers.deepSeek.modelsFetchFailed", {
        error: String(error).replace(/^Error:\s*/, ""),
      }));
    } finally {
      if (requestId === modelRequestId.current) setModelsLoading(false);
    }
  };

  useEffect(() => {
    if ((!apiKey.trim() || apiKey.trim().length < 8) && !provider?.hasApiKey) return;
    const timer = window.setTimeout(() => void loadLatestModels(), provider?.hasApiKey ? 0 : 800);
    return () => window.clearTimeout(timer);
    // Refresh when the saved credential becomes available or the user finishes entering a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, provider?.id, provider?.hasApiKey]);

  const normalizedModels = normalizeModels(model, models);
  const activeModel = model.trim() || normalizedModels[0] || "";
  const contextWindow = parseContextWindowK(contextWindowK);
  const canSave = Boolean(
    activeModel
    && normalizedModels.length
    && contextWindow !== undefined
    && (provider?.hasApiKey || apiKey.trim()),
  );
  let modelsStatus = <small>{t("providers.deepSeek.modelsAutoHint")}</small>;
  if (modelsError) {
    modelsStatus = <small className="provider-form-error">{modelsError}</small>;
  } else if (modelsLoaded) {
    modelsStatus = <small>{t("providers.deepSeek.modelsUpdated", { count: models.length })}</small>;
  }
  const submit = async () => {
    if (!canSave) return;
    const saved = await onSave({
      id: provider?.id,
      kind: "custom",
      name: "DeepSeek",
      baseUrl: DEEPSEEK_BASE_URL,
      model: activeModel,
      models: normalizedModels,
      modelReasoningEfforts: provider?.modelReasoningEfforts ?? {},
      modelContextWindows: provider?.modelContextWindows ?? {},
      imageInputModels: [],
      contextWindow,
      modelSelectionControlledByCodex: provider?.modelSelectionControlledByCodex ?? true,
      apiKey: apiKey.trim() || undefined,
      apiFormat: "openaiChat",
      balancePlatform: "deepSeek",
      balanceQueryUrl: `${DEEPSEEK_BASE_URL}/user/balance`,
      balanceQueryUsesApiKey: true,
      walletQueryUrl: null,
    });
    if (saved) onClose();
  };

  return (
    <div className="modal-backdrop provider-modal-backdrop">
      <div className="modal provider-modal deepseek-provider-modal">
        <button className="modal-close" disabled={saving} onClick={onClose}
          aria-label={t("providers.deepSeek.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Bot size={22} /></div>
        <h2>{provider ? t("providers.deepSeek.editTitle") : t("providers.deepSeek.addTitle")}</h2>
        <p>{t("providers.deepSeek.description")}</p>
        <div className="provider-form">
          <label htmlFor="deepseek-base-url">{t("providers.form.baseUrl")}</label>
          <Input id="deepseek-base-url" value={DEEPSEEK_BASE_URL} disabled />
          <label htmlFor="deepseek-api-key">{t("providers.form.apiKey")}</label>
          <Input.Password id="deepseek-api-key" value={apiKey} disabled={saving}
            placeholder={provider?.hasApiKey ? t("providers.form.keepApiKey") : t("providers.form.newApiKey")}
            onChange={(event) => setApiKey(event.target.value)} />
          <div className="provider-form-label-row">
            <label htmlFor="deepseek-models">{t("providers.deepSeek.models")}</label>
            <Button size="small" icon={<RefreshCw size={13} />} loading={modelsLoading}
              disabled={saving || (!apiKey.trim() && !provider?.hasApiKey)}
              onClick={() => void loadLatestModels()}>
              {provider ? t("providers.deepSeek.refreshModels") : t("providers.deepSeek.fetchModels")}
            </Button>
          </div>
          <Select id="deepseek-models" mode="tags" value={models} disabled={saving || modelsLoading}
            options={modelOptions(models)} tokenSeparators={[","]}
            onChange={(values) => {
              const next = normalizeModels("", values);
              setModels(next);
              if (!next.includes(model)) setModel(next[0] ?? "");
            }} />
          {modelsStatus}
          <label htmlFor="deepseek-active-model">{t("providers.form.activeModel")}</label>
          <Select id="deepseek-active-model" value={activeModel || undefined}
            disabled={saving || !normalizedModels.length} options={modelOptions(normalizedModels)}
            onChange={setModel} />
          <label htmlFor="deepseek-context-window">{t("providers.form.contextWindow")}</label>
          <AutoComplete id="deepseek-context-window" value={contextWindowK} disabled={saving}
            options={CONTEXT_WINDOW_OPTIONS} placeholder="1000" allowClear
            onChange={setContextWindowK} />
          <small>{t("providers.deepSeek.contextHint")}</small>
          <div className="provider-integration-note">
            <strong>{t("providers.deepSeek.proxyOnly")}</strong>
            <span>{t("providers.deepSeek.balanceHint")}</span>
            <span>{t("providers.deepSeek.imageInputUnsupported")}</span>
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
