import type { Language } from "../i18n";
import { formatCompactTokenCount } from "../utils/tokenContext";

export interface TokenTypeTotals {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cached: number;
}

export const EMPTY_TOKEN_TOTALS: TokenTypeTotals = {
  total: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  cached: 0,
};

export function DailyTokenUsageTooltip({ totals, language }: {
  totals: TokenTypeTotals;
  language: Language;
}) {
  const labels = language === "zh"
    ? {
      title: "今日 Token 用量",
      input: "输入",
      output: "输出",
      reasoning: "推理",
      cached: "缓存",
    }
    : {
      title: "Today's Token usage",
      input: "Input",
      output: "Output",
      reasoning: "Reasoning",
      cached: "Cached",
    };
  const values = [totals.input, totals.output, totals.reasoning, totals.cached];

  return (
    <div className="compact-token-tooltip">
      <strong>{labels.title}</strong>
      {values.map((value, index) => (
        <span key={index}>
          <i className={`token-type-${index}`} />
          {([labels.input, labels.output, labels.reasoning, labels.cached] as const)[index]}
          <b>{formatCompactTokenCount(value, language)}</b>
        </span>
      ))}
    </div>
  );
}
