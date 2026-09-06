import { useEffect, useRef, useState } from "react";
import { AutoComplete, Input, Select } from "antd";
import { optionLabel, stringSuggestions } from "./labels";
import { schemaType, type ConfigSchema, type ConfigValue } from "./schema";
import styles from "./formStyles.module.less";

interface ConfigFieldInputProps {
  schema: ConfigSchema;
  value?: ConfigValue;
  fieldKey: string;
  label: string;
  disabled?: boolean;
  onCommit: (value: ConfigValue | null) => Promise<boolean>;
}

function validateNumber(text: string, schema: ConfigSchema): string | undefined {
  const value = Number(text);
  if (!text.trim() || !Number.isFinite(value)) return "请输入有效的数字。";
  if (schemaType(schema) === "integer" && !Number.isSafeInteger(value)) return "请输入可精确保存的整数。";
  if (schema.minimum !== undefined && value < schema.minimum) return `不能小于 ${schema.minimum}。`;
  if (schema.maximum !== undefined && value > schema.maximum) return `不能大于 ${schema.maximum}。`;
  return undefined;
}

function validateText(value: string, schema: ConfigSchema): string | undefined {
  if (schema.minLength !== undefined && value.length < schema.minLength) return `至少输入 ${schema.minLength} 个字符。`;
  if (schema.maxLength !== undefined && value.length > schema.maxLength) return `最多输入 ${schema.maxLength} 个字符。`;
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) return "输入内容不符合此配置项的格式。";
  return undefined;
}

function useConfigDraft({ schema, value, disabled, onCommit }: ConfigFieldInputProps) {
  const source = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(source);
  const [error, setError] = useState<string>();
  const dirty = useRef(false);
  const latest = useRef(draft);
  const inFlight = useRef<string>();
  const type = schemaType(schema, value);
  const numeric = type === "integer" || type === "number";
  useEffect(() => {
    if (!dirty.current || source === latest.current) {
      setDraft(source);
      latest.current = source;
      dirty.current = false;
    }
  }, [source]);
  const commit = async () => {
    if (!dirty.current || disabled) return;
    const submitted = latest.current;
    if (inFlight.current === submitted) return;
    const validation = numeric ? validateNumber(submitted, schema) : validateText(submitted, schema);
    if (validation && (!numeric || submitted !== "")) { setError(validation); return; }
    const replacement = numeric ? (submitted === "" ? null : Number(submitted)) : submitted;
    inFlight.current = submitted;
    const success = await onCommit(replacement);
    inFlight.current = undefined;
    if (success && latest.current === submitted) dirty.current = false;
    setError(success ? undefined : "未能保存，请检查提示后重试。");
  };
  const change = (next: string) => {
    dirty.current = true;
    latest.current = next;
    setDraft(next);
    setError(undefined);
  };
  return { draft, error, numeric, change, commit };
}

function DraftInput(props: ConfigFieldInputProps) {
  const { fieldKey, label, value, disabled } = props;
  const { draft, error, numeric, change, commit } = useConfigDraft(props);
  const shared = {
    value: draft, disabled, "aria-label": label, status: error ? "error" as const : undefined,
    placeholder: value === "" ? "空文本" : "使用默认值", onBlur: () => { void commit(); },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(event.target.value),
  };
  const multiline = /instructions|prompt|description/.test(fieldKey) || draft.includes("\n");
  const secret = /(?:^|_)(?:api_key|token|secret|password)$/.test(fieldKey);
  const suggestions = stringSuggestions(fieldKey);
  let input = <Input {...shared} inputMode={numeric ? "decimal" : undefined}
    onPressEnter={(event) => event.currentTarget.blur()} />;
  if (multiline) input = <Input.TextArea {...shared} autoSize={{ minRows: 3, maxRows: 10 }} />;
  else if (secret) input = <Input.Password {...shared} autoComplete="off" />;
  else if (suggestions.length) input = <AutoComplete value={draft} disabled={disabled} onChange={change}
    options={suggestions.map((item) => ({ value: item, label: optionLabel(item) }))}
    onSelect={(next) => { change(next); void commit(); }} onBlur={() => { void commit(); }}>
    <Input aria-label={label} placeholder="选择或输入自定义值" status={shared.status} />
  </AutoComplete>;
  return <div className={styles.inputWrap}>
    {input}
    {error && <span role="alert" className={styles.error}>{error}</span>}
  </div>;
}

function ChoiceInput(props: ConfigFieldInputProps) {
  const { schema, value, label, disabled, onCommit } = props;
  const [pending, setPending] = useState<{ value: string }>();
  const [error, setError] = useState(false);
  const boolean = schemaType(schema, value) === "boolean";
  const options = boolean ? [
    { value: "true", label: "开启" }, { value: "false", label: "关闭" },
  ] : (schema.enum ?? []).map((item) => ({ value: JSON.stringify(item), label: optionLabel(String(item)) }));
  const selected = value === undefined ? undefined : JSON.stringify(value);
  if (selected !== undefined && !options.some((option) => option.value === selected)) {
    options.push({ value: selected, label: String(value) });
  }
  const commit = async (next: string | undefined) => {
    setPending({ value: next ?? "" });
    const success = await onCommit(next === undefined ? null : JSON.parse(next) as ConfigValue);
    setPending(undefined);
    setError(!success);
  };
  return <div className={styles.inputWrap}>
    <Select allowClear aria-label={label} placeholder="使用默认值" options={options}
      className={styles.select} value={pending ? pending.value || undefined : selected}
      disabled={disabled || pending !== undefined} showSearch optionFilterProp="label"
      onChange={(next: string | undefined) => { void commit(next); }} />
    {error && <span role="alert" className={styles.error}>未能保存，请重试。</span>}
  </div>;
}

export function ConfigFieldInput(props: ConfigFieldInputProps) {
  if (props.schema.enum || schemaType(props.schema, props.value) === "boolean") return <ChoiceInput {...props} />;
  return <DraftInput {...props} />;
}
