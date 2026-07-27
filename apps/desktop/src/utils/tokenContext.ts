import type { Language } from "../i18n";

export function formatCompactTokenCount(value: number, language: Language) {
  const locale = language === "zh" ? "zh-CN" : "en-US";
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000)}K`;
  }
  return new Intl.NumberFormat(locale).format(value);
}
