import type { Language } from "../../i18n";
import { formatEstimatedCost, type TokenCostDisplaySettings } from "../../utils/tokenCost";
import { formatCompactTokenCount } from "../../utils/tokenContext";
import type { ConcurrentUsageSummary } from "./concurrentUsageSummary";

const COPY = {
  en: {
    accountCount: "Concurrent accounts",
    estimatedCost: "Today's estimated cost",
    title: "Concurrent summary",
    totalTokens: "Today's total Token usage",
  },
  zh: {
    accountCount: "并发账户数",
    estimatedCost: "今日总预估成本",
    title: "并发汇总",
    totalTokens: "今日总 Token 消耗",
  },
};

export function ConcurrentUsageCard({
  display,
  language,
  summary,
}: {
  display: TokenCostDisplaySettings;
  language: Language;
  summary: ConcurrentUsageSummary;
}) {
  const copy = COPY[language];
  return <span className="floating-concurrent-details">
    <span className="floating-concurrent-heading">
      <strong>{copy.title}</strong>
      <i aria-hidden="true" />
    </span>
    <span className="floating-concurrent-stats">
      <span>
        <small>{copy.totalTokens}</small>
        <strong>{formatCompactTokenCount(summary.totalTokens, language)}</strong>
      </span>
      <span>
        <small>{copy.estimatedCost}</small>
        <strong>{formatEstimatedCost(summary.estimatedCost, display)}</strong>
      </span>
      <span>
        <small>{copy.accountCount}</small>
        <strong>{summary.accountCount}</strong>
      </span>
    </span>
  </span>;
}
