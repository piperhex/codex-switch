import { guiText } from "../../i18n/guiText";
import { useId } from "react";
import { Popover } from "antd";
import { Settings } from "lucide-react";
import { formatCompactTokenCount } from "../../utils/tokenContext";
import type { ThreadTokenUsage } from "./types";
import { contextUsage, FULL_PERCENT } from "./contextUsage";
import styles from "./ContextUsageButton.module.less";
import { ContextCapacityHint } from "./ContextCapacityHint";

export function ContextUsageButton({ usage, open, onOpenChange, onSettings, threadId }: {
  usage?: ThreadTokenUsage; open: boolean; onOpenChange: (open: boolean) => void;
  onSettings?: () => void;
  threadId?: string | null;
}) {
  const id = useId();
  const context = contextUsage(usage);
  const percent = context?.percent;
  const content = <div id={id} className={styles.content}>
    <div className={styles.heading}><span>{guiText("背景信息窗口")}</span>
      <button type="button" className={styles.button} aria-label={guiText("设置当前对话的上下文容量")}
        disabled={!onSettings} onClick={onSettings}>
        <Settings size={14} aria-hidden="true" />
      </button>
    </div>
    {!onSettings && <div className={styles.hint}>{guiText("选择对话后可设置容量")}</div>}
    {context ? <>
      <div>{percent != null ? guiText("{value1}% 已用（剩余 {value2}%）", { value1: percent, value2: FULL_PERCENT - percent }) : guiText("上下文容量未知")}</div>
      <div>{guiText("已用")} {formatCompactTokenCount(context.used, "zh")} Token
        {context.capacity !== null && guiText("，共 {value1}", { value1: formatCompactTokenCount(context.capacity, "zh") })}</div>
    </> : <div>{guiText("暂无上下文用量")}</div>}
    <ContextCapacityHint threadId={threadId} open={open} />
  </div>;
  return <Popover content={content} fresh trigger="click" placement="top" arrow={false}
    open={open} onOpenChange={onOpenChange}
    styles={{ root: { maxWidth: "min(400px, calc(100vw - 24px))", visibility: open ? "visible" : "hidden" },
      body: { padding: "6px 10px", borderRadius: 12 } }}>
    <button type="button" className={styles.button} aria-label={guiText("查看上下文用量")} aria-expanded={open}
      aria-describedby={open ? id : undefined}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle className={styles.track} cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" />
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" pathLength={FULL_PERCENT}
          strokeDasharray={`${percent ?? 0} ${FULL_PERCENT}`} transform="rotate(-90 8 8)" />
      </svg>
    </button>
  </Popover>;
}
