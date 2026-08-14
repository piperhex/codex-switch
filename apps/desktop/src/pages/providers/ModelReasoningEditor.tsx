import { Button, Input, Select } from "antd";
import { Plus, Trash2 } from "lucide-react";
import type { Translate } from "../../i18n";
import type { ReasoningEffort } from "../../types";
import {
  defaultReasoningEfforts,
  type ModelReasoningConfig,
  reasoningEffortOptions,
} from "./providerUtils";

interface ModelReasoningEditorProps {
  value: ModelReasoningConfig[];
  disabled: boolean;
  onChange: (value: ModelReasoningConfig[]) => void;
  t: Translate;
}

function usesDefaults(config: ModelReasoningConfig) {
  const defaults = defaultReasoningEfforts(config.model);
  return config.reasoningEfforts.length === defaults.length
    && config.reasoningEfforts.every((effort, index) => effort === defaults[index]);
}

export function ModelReasoningEditor({
  value,
  disabled,
  onChange,
  t,
}: ModelReasoningEditorProps) {
  const updateModel = (index: number, model: string) => {
    onChange(value.map((config, rowIndex) => {
      if (rowIndex !== index) return config;
      const reasoningEfforts = !config.model.trim() || usesDefaults(config)
        ? defaultReasoningEfforts(model)
        : config.reasoningEfforts;
      return { model, reasoningEfforts };
    }));
  };
  const updateEfforts = (index: number, reasoningEfforts: ReasoningEffort[]) => {
    onChange(value.map((config, rowIndex) => (
      rowIndex === index ? { ...config, reasoningEfforts } : config
    )));
  };
  const remove = (index: number) => onChange(value.filter((_, rowIndex) => rowIndex !== index));
  const add = () => onChange([...value, { model: "", reasoningEfforts: [] }]);

  return <div className="provider-model-editor">
    <div className="provider-model-editor-head">
      <span>{t("providers.form.modelName")}</span>
      <span>{t("providers.form.reasoningEfforts")}</span>
      <span />
    </div>
    {value.map((config, index) => <div className="provider-model-editor-row" key={index}>
      <Input value={config.model} disabled={disabled}
        placeholder="gpt-5.6-sol" onChange={(event) => updateModel(index, event.target.value)} />
      <Select mode="multiple" value={config.reasoningEfforts} disabled={disabled}
        maxTagCount="responsive" options={reasoningEffortOptions(config.model, t)}
        placeholder={t("providers.form.reasoningEffortsPlaceholder")}
        onChange={(efforts) => updateEfforts(index, efforts as ReasoningEffort[])} />
      <Button type="text" danger icon={<Trash2 size={14} />} disabled={disabled || value.length === 1}
        aria-label={t("providers.form.removeModel")} onClick={() => remove(index)} />
    </div>)}
    <Button className="provider-model-add" icon={<Plus size={14} />} disabled={disabled} onClick={add}>
      {t("providers.form.addModel")}
    </Button>
  </div>;
}
