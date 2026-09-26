import { useEffect, useState } from "react";
import { Switch, Tooltip } from "antd";
import { useUsageStatus } from "./useUsageStatus";
import { ContextUsageButton } from "./ContextUsageButton";
import { ContextSettingsDialog } from "./ContextSettingsDialog";
import type { ThreadTokenUsage } from "./types";
import styles from "./UsageStatus.module.less";
import { formatTokens, formatCost, usageTrailing } from "../../../../../shared/remote-chat/usage";

const TOOLTIP_STYLES = {
  root: { maxWidth: 400 },
  body: { fontSize: 12, lineHeight: "18px", padding: "6px 8px", overflowWrap: "anywhere" },
} as const;
type UsageHint = "context" | "tokens" | "cost" | "remaining" | "speed";

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
export function UsageStatus({ active, threadId, tokenUsage }: {
  active: boolean; threadId?: string | null; tokenUsage?: ThreadTokenUsage;
}) {
  const { usage, proxy, saving, error, setFastMode, canChangeFastMode } = useUsageStatus(active);
  const [hint, setHint] = useState<UsageHint | null>(null);
  const [settingsThread, setSettingsThread] = useState<string | null>(null);
  const trailing = usageTrailing(usage);
  const pendingDescription = error || "正在读取今日用量…";
  useEffect(() => {
    if (!active || (hint === "remaining" && !trailing)) setHint(null);
  }, [active, hint, trailing]);
  useEffect(() => { setHint(null); }, [threadId]);
  useEffect(() => { setSettingsThread(null); }, [threadId, active]);
  const changeHint = (key: UsageHint, open: boolean) => {
    setHint((current) => {
      if (open) return key;
      return current === key ? null : current;
    });
  };
  const speedHint = canChangeFastMode === false ? "请在主机上切换快速模式" : !proxy ? "正在读取速度设置…"
    : proxy.fastModeAvailable ? "仅影响 Codex GUI 的新请求" : "当前模型暂不支持快速模式";
  return <div className={styles.status} onKeyDown={(event) => {
    if (event.key === "Escape" && hint) { event.stopPropagation(); setHint(null); }
  }}>
    <span className={styles.usage} role="group" aria-label="今日用量">
      <ContextUsageButton threadId={threadId} usage={tokenUsage} open={active && hint === "context"}
        onSettings={threadId ? () => { setHint(null); setSettingsThread(threadId); } : undefined}
        onOpenChange={(open) => changeHint("context", open)} />
      <span>今日</span>
      <UsageValue className={styles.tokens} text={usage ? formatTokens(usage.totalTokens) : "—"}
        open={active && hint === "tokens"} onOpenChange={(open) => changeHint("tokens", open)}
        description={usage ? `今日 Token 用量：${usage.totalTokens.toLocaleString("en-US")}` : pendingDescription} />
      <span>·</span>
      <UsageValue className={styles.cost} text={usage ? formatCost(usage.estimatedCostUsd) : "—"}
        open={active && hint === "cost"} onOpenChange={(open) => changeHint("cost", open)}
        description={usage ? `今日预估费用：${formatCost(usage.estimatedCostUsd)}` : pendingDescription} />
      {trailing && <><span>·</span>
        <UsageValue className={styles[trailing.tone]} text={trailing.text} description={trailing.description}
          open={active && hint === "remaining"} onOpenChange={(open) => changeHint("remaining", open)} />
      </>}
    </span>
    <Tooltip title={error || speedHint} styles={tooltipStyles(active && hint === "speed")}
      fresh trigger={["hover", "focus"]}
      mouseLeaveDelay={0} open={active && hint === "speed"} onOpenChange={(open) => changeHint("speed", open)}>
      <label className={styles.speed}><span>快速模式</span>
        <Switch size="small" aria-label="快速模式" checked={proxy?.fastModeEnabled ?? false} loading={saving}
          disabled={canChangeFastMode === false || !proxy || (!proxy.fastModeEnabled && !proxy.fastModeAvailable)}
          onChange={(enabled) => void setFastMode(enabled)} />
      </label>
    </Tooltip>
    {active && settingsThread && settingsThread === threadId && <ContextSettingsDialog key={settingsThread}
      threadId={settingsThread} onClose={() => setSettingsThread(null)} />}
  </div>;
}
