import { Switch, Tooltip } from "antd";
import { useUsageStatus } from "./useUsageStatus";
import styles from "./UsageStatus.module.less";

const MILLION = 1_000_000;
const THOUSAND = 1_000;
const LOW_QUOTA_PERCENT = 20;
const WARNING_QUOTA_PERCENT = 50;
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
  const { usage, proxy, saving, error, setFastMode } = useUsageStatus(active);
  const remaining = usage?.primaryRemainingPercent;
  const estimate = usage?.providerEstimatedCost;
  const hasQuota = typeof remaining === "number" && Number.isFinite(remaining);
  const trailing = hasQuota ? `${Math.round(remaining)}%` : estimate ? `API ${formatCost(estimate.amountUsd)}` : null;
  const quotaLabel = usage?.primaryRemainingAggregated ? "并发账户剩余额度合计" : "当前账户剩余额度";
  const trailingLabel = hasQuota ? quotaLabel : "当前 API 今日预估费用";
  const trailingClass = quotaColor(remaining);
  const speedHint = !proxy?.running ? "开启本地代理后可使用快速模式"
    : proxy.fastModeAvailable ? "切换后对新请求生效" : "当前模型暂不支持快速模式";
  return <div className={styles.status}>
    <Tooltip title={error || <div>今日 Token 用量与预估费用
      {trailing && <div>{trailingLabel}：{trailing}</div>}</div>} styles={{ root: { maxWidth: 400 } }}>
      <span className={styles.usage} aria-label={error || "今日用量"}>
        <span>今日</span>
        <strong className={styles.tokens}>{usage ? formatTokens(usage.totalTokens) : "—"}</strong>
        <span>·</span><strong className={styles.cost}>{usage ? formatCost(usage.estimatedCostUsd) : "—"}</strong>
        {trailing && <><span>·</span><strong className={trailingClass}>{trailing}</strong></>}
      </span>
    </Tooltip>
    <Tooltip title={error || speedHint} styles={{ root: { maxWidth: 400 } }}>
      <label className={styles.speed}><span>快速模式</span>
        <Switch size="small" aria-label="快速模式" checked={proxy?.fastModeEnabled ?? false} loading={saving}
          disabled={!proxy?.running || (!proxy.fastModeEnabled && !proxy.fastModeAvailable)}
          onChange={(enabled) => void setFastMode(enabled)} />
      </label>
    </Tooltip>
  </div>;
}
