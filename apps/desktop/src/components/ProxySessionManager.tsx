import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Dropdown,
  Modal,
  Progress,
  Table,
  Tag,
  Tooltip,
  type TableColumnsType,
  type TableProps,
} from "antd";
import { Cable, Columns3, Eye, GripVertical, Lock, RefreshCw } from "lucide-react";
import { loadProxySessionRequests, loadProxySessions } from "../api/backend";
import type { Translate } from "../i18n";
import type { ProxySession, ProxySessionRequest } from "../types";

interface ProxySessionManagerProps {
  t: Translate;
}

type ActivityFilter = "active" | "idle";
type ProxySessionColumnKey =
  | "conversation"
  | "connection"
  | "target"
  | "context"
  | "tokens"
  | "activity";

const ACTIVITY_FILTER_STORAGE_KEY = "codex-switch.proxy-session-activity-filter";
const HIDDEN_COLUMNS_STORAGE_KEY = "codex-switch:proxy-session-hidden-columns";
const COLUMN_ORDER_STORAGE_KEY = "codex-switch:proxy-session-column-order";
const PROXY_SESSION_COLUMN_KEYS: ProxySessionColumnKey[] = [
  "conversation",
  "connection",
  "target",
  "context",
  "tokens",
  "activity",
];
const REORDERABLE_COLUMN_KEYS = PROXY_SESSION_COLUMN_KEYS.filter(
  (key): key is Exclude<ProxySessionColumnKey, "activity"> => key !== "activity",
);
type ReorderableColumnKey = typeof REORDERABLE_COLUMN_KEYS[number];

function isProxySessionColumnKey(value: unknown): value is ProxySessionColumnKey {
  return typeof value === "string"
    && PROXY_SESSION_COLUMN_KEYS.includes(value as ProxySessionColumnKey);
}

function loadHiddenColumns(): ProxySessionColumnKey[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    const hiddenColumns = parsed.filter(isProxySessionColumnKey);
    return hiddenColumns.length < PROXY_SESSION_COLUMN_KEYS.length ? hiddenColumns : [];
  } catch {
    return [];
  }
}

function persistHiddenColumns(columns: ProxySessionColumnKey[]) {
  try {
    window.localStorage.setItem(HIDDEN_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // Keep the in-memory selection when local storage is unavailable.
  }
}

function isReorderableColumnKey(value: unknown): value is ReorderableColumnKey {
  return isProxySessionColumnKey(value) && value !== "activity";
}

function loadColumnOrder(): ReorderableColumnKey[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(COLUMN_ORDER_STORAGE_KEY) ?? "[]",
    );
    const stored = Array.isArray(parsed)
      ? [...new Set(parsed.filter(isReorderableColumnKey))]
      : [];
    return [
      ...stored,
      ...REORDERABLE_COLUMN_KEYS.filter((key) => !stored.includes(key)),
    ];
  } catch {
    return [...REORDERABLE_COLUMN_KEYS];
  }
}

function persistColumnOrder(columns: ReorderableColumnKey[]) {
  try {
    window.localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // Keep the in-memory order when local storage is unavailable.
  }
}

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

function formatResponseTime(value: number) {
  return `${(value / 1_000).toFixed(1)}s`;
}

