import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Switch, Table, Tooltip } from "antd";
import { RefreshCw } from "lucide-react";
import { loadProxySessions, loadProxySessionUnlimitedConversation,
  setProxySessionUnlimitedConversation } from "../../api/backend";
import type { Translate } from "../../i18n";
import type { ProxySession } from "../../types";
import { RequestDetailsModal } from "./RequestDetailsModal";
import { SessionColumnSettings } from "./SessionColumnSettings";
import { useSessionColumns } from "./useSessionColumns";
import styles from "./index.module.less";

const SESSION_DEFAULT_PAGE_SIZE = 10;
const SESSION_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const SESSION_TABLE_SCROLL_X = 1_260;
const REFRESH_INTERVAL_MS = 2_000;

function useProxySessions(t: Translate) {
  const [sessions, setSessions] = useState<ProxySession[]>([]);
  const sortedSessions = useMemo(() => [...sessions].sort(
    (left, right) => right.lastSeenAt - left.lastSeenAt || left.id.localeCompare(right.id),
  ), [sessions]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unlimitedConversation, setUnlimitedConversation] = useState(false);
  const [unlimitedConversationLoading, setUnlimitedConversationLoading] = useState(false);
  const refreshingRef = useRef(false);
  const refresh = useCallback(async (showLoading = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (showLoading) setLoading(true);
    try {
      setSessions(await loadProxySessions());
      setError("");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`${t("providers.proxy.sessionsLoadError")}: ${detail}`);
    } finally {
      refreshingRef.current = false;
      if (showLoading) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    void loadProxySessionUnlimitedConversation()
      .then(setUnlimitedConversation)
      .catch(() => setUnlimitedConversation(false));
  }, []);

  const handleUnlimitedConversationChange = async (enabled: boolean) => {
    setUnlimitedConversationLoading(true);
    try {
      setUnlimitedConversation(await setProxySessionUnlimitedConversation(enabled));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`${t("providers.proxy.sessionsRetentionSettingError")}: ${detail}`);
    } finally {
      setUnlimitedConversationLoading(false);
    }
  };

  return { sortedSessions, loading, error, refresh, unlimitedConversation, unlimitedConversationLoading,
    handleUnlimitedConversationChange };
}

export function ProxySessionManager({ t }: { t: Translate }) {
  const { sortedSessions, loading, error, refresh, unlimitedConversation, unlimitedConversationLoading,
    handleUnlimitedConversationChange } = useProxySessions(t);
  const [detailsSession, setDetailsSession] = useState<ProxySession | null>(null);
  const columns = useSessionColumns(t, setDetailsSession);
  return (
    <section className={styles.page} aria-label={t("providers.proxy.sessionsTitle")}>
      <div className={styles.tableHeading}>
        <p className={styles.description}>{t("providers.proxy.sessionsDescription")}</p>
        <div className={styles.tableActions}>
          <Tooltip title={t("providers.proxy.sessionsUnlimitedConversationTooltip")}
            styles={{ root: { maxWidth: 400 } }}>
            <label className={styles.sessionRetentionControl}>
              <span>{t("providers.proxy.sessionsUnlimitedConversation")}</span>
              <Switch size="small" checked={unlimitedConversation} loading={unlimitedConversationLoading}
                onChange={(enabled) => void handleUnlimitedConversationChange(enabled)} />
            </label>
          </Tooltip>
          <SessionColumnSettings settings={columns} t={t} />
          <Button size="small" icon={<RefreshCw size={14} />} loading={loading}
            onClick={() => void refresh(true)}>{t("providers.proxy.sessionsRefresh")}</Button>
        </div>
      </div>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <Table<ProxySession> className={styles.sessionTable} rowKey="id" size="small"
        loading={loading} columns={columns.visibleColumns} dataSource={sortedSessions}
        pagination={{ defaultPageSize: SESSION_DEFAULT_PAGE_SIZE, pageSizeOptions: SESSION_PAGE_SIZE_OPTIONS,
          showSizeChanger: true, size: "small" }}
        onChange={columns.handleTableChange} locale={{ emptyText: t("providers.proxy.sessionsEmpty") }}
        scroll={{ x: SESSION_TABLE_SCROLL_X, y: "100%" }} />
      {detailsSession && <RequestDetailsModal key={detailsSession.id}
        session={sortedSessions.find((session) => session.id === detailsSession.id) ?? detailsSession}
        onClose={() => setDetailsSession(null)} t={t} />}
    </section>
  );
}
