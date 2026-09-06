import { Alert, Button, Popconfirm, Segmented, Table, Tag, type TableColumnsType } from "antd";
import { RefreshCw, Trash2 } from "lucide-react";
import type { ErrorLogEntry } from "../../api/errorLogs";
import type { Language, Translate } from "../../i18n";
import { useErrorLogs, type ErrorLogFilter } from "./useErrorLogs";
import { ERROR_LOG_RETENTION_LIMIT } from "./logEntries";
import styles from "./index.module.less";

interface ErrorLogsPageProps {
  language: Language;
  t: Translate;
}

function logColumns({ language, t }: ErrorLogsPageProps): TableColumnsType<ErrorLogEntry> {
  return [
    {
      title: t("errorLogs.time"), dataIndex: "createdAt", width: 174,
      render: (value: string) => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(language === "zh" ? "zh-CN" : "en-US");
      },
    },
    {
      title: t("errorLogs.source"), dataIndex: "source", width: 110,
      render: (source: ErrorLogEntry["source"]) => (
        <Tag color={source === "proxy" ? "error" : "default"}>
          {t(source === "proxy" ? "errorLogs.proxy" : "errorLogs.toast")}
        </Tag>
      ),
    },
    {
      title: t("errorLogs.message"), dataIndex: "message",
      render: (message: string) => <div className={styles.message}>{message}</div>,
    },
    {
      title: t("errorLogs.status"), dataIndex: "statusCode", width: 96,
      render: (status?: number | null) => status ?? "—",
    },
  ];
}

function LogToolbar({ logs, t }: { logs: ReturnType<typeof useErrorLogs>; t: Translate }) {
  const busy = logs.operation !== null;
  return (
    <div className={styles.toolbar}>
      <Segmented<ErrorLogFilter> value={logs.filter} disabled={busy} onChange={logs.setFilter}
        options={[
          { value: "all", label: t("errorLogs.all") },
          { value: "proxy", label: t("errorLogs.proxy") },
          { value: "toast", label: t("errorLogs.toast") },
        ]} />
      <div className={styles.actions}>
        <Button size="small" icon={<RefreshCw size={14} />} loading={logs.operation === "refresh"}
          disabled={busy} onClick={() => void logs.load()}>{t("errorLogs.refresh")}</Button>
        <Popconfirm title={t("errorLogs.clearTitle")} description={t("errorLogs.clearDescription")}
          okText={t("errorLogs.clear")} cancelText={t("errorLogs.cancel")}
          okButtonProps={{ danger: true }} styles={{ root: { maxWidth: 400 }, body: { maxWidth: 400 } }}
          onConfirm={() => logs.clear()} onOpenChange={logs.setPollingPaused} disabled={busy}>
          <Button size="small" danger icon={<Trash2 size={14} />} loading={logs.operation === "clear"}
            disabled={busy}>{t("errorLogs.clear")}</Button>
        </Popconfirm>
      </div>
    </div>
  );
}

export function ErrorLogsPage({ language, t }: ErrorLogsPageProps) {
  const logs = useErrorLogs();
  const busy = logs.operation !== null;
  return (
    <section className={styles.page} aria-label={t("errorLogs.title")}>
      <LogToolbar logs={logs} t={t} />
      {logs.error && <Alert type="error" showIcon className={styles.error}
        message={t(logs.error === "clear" ? "errorLogs.clearFailed" : "errorLogs.loadFailed")} />}
      <Table<ErrorLogEntry> rowKey="id" size="small" tableLayout="fixed" columns={logColumns({ language, t })}
        dataSource={logs.entries} pagination={false} loading={!logs.entries.length && busy}
        locale={{ emptyText: t("errorLogs.empty") }} scroll={{ x: 700 }} />
      <div className={styles.footer}>
        <span>{t("errorLogs.count", { count: logs.entries.length, limit: ERROR_LOG_RETENTION_LIMIT })}</span>
        {logs.hasMore && <Button size="small" loading={logs.operation === "more"} disabled={busy}
          onClick={() => void logs.load("more")}>{t("errorLogs.loadMore")}</Button>}
      </div>
    </section>
  );
}
