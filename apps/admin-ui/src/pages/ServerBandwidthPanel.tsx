import { useMemo } from "react";
import { Alert, Button, Skeleton, Tag } from "antd";
import { RefreshCw } from "lucide-react";
import type { TrafficApi } from "../chat-traffic-types";
import { EChart } from "../components/charts/EChart";
import { useServerBandwidth } from "../hooks/useServerBandwidth";
import { useI18n } from "../i18n-context";
import { formatBandwidthBytes, serverBandwidthChart } from "./server-bandwidth";
import "./server-bandwidth.css";

export function ServerBandwidthPanel({ api, dark }: { api: TrafficApi; dark: boolean }) {
  const { language, t } = useI18n();
  const { data, loading, error, refresh } = useServerBandwidth(api);
  const waiting = !data && !error;
  const option = useMemo(() => serverBandwidthChart({
    history: data?.history ?? [], dark, language, title: t("dashboard.bandwidthRate"),
  }), [data, dark, language, t]);
  const metrics = [
    { label: t("dashboard.bandwidthRate"), bytes: data?.bytesPerSecond, rate: true },
    { label: t("dashboard.bandwidthPeak"), bytes: data?.peakBytesPerSecond, rate: true },
    { label: t("dashboard.bandwidthRecent"), bytes: data?.recentBytes, rate: false },
  ];

  return (
    <article className="dashboard-panel server-bandwidth-panel">
      <div className="dashboard-panel-heading">
        <div>
          <h2>{t("dashboard.bandwidthTitle")}</h2>
          <span>{t("dashboard.bandwidthDescription")}</span>
        </div>
        <div className="server-bandwidth-controls">
          <Tag color={error ? "warning" : "processing"}>
            {t(error ? "dashboard.bandwidthPaused" : "dashboard.bandwidthLive")}
          </Tag>
          <Button
            size="small" loading={loading} icon={<RefreshCw size={14} />}
            onClick={() => void refresh()} aria-label={t("dashboard.bandwidthRefresh")}
          >{t("common.refresh")}</Button>
        </div>
      </div>
      <div className="server-bandwidth-metrics">
        {metrics.map((metric) => <div key={metric.label}>
          <span>{metric.label}</span>
          {waiting ? <Skeleton.Input active size="small" /> : <strong>
            {error || metric.bytes === undefined ? "—"
              : `${formatBandwidthBytes(metric.bytes, language)}${metric.rate ? "/s" : ""}`}
          </strong>}
        </div>)}
      </div>
      {error && <Alert type="warning" showIcon message={t("dashboard.bandwidthError")} />}
      {waiting && <Skeleton active paragraph={{ rows: 3 }} />}
      {!waiting && !error && <EChart
        className="dashboard-chart server-bandwidth-chart" dark={dark} option={option}
        ariaLabel={t("dashboard.bandwidthChart")}
      />}
      <p className="server-bandwidth-note">{t("dashboard.bandwidthNote")}</p>
    </article>
  );
}
