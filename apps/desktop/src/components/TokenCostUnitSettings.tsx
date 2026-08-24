import { useEffect, useState } from "react";
import { Button, Dropdown, Input, InputNumber } from "antd";
import { Settings2 } from "lucide-react";
import type { Translate } from "../i18n";
import {
  loadTokenCostDisplaySettings,
  saveTokenCostDisplaySettings,
  TOKEN_COST_DISPLAY_EVENT,
  type TokenCostDisplaySettings,
} from "../utils/tokenCost";

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

export function TokenCostColumnTitle({ label, settings, t }: {
  label: string;
  settings: TokenCostDisplaySettings;
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState(settings.unit);
  const [usdMultiplier, setUsdMultiplier] = useState<number | null>(settings.usdMultiplier);
  const valid = Boolean(unit.trim() && usdMultiplier && usdMultiplier > 0);
  const save = () => {
    if (!valid || usdMultiplier == null) return;
    saveTokenCostDisplaySettings({ unit: unit.trim().slice(0, 12), usdMultiplier });
    setOpen(false);
  };
  return <span className="token-cost-column-title">
    <span>{label}</span>
    <Dropdown trigger={["click"]} placement="bottomRight" open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setUnit(settings.unit);
          setUsdMultiplier(settings.usdMultiplier);
        }
      }} dropdownRender={() => <div className="token-cost-unit-settings"
        onClick={(event) => event.stopPropagation()}>
        <strong>{t("tokenCost.settings.title")}</strong>
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
      </div>}>
      <Button type="text" size="small" className="token-cost-settings-button"
        aria-label={t("tokenCost.settings.title")} icon={<Settings2 size={13} />}
        onClick={(event) => event.stopPropagation()} />
    </Dropdown>
  </span>;
}
