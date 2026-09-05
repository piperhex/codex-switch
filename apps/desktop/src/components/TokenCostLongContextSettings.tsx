import { useState, type MouseEvent } from "react";
import { InputNumber, Switch } from "antd";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { isDesktopApp } from "../api/backend";
import type { Translate } from "../i18n";
import {
  DEFAULT_LONG_CONTEXT_COST_SETTINGS,
  MAX_LONG_CONTEXT_THRESHOLD_TOKENS,
  MAX_LONG_CONTEXT_COST_MULTIPLIER,
  isValidLongContextCostSettings,
  loadLongContextCostSettings,
  saveLongContextCostSettings,
  type LongContextCostSettings,
} from "../utils/tokenCostLongContext";

const LONG_CONTEXT_GUIDE_URL = "https://developers.openai.com/api/docs/models/gpt-5.6-sol";
const MIN_MULTIPLIER_INPUT_VALUE = 0.01;
const MULTIPLIER_INPUT_STEP = 0.1;
const MULTIPLIER_INPUT_PRECISION = 2;
const MULTIPLIER_FIELDS = ["inputMultiplier", "cachedInputMultiplier", "outputMultiplier"] as const;
type NumericSetting = Exclude<keyof LongContextCostSettings, "enabled">;
type SettingsDraft = { enabled: boolean } & Record<NumericSetting, number | null>;
type SettingsError = "saveError" | "linkError" | null;

function isValidField(field: NumericSetting, value: number | null): value is number {
  if (value === null || !Number.isFinite(value) || value <= 0) return false;
  if (field === "thresholdTokens") return Number.isInteger(value) && value <= MAX_LONG_CONTEXT_THRESHOLD_TOKENS;
  return value <= MAX_LONG_CONTEXT_COST_MULTIPLIER;
}

function useLongContextSettings() {
  const [draft, setDraft] = useState<SettingsDraft>(loadLongContextCostSettings);
  const [error, setError] = useState<SettingsError>(null);
  const update = (next: SettingsDraft) => {
    setDraft(next);
    setError(null);
    if (!isValidLongContextCostSettings(next)) return;
    try {
      saveLongContextCostSettings(next);
    } catch {
      setError("saveError");
    }
  };
  const updateField = (field: NumericSetting, value: number | null) => update({ ...draft, [field]: value });
  const updateEnabled = (enabled: boolean) => update({ ...loadLongContextCostSettings(), enabled });
  const openGuide = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isDesktopApp) return;
    event.preventDefault();
    setError(null);
    void openUrl(LONG_CONTEXT_GUIDE_URL).catch(() => setError("linkError"));
  };
  return { draft, error, updateField, updateEnabled, openGuide };
}

interface CostFieldProps {
  field: NumericSetting;
  value: number | null;
  disabled: boolean;
  onChange: (field: NumericSetting, value: number | null) => void;
  t: Translate;
}

function CostField({ field, value, disabled, onChange, t }: CostFieldProps) {
  const isThreshold = field === "thresholdTokens";
  const valid = isValidField(field, value);
  const id = `token-cost-long-context-${field}`;
  return <div className="custom-token-cost-field">
    <label htmlFor={id}>{t(`tokenCost.longContext.${field}`)}</label>
    <InputNumber id={id} value={value} onChange={(next) => onChange(field, next)} disabled={disabled}
      min={isThreshold ? 1 : MIN_MULTIPLIER_INPUT_VALUE}
      max={isThreshold ? MAX_LONG_CONTEXT_THRESHOLD_TOKENS : MAX_LONG_CONTEXT_COST_MULTIPLIER}
      step={isThreshold ? 1 : MULTIPLIER_INPUT_STEP} precision={isThreshold ? 0 : MULTIPLIER_INPUT_PRECISION}
      status={!valid ? "error" : undefined} aria-invalid={!valid}
      aria-describedby={!valid ? `${id}-error` : "token-cost-long-context-rule"} />
    {!valid && <small id={`${id}-error`} className="custom-token-cost-long-context-error" role="alert">
      {t(isThreshold ? "tokenCost.longContext.invalidThreshold" : "tokenCost.longContext.invalidMultiplier", {
        max: isThreshold ? MAX_LONG_CONTEXT_THRESHOLD_TOKENS : MAX_LONG_CONTEXT_COST_MULTIPLIER,
      })}
    </small>}
  </div>;
}

export function TokenCostLongContextSettings({ t }: { t: Translate }) {
  const { draft, error, updateField, updateEnabled, openGuide } = useLongContextSettings();
  const defaults = DEFAULT_LONG_CONTEXT_COST_SETTINGS;
  return <section className="custom-token-cost-long-context" aria-labelledby="token-cost-long-context-title">
    <div className="custom-token-cost-long-context-heading">
      <label id="token-cost-long-context-title" htmlFor="token-cost-long-context-enabled">
        {t("tokenCost.longContext.title")}
      </label>
      <Switch id="token-cost-long-context-enabled" size="small" checked={draft.enabled}
        onChange={updateEnabled} aria-labelledby="token-cost-long-context-title" />
    </div>
    <small id="token-cost-long-context-rule">{t("tokenCost.longContext.rule")}</small>
    <small>{t("tokenCost.longContext.defaults", {
      threshold: defaults.thresholdTokens.toLocaleString("en-US"), input: defaults.inputMultiplier,
      cachedInput: defaults.cachedInputMultiplier, output: defaults.outputMultiplier,
    })}</small>
    <CostField field="thresholdTokens" value={draft.thresholdTokens} disabled={!draft.enabled}
      onChange={updateField} t={t} />
    <div className="custom-token-cost-long-context-rates">
      {MULTIPLIER_FIELDS.map((field) => <CostField key={field} field={field} value={draft[field]}
        disabled={!draft.enabled} onChange={updateField} t={t} />)}
    </div>
    <small>{t("tokenCost.longContext.models")}</small>
    <small>{t("tokenCost.longContext.reference")}</small>
    <small>{t("tokenCost.longContext.stacking")}</small>
    {error && <small className="custom-token-cost-long-context-error" role="alert">
      {t(`tokenCost.longContext.${error}`)}
    </small>}
    <a href={LONG_CONTEXT_GUIDE_URL} target="_blank" rel="noopener noreferrer"
      className="custom-token-cost-source" onClick={openGuide}>
      {t("tokenCost.longContext.officialGuide")}<ExternalLink size={11} aria-hidden="true" />
    </a>
  </section>;
}
