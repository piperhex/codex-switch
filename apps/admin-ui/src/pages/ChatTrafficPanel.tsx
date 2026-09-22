import { useMemo, useState } from "react";
import { Select, Skeleton } from "antd";
import { EChart } from "../components/charts/EChart";
import type { ChatTrafficOverview } from "../chat-traffic-types";
import { useI18n } from "../i18n-context";
import { chatTrafficChart, formatTrafficBytes } from "./chat-traffic-chart";
import "./chat-traffic.css";

interface ChatTrafficPanelProps {
  data?: ChatTrafficOverview;
  dark: boolean;
  loading: boolean;
}

const EMPTY_DAYS: ChatTrafficOverview["daily"] = [];
const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

export function ChatTrafficPanel({ data, dark, loading }: ChatTrafficPanelProps) {
  const { language, t } = useI18n();
  const [selectedDate, setSelectedDate] = useState<string>();
  const daily = data?.daily ?? EMPTY_DAYS;
  const selected = daily.find((day) => day.date === selectedDate) ?? daily[daily.length - 1];
  const periodBytes = daily.reduce((total, day) => total + day.bytes, 0);
  const waiting = loading && !data;
  const dailyOption = useMemo(() => chatTrafficChart({
    labels: daily.map((day) => day.date), bytes: daily.map((day) => day.bytes),
    title: t("dashboard.chatTrafficDaily"), dark, language,
  }), [daily, dark, language, t]);
  const hourlyOption = useMemo(() => chatTrafficChart({
    labels: HOUR_LABELS, bytes: selected?.hourlyBytes ?? HOUR_LABELS.map(() => 0),
    title: t("dashboard.chatTrafficHourly"), dark, language,
  }), [selected, dark, language, t]);
  const metrics = [
    { label: t("dashboard.chatTrafficTotal"), bytes: data?.totalBytes ?? 0 },
    { label: t("dashboard.chatTrafficPeriod"), bytes: periodBytes },
    { label: t("dashboard.chatTrafficSelectedDay", { date: selected?.date ?? "—" }), bytes: selected?.bytes ?? 0 },
  ];

  return (
    <article className="dashboard-panel chat-traffic-panel">
      <div className="dashboard-panel-heading">
        <div>
          <h2>{t("dashboard.chatTraffic")}</h2>
          <span>{t("dashboard.chatTrafficNote")}</span>
        </div>
      </div>
      <div className="chat-traffic-summary">
        {metrics.map((metric) => <div key={metric.label}>
          <span>{metric.label}</span>
          {waiting ? <Skeleton.Input active size="small" /> : <strong>
            {data ? formatTrafficBytes(metric.bytes, language) : "—"}
          </strong>}
        </div>)}
      </div>
      <div className="chat-traffic-charts">
        <section>
          <div className="chat-traffic-chart-heading">
            <h3>{t("dashboard.chatTrafficDaily")}</h3>
            <span>{daily[0]?.date ?? "—"} → {daily[daily.length - 1]?.date ?? "—"}</span>
          </div>
          {waiting ? <Skeleton active /> : <EChart
            className="dashboard-chart" dark={dark} option={dailyOption}
            ariaLabel={t("dashboard.chatTrafficDaily")}
          />}
        </section>
        <section>
          <div className="chat-traffic-chart-heading">
            <h3>{t("dashboard.chatTrafficHourly")}</h3>
            <Select
              aria-label={t("dashboard.chatTrafficDate")}
              value={selected?.date}
              onChange={setSelectedDate}
              disabled={!daily.length || loading}
              popupMatchSelectWidth={280}
              options={[...daily].reverse().map((day) => ({
                value: day.date, label: `${day.date} · ${formatTrafficBytes(day.bytes, language)}`,
              }))}
            />
          </div>
          {waiting ? <Skeleton active /> : <EChart
            className="dashboard-chart" dark={dark} option={hourlyOption}
            ariaLabel={t("dashboard.chatTrafficHourlyAria", { date: selected?.date ?? "—" })}
          />}
        </section>
      </div>
    </article>
  );
}
