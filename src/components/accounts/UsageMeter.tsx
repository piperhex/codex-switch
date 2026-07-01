import { Progress } from "antd";
import type { UsageWindow } from "../../types";
import { remainingTone, resetLabel } from "../../utils/format";

function usageStroke(value: number) {
  const tone = remainingTone(value);
  if (tone === "danger") return "#d2685b";
  if (tone === "warning") return "#d0a340";
  return "#1f7a51";
}

export function UsageMeter({ window }: { window?: UsageWindow | null }) {
  if (!window) return <span className="usage-missing">--</span>;
  const remaining = Math.round(window.remainingPercent);
  const tone = remainingTone(remaining);
  return (
    <div className="table-usage">
      <div className="table-usage-head">
        <strong className={tone}>{remaining}%</strong>
        <span>剩余</span>
      </div>
      <Progress percent={remaining} showInfo={false} size="small" strokeColor={usageStroke(remaining)} />
      <span className="usage-reset">{resetLabel(window.resetsAt)}</span>
    </div>
  );
}
