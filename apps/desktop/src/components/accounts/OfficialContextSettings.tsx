import { useMemo, useState } from "react";
import { Button, Dropdown, Input, Tooltip } from "antd";
import { Plus, Settings, Trash2 } from "lucide-react";
import type { Translate } from "../../i18n";

interface OfficialContextSettingsProps {
  models: string[];
  valuesK: Record<string, string>;
  saving: boolean;
  onSave: (model: string, valueK: string) => Promise<boolean>;
  onChange: (model: string, valueK: string) => void;
  onClear: (model: string) => Promise<void>;
  t: Translate;
}

export function OfficialContextSettings({
  models,
  valuesK,
  saving,
  onSave,
  onChange,
  onClear,
  t,
}: OfficialContextSettingsProps) {
  const [open, setOpen] = useState(false);
  const [newModel, setNewModel] = useState("");
  const modelNames = useMemo(() => [...new Set([...models, ...Object.keys(valuesK)])].sort(), [models, valuesK]);
  const addModel = () => {
    const model = newModel.trim();
    if (!model || modelNames.includes(model)) return;
    setNewModel("");
    void onSave(model, "128");
  };
  return (
    <Dropdown open={open} onOpenChange={setOpen} trigger={["click"]} placement="bottomRight"
      dropdownRender={() => (
        <div className="official-context-settings" role="dialog" aria-label={t("table.modelContextSettings")}>
          <div className="official-context-settings-title">{t("table.modelContextSettings")}</div>
          <div className="official-context-settings-hint">{t("table.modelContextSettingsHint")}</div>
          <div className="official-context-settings-list">
            {modelNames.map((model) => (
              <div className="official-context-settings-row" key={model}>
                <span title={model}>{model}</span>
                <Input size="small" value={valuesK[model] ?? ""} placeholder="—" disabled={saving}
                  suffix="K" onChange={(event) => onChange(model, event.target.value)}
                  onBlur={() => void onSave(model, valuesK[model] ?? "")} />
                <Tooltip title={t("table.modelContextRemove")}>
                  <Button size="small" type="text" danger icon={<Trash2 size={13} />}
                    disabled={saving} onClick={() => void onClear(model)} />
                </Tooltip>
              </div>
            ))}
          </div>
          <div className="official-context-settings-add">
            <Input size="small" value={newModel} placeholder={t("table.modelContextAddPlaceholder")}
              onChange={(event) => setNewModel(event.target.value)} onPressEnter={addModel} />
            <Button size="small" type="text" icon={<Plus size={13} />} disabled={!newModel.trim() || saving}
              onClick={addModel}>{t("table.modelContextAdd")}</Button>
          </div>
        </div>
      )}>
      <Tooltip title={t("table.modelContextSettings")}>
        <Button size="small" type="text" className="table-icon-button" aria-label={t("table.modelContextSettings")}
          icon={<Settings size={14} />} />
      </Tooltip>
    </Dropdown>
  );
}
