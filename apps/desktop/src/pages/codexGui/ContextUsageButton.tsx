import { useId } from "react";
import { Popover } from "antd";
import { formatCompactTokenCount } from "../../utils/tokenContext";
import type { ThreadTokenUsage } from "./types";
import styles from "./ContextUsageButton.module.less";

const FULL_PERCENT = 100;

function contextUsage(usage?: ThreadTokenUsage) {
  const used = usage?.last.totalTokens;
  const total = usage?.modelContextWindow;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return null;
  const capacity = typeof total === "number" && Number.isFinite(total) && total > 0 ? total : null;
  const percent = capacity === null ? null : Math.min(FULL_PERCENT, Math.round(used / capacity * FULL_PERCENT));
  return { used, capacity, percent };
}

export function ContextUsageButton({ usage, open, onOpenChange }: {
  usage?: ThreadTokenUsage; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const context = contextUsage(usage);
  const percent = context?.percent;
  const content = <div id={id} className={styles.content}>
    <div className={styles.heading}>背景信息窗口：</div>
    {context ? <>
      <div>{percent != null ? `${percent}% 已用（剩余 ${FULL_PERCENT - percent}%）` : "上下文容量未知"}</div>
      <div>已用 {formatCompactTokenCount(context.used, "zh")} Token
        {context.capacity !== null && `，共 ${formatCompactTokenCount(context.capacity, "zh")}`}</div>
    </> : <div>暂无上下文用量</div>}
  </div>;
  return <Popover content={content} trigger="click" placement="top" arrow={false}
    open={open} onOpenChange={onOpenChange}
    styles={{ root: { maxWidth: "min(400px, calc(100vw - 24px))", visibility: open ? "visible" : "hidden" },
      body: { padding: "6px 10px", borderRadius: 12 } }}>
    <button type="button" className={styles.button} aria-label="查看上下文用量" aria-expanded={open}
      aria-describedby={open ? id : undefined}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle className={styles.track} cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" />
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" pathLength={FULL_PERCENT}
          strokeDasharray={`${percent ?? 0} ${FULL_PERCENT}`} transform="rotate(-90 8 8)" />
      </svg>
    </button>
  </Popover>;
}