function SessionTokenChart({ session, t }: { session: ProxySession; t: Translate }) {
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
    <Tooltip title={tooltip} placement="top">
      <div className="compact-model-token-chart" role="img"
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

function RequestTokenUsage({ request, t }: { request: ProxySessionRequest; t: Translate }) {
  if (request.totalTokens == null) {
    return (
      <span className="proxy-session-muted">
        {request.responseTimeMs == null
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
    <Tooltip title={tooltip} placement="top">
      <strong className="proxy-session-request-tokens">{formatTokens(request.totalTokens)}</strong>
    </Tooltip>
  );
}

export function ProxySessionManager({ t }: ProxySessionManagerProps) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ProxySession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter[]>(loadActivityFilter);
  const [hiddenColumns, setHiddenColumns] = useState<ProxySessionColumnKey[]>(loadHiddenColumns);
  const [columnOrder, setColumnOrder] = useState<ReorderableColumnKey[]>(loadColumnOrder);
  const draggedColumnRef = useRef<ReorderableColumnKey | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<ReorderableColumnKey | null>(null);
  const [dragTargetColumn, setDragTargetColumn] = useState<ReorderableColumnKey | null>(null);
  const [detailsSession, setDetailsSession] = useState<ProxySession | null>(null);
  const [requestDetails, setRequestDetails] = useState<ProxySessionRequest[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");

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

  const refreshRequestDetails = useCallback(async (
    session: ProxySession,
    showLoading = false,
  ) => {
    if (showLoading) setDetailsLoading(true);
    try {
      setRequestDetails(await loadProxySessionRequests(session.id));
      setDetailsError("");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setDetailsError(`${t("providers.proxy.sessionsRequestDetailsLoadError")}: ${detail}`);
    } finally {
      if (showLoading) setDetailsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!detailsSession) return;
    void refreshRequestDetails(detailsSession, true);
    const timer = window.setInterval(
      () => void refreshRequestDetails(detailsSession),
      2_000,
    );
    return () => window.clearInterval(timer);
  }, [detailsSession, refreshRequestDetails]);

  const openRequestDetails = useCallback((session: ProxySession) => {
    setRequestDetails([]);
    setDetailsError("");
    setDetailsSession(session);
  }, []);

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
      title: t("providers.proxy.sessionsTokens"),
      key: "tokens",
      width: 120,
      align: "center",
      render: (_, session) => (
        <div className="proxy-session-token-chart">
          <SessionTokenChart session={session} t={t} />
        </div>
      ),
    },
    {
      title: t("providers.proxy.sessionsActivity"),
      dataIndex: "activity",
      key: "activity",
      width: 220,
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
            <Button
              className="proxy-session-request-details-button"
              type="link"
              size="small"
              icon={<Eye size={12} />}
              onClick={() => openRequestDetails(session)}
            >
              {t("providers.proxy.sessionsRequestDetails")}
            </Button>
          </div>
          <span title={new Date(session.lastSeenAt * 1000).toLocaleString()}>
            {t("providers.proxy.sessionsLastSeen", {
              time: new Date(session.lastSeenAt * 1000).toLocaleTimeString(),
            })}
          </span>
        </div>
      ),
    },
  ], [activityFilter, openRequestDetails, t]);

  const hiddenColumnSet = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const columnLabels = useMemo<Record<ProxySessionColumnKey, string>>(() => ({
    conversation: t("providers.proxy.sessionsConversation"),
    connection: t("providers.proxy.sessionsConnection"),
    target: t("providers.proxy.sessionsTarget"),
    context: t("providers.proxy.sessionsContext"),
    tokens: t("providers.proxy.sessionsTokens"),
    activity: t("providers.proxy.sessionsActivity"),
  }), [t]);
  const orderedColumns = useMemo(() => {
    const columnsByKey = new Map(
      columns
        .filter((column) => isProxySessionColumnKey(column.key))
        .map((column) => [column.key as ProxySessionColumnKey, column]),
    );
    return [...columnOrder, "activity" as const]
      .map((key) => columnsByKey.get(key))
      .filter((column): column is NonNullable<typeof column> => column != null);
  }, [columnOrder, columns]);
  const visibleColumns = useMemo(
    () => orderedColumns.filter(
      (column) => !isProxySessionColumnKey(column.key) || !hiddenColumnSet.has(column.key),
    ),
    [hiddenColumnSet, orderedColumns],
  );
  const columnSettings = useMemo<{ key: ProxySessionColumnKey; label: string }[]>(
    () => [...columnOrder, "activity" as const].map((key) => ({
      key,
      label: columnLabels[key],
    })),
    [columnLabels, columnOrder],
  );
  const visibleColumnCount = columnSettings.filter(
    ({ key }) => !hiddenColumnSet.has(key),
  ).length;

  const setColumnVisible = (key: ProxySessionColumnKey, visible: boolean) => {
    setHiddenColumns((current) => {
      if (!visible && !current.includes(key) && visibleColumnCount <= 1) return current;
      const next = visible
        ? current.filter((column) => column !== key)
        : [...new Set([...current, key])];
      persistHiddenColumns(next);
      return next;
    });
  };

  const reorderColumn = (
    source: ReorderableColumnKey,
    target: ReorderableColumnKey,
  ) => {
    if (source === target) return;
    setColumnOrder((current) => {
      const next = current.filter((key) => key !== source);
      next.splice(current.indexOf(target), 0, source);
      persistColumnOrder(next);
      return next;
    });
  };

  const moveColumn = (key: ReorderableColumnKey, offset: number) => {
    setColumnOrder((current) => {
      const sourceIndex = current.indexOf(key);
      const targetIndex = Math.max(0, Math.min(current.length - 1, sourceIndex + offset));
      if (sourceIndex === targetIndex) return current;
      const next = [...current];
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, key);
      persistColumnOrder(next);
      return next;
    });
  };

  const requestDetailColumns = useMemo<TableColumnsType<ProxySessionRequest>>(() => [
    {
      title: t("providers.proxy.sessionsRequestNumber"),
      dataIndex: "id",
      key: "id",
      width: 80,
      render: (id: number) => <strong>#{id}</strong>,
    },
    {
      title: t("providers.proxy.sessionsRequestStartedAt"),
      dataIndex: "startedAt",
      key: "startedAt",
      width: 150,
      render: (startedAt: number) => (
        <span title={new Date(startedAt * 1000).toLocaleString()}>
          {new Date(startedAt * 1000).toLocaleTimeString()}
        </span>
      ),
    },
    {
      title: t("providers.proxy.sessionsRequestModel"),
      dataIndex: "model",
      key: "model",
      ellipsis: true,
      render: (model?: string | null) => (
        model || <span className="proxy-session-muted">{t("providers.proxy.sessionsRequestUnknown")}</span>
      ),
    },
    {
      title: t("providers.proxy.sessionsRequestReasoning"),
      dataIndex: "reasoningEffort",
      key: "reasoningEffort",
      width: 120,
      render: (reasoningEffort?: string | null) => (
        reasoningEffort
          ? <Tag>{reasoningEffort}</Tag>
          : <span className="proxy-session-muted">{t("providers.proxy.sessionsRequestUnknown")}</span>
      ),
    },
    {
      title: t("providers.proxy.sessionsRequestFirstResponseTime"),
      dataIndex: "firstResponseTimeMs",
      key: "firstResponseTimeMs",
      width: 130,
      align: "right",
      render: (firstResponseTimeMs: number | null | undefined, request) => {
        if (firstResponseTimeMs != null) {
          return <strong>{formatResponseTime(firstResponseTimeMs)}</strong>;
        }
        if (request.responseTimeMs != null) {
          return <span className="proxy-session-muted">—</span>;
        }
        return (
          <Tag color="processing">
            {t("providers.proxy.sessionsRequestAwaitingFirstResponse", {
              time: formatResponseTime(Math.max(0, Date.now() - request.startedAt * 1_000)),
            })}
          </Tag>
        );
      },
    },
    {
      title: t("providers.proxy.sessionsRequestResponseTime"),
      dataIndex: "responseTimeMs",
      key: "responseTimeMs",
      width: 120,
      align: "right",
      render: (responseTimeMs: number | null | undefined, request) => {
        const elapsedMs = responseTimeMs
          ?? Math.max(0, Date.now() - request.startedAt * 1_000);
        return responseTimeMs == null
          ? (
              <Tag color="processing">
                {t("providers.proxy.sessionsRequestInProgress", {
                  time: formatResponseTime(elapsedMs),
                })}
              </Tag>
            )
          : (
              <strong>
                {t("providers.proxy.sessionsRequestResponded", {
                  time: formatResponseTime(elapsedMs),
                })}
              </strong>
            );
      },
    },
    {
      title: t("providers.proxy.sessionsRequestTokens"),
      key: "tokens",
      width: 110,
      align: "right",
      render: (_, request) => <RequestTokenUsage request={request} t={t} />,
    },
  ], [t]);

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

  const closeManager = () => {
    setDetailsSession(null);
    setOpen(false);
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
        width="95vw"
        title={t("providers.proxy.sessionsTitle")}
        onCancel={closeManager}
        footer={(
          <>
            <Button icon={<RefreshCw size={14} />} loading={loading}
              onClick={() => void refresh(true)}>
              {t("providers.proxy.sessionsRefresh")}
            </Button>
            <Button type="primary" onClick={closeManager}>
              {t("providers.proxy.sessionsClose")}
            </Button>
          </>
        )}
      >
        <div className="proxy-session-table-heading">
          <p className="proxy-session-description">{t("providers.proxy.sessionsDescription")}</p>
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            dropdownRender={() => (
              <div
                className="proxy-session-column-settings"
                onClick={(event) => event.stopPropagation()}
              >
                <strong>{t("table.columnSettings")}</strong>
                <div className="proxy-session-column-settings-list">
                  {columnSettings.map(({ key, label }) => {
                    const checked = !hiddenColumnSet.has(key);
                    const reorderable = isReorderableColumnKey(key);
                    return (
                      <div
                        key={key}
                        data-proxy-session-column-key={key}
                        className={[
                          "proxy-session-column-setting-item",
                          draggedColumn === key ? "is-dragging" : "",
                          dragTargetColumn === key ? "is-drag-target" : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {reorderable ? (
                          <span
                            className="proxy-session-column-drag-handle"
                            role="button"
                            tabIndex={0}
                            title={t("table.columnOrderDrag", { column: label })}
                            aria-label={t("table.columnOrderDrag", { column: label })}
                            onPointerDown={(event) => {
                              if (event.button !== 0) return;
                              event.preventDefault();
                              event.currentTarget.setPointerCapture(event.pointerId);
                              draggedColumnRef.current = key;
                              setDraggedColumn(key);
                            }}
                            onPointerMove={(event) => {
                              if (!draggedColumnRef.current) return;
                              const item = document
                                .elementFromPoint(event.clientX, event.clientY)
                                ?.closest<HTMLElement>("[data-proxy-session-column-key]");
                              const target = item?.dataset.proxySessionColumnKey;
                              setDragTargetColumn(
                                isReorderableColumnKey(target) ? target : null,
                              );
                            }}
                            onPointerUp={(event) => {
                              const source = draggedColumnRef.current;
                              const item = document
                                .elementFromPoint(event.clientX, event.clientY)
                                ?.closest<HTMLElement>("[data-proxy-session-column-key]");
                              const target = item?.dataset.proxySessionColumnKey;
                              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                event.currentTarget.releasePointerCapture(event.pointerId);
                              }
                              draggedColumnRef.current = null;
                              setDraggedColumn(null);
                              setDragTargetColumn(null);
                              if (source && isReorderableColumnKey(target)) {
                                reorderColumn(source, target);
                              }
                            }}
                            onPointerCancel={() => {
                              draggedColumnRef.current = null;
                              setDraggedColumn(null);
                              setDragTargetColumn(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                              event.preventDefault();
                              moveColumn(key, event.key === "ArrowUp" ? -1 : 1);
                            }}
                          >
                            <GripVertical size={14} aria-hidden="true" />
                          </span>
                        ) : (
                          <Tooltip title={t("table.columnOrderFixedLast")}>
                            <span className="proxy-session-column-fixed-icon">
                              <Lock size={12} aria-hidden="true" />
                            </span>
                          </Tooltip>
                        )}
                        <Checkbox
                          checked={checked}
                          disabled={checked && visibleColumnCount <= 1}
                          onChange={(event) => setColumnVisible(key, event.target.checked)}
                        >
                          {label}
                        </Checkbox>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          >
            <Tooltip title={t("table.columnSettings")}>
              <Button
                size="small"
                className="table-icon-button"
                aria-label={t("table.columnSettings")}
                icon={<Columns3 size={15} />}
              />
            </Tooltip>
          </Dropdown>
        </div>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <Table<ProxySession>
          className="proxy-session-table"
          rowKey="id"
          size="small"
          loading={loading}
          columns={visibleColumns}
          dataSource={sessions}
          pagination={false}
          onChange={handleTableChange}
          locale={{ emptyText: t("providers.proxy.sessionsEmpty") }}
          scroll={{ x: 1260, y: "calc(80vh - 238px)" }}
        />
      </Modal>
      <Modal
        className="proxy-session-request-modal"
        open={detailsSession != null}
        centered
        width={880}
        title={t("providers.proxy.sessionsRequestDetailsTitle", {
          conversation: detailsSession?.title
            || (detailsSession ? shortSessionId(detailsSession.id) : ""),
        })}
        onCancel={() => setDetailsSession(null)}
        footer={(
          <>
            <Button
              icon={<RefreshCw size={14} />}
              loading={detailsLoading}
              onClick={() => {
                if (detailsSession) void refreshRequestDetails(detailsSession, true);
              }}
            >
              {t("providers.proxy.sessionsRefresh")}
            </Button>
            <Button type="primary" onClick={() => setDetailsSession(null)}>
              {t("providers.proxy.sessionsClose")}
            </Button>
          </>
        )}
      >
        <p className="proxy-session-description">
          {t("providers.proxy.sessionsRequestDetailsDescription", {
            count: detailsSession?.requestCount || 0,
          })}
        </p>
        {detailsError ? <Alert type="error" showIcon message={detailsError} /> : null}
        <Table<ProxySessionRequest>
          className="proxy-session-request-table"
          rowKey="id"
          size="small"
          loading={detailsLoading}
          columns={requestDetailColumns}
          dataSource={requestDetails}
          pagination={requestDetails.length > 10 ? { pageSize: 10, size: "small" } : false}
          locale={{ emptyText: t("providers.proxy.sessionsRequestDetailsEmpty") }}
          scroll={{ x: 930, y: "calc(80vh - 260px)" }}
        />
      </Modal>
    </>
  );
}
