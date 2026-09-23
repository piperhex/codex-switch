import { useEffect, useState } from "react";
import { InputNumber } from "antd";
import type { Translate } from "../i18n";
import {
  FAST_MODE_COST_MULTIPLIER_EVENT, MODEL_FAST_MODE_COST_STORAGE_KEY,
  MAX_FAST_MODE_COST_MULTIPLIER, modelFastModeCostOverride, saveModelFastModeCostMultiplier,
} from "../utils/tokenCostFastMode";

interface Props {
  model: string;
  presetMultiplier: number | null;
  t: Translate;
}

export function TokenCostFastModeSettings({ model, presetMultiplier, t }: Props) {
  const [value, setValue] = useState(() => modelFastModeCostOverride(model));
  const [error, setError] = useState(false);
  useEffect(() => {
    const refresh = () => setValue(modelFastModeCostOverride(model));
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key === MODEL_FAST_MODE_COST_STORAGE_KEY) refresh();
    };
    window.addEventListener(FAST_MODE_COST_MULTIPLIER_EVENT, refresh);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(FAST_MODE_COST_MULTIPLIER_EVENT, refresh);
      window.removeEventListener("storage", storage);
    };
  }, [model]);
  const save = (next: number | null) => {
    setValue(next);
    try { saveModelFastModeCostMultiplier(model, next); setError(false); }
    catch { setError(true); }
  };
  return <div style={{ maxWidth: 160 }}>
    <InputNumber value={value} onChange={save} min={0.01} max={MAX_FAST_MODE_COST_MULTIPLIER}
      step={0.1} precision={2} placeholder={presetMultiplier === null ? t("tokenCost.fastMode.unpublished") : String(presetMultiplier)}
      aria-label={t("tokenCost.fastMode.modelMultiplier", { model })}
      status={error ? "error" : undefined} style={{ width: 100 }} />
    {error && <small role="alert">{t("tokenCost.fastMode.saveError")}</small>}
  </div>;
}