import { useState, type MouseEvent } from "react";
import { InputNumber } from "antd";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { isDesktopApp } from "../api/backend";
import type { Translate } from "../i18n";
import {
  DEFAULT_FAST_MODE_COST_MULTIPLIER,
  MAX_FAST_MODE_COST_MULTIPLIER,
  isValidFastModeCostMultiplier,
  loadFastModeCostMultiplier,
  saveFastModeCostMultiplier,
} from "../utils/tokenCostFastMode";

const CODEX_QUOTA_GUIDE_URL = "https://learn.chatgpt.com/docs/agent-configuration/speed";
const MULTIPLIER_INPUT_STEP = 0.1;
const MULTIPLIER_INPUT_PRECISION = 2;

export function TokenCostFastModeSettings({ t }: { t: Translate }) {
  const [multiplier, setMultiplier] = useState<number | null>(loadFastModeCostMultiplier);
  const [error, setError] = useState<"saveError" | "linkError" | null>(null);
  const valid = isValidFastModeCostMultiplier(multiplier);
  const updateMultiplier = (value: number | null) => {
    setMultiplier(value);
    setError(null);
    if (!isValidFastModeCostMultiplier(value)) return;
    try {
      saveFastModeCostMultiplier(value);
    } catch {
      setError("saveError");
    }
  };
  const openQuotaGuide = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isDesktopApp) return;
    event.preventDefault();
    setError(null);
    void openUrl(CODEX_QUOTA_GUIDE_URL).catch(() => setError("linkError"));
  };

  return <div className="custom-token-cost-fast-mode custom-token-cost-field">
    <label htmlFor="token-cost-fast-mode-multiplier">{t("tokenCost.fastMode.multiplier")}</label>
    <InputNumber id="token-cost-fast-mode-multiplier" value={multiplier} onChange={updateMultiplier}
      min={MULTIPLIER_INPUT_STEP} max={MAX_FAST_MODE_COST_MULTIPLIER} step={MULTIPLIER_INPUT_STEP}
      precision={MULTIPLIER_INPUT_PRECISION} status={!valid || error === "saveError" ? "error" : undefined}
      aria-invalid={!valid} aria-describedby="token-cost-fast-mode-hint" />
    <small id="token-cost-fast-mode-hint">
      {t("tokenCost.fastMode.hint", { multiplier: DEFAULT_FAST_MODE_COST_MULTIPLIER })}
    </small>
    <small>{t("tokenCost.fastMode.legacyHint")}</small>
    {!valid && <small className="custom-token-cost-fast-mode-error" role="alert">
      {t("tokenCost.fastMode.invalid", { max: MAX_FAST_MODE_COST_MULTIPLIER })}
    </small>}
    {error && <small className="custom-token-cost-fast-mode-error" role="alert">
      {t(`tokenCost.fastMode.${error}`)}
    </small>}
    <a href={CODEX_QUOTA_GUIDE_URL} target="_blank" rel="noopener noreferrer"
      className="custom-token-cost-source" onClick={openQuotaGuide}>
      {t("tokenCost.fastMode.officialGuide")}<ExternalLink size={11} aria-hidden="true" />
    </a>
  </div>;
}
