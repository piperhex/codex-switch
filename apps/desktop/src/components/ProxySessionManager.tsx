import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Modal,
  Progress,
  Table,
  Tag,
  type TableColumnsType,
  type TableProps,
} from "antd";
import { Cable, RefreshCw } from "lucide-react";
import { loadProxySessions } from "../api/backend";
import type { Translate } from "../i18n";
import type { ProxySession } from "../types";

interface ProxySessionManagerProps {
  t: Translate;
}

type ActivityFilter = "active" | "idle";

const ACTIVITY_FILTER_STORAGE_KEY = "codex-switch.proxy-session-activity-filter";

function loadActivityFilter(): ActivityFilter[] {
  try {
    const stored = window.localStorage.getItem(ACTIVITY_FILTER_STORAGE_KEY);
    if (stored === "all") return [];
    if (stored === "active" || stored === "idle") return [stored];
  } catch {
    // Fall back to the default when local storage is unavailable.
  }
  return ["active"];
}

function formatTokens(value: number) {
  const compact = (divisor: number, suffix: string) => {
    const scaled = value / divisor;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)}${suffix}`;
  };
  if (value >= 1_000_000) return compact(1_000_000, "M");
  if (value >= 1_000) return compact(1_000, "K");
  return String(value);
}

function shortSessionId(id: string) {
  if (id.length <= 20) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function maskEmail(value?: string | null) {
  if (!value) return "";
  const [local, domain] = value.split("@");
  if (!domain) return value;
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}${local.length > visible.length ? "•••" : ""}@${domain}`;
}

export function ProxySessionManager({ t }: ProxySessionManagerProps) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ProxySession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter[]>(loadActivityFilter);

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      setSessions(await loadProxySessions());
      setError("");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`${t("providers.proxy.sessionsLoadError")}: ${detail}`);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  const columns = useMemo<TableColumnsType<ProxySession>>(() => [
    {
      title: t("providers.proxy.sessionsConversation"),
      key: "conversation",
      width: 140,
      render: (_, session) => (
        <div className="proxy-session-cell proxy-session-title">
          <strong title={session.title || undefined}>
            {session.title || t("providers.proxy.sessionsConversationUnknown")}
          </strong>
          <span title={session.id}>{shortSessionId(session.id)}</span>
        </div>
      ),
    },
    {
      title: t("providers.proxy.sessionsConnection"),
      key: "connection",
      width: 180,
      render: (_, session) => (
        <div className="proxy-session-cell">
          <strong title={session.id}>{shortSessionId(session.id)}</strong>
          <span title={[session.client, session.remoteAddress].filter(Boolean).join(" · ")}>
            {[session.client, session.remoteAddress].filter(Boolean).join(" · ")}
          </span>
        </div>
      ),
    },
    {
      title: t("providers.proxy.sessionsTarget"),
      key: "target",
      width: 220,
      render: (_, session) => (
        <div className="proxy-session-cell">
          <strong>{session.provider || "—"}</strong>
          <span>
            {[maskEmail(session.accountEmail), session.model].filter(Boolean).join(" · ") || "—"}
          </span>
        </div>
      ),
    },
    {
      title: t("providers.proxy.sessionsContext"),
      key: "context",
      width: 190,
      render: (_, session) => {
        const used = session.contextTokens;
        const total = session.modelContextWindow;
        if (used == null) {
          return <span className="proxy-session-muted">{t("providers.proxy.sessionsContextUnknown")}</span>;
        }
        const percent = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
        return (
          <div className="proxy-session-context">
            <span>
              {total
                ? t("providers.proxy.sessionsContextValue", {
                    used: formatTokens(used),
                    total: formatTokens(total),
                  })
                : formatTokens(used)}
            </span>
            {total ? <Progress percent={percent} showInfo={false} size="small" /> : null}
          </div>
        );
      },
    },
    {
      title: t("providers.proxy.sessionsActivity"),
      dataIndex: "activity",
      key: "activity",
      width: 170,
      filters: [
        { text: t("providers.proxy.sessionsActive"), value: "active" },
        { text: t("providers.proxy.sessionsIdle"), value: "idle" },
      ],
      filteredValue: activityFilter,
      filterMultiple: false,
      onFilter: (value, session) =>
        value === "active" ? session.activeRequests > 0 : session.activeRequests === 0,
      render: (_, session) => (
        <div className="proxy-session-activity">
          <div>
            <Tag color={session.activeRequests > 0 ? "processing" : "default"}>
              {session.activeRequests > 0
                ? t("providers.proxy.sessionsActive")
                : t("providers.proxy.sessionsIdle")}
            </Tag>
            <span>{t("providers.proxy.sessionsRequests", { count: session.requestCount })}</span>
          </div>
          <span title={new Date(session.lastSeenAt * 1000).toLocaleString()}>
            {t("providers.proxy.sessionsLastSeen", {
              time: new Date(session.lastSeenAt * 1000).toLocaleTimeString(),
            })}
          </span>
        </div>
      ),
    },
  ], [activityFilter, t]);

  const handleTableChange: TableProps<ProxySession>["onChange"] = (_, filters) => {
    const nextFilter = (filters.activity || []).filter(
      (value): value is ActivityFilter => value === "active" || value === "idle",
    );
    setActivityFilter(nextFilter);
    try {
      window.localStorage.setItem(
        ACTIVITY_FILTER_STORAGE_KEY,
        nextFilter[0] || "all",
      );
    } catch {
      // Keep the in-memory selection when local storage is unavailable.
    }
  };

  return (
    <>
      <Button size="small" icon={<Cable size={14} />} onClick={() => setOpen(true)}>
        {t("providers.proxy.sessions")}
      </Button>
      <Modal
        className="proxy-session-modal"
        open={open}
        centered
        width="80vw"
        title={t("providers.proxy.sessionsTitle")}
        onCancel={() => setOpen(false)}
        footer={(
          <>
            <Button icon={<RefreshCw size={14} />} loading={loading}
              onClick={() => void refresh(true)}>
              {t("providers.proxy.sessionsRefresh")}
            </Button>
            <Button type="primary" onClick={() => setOpen(false)}>
              {t("providers.proxy.sessionsClose")}
            </Button>
          </>
        )}
      >
        <p className="proxy-session-description">{t("providers.proxy.sessionsDescription")}</p>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <Table<ProxySession>
          className="proxy-session-table"
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={sessions}
          pagination={false}
          onChange={handleTableChange}
          locale={{ emptyText: t("providers.proxy.sessionsEmpty") }}
          scroll={{ x: 1090, y: "calc(80vh - 238px)" }}
        />
      </Modal>
    </>
  );
}
