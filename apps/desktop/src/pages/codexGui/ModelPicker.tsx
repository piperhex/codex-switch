import { useEffect, useState, type KeyboardEvent } from "react";
import { Button, Input, Popover, Tooltip } from "antd";
import { Check, ChevronLeft, ChevronRight, RotateCcw, Search } from "lucide-react";
import type { Model } from "./types";
import { resolveModelSelection, type ModelSelection } from "./modelSelection";
import styles from "./ModelPicker.module.less";
import { EFFORT_LABELS } from '../../../../../shared/remote-chat/composer';
const EFFORT_ORDER = Object.keys(EFFORT_LABELS);
const MODEL_SEARCH_THRESHOLD = 8;
interface ModelPickerProps extends ModelSelection {
  models: Model[];
  disabled: boolean;
  onChange: (selection: ModelSelection) => void;
}

function moveModelFocus(event: KeyboardEvent<HTMLDivElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"));
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next = (current + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = buttons.length - 1;
  event.preventDefault();
  buttons[next]?.focus();
}

function ModelList({ models, model, onSelect, onBack }: {
  models: Model[]; model: string; onSelect: (model: string) => void; onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const options = models.map((entry) => ({ value: entry.model, label: entry.displayName || entry.model }))
    .filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className={styles.models}>
    <button className={styles.listHeading} onClick={onBack} aria-label="返回推理强度设置">
      <ChevronLeft size={12} /><span>选择模型</span>
    </button>
    {models.length > MODEL_SEARCH_THRESHOLD && <Input size="small" className={styles.search}
      prefix={<Search size={12} />}
      placeholder="搜索模型" aria-label="搜索模型" value={query} allowClear
      onChange={(event) => setQuery(event.target.value)} />}
    <div className={styles.modelList} role="menu" aria-label="选择模型" onKeyDown={moveModelFocus}>
      {options.map((option) => <button key={option.value} type="button" role="menuitemradio"
        className={styles.modelOption} aria-checked={model === option.value}
        autoFocus={models.length <= MODEL_SEARCH_THRESHOLD && model === option.value}
        onClick={() => onSelect(option.value)}>
        <span>{option.label}</span>
        {model === option.value && <Check size={14} />}
      </button>)}
      {!options.length && <p className={styles.hint}>未找到模型</p>}
    </div>
  </div>;
}

export function ModelPicker(props: ModelPickerProps) {
  const { models, onChange } = props;
  const { model, effort } = resolveModelSelection(models, props);
  const disabled = props.disabled || !model;
  const [open, setOpen] = useState(false);
  const [choosingModel, setChoosingModel] = useState(false);
  const selected = models.find((entry) => entry.model === model);
  const modelLabel = selected?.displayName || model || "正在加载模型…";
  const effortLabel = EFFORT_LABELS[effort] || effort;
  const recommended = resolveModelSelection(models, { model, effort: "" });
  const levels = [...(selected?.supportedReasoningEfforts ?? [])].sort((left, right) =>
    EFFORT_ORDER.indexOf(left.reasoningEffort) - EFFORT_ORDER.indexOf(right.reasoningEffort));
  const index = Math.max(0, levels.findIndex((level) =>
    level.reasoningEffort === (effort || selected?.defaultReasoningEffort)));
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) setChoosingModel(false);
  };
  const selectModel = (value: string) => {
    onChange(resolveModelSelection(models, { model: value, effort: "" }));
    setChoosingModel(false);
  };
  const panel = <div className={styles.panel} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
  }}>
    {choosingModel ? <ModelList models={models} model={model} onSelect={selectModel}
      onBack={() => setChoosingModel(false)} /> : <div className={styles.reasoning}>
      <div className={styles.summary}>
        <button className={styles.modelHeading} onClick={() => setChoosingModel(true)} aria-label="选择模型">
          <span className={styles.effortName}>{effortLabel}<ChevronRight size={12} /></span>
          <span className={styles.modelName}>{modelLabel}</span>
        </button>
        <Tooltip title="恢复推荐推理强度" styles={{ root: { maxWidth: 400 } }}>
          <Button type="text" size="small" className={styles.reset} icon={<RotateCcw size={14} />}
            disabled={effort === recommended.effort} aria-label="恢复推荐推理强度"
            onClick={() => onChange(recommended)} />
        </Tooltip>
      </div>
      {levels.length > 0 ? <div className={styles.sliderWrap}>
        <input type="range" className={styles.slider} min={0} max={Math.max(1, levels.length - 1)} step={1}
          value={index} disabled={levels.length < 2} aria-label="推理强度"
          aria-valuetext={EFFORT_LABELS[levels[index].reasoningEffort] || levels[index].reasoningEffort}
          onChange={(event) => onChange({ model, effort: levels[Number(event.target.value)].reasoningEffort })} />
        <div className={styles.stops} aria-hidden="true">
          {levels.map((level) => <i key={level.reasoningEffort} />)}
        </div>
      </div> : <p className={styles.hint}>该模型不支持调整推理强度</p>}
    </div>}
  </div>;
  return <Popover trigger="click" placement="topRight" arrow={false} open={open && !disabled}
    onOpenChange={changeOpen} content={panel} styles={{ root: { maxWidth: 400 },
      body: { padding: 0, borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 16px rgb(0 0 0 / 8%)" } }}>
    <button type="button" className={styles.trigger} disabled={disabled} aria-expanded={open && !disabled}
      aria-label={`模型与推理强度：${modelLabel} ${effortLabel}`}>
      <span className={styles.triggerModel}>{modelLabel}</span>
      {effortLabel && <span className={styles.triggerEffort}>{effortLabel}</span>}
    </button>
  </Popover>;
}
