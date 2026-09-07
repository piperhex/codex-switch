import { useEffect, useRef, useState } from "react";
import { Button, Select } from "antd";
import { RefreshCw } from "lucide-react";
import { fetchRelayModels } from "../../api/backend";
import type { Translate } from "../../i18n";
import { ModelReasoningEditor } from "./ModelReasoningEditor";
import {
  modelOptions,
  modelContextWindows,
  modelApiFormats,
  modelImageInputModels,
  modelReasoningConfigs,
  modelReasoningEfforts,
  type ModelReasoningConfig,
} from "./providerUtils";

interface RelayModelPickerProps {
  baseUrl: string;
  apiKey: string;
  providerId?: string;
  enabled: boolean;
  disabled: boolean;
  modelConfigs: ModelReasoningConfig[];
  activeModel: string;
  onModelConfigsChange: (configs: ModelReasoningConfig[]) => void;
  onActiveModelChange: (model: string) => void;
  t: Translate;
}

const AUTO_FETCH_DELAY_MS = 800;

export function RelayModelPicker({
  baseUrl,
  apiKey,
  providerId,
  enabled,
  disabled,
  modelConfigs,
  activeModel,
  onModelConfigsChange,
  onActiveModelChange,
  t,
}: RelayModelPickerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const requestId = useRef(0);
  const pendingRequest = useRef<number | null>(null);
  const autoFetchTimer = useRef<number>();
  const selection = useRef({ modelConfigs, activeModel });
  selection.current = { modelConfigs, activeModel };
  const canFetch = enabled && Boolean(baseUrl.trim() && (apiKey.trim() || providerId));

  const loadModels = async () => {
    if (disabled || pendingRequest.current !== null) return;
    window.clearTimeout(autoFetchTimer.current);
    if (!canFetch) {
      setError(t("providers.form.modelsNeedConnection"));
      return;
    }
    const currentRequestId = ++requestId.current;
    pendingRequest.current = currentRequestId;
    setLoading(true);
    setError("");
    try {
      const latest = await fetchRelayModels(baseUrl, apiKey, providerId);
      if (currentRequestId !== requestId.current) return;
      const { modelConfigs, activeModel } = selection.current;
      onModelConfigsChange(modelReasoningConfigs(latest, {
        reasoningEfforts: modelReasoningEfforts(modelConfigs),
        contextWindows: modelContextWindows(modelConfigs),
        apiFormats: modelApiFormats(modelConfigs),
        imageInputModels: modelImageInputModels(modelConfigs),
        preserveImageInputForModels: modelConfigs.map(({ model }) => model.trim()),
        tokenCosts: Object.fromEntries(modelConfigs.flatMap(({ model, unitCost }) => (
          model.trim() && unitCost != null ? [[model.trim(), unitCost]] : []
        ))),
      }));
      onActiveModelChange(latest.includes(activeModel) ? activeModel : latest[0] ?? "");
      setLoaded(true);
    } catch {
      if (currentRequestId !== requestId.current) return;
      setError(t("providers.form.modelsFetchFailed"));
      setLoaded(false);
    } finally {
      if (pendingRequest.current === currentRequestId) pendingRequest.current = null;
      if (currentRequestId === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    requestId.current += 1;
    pendingRequest.current = null;
    setLoading(false);
    setError("");
    setLoaded(false);
    // Opening an existing provider must leave its saved model list intact until refresh is requested.
    if (canFetch && apiKey.trim() && !disabled) {
      autoFetchTimer.current = window.setTimeout(() => void loadModels(), AUTO_FETCH_DELAY_MS);
    }
    return () => {
      window.clearTimeout(autoFetchTimer.current);
      requestId.current += 1;
    };
    // Fetch only when the connection fields change; selection callbacks must not retrigger discovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, apiKey, providerId, enabled, disabled]);

  const updateModels = (configs: ModelReasoningConfig[]) => {
    onModelConfigsChange(configs);
    const nextModels = configs.map(({ model }) => model.trim()).filter(Boolean);
    if (!nextModels.includes(activeModel)) onActiveModelChange(nextModels[0] ?? "");
  };
  const status = error
    ? <small className="provider-form-error">{error}</small>
    : <small>{loaded
      ? t("providers.form.modelsUpdated", { count: modelConfigs.length })
      : t(providerId ? "providers.form.modelsRefreshHint" : "providers.form.modelsAutoHint")}</small>;

  return <>
    <div className="provider-form-label-row">
      <label>{t("providers.form.models")}</label>
      <Button size="small" icon={<RefreshCw size={13} />} loading={loading}
        disabled={disabled || !canFetch} onClick={() => void loadModels()}>
        {t("providers.form.refreshModels")}
      </Button>
    </div>
    <ModelReasoningEditor value={modelConfigs} disabled={disabled || loading}
      onChange={updateModels} t={t} />
    <small>{t("providers.form.modelRowsHint")}</small>
    {status}
    <label htmlFor="relay-active-model">{t("providers.form.activeModel")}</label>
    <Select id="relay-active-model" value={activeModel || undefined}
      disabled={disabled || loading || !modelConfigs.length}
      options={modelOptions(modelConfigs.map(({ model }) => model.trim()).filter(Boolean))}
      onChange={onActiveModelChange} />
  </>;
}
