import { Button } from "antd";
import { CalendarClock, RefreshCw } from "lucide-react";
import type { ResetCreditsSummary } from "../../types";
import { formatBeijingTime } from "../../utils/format";

export type ResetCreditsLoadState =
  | { status: "loading" }
  | { status: "loaded"; data: ResetCreditsSummary }
  | { status: "error"; error: string };

export function ResetCreditsPanel({ state, onRetry }: {
  state?: ResetCreditsLoadState;
  onRetry: () => void;
}) {
  if (!state || state.status === "loading") {
    return <div className="reset-credits-status"><RefreshCw className="spin" size={16} />正在读取重置卡…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="reset-credits-status reset-credits-error">
        <span>{state.error}</span>
        <Button size="small" icon={<RefreshCw size={13} />} onClick={onRetry}>重试</Button>
      </div>
    );
  }
  if (!state.data.credits.length) {
    return <div className="reset-credits-status">当前账号没有重置卡</div>;
  }
  return (
    <div className="reset-credits-panel">
      {state.data.credits.map((credit, index) => (
        <div className="reset-credit" key={`${credit.issuedAt ?? "unknown"}-${credit.expiresAt ?? "unknown"}-${index}`}>
          <div className="reset-credit-index"><CalendarClock size={16} />重置卡 {index + 1}</div>
          <dl>
            <div><dt>发放时间</dt><dd>{formatBeijingTime(credit.issuedAt)} <span>北京时间</span></dd></div>
            <div><dt>过期时间</dt><dd>{formatBeijingTime(credit.expiresAt)} <span>北京时间</span></dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}
