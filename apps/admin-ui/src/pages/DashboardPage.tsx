import { useMemo } from "react";
import { Button, Empty, Progress, Segmented, Skeleton, Tag, Typography } from "antd";
import type { EChartsCoreOption } from "echarts/core";
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  MessageSquareText,
  MonitorSmartphone,
  RefreshCw,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { EChart } from "../components/charts/EChart";
import { useI18n } from "../i18n-context";
import type { DashboardOverview, MenuKey, Permission, TelemetryPlatform } from "../types";

interface DashboardPageProps {
  data: DashboardOverview | null;
  days: 7 | 30 | 90;
  dark: boolean;
  loading: boolean;
  permissions: Permission[];
  onDaysChange: (days: 7 | 30 | 90) => void;
  onNavigate: (key: MenuKey) => void;
  onRefresh: () => void | Promise<void>;
}

const platformKeys: Record<TelemetryPlatform, string> = {
  windows: "telemetry.platform.windows",
  macos: "telemetry.platform.macos",
  linux: "telemetry.platform.linux",
  android: "telemetry.platform.android",
  ios: "telemetry.platform.ios",
};

export function DashboardPage({
  data,
  days,
  dark,
  loading,
  permissions,
  onDaysChange,
  onNavigate,
  onRefresh,
}: DashboardPageProps) {
  const { language, t } = useI18n();
  const number = useMemo(() => new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US"), [language]);
  const summary = data?.summary;
  const muted = dark ? "#8fa0b5" : "#64748b";
  const text = dark ? "#dce5f0" : "#334155";
  const gridLine = dark ? "rgba(148, 163, 184, 0.12)" : "rgba(148, 163, 184, 0.18)";
  const periodLabel = t("dashboard.periodDays", { count: days });

  const dateLabels = useMemo(() => (
    data?.trend.map((item) => {
      const date = new Date(`${item.date}T00:00:00Z`);
      return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
        month: "numeric",
        day: "numeric",
        timeZone: "UTC",
      }).format(date);
    }) ?? []
  ), [data?.trend, language]);

  const trendOption = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 450,
    backgroundColor: "transparent",
    color: ["#1769e0", "#16a085"],
    tooltip: { trigger: "axis" },
    legend: {
      top: 0,
      right: 4,
      textStyle: { color: muted },
      data: [t("dashboard.newUsers"), t("dashboard.newDevices")],
    },
    grid: { left: 18, right: 18, top: 46, bottom: 8, containLabel: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: dateLabels,
      axisLine: { lineStyle: { color: gridLine } },
      axisTick: { show: false },
      axisLabel: { color: muted, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: gridLine } },
    },
    series: [
      {
        name: t("dashboard.newUsers"),
        type: "line",
        smooth: true,
        showSymbol: false,
        data: data?.trend.map((item) => item.users) ?? [],
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.1 },
      },
      {
        name: t("dashboard.newDevices"),
        type: "line",
        smooth: true,
        showSymbol: false,
        data: data?.trend.map((item) => item.installations) ?? [],
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.08 },
      },
    ],
  }), [data?.trend, dateLabels, gridLine, muted, t]);

  const platformOption = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 450,
    backgroundColor: "transparent",
    color: ["#1769e0", "#7c3aed", "#f59e0b", "#16a085", "#06b6d4"],
    tooltip: { trigger: "item", formatter: "{b}<br/>{c} ({d}%)" },
    legend: {
      bottom: 0,
      left: "center",
      textStyle: { color: muted },
    },
    series: [{
      type: "pie",
      radius: ["48%", "70%"],
      center: ["50%", "43%"],
      avoidLabelOverlap: true,
      itemStyle: {
        borderRadius: 5,
        borderColor: dark ? "#111827" : "#ffffff",
        borderWidth: 3,
      },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 14, fontWeight: 600, color: text } },
      data: data?.platforms.map((item) => ({
        name: t(platformKeys[item.name] as Parameters<typeof t>[0]),
        value: item.value,
      })) ?? [],
    }],
  }), [dark, data?.platforms, muted, t, text]);

  const planOption = useMemo<EChartsCoreOption>(() => {
    const plans = [...(data?.accountPlans ?? [])].reverse();
    return {
      animationDuration: 450,
      backgroundColor: "transparent",
      color: ["#1769e0"],
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 8, right: 28, top: 8, bottom: 4, containLabel: true },
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: muted },
        splitLine: { lineStyle: { color: gridLine } },
      },
      yAxis: {
        type: "category",
        data: plans.map((item) => item.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: muted, width: 120, overflow: "truncate" },
      },
      series: [{
        type: "bar",
        data: plans.map((item) => item.value),
        barMaxWidth: 22,
        itemStyle: { borderRadius: [0, 6, 6, 0] },
        label: { show: true, position: "right", color: text },
      }],
    };
  }, [data?.accountPlans, gridLine, muted, text]);

  const activeRate = summary?.totalUsers
    ? Math.round((summary.activeUsers / summary.totalUsers) * 100)
    : 0;
  const boundRate = summary?.officialAccounts
    ? Math.round((summary.boundOfficialAccounts / summary.officialAccounts) * 100)
    : 0;
  const feedbackTotal = data ? data.feedback.pending + data.feedback.replied : 0;
  const feedbackRate = feedbackTotal
    ? Math.round((data!.feedback.replied / feedbackTotal) * 100)
    : 0;
  const canOpenFeedback = permissions.includes("admin.feedback.read");
  const canOpenApprovals = permissions.includes("admin.approvals.read");
  const canOpenAccounts = permissions.includes("admin.official-accounts.read");

  const metrics = [
    {
      key: "users",
      label: t("dashboard.totalUsers"),
      value: summary?.totalUsers ?? 0,
      note: t("dashboard.userMetricNote", { active: summary?.activeUsers ?? 0, newCount: summary?.newUsers ?? 0, period: periodLabel }),
      icon: <Users size={20} />,
      tone: "blue",
    },
    {
      key: "devices",
      label: t("dashboard.totalDevices"),
      value: summary?.totalInstallations ?? 0,
      note: t("dashboard.deviceMetricNote", { count: summary?.newInstallations ?? 0, period: periodLabel }),
      icon: <MonitorSmartphone size={20} />,
      tone: "teal",
    },
    {
      key: "accounts",
      label: t("dashboard.accountPool"),
      value: summary?.officialAccounts ?? 0,
      note: t("dashboard.accountMetricNote", { bound: summary?.boundOfficialAccounts ?? 0, bindings: summary?.totalBindings ?? 0 }),
      icon: <BadgeCheck size={20} />,
      tone: "violet",
    },
    {
      key: "pending",
      label: t("dashboard.pendingItems"),
      value: (summary?.pendingFeedback ?? 0) + (summary?.pendingApprovals ?? 0),
      note: t("dashboard.pendingMetricNote", { feedback: summary?.pendingFeedback ?? 0, approvals: summary?.pendingApprovals ?? 0 }),
      icon: <CircleAlert size={20} />,
      tone: "amber",
    },
  ];

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <div className="dashboard-eyebrow">CODEX SWITCH · OVERVIEW</div>
          <h1 className="page-title dashboard-title">{t("dashboard.title")}</h1>
          <Typography.Text type="secondary">{t("dashboard.description")}</Typography.Text>
        </div>
        <div className="dashboard-controls">
          <Segmented
            value={days}
            options={[
              { value: 7, label: t("dashboard.days", { count: 7 }) },
              { value: 30, label: t("dashboard.days", { count: 30 }) },
              { value: 90, label: t("dashboard.days", { count: 90 }) },
            ]}
            onChange={(value) => onDaysChange(value as 7 | 30 | 90)}
          />
          <Button loading={loading} icon={<RefreshCw size={15} />} onClick={() => void onRefresh()}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      <div className="dashboard-kpi-grid">
        {metrics.map((metric) => (
          <div className={`dashboard-kpi dashboard-kpi-${metric.tone}`} key={metric.key}>
            <div className="dashboard-kpi-top">
              <span>{metric.label}</span>
              <div className="dashboard-kpi-icon">{metric.icon}</div>
            </div>
            {loading && !data
              ? <Skeleton.Input active size="small" />
              : <strong>{number.format(metric.value)}</strong>}
            <small>{metric.note}</small>
          </div>
        ))}
      </div>

      <div className="dashboard-chart-grid dashboard-chart-grid-top">
        <article className="dashboard-panel dashboard-panel-wide">
          <div className="dashboard-panel-heading">
            <div>
              <h2>{t("dashboard.growthTrend")}</h2>
              <span>{t("dashboard.growthTrendDescription", { period: periodLabel })}</span>
            </div>
            <Tag color="blue">{data?.range.startDate ?? "—"} → {data?.range.endDate ?? "—"}</Tag>
          </div>
          <EChart
            className="dashboard-chart dashboard-trend-chart"
            dark={dark}
            option={trendOption}
            ariaLabel={t("dashboard.growthTrendAria")}
          />
        </article>

        <article className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h2>{t("dashboard.platformDistribution")}</h2>
              <span>{t("dashboard.platformDescription")}</span>
            </div>
          </div>
          {(data?.platforms.some((item) => item.value > 0) ?? false)
            ? (
              <EChart
                className="dashboard-chart dashboard-donut-chart"
                dark={dark}
                option={platformOption}
                ariaLabel={t("dashboard.platformAria")}
              />
            )
            : <Empty className="dashboard-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("dashboard.noData")} />}
        </article>
      </div>

      <div className="dashboard-chart-grid">
        <article className="dashboard-panel dashboard-panel-wide">
          <div className="dashboard-panel-heading">
            <div>
              <h2>{t("dashboard.planDistribution")}</h2>
              <span>{t("dashboard.planDescription")}</span>
            </div>
          </div>
          {data?.accountPlans.length
            ? (
              <EChart
                className="dashboard-chart dashboard-plan-chart"
                dark={dark}
                option={planOption}
                ariaLabel={t("dashboard.planAria")}
              />
            )
            : <Empty className="dashboard-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("dashboard.noData")} />}
        </article>

        <article className="dashboard-panel dashboard-operations-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h2>{t("dashboard.operations")}</h2>
              <span>{t("dashboard.operationsDescription")}</span>
            </div>
          </div>
          <div className="dashboard-health-row">
            <Progress
              type="circle"
              size={82}
              percent={activeRate}
              strokeColor="#1769e0"
              format={(value) => `${value}%`}
            />
            <div>
              <strong>{t("dashboard.activeUserRate")}</strong>
              <span>{t("dashboard.activeUserRateNote", { active: summary?.activeUsers ?? 0, total: summary?.totalUsers ?? 0 })}</span>
            </div>
          </div>
          <div className="dashboard-operation-list">
            <div className="dashboard-operation-item">
              <span className="dashboard-operation-dot dashboard-operation-dot-violet"><BadgeCheck size={16} /></span>
              <div><strong>{t("dashboard.poolCoverage")}</strong><span>{t("dashboard.poolCoverageNote", { rate: boundRate })}</span></div>
              {canOpenAccounts && <Button type="text" icon={<ArrowRight size={15} />} onClick={() => onNavigate("officialAccounts")} aria-label={t("dashboard.openAccounts")} />}
            </div>
            <div className="dashboard-operation-item">
              <span className="dashboard-operation-dot dashboard-operation-dot-teal"><MessageSquareText size={16} /></span>
              <div><strong>{t("dashboard.feedbackHandled")}</strong><span>{t("dashboard.feedbackHandledNote", { rate: feedbackRate })}</span></div>
              {canOpenFeedback && <Button type="text" icon={<ArrowRight size={15} />} onClick={() => onNavigate("feedback")} aria-label={t("dashboard.openFeedback")} />}
            </div>
            <div className="dashboard-operation-item">
              <span className="dashboard-operation-dot dashboard-operation-dot-amber"><UserRoundCheck size={16} /></span>
              <div><strong>{t("dashboard.pendingApprovals")}</strong><span>{t("dashboard.pendingApprovalsNote", { count: summary?.pendingApprovals ?? 0 })}</span></div>
              {canOpenApprovals && <Button type="text" icon={<ArrowRight size={15} />} onClick={() => onNavigate("approvals")} aria-label={t("dashboard.openApprovals")} />}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
