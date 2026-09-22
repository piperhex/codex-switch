import { Button, Progress, Tag, type TableColumnsType } from "antd";
import { Eye } from "lucide-react";
import type { Translate } from "../../i18n";
import type { ProxySession } from "../../types";
import { formatTokens, maskEmail, SessionTokenChart, shortSessionId } from "./sessionCells";
import styles from "./index.module.less";

export type ActivityFilter = "active" | "idle";
interface SessionCellProps { session: ProxySession; t: Translate }
interface SessionColumnsOptions {
  activityFilter: ActivityFilter[];
  openRequestDetails: (session: ProxySession) => void;
  t: Translate;
}

function SessionConversation({ session, t }: SessionCellProps) {
  return <div className={styles.sessionCell + " " + styles.sessionTitle}>
    <strong title={session.title || undefined}>
      {session.title || t("providers.proxy.sessionsConversationUnknown")}
    </strong>
    <span title={session.id}>{shortSessionId(session.id)}</span>
  </div>;
}

function SessionConnection({ session }: { session: ProxySession }) {
  const client = [session.client, session.remoteAddress].filter(Boolean).join(" · ");
  return <div className={styles.sessionCell}>
    <strong title={session.id}>{shortSessionId(session.id)}</strong>
    <span title={client}>{client}</span>
  </div>;
}

function SessionTarget({ session }: { session: ProxySession }) {
  return <div className={styles.sessionCell}>
    <strong>{session.provider || "—"}</strong>
    <span>{[maskEmail(session.accountEmail), session.model].filter(Boolean).join(" · ") || "—"}</span>
  </div>;
}

function SessionContext({ session, t }: SessionCellProps) {
  const used = session.contextTokens;
  const total = session.modelContextWindow;
  if (used == null) return <span className={styles.muted}>{t("providers.proxy.sessionsContextUnknown")}</span>;
  const percent = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return <div className={styles.sessionContext}>
    <span>{total
      ? t("providers.proxy.sessionsContextValue", { used: formatTokens(used), total: formatTokens(total) })
      : formatTokens(used)}</span>
    {total ? <Progress percent={percent} showInfo={false} size="small" /> : null}
  </div>;
}

function SessionActivity({ session, t, onOpen }: SessionCellProps & { onOpen: () => void }) {
  return <div className={styles.activity}>
    <div>
      <Tag color={session.activeRequests > 0 ? "processing" : "default"}>
        {t(session.activeRequests > 0 ? "providers.proxy.sessionsActive" : "providers.proxy.sessionsIdle")}
      </Tag>
      <span>{t("providers.proxy.sessionsRequests", { count: session.requestCount })}</span>
      <Button className={styles.requestDetailsButton} type="link" size="small"
        icon={<Eye size={12} />} onClick={onOpen}>{t("providers.proxy.sessionsRequestDetails")}</Button>
    </div>
    <span title={new Date(session.lastSeenAt * 1000).toLocaleString()}>
      {t("providers.proxy.sessionsLastSeen", { time: new Date(session.lastSeenAt * 1000).toLocaleTimeString() })}
    </span>
  </div>;
}

export function sessionColumns({ activityFilter, openRequestDetails, t }: SessionColumnsOptions)
  : TableColumnsType<ProxySession> {
  return [
    {
      title: t("providers.proxy.sessionsConversation"), key: "conversation", width: 140,
      render: (_, session) => <SessionConversation session={session} t={t} />,
    },
    {
      title: t("providers.proxy.sessionsConnection"), key: "connection", width: 180,
      render: (_, session) => <SessionConnection session={session} />,
    },
    {
      title: t("providers.proxy.sessionsTarget"), key: "target", width: 220,
      render: (_, session) => <SessionTarget session={session} />,
    },
    {
      title: t("providers.proxy.sessionsContext"), key: "context", width: 190,
      render: (_, session) => <SessionContext session={session} t={t} />,
    },
    {
      title: t("providers.proxy.sessionsTokens"), key: "tokens", width: 120, align: "center",
      render: (_, session) => <div className={styles.tokenChart}><SessionTokenChart session={session} t={t} /></div>,
    },
    {
      title: t("providers.proxy.sessionsActivity"), dataIndex: "activity", key: "activity", width: 220,
      filters: [
        { text: t("providers.proxy.sessionsActive"), value: "active" },
        { text: t("providers.proxy.sessionsIdle"), value: "idle" },
      ],
      filteredValue: activityFilter, filterMultiple: false,
      onFilter: (value, session) => value === "active" ? session.activeRequests > 0 : session.activeRequests === 0,
      render: (_, session) => <SessionActivity session={session} t={t} onOpen={() => openRequestDetails(session)} />,
    },
  ];
}
