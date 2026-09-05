import { Select } from "antd";
import { ExternalLink } from "lucide-react";
import type { Translate } from "../i18n";
import { TokenCostFastModeSettings } from "./TokenCostFastModeSettings";
import { TokenCostLongContextSettings } from "./TokenCostLongContextSettings";
import {
  TOKEN_COST_PRESETS,
  TOKEN_COST_PRESETS_SOURCE_URL,
  TOKEN_COST_PRESETS_VERIFIED_AT,
  UNPRICED_PRESET_MODELS,
} from "../utils/tokenCostPresets";

interface TokenCostPresetsProps {
  referenceModel: string;
  onReferenceChange: (model: string) => void;
  t: Translate;
}

function PriceSource({ model, url, t }: { model: string; url: string; t: Translate }) {
  return <a href={url} target="_blank" rel="noopener noreferrer" className="custom-token-cost-source"
    aria-label={t("tokenCost.customBilling.sourceForModel", { model })}>
    {t("tokenCost.customBilling.source")}<ExternalLink size={11} aria-hidden="true" />
  </a>;
}

export function TokenCostPresets({ referenceModel, onReferenceChange, t }: TokenCostPresetsProps) {
  return <section className="custom-token-cost-presets" aria-labelledby="token-cost-presets-title">
    <div className="custom-token-cost-section-heading">
      <h3 id="token-cost-presets-title">{t("tokenCost.customBilling.presetsTitle")}</h3>
      <small>{t("tokenCost.customBilling.presetsHint", { date: TOKEN_COST_PRESETS_VERIFIED_AT })}</small>
    </div>
    <div className="custom-token-cost-table-scroll">
      <table className="custom-token-cost-preset-table">
        <thead><tr>
          <th scope="col">{t("tokenCost.customBilling.model")}</th>
          <th scope="col">{t("tokenCost.customBilling.presetInput")}</th>
          <th scope="col">{t("tokenCost.customBilling.presetCachedInput")}</th>
          <th scope="col">{t("tokenCost.customBilling.presetOutput")}</th>
          <th scope="col">{t("tokenCost.customBilling.source")}</th>
        </tr></thead>
        <tbody>
          {TOKEN_COST_PRESETS.map((preset) => <tr key={preset.model}>
            <th scope="row"><code>{preset.model}</code></th>
            <td>{preset.input}</td><td>{preset.cachedInput}</td><td>{preset.output}</td>
            <td><PriceSource model={preset.model} url={preset.sourceUrl} t={t} /></td>
          </tr>)}
          {UNPRICED_PRESET_MODELS.map((model) => <tr key={model}>
            <th scope="row"><code>{model}</code></th>
            <td colSpan={3} className="custom-token-cost-unpriced">{t("tokenCost.customBilling.unpriced")}</td>
            <td><PriceSource model={model} url={TOKEN_COST_PRESETS_SOURCE_URL} t={t} /></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="custom-token-cost-reference custom-token-cost-field">
      <label htmlFor="token-cost-reference-model">{t("tokenCost.customBilling.referenceModel")}</label>
      <Select id="token-cost-reference-model" value={referenceModel} onChange={onReferenceChange}
        classNames={{ popup: { root: "custom-token-cost-select-popup" } }} popupMatchSelectWidth={false}
        options={TOKEN_COST_PRESETS.map((preset) => ({ value: preset.model, label: preset.model }))} />
      <small>{t("tokenCost.customBilling.referenceHint")}</small>
      <small>{t("tokenCost.customBilling.priorityHint")}</small>
    </div>
    <TokenCostFastModeSettings t={t} />
    <TokenCostLongContextSettings t={t} />
  </section>;
}
