import { useEffect, useState } from "react";
import { Switch, Tooltip } from "antd";
import { useUsageStatus } from "./useUsageStatus";
import styles from "./UsageStatus.module.less";

const MILLION = 1_000_000;
const THOUSAND = 1_000;
const LOW_QUOTA_PERCENT = 20;
const WARNING_QUOTA_PERCENT = 50;
const TOOLTIP_STYLES = {
  root: { maxWidth: 400 },
  body: { fontSize: 12, lineHeight: "18px", padding: "6px 8px", overflowWrap: "anywhere" },
} as const;
type UsageHint = "tokens" | "cost" | "remaining" | "speed";

function tooltipStyles(open: boolean) {
  // Closing animations must not overlap the next hovered or focused value's tooltip.
  return { ...TOOLTIP_STYLES, root: { ...TOOLTIP_STYLES.root, visibility: open ? "visible" : "hidden" } } as const;
}

function UsageValue({ text, description, className, open, onOpenChange }: {
  text: string; description: string; className: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  return <Tooltip title={description} fresh trigger={["hover", "focus"]} styles={tooltipStyles(open)}
    mouseLeaveDelay={0} open={open} onOpenChange={onOpenChange}>
    <strong className={`${styles.value} ${className}`} tabIndex={0}>{text}</strong>
  </Tooltip>;
}
function formatTokens(value: number) {
  if (value >= MILLION) return `${(value / MILLION).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (value >= THOUSAND) return `${(value / THOUSAND).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return value.toLocaleString("en-US");
}
function formatCost(value: number) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2 })}USD`;
}

function quotaColor(remaining: number | null | undefined) {
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) return styles.cost;
  if (remaining <= LOW_QUOTA_PERCENT) return styles.low;
  return remaining <= WARNING_QUOTA_PERCENT ? styles.cost : styles.quota;
}

export function UsageStatus({ active }: { active: boolean }) {
  const { usage, proxy, saving, error, setFastMode, canChangeFastMode } = useUsageStatus(active);
  const [hint, setHint] = useState<UsageHint | null>(null);
  const remaining = usage?.primaryRemainingPercent;
  const estimate = usage?.providerEstimatedCost;
  const hasQuota = typeof remaining === "number" && Number.isFinite(remaining);
  const trailing = hasQuota ? `${Math.round(remaining)}%` : estimate ? `API ${formatCost(estimate.amountUsd)}` : null;
  const quotaLabel = usage?.primaryRemainingAggregated ? "并发账户剩余额度合计" : "当前账户剩余额度";
  const costLabel = estimate?.aggregated ? "聚合 API 今日预估费用" : "当前 API 今日预估费用";
  const trailingDescription = hasQuota
    ? `${quotaLabel}：${remaining.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`
    : `${costLabel}：${formatCost(estimate?.amountUsd ?? 0)}`;
  const trailingClass = quotaColor(remaining);
  const pendingDescription = error || "正在读取今日用量…";
  useEffect(() => {
    if (!active || (hint === "remaining" && !trailing)) setHint(null);
  }, [active, hint, trailing]);
  const changeHint = (key: UsageHint, open: boolean) => {
    setHint((current) => {
      if (open) return key;
      return current === key ? null : current;
    });
  };
  const speedHint = canChangeFastMode === false ? "请在主机上切换快速模式" : !proxy?.running ? "开启本地代理后可使用快速模式"
    : proxy.fastModeAvailable ? "切换后对新请求生效" : "当前模型暂不支持快速模式";
  return <div className={styles.status} onKeyDown={(event) => {
    if (event.key === "Escape" && hint) { event.stopPropagation(); setHint(null); }
  }}>
    <span className={styles.usage} role="group" aria-label="今日用量">
      <span>今日</span>
      <UsageValue className={styles.tokens} text={usage ? formatTokens(usage.totalTokens) : "—"}
        open={active && hint === "tokens"} onOpenChange={(open) => changeHint("tokens", open)}
        description={usage ? `今日 Token 用量：${usage.totalTokens.toLocaleString("en-US")}` : pendingDescription} />
      <span>·</span>
      <UsageValue className={styles.cost} text={usage ? formatCost(usage.estimatedCostUsd) : "—"}
        open={active && hint === "cost"} onOpenChange={(open) => changeHint("cost", open)}
        description={usage ? `今日预估费用：${formatCost(usage.estimatedCostUsd)}` : pendingDescription} />
      {trailing && <><span>·</span>
        <UsageValue className={trailingClass} text={trailing} description={trailingDescription}
          open={active && hint === "remaining"} onOpenChange={(open) => changeHint("remaining", open)} />
      </>}
    </span>
    <Tooltip title={error || speedHint} styles={tooltipStyles(active && hint === "speed")}
      fresh trigger={["hover", "focus"]}
      mouseLeaveDelay={0} open={active && hint === "speed"} onOpenChange={(open) => changeHint("speed", open)}>
      <label className={styles.speed}><span>快速模式</span>
        <Switch size="small" aria-label="快速模式" checked={proxy?.fastModeEnabled ?? false} loading={saving}
          disabled={canChangeFastMode === false || !proxy?.running || (!proxy.fastModeEnabled && !proxy.fastModeAvailable)}
          onChange={(enabled) => void setFastMode(enabled)} />
      </label>
    </Tooltip>
  </div>;
}
