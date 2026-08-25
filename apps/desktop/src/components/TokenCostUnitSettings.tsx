import { useEffect, useState } from "react";
import { Button, Dropdown, Input, InputNumber, Select } from "antd";
import { Settings2 } from "lucide-react";
import type { Translate } from "../i18n";
import type { Provider } from "../types";
import { CustomTokenCostModal } from "./CustomTokenCostModal";
import {
  loadTokenCostDisplaySettings,
  saveTokenCostDisplaySettings,
  TOKEN_COST_DISPLAY_EVENT,
  type TokenCostDisplaySettings,
} from "../utils/tokenCost";
import { fetchCloudCurrencyRates } from "../api/backend";
import type { CloudCurrencyRate } from "../types";

export function useTokenCostDisplaySettings() {
  const [settings, setSettings] = useState(loadTokenCostDisplaySettings);
  useEffect(() => {
    const refresh = () => setSettings(loadTokenCostDisplaySettings());
    window.addEventListener(TOKEN_COST_DISPLAY_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(TOKEN_COST_DISPLAY_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return settings;
}

export function TokenCostColumnTitle({ label, settings, providers, t }: {
  label: string;
  settings: TokenCostDisplaySettings;
  providers: Provider[];
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const [customBillingOpen, setCustomBillingOpen] = useState(false);
  const [unit, setUnit] = useState(settings.unit);
  const [usdMultiplier, setUsdMultiplier] = useState<number | null>(settings.usdMultiplier);
  const [currencyRates, setCurrencyRates] = useState<CloudCurrencyRate[]>([]);
  const [currencyRatesLoading, setCurrencyRatesLoading] = useState(false);
  const valid = Boolean(unit.trim() && usdMultiplier && usdMultiplier > 0);
  const save = () => {
    if (!valid || usdMultiplier == null) return;
    saveTokenCostDisplaySettings({ unit: unit.trim().slice(0, 12), usdMultiplier });
    setOpen(false);
  };
  const loadCurrencyRates = async () => {
    setCurrencyRatesLoading(true);
    try {
      setCurrencyRates((await fetchCloudCurrencyRates()).currencies);
    } catch {
      setCurrencyRates([]);
    } finally {
      setCurrencyRatesLoading(false);
    }
  };
  return <>
    <span className="token-cost-column-title">
      <span>{label}</span>
      <Dropdown trigger={["click"]} placement="bottomRight" open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            setUnit(settings.unit);
            setUsdMultiplier(settings.usdMultiplier);
            void loadCurrencyRates();
          }
        }} dropdownRender={() => <div className="token-cost-unit-settings"
          onClick={(event) => event.stopPropagation()}>
          <strong>{t("tokenCost.settings.title")}</strong>
          <label htmlFor="token-cost-currency">{t("tokenCost.settings.currency")}</label>
          <Select id="token-cost-currency" allowClear loading={currencyRatesLoading}
            placeholder={t("tokenCost.settings.currencyPlaceholder")} style={{ width: "100%" }}
            options={currencyRates.map((currency) => ({
              value: currency.code,
              label: `${currency.name} (${currency.code})`,
            }))}
            onChange={(code: string | undefined) => {
              const currency = currencyRates.find((item) => item.code === code);
              if (!currency) return;
              setUnit(currency.name);
              setUsdMultiplier(currency.rate);
            }} />
          <label htmlFor="token-cost-unit">{t("tokenCost.settings.unit")}</label>
          <Input id="token-cost-unit" value={unit} maxLength={12}
            onChange={(event) => setUnit(event.target.value)} />
          <label htmlFor="token-cost-multiplier">{t("tokenCost.settings.usdMultiplier")}</label>
          <InputNumber id="token-cost-multiplier" min={0.000001} precision={6}
            value={usdMultiplier} onChange={setUsdMultiplier} />
          <small>{t("tokenCost.settings.hint", { unit: unit.trim() || settings.unit })}</small>
          <Button type="primary" size="small" disabled={!valid} onClick={save}>
            {t("tokenCost.settings.save")}
          </Button>
          <Button size="small" onClick={() => {
            setOpen(false);
            setCustomBillingOpen(true);
          }}>
            {t("tokenCost.settings.customBilling")}
          </Button>
        </div>}>
        <Button type="text" size="small" className="token-cost-settings-button"
          aria-label={t("tokenCost.settings.title")} icon={<Settings2 size={13} />}
          onClick={(event) => event.stopPropagation()} />
      </Dropdown>
    </span>
    <CustomTokenCostModal open={customBillingOpen} providers={providers} t={t}
      onClose={() => setCustomBillingOpen(false)} />
  </>;
}
