import { Tag, Tooltip } from "antd";
import type { Translate } from "../../i18n";
import type { ProxySession, ProxySessionRequest } from "../../types";
import styles from "./index.module.less";

export function formatTokens(value: number) {
  const compact = (divisor: number, suffix: string) => {
    const scaled = value / divisor;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)}${suffix}`;
  };
  if (value >= 1_000_000) return compact(1_000_000, "M");
  if (value >= 1_000) return compact(1_000, "K");
  return String(value);
}

export function shortSessionId(id: string) {
  if (id.length <= 20) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

export function maskEmail(value?: string | null) {
  if (!value) return "";
  const [local, domain] = value.split("@");
  if (!domain) return value;
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}${local.length > visible.length ? "•••" : ""}@${domain}`;
}

export function formatResponseTime(value: number) {
  return `${(value / 1_000).toFixed(1)}s`;
}

export function SessionTokenChart({ session, t }: { session: ProxySession; t: Translate }) {
  const values = [
    session.inputTokens,
    session.outputTokens,
    session.reasoningTokens,
    session.cachedTokens,
  ];
  const labels = [
    t("tokenUsage.input"),
    t("tokenUsage.output"),
    t("tokenUsage.reasoning"),
    t("tokenUsage.cached"),
  ];
  const maximum = Math.max(...values, 1);
  const tooltip = (
    <div className="compact-token-tooltip">
      <strong>{t("providers.proxy.sessionsTokensTooltip")}</strong>
      {values.map((value, index) => (
        <span key={labels[index]}>
          <i className={`token-type-${index}`} />
          {labels[index]}
          <b>{formatTokens(value)}</b>
        </span>
      ))}
    </div>
  );
  return (
    <Tooltip title={tooltip} placement="top" styles={{ root: { maxWidth: 400 } }}>
      <div className={styles.compactModelTokenChart} role="img"
        aria-label={t("providers.proxy.sessionsTokensAria", {
          tokens: formatTokens(session.totalTokens),
        })}>
        <span>{t("providers.proxy.sessionsTokensCaption")}</span>
        <svg viewBox="0 0 48 26" aria-hidden="true">
          {values.map((value, index) => {
            const height = value > 0 ? Math.max(3, Math.round((value / maximum) * 22)) : 2;
            return <rect key={labels[index]} className={`token-type-${index}`}
              x={index * 12 + 2} y={24 - height} width="8" height={height} rx="2" />;
          })}
        </svg>
        <small>{formatTokens(session.totalTokens)}</small>
      </div>
    </Tooltip>
  );
}

export function RequestTokenUsage({ request, t }: { request: ProxySessionRequest; t: Translate }) {
  if (request.totalTokens == null) {
    return (
      <span className={styles.muted}>
        {request.responseTimeMs == null && !request.interrupted
          ? t("providers.proxy.sessionsRequestTokensCalculating")
          : t("providers.proxy.sessionsRequestUnknown")}
      </span>
    );
  }
  const values = [
    request.inputTokens,
    request.outputTokens,
    request.reasoningTokens,
    request.cachedTokens,
  ];
  const labels = [
    t("tokenUsage.input"),
    t("tokenUsage.output"),
    t("tokenUsage.reasoning"),
    t("tokenUsage.cached"),
  ];
  const tooltip = (
    <div className="compact-token-tooltip">
      <strong>{t("providers.proxy.sessionsRequestTokensTooltip")}</strong>
      {values.map((value, index) => (
        <span key={labels[index]}>
          <i className={`token-type-${index}`} />
          {labels[index]}
          <b>{value == null ? "—" : formatTokens(value)}</b>
        </span>
      ))}
    </div>
  );
  return (
    <Tooltip title={tooltip} placement="top" styles={{ root: { maxWidth: 400 } }}>
      <strong className={styles.requestTokens}>{formatTokens(request.totalTokens)}</strong>
    </Tooltip>
  );
}

export function RequestSpeed({ serviceTier, t }: {
  serviceTier?: ProxySessionRequest["serviceTier"];
  t: Translate;
}) {
  if (serviceTier === "priority") {
    return <Tag color="orange">{t("providers.proxy.sessionsRequestSpeedFast")}</Tag>;
  }
  if (serviceTier === "default") {
    return <Tag>{t("providers.proxy.sessionsRequestSpeedStandard")}</Tag>;
  }
  return <span className={styles.muted}>{t("providers.proxy.sessionsRequestUnknown")}</span>;
}
