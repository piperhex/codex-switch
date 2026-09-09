import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "antd";
import { Check, Hand, ShieldAlert, ShieldCheck } from "lucide-react";
import type { AccessMode } from "./types";
import styles from "./AccessPicker.module.less";

const ACCESS_OPTIONS = [
  { value: "read-only", label: "请求批准", icon: Hand,
    description: "编辑外部文件和使用互联网时始终询问" },
  { value: "workspace-write", label: "帮我批准", icon: ShieldCheck,
    description: "自动判断风险，帮你批准安全操作" },
  { value: "danger-full-access", label: "完全访问权限", icon: ShieldAlert,
    description: "可不受限制地访问互联网和你电脑上的任何文件" },
] satisfies { value: AccessMode; label: string; icon: typeof Hand; description: string }[];

function moveOptionFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"));
  const current = options.indexOf(document.activeElement as HTMLButtonElement);
  let next = (current + (event.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = options.length - 1;
  event.preventDefault();
  options[next]?.focus();
}

export function AccessPicker({ value, disabled, onChange }: {
  value: AccessMode; disabled: boolean; onChange: (access: AccessMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = ACCESS_OPTIONS.find((option) => option.value === value) ?? ACCESS_OPTIONS[1];
  const fullAccess = value === "danger-full-access";
  const Icon = selected.icon;
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const panel = <div className={styles.panel} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
  }}>
    <div className={styles.heading}>应如何批准 ChatGPT 操作？</div>
    <div role="menu" aria-label="访问权限" onKeyDown={moveOptionFocus}>
      {ACCESS_OPTIONS.map((option) => <button key={option.value} type="button" role="menuitemradio"
        className={`${styles.option} ${option.value === "danger-full-access" ? styles.fullAccess : ""}`}
        aria-checked={value === option.value} disabled={disabled}
        onClick={() => { if (!disabled) { onChange(option.value); close(); } }}>
        <option.icon size={16} aria-hidden="true" />
        <span className={styles.copy}><span>{option.label}</span><small>{option.description}</small></span>
        {value === option.value && <Check className={styles.check} size={16} aria-hidden="true" />}
      </button>)}
    </div>
  </div>;
  return <Popover trigger="click" placement="topLeft" arrow={false} open={open && !disabled}
    onOpenChange={setOpen} content={panel} styles={{ root: { maxWidth: 400 },
      body: { padding: 0, borderRadius: 12, overflow: "hidden" } }}>
    <button ref={trigger} type="button" disabled={disabled}
      onKeyDown={(event) => { if (event.key === "Escape") close(); }}
      className={`${styles.trigger} ${fullAccess ? styles.fullAccess : ""}`}
      aria-haspopup="menu" aria-expanded={open && !disabled} aria-label={`访问权限：${selected.label}`}>
      <Icon size={16} aria-hidden="true" /><span>{fullAccess ? "完全访问" : selected.label}</span>
    </button>
  </Popover>;
}
