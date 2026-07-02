import { useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { dragFloatingBubble, loadDashboard, resizeFloatingBubble, subscribeToBackendEvents } from "../api/backend";
import { useLanguage } from "../hooks/useLanguage";
import type { Account, UsageWindow } from "../types";
import { formatUpdated, remainingTone, resetLabel } from "../utils/format";

function usageColor(remaining: number) {
  const tone = remainingTone(remaining);
  if (tone === "danger") return "#ef6b62";
  if (tone === "warning") return "#e5b84f";
  return "#35d05b";
}

function DetailRow({ label, usage, language }: {
  label: string;
  usage?: UsageWindow | null;
  language: "en" | "zh";
}) {
  if (!usage) {
    return <div className="bubble-detail-row"><b>{label}</b><span>--</span></div>;
  }
  const used = Math.round(usage.usedPercent);
  const remaining = Math.round(usage.remainingPercent);
  return (
    <div className="bubble-detail-row">
      <b>{label}</b>
      <span>{language === "zh" ? `已用 ${used}% · 剩余 ${remaining}%` : `${used}% used · ${remaining}% left`}</span>
      <small>{resetLabel(usage.resetsAt, language)}</small>
    </div>
  );
}

export function FloatingUsageBubble() {
  const { language } = useLanguage();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(() => {
    void loadDashboard().then(({ accounts: nextAccounts }) => setAccounts(nextAccounts));
  }, []);

  useEffect(() => {
    load();
    return subscribeToBackendEvents(load, load);
  }, [load]);

  const account = useMemo(() => accounts.find((item) => item.active), [accounts]);
  const primary = account?.usage.primary;
  const remaining = primary ? Math.round(primary.remainingPercent) : null;
  const ringStyle = {
    "--bubble-progress": `${remaining ?? 0}%`,
    "--bubble-color": remaining === null ? "#7b8780" : usageColor(remaining),
  } as CSSProperties;

  const setHover = (nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    void resizeFloatingBubble(nextExpanded);
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setExpanded(false);
    void resizeFloatingBubble(false).then(dragFloatingBubble);
  };

  return (
    <div className={`floating-usage-window ${expanded ? "is-expanded" : ""}`}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      {expanded && (
        <aside className="bubble-details">
          <header>
            <span>{language === "zh" ? "当前账号" : "Current account"}</span>
            <strong title={account?.email}>{account?.email ?? (language === "zh" ? "暂无账号" : "No account")}</strong>
            {account && <small>{account.plan}</small>}
          </header>
          <DetailRow label="5h" usage={primary} language={language} />
          <DetailRow label={language === "zh" ? "1 周" : "1 week"} usage={account?.usage.secondary} language={language} />
          <footer>{language === "zh" ? "更新于 " : "Updated "}{formatUpdated(account?.usage.fetchedAt, language)}</footer>
        </aside>
      )}
      <button type="button" className="floating-bubble" style={ringStyle}
        aria-label={language === "zh" ? "当前账号 5 小时用量" : "Current account 5-hour usage"}
        onPointerDown={startDrag}>
        <span className="floating-bubble-value">{remaining === null ? "--" : `${remaining}%`}</span>
        <small>{language === "zh" ? "5h 剩余" : "5h left"}</small>
      </button>
    </div>
  );
}
