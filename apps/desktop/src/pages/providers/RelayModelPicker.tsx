import { useEffect, useRef, useState } from "react";
import { Button, Select } from "antd";
import { RefreshCw } from "lucide-react";
import { fetchRelayModels } from "../../api/backend";
import type { Translate } from "../../i18n";
import { ModelReasoningEditor } from "./ModelReasoningEditor";
import {
  modelOptions,
  modelContextWindows,
  modelReasoningConfigs,
  modelReasoningEfforts,
  type ModelReasoningConfig,
} from "./providerUtils";

interface RelayModelPickerProps {
  baseUrl: string;
  apiKey: string;
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
  const canFetch = enabled && Boolean(baseUrl.trim() && apiKey.trim());

  const loadModels = async () => {
    if (!canFetch) {
      setError(t("providers.relay.modelsNeedConnection"));
      return;
    }
    const currentRequestId = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const latest = await fetchRelayModels(baseUrl, apiKey);
      if (currentRequestId !== requestId.current) return;
      onModelConfigsChange(modelReasoningConfigs(latest, {
        reasoningEfforts: modelReasoningEfforts(modelConfigs),
        contextWindows: modelContextWindows(modelConfigs),
      }));
      onActiveModelChange(latest.includes(activeModel) ? activeModel : latest[0] ?? "");
      setLoaded(true);
    } catch {
      if (currentRequestId !== requestId.current) return;
      setError(t("providers.relay.modelsFetchFailed"));
      setLoaded(false);
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    requestId.current += 1;
    setLoading(false);
    if (!canFetch) {
      setError("");
      setLoaded(false);
      return;
    }
    const timer = window.setTimeout(() => void loadModels(), AUTO_FETCH_DELAY_MS);
    return () => window.clearTimeout(timer);
    // Fetch only when the connection fields change; selection callbacks must not retrigger discovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, apiKey, enabled]);

  const updateModels = (configs: ModelReasoningConfig[]) => {
    onModelConfigsChange(configs);
    const nextModels = configs.map(({ model }) => model.trim()).filter(Boolean);
    if (!nextModels.includes(activeModel)) onActiveModelChange(nextModels[0] ?? "");
  };
  const status = error
    ? <small className="provider-form-error">{error}</small>
    : <small>{loaded
      ? t("providers.relay.modelsUpdated", { count: modelConfigs.length })
      : t("providers.relay.modelsAutoHint")}</small>;

  return <>
    <div className="provider-form-label-row">
      <label>{t("providers.relay.models")}</label>
      <Button size="small" icon={<RefreshCw size={13} />} loading={loading}
        disabled={disabled || !canFetch} onClick={() => void loadModels()}>
        {t("providers.relay.refreshModels")}
      </Button>
    </div>
    <ModelReasoningEditor value={modelConfigs} disabled={disabled || loading}
      onChange={updateModels} t={t} />
    <small>{t("providers.form.modelRowsHint")}</small>
    {status}
    <label htmlFor="relay-active-model">{t("providers.form.activeModel")}</label>
    <Select id="relay-active-model" value={activeModel || undefined}
      disabled={disabled || !modelConfigs.length}
      options={modelOptions(modelConfigs.map(({ model }) => model.trim()).filter(Boolean))}
      onChange={onActiveModelChange} />
  </>;
}
