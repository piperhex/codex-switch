import { useEffect, useRef, useState } from "react";
import { Button, Select } from "antd";
import { RefreshCw } from "lucide-react";
import { fetchRelayModels } from "../../api/backend";
import type { Translate } from "../../i18n";
import { modelOptions, normalizeModels } from "./providerUtils";

interface RelayModelPickerProps {
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  disabled: boolean;
  models: string[];
  activeModel: string;
  onModelsChange: (models: string[]) => void;
  onActiveModelChange: (model: string) => void;
  t: Translate;
}

const AUTO_FETCH_DELAY_MS = 800;

export function RelayModelPicker({
  baseUrl,
  apiKey,
  enabled,
  disabled,
  models,
  activeModel,
  onModelsChange,
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
      onModelsChange(latest);
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

  const updateModels = (values: string[]) => {
    const nextModels = normalizeModels("", values);
    onModelsChange(nextModels);
    if (!nextModels.includes(activeModel)) onActiveModelChange(nextModels[0] ?? "");
  };
  const status = error
    ? <small className="provider-form-error">{error}</small>
    : <small>{loaded
      ? t("providers.relay.modelsUpdated", { count: models.length })
      : t("providers.relay.modelsAutoHint")}</small>;

  return <>
    <div className="provider-form-label-row">
      <label htmlFor="relay-models">{t("providers.relay.models")}</label>
      <Button size="small" icon={<RefreshCw size={13} />} loading={loading}
        disabled={disabled || !canFetch} onClick={() => void loadModels()}>
        {t("providers.relay.refreshModels")}
      </Button>
    </div>
    <Select id="relay-models" mode="tags" value={models} disabled={disabled || loading}
      options={modelOptions(models)} tokenSeparators={[","]} onChange={updateModels} />
    {status}
    <label htmlFor="relay-active-model">{t("providers.form.activeModel")}</label>
    <Select id="relay-active-model" value={activeModel || undefined}
      disabled={disabled || !models.length} options={modelOptions(models)}
      onChange={onActiveModelChange} />
  </>;
}
